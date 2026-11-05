/**
 * FormPilot 运行时编排（规划层）。
 *
 * 新模型：plan → execute → 重新 inspect → 继续，全部是纯函数编排：
 *   - createRuntimeContext 组装 resumeIndex / pageModel / task；
 *   - planNextStep 只用确定性 matcher 产出下一步（本地模型缺省不参与，最多给只读建议）；
 *   - runNextStep 执行一步并记录 task 状态，下一次调用会先重新 inspect 再重新规划；
 *   - runFillLoop 是给 background 复用的驱动循环。
 *
 * 明确不再使用 `task.step` 当控件下标（旧实现 controls.slice(task.step) 的跨分区串味根因）。
 * task.step 现在只是「已执行成功步骤数」的计数器。
 *
 * execute / inspect / verify 由外部注入（background / content script），本模块不碰 DOM、不发起 IO。
 */

import { buildResumeIndex } from '../core/resume-index.mjs';
import { DEFAULT_LIMIT, planFill } from '../core/matcher.mjs';
import { validatePlannedStep } from './action-guard.mjs';
import { buildPlannerModelInput, validatePlannerSuggestion } from '../ai/schema.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => (value && typeof value === 'object' ? structuredClone(value) : value);

export const DEFAULT_MAX_FAILURES = 3;
export const DEFAULT_MAX_STEPS = 100;
const TERMINAL_STATUSES = new Set(['complete', 'completed', 'manual', 'blocked', 'stopped', 'cancelled']);

function normalizeTask(task = {}) {
  const source = record(task) ? task : {};
  return {
    ...clone(source),
    status: typeof source.status === 'string' ? source.status : 'pending',
    step: Number.isInteger(source.step) ? source.step : 0,
    passes: Number.isInteger(source.passes) ? source.passes : 0,
    failures: Number.isInteger(source.failures) ? source.failures : 0,
    executedStepIds: Array.isArray(source.executedStepIds) ? source.executedStepIds.slice() : [],
    history: Array.isArray(source.history) ? source.history.slice() : []
  };
}

/**
 * 创建运行时上下文。
 * @param {{ resume?: object, resumeIndex?: object, pageModel?: object, task?: object,
 *           mode?: 'fill-empty'|'overwrite', limit?: number, provider?: {generate: Function},
 *           inspect?: Function, execute?: Function, verify?: Function,
 *           maxFailures?: number, maxSteps?: number }} input
 */
export function createRuntimeContext({
  resume = {},
  resumeIndex,
  pageModel = {},
  task = {},
  mode = 'fill-empty',
  limit = DEFAULT_LIMIT,
  provider,
  maxFailures = DEFAULT_MAX_FAILURES,
  maxSteps = DEFAULT_MAX_STEPS,
  ...options
} = {}) {
  if (resume !== undefined && resume !== null && !record(resume)) throw new TypeError('resume must be an object');
  if (pageModel !== undefined && pageModel !== null && !record(pageModel)) throw new TypeError('pageModel must be an object');
  const index = record(resumeIndex) ? resumeIndex : buildResumeIndex(record(resume) ? resume : {});
  return {
    resume: clone(resume) ?? {},
    resumeIndex: index,
    pageModel: clone(pageModel) ?? {},
    mode,
    limit,
    maxFailures,
    maxSteps,
    task: normalizeTask(task),
    provider: provider && typeof provider.generate === 'function' ? provider : null,
    ...options
  };
}

function legacyCandidate(context, task) {
  if (!Array.isArray(task?.plan)) return null;
  const entry = task.plan.find(item => record(item) && !['verified', 'completed', 'skipped'].includes(item.status) && (item.tool || item.action));
  if (!entry) return null;
  return entry.action ?? entry;
}

