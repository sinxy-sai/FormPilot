/**
 * Background service worker (fill engine v2, task D — orchestration).
 *
 * Owns the review→backup→fill loop from docs/specs/2026-11-05-fill-engine-v2.md
 * §6:
 *   snapshot → inspect → plan → execute steps (re-inspect + re-plan after an
 *   add-item succeeds, max 3 passes) → aggregate { results, plan, summary }.
 *
 * Invariants enforced here (second line of defence, the content script also
 * refuses forbidden steps):
 *  - the first mutation of a page is always preceded by a successful snapshot;
 *  - only fill/select/check/add-item steps are ever sent down;
 *  - nothing whose label looks like save/submit/apply/preview/confirm is sent;
 *  - navigation invalidates the session but backups stay on disk.
 */
import { createLogger } from './core/logger.mjs';
import { buildResumeIndex } from './core/resume-index.mjs';
import {
  BACKUP_LIMIT,
  loadBackups,
  loadLatestBackup,
  saveBackup,
  findBackup,
  loadPageRunState,
  savePagePlan,
  savePageResult
} from './core/storage.mjs';

const log = createLogger('background');
const MAX_PASSES = 3;
const MAX_STEPS = 200;
const MAX_ADD_CLICKS_PER_ACTION = 10;
const ALLOWED_STEP_KINDS = new Set(['fill', 'select', 'check', 'add-item']);
const RESTRICTED_URL = /^(chrome|edge|about|devtools|chrome-extension|moz-extension):/i;
const FORBIDDEN_LABEL = /(?:submit|save|send|apply|finish|final|confirm|preview|publish|delete|remove|captcha|登录|保存|提交|投递|申请|预览|确认|发布|发送|取消|删除|移除|同意|授权|签署|consent|agree|terms|privacy)/i;

/** tabId → { identity, lastPlan, lastResult, invalidatedReason } (memory only) */
const sessions = new Map();

/* ------------------------------------------------------------ chrome plumbing */

const isMissingReceiver = (error) => /Receiving end does not exist|Could not establish connection/i.test(String(error?.message || error));

async function sendMessage(tabId, message, frameId) {
  const options = Number.isInteger(frameId) ? { frameId } : undefined;
  return options ? chrome.tabs.sendMessage(tabId, message, options) : chrome.tabs.sendMessage(tabId, message);
}

async function ensureContentScript(tabId, frameId) {
  if (!chrome.scripting?.executeScript) return false;
  const target = Number.isInteger(frameId) ? { tabId, frameIds: [frameId] } : { tabId };
  try {
    await chrome.scripting.executeScript({ target, files: ['src/content.js'] });
    return true;
  } catch (error) {
    log.warn('content-inject-failed', { tabId, frameId, error: String(error?.message || error) });
    return false;
  }
}

async function send(tabId, message, frameId) {
  try {
    return await sendMessage(tabId, message, frameId);
  } catch (error) {
    if (!isMissingReceiver(error)) throw error;
    log.info('content-recover', { tabId, frameId, type: message?.type });
    // 扩展重载后，旧标签页里的 content script 会失效；先确认目标标签页还能注入脚本，
    // 再补注入并重试一次。不能注入时抛出稳定错误码，让侧边栏给出可操作提示。
    const tab = await getTab(tabId);
    if (tab && /^(?:chrome|edge|about|devtools|chrome-extension|edge-extension|view-source):/i.test(String(tab.url ?? ''))) throw new Error('unsupported-page');
    const injected = await ensureContentScript(tabId, frameId);
    if (!injected) throw new Error('content-unavailable');
    try {
      return await sendMessage(tabId, message, frameId);
    } catch (retryError) {
      log.warn('content-retry-failed', { tabId, frameId, error: String(retryError?.message || retryError) });
      throw new Error(isMissingReceiver(retryError) ? 'content-unavailable' : String(retryError?.message || retryError));
    }
  }
}

/** Send a page message and normalize an `{ error }` payload into a throw. */
async function request(tabId, message, frameId) {
  const response = await send(tabId, message, frameId);
  if (!response) throw new Error(`${message.type}-empty-response`);
  if (response.error) throw new Error(String(response.error));
  return response;
}

async function getTab(tabId) {
  try { return await chrome.tabs.get(tabId); } catch { return null; }
}

