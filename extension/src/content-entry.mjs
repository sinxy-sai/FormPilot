/**
 * Content-script entry (fill engine v2, task D — message surface).
 *
 * Transport only: it owns the page-side message protocol from docs/specs/
 * 2026-11-05-fill-engine-v2.md §6 and never clicks save/submit/preview/finish
 * buttons. The planner (core/matcher.mjs + core/resume-index.mjs) and the
 * executor (runtime/control-executor.mjs) are owned by other tasks; they are
 * resolved defensively so this entry keeps loading while they land in parallel.
 */
import { inspectPage } from './runtime/page-inspector.mjs';
import * as executorModule from './runtime/control-executor.mjs';
import { buildResumeIndex } from './core/resume-index.mjs';
import { planFill } from './core/matcher.mjs';
import { listCapabilities } from './adapters/capabilities.mjs';
import { createLogger } from './core/logger.mjs';

const log = createLogger('content');
const RUNTIME_VERSION = '2.0.0';
const documentId = globalThis.__formPilotDocumentId || (globalThis.__formPilotDocumentId = `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const contentMarker = 'data-formpilot-content-loaded';
const runtimeMarker = 'data-formpilot-runtime';
const alreadyLoaded = globalThis.__formPilotContentLoaded || document.documentElement?.hasAttribute(contentMarker);
const controlSelector = 'input, textarea, select, [role="combobox"], [contenteditable="true"]';
// Must match the executor guard and the background guard (contract §0 / §9):
// save, cancel, submit, preview, delete… are never clicked or accepted as steps.
const FORBIDDEN_LABEL = /(?:submit|save|send|apply|finish|final|confirm|preview|publish|delete|remove|captcha|登录|保存|提交|投递|申请|预览|确认|发布|发送|取消|删除|移除|同意|授权|签署|consent|agree|terms|privacy)/i;
const ALLOWED_STEP_KINDS = new Set(['fill', 'select', 'check', 'add-item']);

const executeStep = (...args) => typeof executorModule.executeStep === 'function'
  ? executorModule.executeStep(...args)
  : Promise.resolve({ status: 'failed', reason: 'executor-unavailable', changed: false });
const executeAction = (...args) => typeof executorModule.executeAction === 'function'
  ? executorModule.executeAction(...args)
  : Promise.resolve({ status: 'failed', reason: 'executor-unavailable', changed: false });
const runUndo = (...args) => typeof executorModule.undoLastFill === 'function'
  ? executorModule.undoLastFill(...args)
  : { undone: 0 };

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const queryAllDeep = (root, query) => {
  const output = [...(root?.querySelectorAll?.(query) || [])];
  for (const host of root?.querySelectorAll?.('*') || []) if (host.shadowRoot) output.push(...queryAllDeep(host.shadowRoot, query));
  return output;
};
const dispatchEvent = (element, type) => {
  try {
    const EventCtor = element?.ownerDocument?.defaultView?.Event || globalThis.Event;
    element?.dispatchEvent?.(new EventCtor(type, { bubbles: true }));
  } catch (error) {
    log.warn('dispatch-failed', { type, error: String(error?.message || error) });
  }
};

const countControls = (root) => {
  let count = 0;
  try { count += root?.querySelectorAll?.(controlSelector)?.length || 0; } catch { /* ignore */ }
  for (const host of root?.querySelectorAll?.('*') || []) if (host.shadowRoot) count += countControls(host.shadowRoot);
  return count;
};
const waitForControls = async (timeoutMs = 8000) => {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (countControls(document)) return true;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  return countControls(document) > 0;
};

const inspect = () => inspectPage(document, { capabilities: listCapabilities() });

const resolveElement = (pageModel, controlId) => {
  const control = pageModel?.controls?.find(item => item.controlId === controlId);
  if (!control?.selectorToken) return null;
  const index = Number(String(control.selectorToken).replace(/^control-token-/, ''));
  if (!Number.isInteger(index) || index < 0) return null;
  const elements = queryAllDeep(document, controlSelector).filter(element => element?.type !== 'file');
  return elements[index] ?? null;
};

/** Second line of defence: only benign step kinds and never sensitive targets. */
const guardStep = (step, pageModel) => {
  if (!step || typeof step !== 'object') return { allowed: false, reason: 'invalid-step' };
  if (!ALLOWED_STEP_KINDS.has(step.kind)) return { allowed: false, reason: 'forbidden-kind' };
  if (step.kind === 'add-item') {
    if (typeof step.actionId !== 'string' || !step.actionId) return { allowed: false, reason: 'missing-action' };
    const action = (pageModel.actions ?? []).find(item => item.actionId === step.actionId);
    if (!action) return { allowed: false, reason: 'action-not-found' };
    if (FORBIDDEN_LABEL.test(`${action.label ?? ''}`)) return { allowed: false, reason: 'forbidden-target' };
    return { allowed: true, target: action };
  }
  if (typeof step.controlId !== 'string' || !step.controlId) return { allowed: false, reason: 'missing-control' };
  const control = (pageModel.controls ?? []).find(item => item.controlId === step.controlId);
  if (!control) return { allowed: false, reason: 'control-not-found' };
  const controlType = String(control.controlType ?? '').toLowerCase();
  if (controlType === 'file' || controlType === 'button' || controlType === 'submit') return { allowed: false, reason: 'forbidden-target' };
  if (control.disabled === true || control.readonly === true) return { allowed: false, reason: 'control-not-editable' };
  return { allowed: true, target: control };
};

const buildBackup = (reason) => {
  const { pageModel, diagnostics } = inspect();
  return {
    backupId: `backup-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
    capturedAt: new Date().toISOString(),
    reason: String(reason ?? 'manual'),
    url: String(location.href),
    pageIdentity: pageModel.pageIdentity,
    fingerprint: pageModel.fingerprint,
    controls: pageModel.controls.map(control => ({
      controlId: control.controlId,
      label: control.label ?? '',
      value: control.value === undefined ? '' : control.value,
      controlType: control.controlType ?? '',
      ...(control.fieldKey === undefined ? {} : { fieldKey: control.fieldKey }),
      ...(control.sectionKey === undefined ? {} : { sectionKey: control.sectionKey }),
      ...(control.sectionId === undefined ? {} : { sectionId: control.sectionId }),
      ...(Number.isInteger(control.itemIndex) ? { itemIndex: control.itemIndex } : {})
    })),
    diagnostics: Array.isArray(diagnostics) ? diagnostics.length : 0
  };
};