async function optionalSuggestion(context, plan) {
  const provider = context.provider;
  const task = context.task ?? {};
  if (!provider || task.disableProvider === true) return null;
  if (!(plan.summary?.unsupported > 0) && !(Array.isArray(plan.summary?.missingFields) && plan.summary.missingFields.length > 0)) return null;
  let input;
  try {
    input = buildPlannerModelInput(context.pageModel ?? {}, context.resumeIndex ?? {}, plan, task);
  } catch {
    return null; // 输入过大 / 不合法：直接放弃建议，不影响确定性结果
  }
  let raw;
  try {
    raw = await provider.generate(input, { signal: context.signal });
  } catch {
    return null;
  }
  if (!raw || raw.status === 'abstain') return null;
  const validated = validatePlannerSuggestion(raw, {
    controlIds: input.page.controls.map(control => control.controlId),
    entryIds: input.resume.entries.map(entry => entry.entryId)
  });
  return validated.status === 'suggestion' ? validated : null;
}

/**
 * 决定下一步。
 * @returns {Promise<{status:'action'|'manual'|'blocked'|'complete'|'suggestion', step?: object, action?: object,
 *   plan?: object, suggestion?: object, reason?: string, confidence?: number}>}
 */
export async function planNextStep(context) {
  if (!record(context)) throw new TypeError('context required');
  const page = context.pageModel ?? {};
  const task = normalizeTask(context.task);
  context.task = task;
  if (TERMINAL_STATUSES.has(task.status)) return { status: 'complete', reason: 'task-complete', plan: context.lastPlan ?? null };

  const mode = context.mode ?? 'fill-empty';

  // 1) 过渡期兼容：task.plan 里旧的 tool 形状动作
  const legacy = legacyCandidate(context, task);
  if (legacy) {
    const gate = validatePlannedStep(legacy, { pageModel: page, mode, task, pageFingerprint: task.pageFingerprint });
    if (gate.allowed) return { status: 'action', step: legacy, action: legacy, plan: context.lastPlan ?? null, reason: 'legacy-plan', confidence: legacy.confidence };
    if (gate.requiresUser) return { status: 'manual', action: legacy, plan: context.lastPlan ?? null, reason: gate.reason };
  }

  // 2) 确定性计划（matcher 严格分区），每次基于当前 pageModel 重新规划
  const plan = planFill({ resumeIndex: context.resumeIndex, pageModel: page, mode, limit: context.limit ?? DEFAULT_LIMIT });
  context.lastPlan = plan;
  const executed = new Set(task.executedStepIds);
  const blockers = [];
  for (const step of plan.steps) {
    if (step.status !== 'ready') continue;
    if (step.stepId && executed.has(step.stepId)) continue;
    const gate = validatePlannedStep(step, { pageModel: page, mode, task, pageFingerprint: task.pageFingerprint });
    if (gate.allowed) {
      return { status: 'action', step, plan, reason: step.kind === 'add-item' ? 'add-item' : 'plan', confidence: step.confidence };
    }
    if (gate.requiresUser) blockers.push({ step, reason: gate.reason });
  }

  if (blockers.length) return { status: 'manual', reason: blockers[0].reason, step: blockers[0].step, plan, blockers };
  if (plan.summary.conflicts > 0) return { status: 'manual', reason: 'conflicts-need-review', plan };
  if (plan.summary.unsupported > 0) {
    const suggestion = await optionalSuggestion(context, plan);
    if (suggestion) return { status: 'suggestion', suggestion, plan, reason: 'model-suggestion' };
    return { status: 'manual', reason: 'unsupported-fields', plan };
  }
  if (plan.steps.length === 0) return { status: 'complete', reason: 'nothing-to-fill', plan };
  if (plan.steps.every(step => step.status === 'skipped')) return { status: 'complete', reason: 'all-already-correct', plan };
  return { status: 'complete', reason: 'plan-exhausted', plan };
}

function outcomeOK(result) {
  if (!record(result)) return false;
  return ['verified', 'done', 'success'].includes(String(result.status)) || result.verified === true;
}

/**
 * 执行一步：先（可选）重新 inspect，再规划、守卫、执行、记录。
 * @returns {Promise<object>} 最新 task 状态（含 decision / pageModel / lastResult）
 */