async function resolveTabId(message = {}, sender = {}) {
  if (Number.isInteger(message.tabId)) return message.tabId;
  if (Number.isInteger(sender?.tab?.id)) return sender.tab.id;
  if (chrome.tabs?.query) {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (Number.isInteger(tabs?.[0]?.id)) return tabs[0].id;
  }
  throw new Error('tabId required');
}

async function assertUsableTab(tabId) {
  const tab = await getTab(tabId);
  if (!tab) throw new Error('tab-not-found');
  if (RESTRICTED_URL.test(String(tab.url ?? ''))) throw new Error('unsupported-page');
  return tab;
}

const pageIdentityFromUrl = (url) => {
  try {
    const parsed = new URL(String(url ?? ''));
    return { origin: parsed.origin, route: `${parsed.pathname}${parsed.search}`, title: '' };
  } catch {
    return { origin: '', route: '' };
  }
};

/* --------------------------------------------------------------- guards */

function findStepTarget(step, pageModel) {
  if (!step) return null;
  if (step.kind === 'add-item') return (pageModel?.actions ?? []).find(action => action.actionId === step.actionId) ?? null;
  return (pageModel?.controls ?? []).find(control => control.controlId === step.controlId) ?? null;
}

/** Re-validate every step right before it leaves the worker. */
export function guardStep(step, pageModel) {
  if (!step || typeof step !== 'object') return { allowed: false, reason: 'invalid-step' };
  if (!ALLOWED_STEP_KINDS.has(step.kind)) return { allowed: false, reason: 'forbidden-kind' };
  if (step.kind === 'add-item' && (typeof step.actionId !== 'string' || !step.actionId)) return { allowed: false, reason: 'missing-action' };
  if (step.kind !== 'add-item' && (typeof step.controlId !== 'string' || !step.controlId)) return { allowed: false, reason: 'missing-control' };
  const target = findStepTarget(step, pageModel);
  if (!target) return { allowed: false, reason: step.kind === 'add-item' ? 'action-not-found' : 'control-not-found' };
  if (step.kind === 'add-item') {
    // Only "add an item" buttons are clickable, and never a save/cancel/submit one.
    if (FORBIDDEN_LABEL.test(`${target.label ?? ''} ${target.sectionLabel ?? ''}`)) return { allowed: false, reason: 'forbidden-target' };
    return { allowed: true, target };
  }
  const controlType = String(target.controlType ?? '').toLowerCase();
  if (controlType === 'file' || controlType === 'button' || controlType === 'submit') return { allowed: false, reason: 'forbidden-target' };
  if (target.disabled === true || target.readonly === true) return { allowed: false, reason: 'control-not-editable' };
  return { allowed: true, target };
}

const stepSignature = (step) => `${step.kind}:${step.controlId ?? step.actionId ?? ''}:${JSON.stringify(step.value ?? null)}`;

function summarizeResults(results = []) {
  const summary = { total: results.length, ok: 0, conflict: 0, failed: 0, skipped: 0, manual: 0 };
  for (const result of results) {
    switch (result?.status) {
      case 'done':
      case 'verified': summary.ok += 1; break;
      case 'conflict': summary.conflict += 1; break;
      case 'failed': summary.failed += 1; break;
      case 'manual': summary.manual += 1; break;
      default: summary.skipped += 1;
    }
  }
  return summary;
}

/** Turn an executor StepResult into a review-table row with its step context. */
function recordResult(step, outcome) {
  const status = outcome?.status ?? 'failed';
  const isAdd = step.kind === 'add-item';
  return {
    stepId: step.stepId ?? outcome?.stepId ?? null,
    kind: step.kind,
    controlId: step.controlId ?? null,
    actionId: step.actionId ?? null,
    fieldKey: step.fieldKey ?? '',
    sectionKey: step.sectionKey ?? '',
    itemIndex: Number.isInteger(step.itemIndex) ? step.itemIndex : null,
    value: step.value,
    expected: isAdd ? step.value : (outcome?.after ?? step.value),
    before: outcome?.before,
    after: outcome?.after,
    sourcePath: Array.isArray(step.sourcePath) ? step.sourcePath : [],
    confidence: Number.isFinite(Number(step.confidence)) ? Number(step.confidence) : null,
    status,
    reason: outcome?.reason ?? '',
    changed: outcome?.changed === true
  };
}

/** Stable, non-reversible resume fingerprint attached to each pre-fill backup. */
function resumeFingerprint(resume) {
  try {
    const text = JSON.stringify(resume);
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return `resume-${(hash >>> 0).toString(16)}-${text.length}`;
  } catch {
    return 'resume-unhashable';
  }
}