const nativeSetter = (element, property) => {
  for (let prototype = Object.getPrototypeOf(element); prototype; prototype = Object.getPrototypeOf(prototype)) {
    const descriptor = Object.getOwnPropertyDescriptor(prototype, property);
    if (descriptor?.set) return descriptor.set;
  }
  return null;
};

const readValue = (element, control) => {
  if (!element) return '';
  if (control?.controlType === 'checkbox' || element.type === 'checkbox' || element.type === 'radio') return Boolean(element.checked);
  if (element.tagName?.toLowerCase() === 'select') return String(element.value ?? '');
  return String(element.value ?? element.textContent ?? '');
};

/** Restore one backed-up control value in place (never clicks buttons). */
const restoreControl = (element, control, value) => {
  if (!element) return { ok: false, reason: 'element-missing' };
  const type = String(control?.controlType ?? '').toLowerCase();
  if (type === 'checkbox' || type === 'radio') {
    const wanted = value === true || value === 'true' || value === '是';
    if (Boolean(element.checked) === wanted) return { ok: true };
    const setter = nativeSetter(element, 'checked');
    if (setter) setter.call(element, wanted); else element.checked = wanted;
    dispatchEvent(element, 'input');
    dispatchEvent(element, 'change');
    if (Boolean(element.checked) !== wanted) {
      try { element.click?.(); } catch { /* ignore */ }
    }
    return { ok: Boolean(element.checked) === wanted, reason: Boolean(element.checked) === wanted ? undefined : 'checkbox-restore-failed' };
  }
  if (element.tagName?.toLowerCase() === 'select') {
    const wanted = String(value ?? '');
    const option = [...(element.options || element.querySelectorAll?.('option') || [])]
      .find(item => text(item.value) === text(wanted) || text(item.textContent || item.text) === text(wanted));
    if (!option) return { ok: false, reason: 'option-not-found' };
    const setter = nativeSetter(element, 'value');
    if (setter) setter.call(element, option.value); else element.value = option.value;
    dispatchEvent(element, 'input');
    dispatchEvent(element, 'change');
    return { ok: String(element.value) === String(option.value), reason: 'select-restore-failed' };
  }
  const stringValue = value === undefined || value === null ? '' : String(value);
  if (element.isContentEditable || element.getAttribute?.('contenteditable') === 'true') {
    element.textContent = stringValue;
  } else {
    const setter = nativeSetter(element, 'value');
    if (setter) setter.call(element, stringValue); else element.value = stringValue;
  }
  dispatchEvent(element, 'input');
  dispatchEvent(element, 'change');
  dispatchEvent(element, 'blur');
  const actual = readValue(element, control);
  return { ok: String(actual) === stringValue, reason: String(actual) === stringValue ? undefined : 'readback-mismatch' };
};

/**
 * Locate the live control for a backup entry. `controlId` is stable within one
 * page-model generation; after a re-render (e.g. cards added/removed) we fall
 * back to section + item + fieldKey + label, and skip when nothing matches.
 */