export async function runNextStep(context) {
  if (!record(context)) throw new TypeError('context required');
  const before = context.pageModel ?? {};

  // 1) 重新 inspect（若外部提供）
  if (typeof context.inspect === 'function') {
    const inspected = await context.inspect(context);
    const nextPage = inspected?.pageModel ?? inspected;
    if (record(nextPage) && Array.isArray(nextPage.controls)) context.pageModel = nextPage;
  }
  const page = context.pageModel ?? {};
  let task = normalizeTask(context.task);
  if (before.fingerprint && page.fingerprint && before.fingerprint !== page.fingerprint) {
    task.passes += 1;
    task.pageFingerprint = page.fingerprint;
  }

  // 2) 规划
  const decision = await planNextStep(context);
  task = normalizeTask(context.task);
  task.lastDecision = decision;
  task.pageFingerprint = page.fingerprint ?? task.pageFingerprint;
  context.task = task;
  if (decision.status === 'complete') {
    task.status = 'completed';
    return { ...task, decision, pageModel: page };
  }
  if (decision.status !== 'action') {
    task.status = decision.status === 'blocked' ? 'blocked' : 'manual';
    task.lastReason = decision.reason;
    return { ...task, decision, pageModel: page };
  }

  // 3) 守卫（防御纵深：即使 plan 被篡改，执行前再校验一遍）
  const step = decision.step;
  const gate = validatePlannedStep(step, { pageModel: page, mode: context.mode ?? 'fill-empty', task, pageFingerprint: task.pageFingerprint });
  if (!gate.allowed) {
    task.status = gate.requiresUser ? 'manual' : 'blocked';
    task.lastReason = gate.reason;
    context.task = task;
    return { ...task, decision: { ...decision, status: task.status, reason: gate.reason }, pageModel: page };
  }

  // 4) 执行 + 读回校验（由外部注入）
  let result;
  try {
    result = typeof context.execute === 'function' ? await context.execute(step, context) : { status: 'skipped', reason: 'no-executor' };
    if (typeof context.verify === 'function') result = (await context.verify(result, step, context)) || result;
  } catch (error) {
    result = { status: 'failed', reason: 'execution-error', error: String(error?.message ?? error) };
  }
  const ok = outcomeOK(result);

  // 5) 记录状态（task.step 只是成功步骤计数，不是控件下标）
  if (ok) {
    const stepId = step?.stepId ?? step?.controlId ?? step?.kind;
    if (stepId) task.executedStepIds = [...new Set([...task.executedStepIds, stepId])].slice(-500);
    task.step += 1;
    task.failures = 0;
    task.status = 'pending';
  } else {
    task.failures += 1;
    task.lastReason = result?.reason ?? 'step-failed';
    task.status = task.failures >= (context.maxFailures ?? DEFAULT_MAX_FAILURES) ? 'manual' : 'pending';
  }
  task.lastStep = step;
  task.lastResult = result;
  task.history = [...task.history, {
    step: step?.stepId ?? null,
    kind: step?.kind ?? null,
    controlId: step?.controlId ?? null,
    sectionKey: step?.sectionKey ?? null,
    itemIndex: step?.itemIndex ?? null,
    status: result?.status ?? null,
    reason: result?.reason ?? null,
    at: new Date().toISOString()
  }].slice(-50);
  context.task = task;
  return { ...task, decision, pageModel: page };
}

/**
 * 驱动循环：plan → execute → 重新 inspect → 继续，直到完成 / 需要人工 / 达到上限。
 * background 可以直接复用，也可以自己按 runNextStep 逐步驱动（契约 §6）。
 */
export async function runFillLoop(context, { maxSteps } = {}) {
  if (!record(context)) throw new TypeError('context required');
  const limit = Number.isInteger(maxSteps) ? maxSteps : (context.maxSteps ?? DEFAULT_MAX_STEPS);
  const results = [];
  let state = normalizeTask(context.task);
  for (let index = 0; index < limit; index += 1) {
    state = await runNextStep(context);
    results.push({
      status: state.status,
      decision: state.lastDecision?.status ?? null,
      reason: state.lastDecision?.reason ?? null,
      step: state.lastStep?.stepId ?? null,
      kind: state.lastStep?.kind ?? null,
      resultStatus: state.lastResult?.status ?? null
    });
    if (!['pending', 'running'].includes(state.status)) break;
  }
  const plan = context.lastPlan ?? null;
  return {
    status: state.status,
    results,
    task: context.task,
    plan,
    summary: plan?.summary ?? null
  };
}

export default { createRuntimeContext, planNextStep, runNextStep, runFillLoop };