/* --------------------------------------------------------------- planning */

async function loadResumeIndex(resume) {
  // 必须是顶层静态 import：MV3 service worker 里 `import()` 被 HTML 规范禁止
  // （"import() is disallowed on ServiceWorkerGlobalScope"），动态导入会永远失败。
  try {
    return { index: buildResumeIndex(resume) };
  } catch (error) {
    log.warn('resume-index-unavailable', { error: String(error?.message || error) });
    return { index: null, unavailable: true };
  }
}

const normalizeMode = (mode) => (mode === 'overwrite' ? 'overwrite' : 'fill-empty');

async function planFor(tabId, resume, mode) {
  const response = await request(tabId, { type: 'plan-fill', resume, mode });
  if (!response?.plan || !Array.isArray(response.plan.steps)) throw new Error('plan-invalid');
  return { plan: response.plan, pageIdentity: response.pageIdentity, pageFingerprint: response.pageFingerprint };
}

/* --------------------------------------------------------------- handlers */

async function inspectPage(message, sender) {
  const tabId = await resolveTabId(message, sender);
  const tab = await assertUsableTab(tabId);
  const response = await request(tabId, { type: 'inspect-page' });
  if (!response?.pageModel) throw new Error('inspect-failed');
  const identity = response.pageModel.pageIdentity ?? pageIdentityFromUrl(tab?.url);
  let stored = { backups: [], latestBackup: null, plan: null, result: null };
  try { stored = await loadPageRunState(identity); } catch (error) { log.warn('run-state-load-failed', { error: String(error?.message || error) }); }
  if (!sessions.has(tabId)) sessions.set(tabId, { identity });
  else sessions.get(tabId).identity = identity;
  return {
    pageModel: response.pageModel,
    diagnostics: Array.isArray(response.diagnostics) ? response.diagnostics : [],
    pageIdentity: identity,
    backups: stored.backups ?? [],
    latestBackup: stored.latestBackup ?? null,
    plan: stored.plan ?? null,
    result: stored.result ?? null,
    tab: { id: tabId, url: tab?.url ?? '', title: tab?.title ?? '' }
  };
}

async function refreshPlan(message, sender) {
  const tabId = await resolveTabId(message, sender);
  await assertUsableTab(tabId);
  const resume = message?.resume;
  if (!resume || typeof resume !== 'object') throw new Error('resume-required');
  const mode = normalizeMode(message?.mode);
  const { plan, pageIdentity } = await planFor(tabId, resume, mode);
  const identity = pageIdentity ?? sessions.get(tabId)?.identity ?? pageIdentityFromUrl((await getTab(tabId))?.url);
  const session = sessions.get(tabId) ?? {};
  sessions.set(tabId, { ...session, identity, lastPlan: plan, invalidatedReason: null });
  try { await savePagePlan(identity, plan); } catch (error) { log.warn('plan-save-failed', { error: String(error?.message || error) }); }
  return { plan, pageIdentity: identity, summary: plan.summary ?? null };
}

async function createBackup(message, sender) {
  const tabId = await resolveTabId(message, sender);
  await assertUsableTab(tabId);
  const snapshot = await request(tabId, { type: 'snapshot-page', reason: String(message?.reason ?? 'manual') });
  if (!snapshot?.backup) throw new Error('snapshot-failed');
  const saved = await saveBackup(snapshot.backup, { limit: BACKUP_LIMIT });
  log.info('backup-saved', { tabId, controls: saved.backup.controls.length, backups: saved.backups.length });
  return { backup: saved.backup, backups: saved.backups };
}

async function restoreBackup(message, sender) {
  const tabId = await resolveTabId(message, sender);
  const tab = await assertUsableTab(tabId);
  const identity = message?.pageIdentity ?? sessions.get(tabId)?.identity ?? pageIdentityFromUrl(tab?.url);
  let backup = message?.backup ?? null;
  if (!backup) backup = message?.backupId ? await findBackup(identity, message.backupId) : await loadLatestBackup(identity);
  if (!backup) throw new Error('no-backup');
  const response = await request(tabId, { type: 'restore-backup', backup });
  log.info('backup-restored', { tabId, restored: response?.restored ?? 0, failed: response?.failed ?? 0 });
  return { backup, restored: Number(response?.restored) || 0, failed: Number(response?.failed) || 0 };
}

