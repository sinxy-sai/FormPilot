import { inspectPage } from './page-inspector.mjs';
import { executeTool } from './control-executor.mjs';
import { validatePlannedAction } from './action-guard.mjs';
import { normalizePlannedAction } from './action-tools.mjs';
import { verifyAction } from './result-verifier.mjs';
import { buildActionModelInput, validateActionProposal } from '../ai/schema.mjs';
import { unavailableProvider } from '../ai/provider.mjs';
import { findStrategies, saveStrategy, recordStrategyResult } from '../core/strategy-cache.mjs';

const clone = value => value && typeof value === 'object' ? structuredClone(value) : value;
const taskState = (task = {}) => ({ ...task, status: task.status || 'pending', step: Number.isInteger(task.step) ? task.step : 0, failures: Number.isInteger(task.failures) ? task.failures : 0, history: Array.isArray(task.history) ? task.history.slice() : [] });

export function createRuntimeContext({ resume = {}, pageModel = {}, task = {}, strategies = [], ...options } = {}) {
  return { resume: clone(resume) || {}, pageModel: clone(pageModel) || {}, task: taskState(clone(task) || {}), strategies: Array.isArray(strategies) ? strategies.slice() : [], provider: options.provider || unavailableProvider, ...options };
}

function ruleCandidate(context) {
  const t = context.task || {};
  if (t.nextAction) return t.nextAction;
  if (Array.isArray(t.plan)) {
    const item = t.plan.find(x => x && !['verified','completed','skipped'].includes(x.status) && (x.action || x.tool));
    if (item) return item.action || item;
  }
  const strategy = (context.strategies || []).find(s => Array.isArray(s.steps) && s.steps[context.task.step]);
  return strategy?.steps?.[context.task.step] || null;
}

export async function planNextStep(context) {
  if (!context || typeof context !== 'object') throw new TypeError('context required');
  const page = context.pageModel || {};
  if (context.task?.status === 'complete' || context.task?.status === 'completed') return { status: 'complete', reason: 'task-complete' };
  const cached = ruleCandidate(context);
  if (cached) {
    const checked = validateActionProposal(cached, page);
    if (checked.status === 'proposed') return { status: 'action', action: checked, reason: 'strategy-or-rule', confidence: checked.confidence };
  }
  const input = buildActionModelInput(page, context.task || {});
  let raw;
  try { raw = await (context.provider || unavailableProvider).generate(input, { signal: context.signal }); } catch { raw = { status: 'abstain', reason: 'provider-error' }; }
  if (raw?.status === 'abstain') return { status: 'manual', reason: raw.reason || 'model-abstained' };
  const checked = validateActionProposal(raw, page);
  if (checked.status !== 'proposed') return { status: 'manual', reason: checked.reason || 'invalid-model-action' };
  const gate = validatePlannedAction(checked, { pageModel: page, resume: context.resume, task: context.task });
  if (!gate.allowed) return gate.requiresUser ? { status: 'manual', action: checked, reason: gate.reason } : { status: 'blocked', action: checked, reason: gate.reason };
  return { status: checked.tool === 'ask_user' ? 'manual' : 'action', action: checked, reason: checked.reason || 'model', confidence: checked.confidence };
}

export async function runNextStep(context) {
  if (!context || typeof context !== 'object') throw new TypeError('context required');
  const before = context.pageModel || {};
  const inspected = typeof context.inspect === 'function' ? await context.inspect(context) : null;
  if (inspected?.pageModel) context.pageModel = inspected.pageModel;
  const page = context.pageModel || {};
  if (before.fingerprint && page.fingerprint && before.fingerprint !== page.fingerprint) { context.task = { ...context.task, pageFingerprint: page.fingerprint, status: 'pending', failures: 0 }; }
  const decision = await planNextStep(context);
  const task = taskState(context.task);
  task.lastDecision = decision;
  task.pageFingerprint = page.fingerprint || task.pageFingerprint;
  if (decision.status !== 'action') {
    task.status = decision.status === 'complete' ? 'completed' : decision.status;
    context.task = task;
    return { ...task, decision, pageModel: page };
  }
  const rawAction = decision.action || {}; const { status: _proposalStatus, ...actionInput } = rawAction; const action = normalizePlannedAction(actionInput, page);
  if (action?.rejected) { task.status = 'blocked'; task.lastReason = action.reason; context.task = task; return { ...task, decision: { status:'blocked', reason: action.reason }, pageModel: page }; }
  const gate = validatePlannedAction(action, { pageModel: page, resume: context.resume, task });
  if (!gate.allowed) { task.status = gate.requiresUser ? 'manual' : 'blocked'; task.lastReason = gate.reason; context.task = task; return { ...task, decision: { status: task.status, action, reason: gate.reason }, pageModel: page }; }
  let result;
  try {
    result = typeof context.execute === 'function' ? await context.execute(action, context) : await executeTool(context.document, action, { pageFingerprint: page.fingerprint });
    if (typeof context.verify === 'function') result = await context.verify(result, action, context) || result;
    else if (result && result.status !== 'verified' && context.document) { const v = await verifyAction(context.document, action, result, { pageFingerprint: page.fingerprint }); result = { ...result, status: v.verified ? 'verified' : 'skipped', reason: v.reason }; }
  } catch (error) { result = { status: 'skipped', reason: 'execution-error', error: String(error?.message || error) }; }
  const ok = result?.status === 'verified' || result?.status === 'success' || result?.verified === true;
  task.lastAction = action; task.lastResult = result; task.step += ok ? 1 : 0; task.failures = ok ? 0 : task.failures + 1;
  task.history = task.history.concat([{ action, result, step: task.step, at: new Date().toISOString() }]).slice(-50);
  if (ok) { task.status = 'pending'; if (context.recordStrategy) await context.recordStrategy(action, result, context); }
  else if (task.failures >= (context.maxFailures ?? 3)) { task.status = 'manual'; task.lastReason = result?.reason || 'repeated-failure'; }
  else task.status = 'pending';
  context.task = task;
  return { ...task, decision, pageModel: page };
}

export async function loadStrategiesForContext(context) {
  if (context.strategies?.length) return context.strategies;
  const p = context.pageModel || {}; const id = p.pageIdentity || {};
  try { context.strategies = await findStrategies({ origin:id.origin, route:id.route, pageFingerprint:p.fingerprint, capabilityVersions:p.capabilityVersions }); } catch { context.strategies = []; }
  return context.strategies;
}

export async function recordRuntimeStrategy(context, action, result) {
  const p = context.pageModel || {}; const id = p.pageIdentity || {}; const existing = context.strategies?.[0];
  if (existing?.id) return recordStrategyResult(existing.id, result);
  if (!id.origin || !id.route || !p.fingerprint) return null;
  return saveStrategy({ scope:{origin:id.origin,route:id.route}, structureFingerprint:p.fingerprint, capabilityVersions:p.capabilityVersions || {}, steps:[action], successCount:1, lastValidatedAt:new Date().toISOString() });
}