const findCurrentControl = (pageModel, snapshot) => {
  const controls = (pageModel?.controls ?? []).filter(control => String(control?.controlType ?? '').toLowerCase() !== 'file');
  const byId = controls.find(control => control.controlId === snapshot.controlId);
  if (byId) return byId;
  const sameScope = controls.filter(control => (snapshot.sectionId === undefined || control.sectionId === snapshot.sectionId)
    && (snapshot.itemIndex === undefined || control.itemIndex === snapshot.itemIndex));
  if (snapshot.fieldKey) {
    const byField = sameScope.find(control => control.fieldKey === snapshot.fieldKey);
    if (byField) return byField;
  }
  if (snapshot.label) {
    const byLabel = sameScope.find(control => control.label === snapshot.label);
    if (byLabel) return byLabel;
  }
  if (snapshot.sectionKey) {
    const bySection = controls.find(control => control.sectionKey === snapshot.sectionKey
      && (snapshot.fieldKey ? control.fieldKey === snapshot.fieldKey : control.label === snapshot.label));
    if (bySection) return bySection;
  }
  return null;
};

const restoreBackup = (backup) => {
  if (!backup || typeof backup !== 'object' || !Array.isArray(backup.controls)) throw new Error('backup-required');
  const { pageModel } = inspect();
  let restored = 0;
  const failures = [];
  for (const control of backup.controls) {
    const current = findCurrentControl(pageModel, control);
    if (!current) { failures.push({ controlId: control.controlId, label: control.label, reason: 'control-not-found' }); continue; }
    const element = resolveElement(pageModel, current.controlId);
    const outcome = restoreControl(element, current, control.value);
    if (outcome.ok) restored += 1;
    else failures.push({ controlId: current.controlId, label: control.label, reason: outcome.reason ?? 'restore-failed' });
  }
  return { restored, failed: failures.length, failures: failures.slice(0, 20) };
};

const handleExecuteStep = async (message) => {
  const { pageModel } = inspect();
  const step = message?.step;
  const stepId = step?.stepId ?? null;
  const mode = message?.mode === 'overwrite' ? 'overwrite' : 'fill-empty';
  const gate = guardStep(step, pageModel);
  if (!gate.allowed) {
    log.warn('execute-step-blocked', { stepId, reason: gate.reason });
    return { stepId, status: 'failed', reason: gate.reason, changed: false };
  }
  const fingerprint = pageModel.fingerprint;
  if (message?.pageFingerprint && message.pageFingerprint !== fingerprint) return { stepId, status: 'failed', reason: 'page-changed', changed: false, pageFingerprint: fingerprint };
  const result = await executeStep(document, step, { pageModel, pageFingerprint: fingerprint, mode });
  return { ...result, stepId, kind: step.kind, pageFingerprint: fingerprint };
};

const handleExecuteAction = async (message) => {
  const { pageModel } = inspect();
  const actionId = typeof message?.action === 'string' ? message.action : message?.action?.actionId;
  const action = (pageModel.actions ?? []).find(item => item.actionId === actionId);
  if (!action) return { actionId, status: 'failed', reason: 'action-not-found', changed: false };
  if (action.kind !== 'add-item') return { actionId, status: 'failed', reason: 'forbidden-action', changed: false };
  if (FORBIDDEN_LABEL.test(`${action.label ?? ''}`)) return { actionId, status: 'failed', reason: 'forbidden-target', changed: false };
  const fingerprint = pageModel.fingerprint;
  if (message?.pageFingerprint && message.pageFingerprint !== fingerprint) return { actionId, status: 'failed', reason: 'page-changed', changed: false, pageFingerprint: fingerprint };
  const result = await executeAction(document, action, { pageModel, pageFingerprint: fingerprint });
  return { ...result, actionId, kind: 'add-item', pageFingerprint: fingerprint };
};

const handlePlan = (message) => {
  const resume = message?.resume;
  if (!resume || typeof resume !== 'object') throw new Error('resume-required');
  const mode = message?.mode === 'overwrite' ? 'overwrite' : 'fill-empty';
  const { pageModel } = inspect();
  const resumeIndex = buildResumeIndex(resume);
  const plan = planFill({ resumeIndex, pageModel, mode, limit: 200 });
  return { plan, pageIdentity: pageModel.pageIdentity, pageFingerprint: pageModel.fingerprint, summary: plan?.summary ?? null };
};