async function undoFill(message, sender) {
  const tabId = await resolveTabId(message, sender);
  await assertUsableTab(tabId);
  const response = await request(tabId, { type: 'undo-last-fill' });
  return { undone: Number(response?.undone) || 0, changed: response?.changed === true };
}

async function runFill(message, sender) {
  const tabId = await resolveTabId(message, sender);
  const tab = await assertUsableTab(tabId);
  const resume = message?.resume;
  if (!resume || typeof resume !== 'object') throw new Error('resume-required');
  const mode = normalizeMode(message?.mode);
  const maxPasses = Math.max(1, Math.min(MAX_PASSES, Number.isInteger(message?.maxPasses) ? message.maxPasses : MAX_PASSES));

  // 1. Mandatory snapshot before the first write. Without it we do not fill.
  let backup;
  try {
    const snapshot = await request(tabId, { type: 'snapshot-page', reason: 'before-fill' });
    if (!snapshot?.backup) throw new Error('snapshot-empty');
    const saved = await saveBackup({ ...snapshot.backup, resumeFingerprint: resumeFingerprint(resume) }, { limit: BACKUP_LIMIT });
    backup = saved.backup;
  } catch (error) {
    log.error('backup-before-fill-failed', { tabId, error: String(error?.message || error) });
    throw new Error(`backup-failed: ${String(error?.message || error)}`);
  }
  const identity = backup.pageIdentity ?? pageIdentityFromUrl(tab?.url);
  log.info('fill-start', { tabId, mode, identity, backupControls: backup.controls.length });

  // 2. inspect current page
  let inspected = await request(tabId, { type: 'inspect-page' });
  if (!inspected?.pageModel) throw new Error('inspect-failed');
  let pageModel = inspected.pageModel;

  const results = [];
  const executed = new Set();
  const addClicks = new Map();
  let finalPlan = null;
  let passes = 0;

  for (let pass = 0; pass < maxPasses && results.length < MAX_STEPS; pass += 1) {
    passes += 1;
    let planned;
    try {
      planned = await planFor(tabId, resume, mode);
    } catch (error) {
      log.warn('plan-pass-failed', { pass, error: String(error?.message || error) });
      break;
    }
    finalPlan = planned.plan;
    const ready = finalPlan.steps.filter(step => step?.status === 'ready');
    if (!ready.length) break;
    let replan = false;
    let progressed = false;
    for (const step of ready) {
      if (results.length >= MAX_STEPS) break;
      const key = stepSignature(step);
      const isAdd = step.kind === 'add-item';
      if (isAdd) {
        const clicks = addClicks.get(step.actionId) ?? 0;
        if (clicks >= MAX_ADD_CLICKS_PER_ACTION) continue;
      } else if (executed.has(key)) {
        continue;
      }
      const gate = guardStep(step, pageModel);
      if (!gate.allowed) {
        log.warn('step-blocked', { stepId: step.stepId, kind: step.kind, reason: gate.reason });
        results.push(recordResult(step, { status: 'skipped', reason: gate.reason, changed: false }));
        executed.add(key);
        continue;
      }
      let outcome;
      try {
        if (isAdd) {
          const action = gate.target;
          addClicks.set(step.actionId, (addClicks.get(step.actionId) ?? 0) + 1);
          outcome = await request(tabId, { type: 'execute-action', action, pageFingerprint: pageModel.fingerprint });
          results.push(recordResult(step, outcome));
          if (['done', 'verified'].includes(outcome?.status)) {
            // 确认「添加」真的新增了条目：条目数没涨说明按钮点了但页面没反应，
            // 必须当作失败停止，否则会反复点击「添加」产生重复卡片。
            const beforeCount = pageModel.sections?.find(item => item.key === step.sectionKey)?.itemCount ?? 0;
            const reinforced = await request(tabId, { type: 'inspect-page' }).catch(() => null);
            if (reinforced?.pageModel) pageModel = reinforced.pageModel;
            const afterCount = pageModel.sections?.find(item => item.key === step.sectionKey)?.itemCount ?? beforeCount;
            if (afterCount <= beforeCount) {
              results[results.length - 1] = recordResult(step, { status: 'failed', reason: 'add-item-not-effective', changed: false });
              break;
            }
            replan = true;
            progressed = true;
            break;
          }
        } else {
          outcome = await request(tabId, { type: 'execute-step', step, pageFingerprint: pageModel.fingerprint, mode });
          executed.add(key);
          results.push(recordResult(step, outcome));
          if (['done', 'verified'].includes(outcome?.status)) progressed = true;
          if (outcome?.status === 'failed' && /page-changed|page-fingerprint|target-missing|control-not-found/i.test(String(outcome.reason ?? ''))) {
            replan = true;
            break;
          }
        }
      } catch (error) {
        executed.add(key);
        results.push(recordResult(step, { status: 'failed', reason: String(error?.message || error), changed: false }));
      }
    }
    if (!replan) break;
    // Re-inspect after add-item / page change, then re-plan on the next pass.
    try {
      inspected = await request(tabId, { type: 'inspect-page' });
      if (inspected?.pageModel) pageModel = inspected.pageModel;
    } catch (error) {
      log.warn('reinspect-failed', { error: String(error?.message || error) });
      break;
    }
    if (!progressed) break;
  }

  const summary = summarizeResults(results);
  const identityFinal = pageModel?.pageIdentity ?? identity;
  const backups = await loadBackups(identityFinal).catch(() => []);
  try {
    if (finalPlan) await savePagePlan(identityFinal, finalPlan);
    await savePageResult(identityFinal, { results, summary, mode, finishedAt: new Date().toISOString() });
  } catch (error) {
    log.warn('fill-state-save-failed', { error: String(error?.message || error) });
  }
  const session = sessions.get(tabId) ?? {};
  sessions.set(tabId, { ...session, identity: identityFinal, lastPlan: finalPlan, lastResult: { results, summary } });
  log.info('fill-done', { tabId, passes, ...summary });
  return { results, plan: finalPlan, summary, backup, backups, pageModel, mode, passes };
}

async function runState(message, sender) {
  const tabId = await resolveTabId(message, sender);
  const tab = await getTab(tabId);
  const identity = message?.pageIdentity ?? sessions.get(tabId)?.identity ?? pageIdentityFromUrl(tab?.url);
  const stored = await loadPageRunState(identity).catch(() => ({ backups: [], latestBackup: null, plan: null, result: null }));
  return { ...stored, pageIdentity: identity };
}

async function analyzeResume(message) {
  const resume = message?.resume;
  if (!resume || typeof resume !== 'object') throw new Error('resume-required');
  const { index, unavailable } = await loadResumeIndex(resume);
  if (unavailable) return { index: null, notice: 'resume-index-unavailable' };
  return { index };
}

/* --------------------------------------------------------------- routing */

function broadcastInvalidation(tabId, reason) {
  if (!chrome.runtime?.sendMessage) return;
  try {
    const result = chrome.runtime.sendMessage({ type: 'page/invalidated', tabId, reason });
    result?.catch?.(() => {});
  } catch { /* no side panel listener is fine */ }
}

export async function handleMessage(message, sender = {}) {
  switch (message?.type) {
    case 'page/inspect': return inspectPage(message, sender);
    case 'backup/create': return createBackup(message, sender);
    case 'backup/restore': return restoreBackup(message, sender);
    case 'plan/refresh': return refreshPlan(message, sender);
    case 'fill/run': return runFill(message, sender);
    case 'fill/undo': return undoFill(message, sender);
    case 'resume/analyze': return analyzeResume(message, sender);
    case 'run/state': return runState(message, sender);
    default: return null;
  }
}

export function invalidateSession(tabId, reason = 'navigation') {
  if (!Number.isInteger(tabId)) return;
  const session = sessions.get(tabId);
  sessions.delete(tabId);
  if (session) log.info('session-invalidated', { tabId, reason });
  broadcastInvalidation(tabId, reason);
}

if (globalThis.chrome?.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (!message || typeof message.type !== 'string') return false;
    const handled = handleMessage(message, sender);
    if (!handled || typeof handled.then !== 'function') return false;
    handled.then(respond).catch(error => {
      log.error('message-failed', { type: message.type, error: String(error?.stack || error) });
      respond({ error: String(error?.message || error) });
    });
    return true;
  });
}

if (globalThis.chrome?.tabs?.onUpdated) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (!changeInfo) return;
    if (!changeInfo.url && changeInfo.status !== 'loading') return;
    invalidateSession(tabId, changeInfo.url ? 'url-changed' : 'reload');
  });
}

if (globalThis.chrome?.tabs?.onRemoved) {
  chrome.tabs.onRemoved.addListener(tabId => { sessions.delete(tabId); });
}