const handlers = {
  'formpilot-ping': () => ({ ok: true, documentId, runtimeVersion: '2.0.0' }),
  'inspect-page': async () => {
    await waitForControls();
    const { pageModel, diagnostics } = inspect();
    log.info('inspect-page', { controls: pageModel?.controls?.length ?? 0, fingerprint: pageModel?.fingerprint });
    return { runtimeVersion: '2.0.0', documentId, pageModel, diagnostics };
  },
  'snapshot-page': async (message) => ({ backup: buildBackup(message?.reason) }),
  'plan-fill': async (message) => handlePlan(message),
  'execute-step': (message) => handleExecuteStep(message),
  'execute-action': (message) => handleExecuteAction(message),
  'undo-last-fill': async () => {
    const result = runUndo(document) ?? {};
    return { undone: Number(result.undone) || 0, changed: result.changed === true };
  },
  'restore-backup': async (message) => restoreBackup(message?.backup)
};

/**
 * 只读自检：只有在 URL 上显式带上 `#formpilot-selfcheck` 时才运行。
 * 不写入任何字段、不点任何按钮，只把「识别到了什么」打到控制台，便于在真实站点上
 * 确认检查器/匹配器是否和新构建一致（扩展更新后页面需要刷新才会重新注入）。
 * 注意：必须定义在下面的自动执行块之前（const 没有变量提升）。
 */
const maybeRunSelfCheck = async () => {
  if (!String(globalThis.location?.hash || '').toLowerCase().includes('formpilot-selfcheck')) return;
  try {
    await waitForControls(15000);
    const { pageModel, diagnostics } = inspect();
    const fields = {};
    for (const control of pageModel.controls) {
      const key = `${control.sectionKey ?? '-'}/${control.fieldKey ?? '-'}`;
      fields[key] = (fields[key] ?? 0) + 1;
    }
    const report = {
      runtimeVersion: RUNTIME_VERSION,
      url: location.href,
      fingerprint: pageModel.fingerprint,
      controls: pageModel.controls.length,
      sections: pageModel.sections.map(section => ({ key: section.key ?? null, label: section.label, items: section.itemCount, add: Boolean(section.addActionId) })),
      actions: (pageModel.actions ?? []).map(action => action.actionId),
      fields,
      diagnostics
    };
    log.info('self-check', report);
    // 同时写成一个字符串 / DOM 属性：这样控制台里能直接复制，自动化也能读到。
    const reportJson = JSON.stringify(report);
    log.info('self-check-json', reportJson);
    try { document.documentElement?.setAttribute('data-formpilot-selfcheck', reportJson.slice(0, 20000)); } catch { /* attribute too large is fine to skip */ }
    const stored = await chrome.storage.local.get('resume');
    if (stored?.resume && typeof stored.resume === 'object') {
      const plan = planFill({ resumeIndex: buildResumeIndex(stored.resume), pageModel, mode: 'fill-empty', limit: 200 });
      const planReport = {
        summary: plan.summary,
        sample: plan.steps.slice(0, 12).map(step => ({ id: step.stepId, kind: step.kind, status: step.status, section: step.sectionKey, item: step.itemIndex, field: step.fieldKey, source: (step.sourcePath ?? []).join('.'), value: typeof step.value === 'string' ? step.value.slice(0, 40) : step.value, current: step.currentValue === undefined ? undefined : String(step.currentValue).slice(0, 30) }))
      };
      log.info('self-check-plan', planReport);
      log.info('self-check-plan-json', JSON.stringify(planReport));
      try { document.documentElement?.setAttribute('data-formpilot-selfcheck-plan', JSON.stringify(planReport).slice(0, 20000)); } catch { /* ignore */ }
    } else {
      log.info('self-check-plan', { skipped: 'no-resume-in-storage' });
    }
  } catch (error) {
    log.warn('self-check-failed', { error: String(error?.message || error) });
  }
};

if (typeof chrome !== 'undefined' && chrome.runtime && !alreadyLoaded) {
  globalThis.__formPilotContentLoaded = true;
  document.documentElement?.setAttribute(contentMarker, '');
  // 运行时版本标记：排查「页面里跑的到底是哪个构建」时用（扩展更新后需要重载扩展才能生效）。
  document.documentElement?.setAttribute(runtimeMarker, RUNTIME_VERSION);
  log.info('loaded', { url: location.href, documentId, runtimeVersion: RUNTIME_VERSION });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const handler = handlers[message?.type];
    if (!handler) return undefined;
    Promise.resolve()
      .then(() => handler(message))
      .then(result => sendResponse(result))
      .catch(error => {
        log.error('message-failed', { type: message?.type, error: String(error?.stack || error) });
        sendResponse({ error: String(error?.message || error) });
      });
    return true;
  });
  maybeRunSelfCheck();
}

export {
  handlers,
  guardStep,
  buildBackup,
  restoreBackup,
  handleExecuteStep,
  handleExecuteAction,
  handlePlan,
  maybeRunSelfCheck
};
