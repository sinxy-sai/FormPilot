/**
 * FormPilot AI 边界（schema.mjs）。
 *
 * 规划层重写后，本地模型**不在关键路径**：deterministic 的 resumeIndex + matcher 先产出计划，
 * 模型只允许给出「只读的映射建议」(buildPlannerModelInput / validatePlannerSuggestion)，
 * 永远不能输出可直接执行的动作（tool/target/value/selector 一律拒绝）。
 *
 * 兼容保留：AI 运行时时代留下的 buildModelInput / validateModelProposal /
 * pathSegmentsExist / readPathSegments / buildActionModelInput / validateActionProposal。
 * 这些函数不依赖 runtime/action-tools.mjs，避免跨负责人文件耦合。
 */

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const FORBIDDEN_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const EXECUTABLE_KEYS = new Set(['tool', 'target', 'arguments', 'value', 'selector', 'selectors', 'script', 'javascript', 'click', 'submit', 'action', 'code', 'handler', 'onclick', 'url', 'file', 'files', 'filename']);
const ALLOWED_TOOLS = new Set(['focus', 'open', 'type', 'check', 'select', 'wait', 'read_value', 'verify', 'ask_user', 'undo']);
const MAX_INPUT_BYTES = 30000;

const truncate = (value, max) => {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

const guarded = (input, maxBytes = MAX_INPUT_BYTES) => {
  const serialized = JSON.stringify(input);
  if (serialized.length > maxBytes) throw new RangeError('model-input-too-large');
  return input;
};

// ---------------------------------------------------------------------------
// 旧 AI 运行时接口（兼容保留）
// ---------------------------------------------------------------------------

export function buildModelInput(field, candidates) {
  const safeField = { id: field?.id ?? '', label: field?.label ?? field?.name ?? '', section: field?.section ?? '', controlType: field?.controlType ?? '' };
  if (Array.isArray(field?.options)) safeField.options = field.options.map(String).slice(0, 100);
  const safeCandidates = (candidates || []).map((candidate, index) => ({
    candidateId: String(candidate.candidateId ?? candidate.id ?? `candidate-${index + 1}`),
    pathSegments: Array.isArray(candidate.pathSegments) ? candidate.pathSegments.slice() : [],
    displayPath: String(candidate.displayPath ?? candidate.path ?? ''),
    valueType: String(candidate.valueType ?? 'unknown')
  }));
  return guarded({ field: safeField, candidates: safeCandidates }, 20000);
}

export function validateModelProposal(raw, context = {}) {
  if (!record(raw) || !Array.isArray(context.candidates)) return { status: 'rejected', reason: 'invalid-output' };
  if (JSON.stringify(raw).length > 10000) return { status: 'rejected', reason: 'output-too-large' };
  const keys = Object.keys(raw);
  if (raw.status === 'abstain') {
    if (keys.some(key => !new Set(['status', 'reason']).has(key)) || typeof raw.reason !== 'string' || !raw.reason) return { status: 'rejected', reason: 'invalid-abstain' };
    return { status: 'abstain', reason: raw.reason };
  }
  if (keys.some(key => EXECUTABLE_KEYS.has(key))) return { status: 'rejected', reason: 'forbidden-property' };
  if (keys.some(key => !new Set(['candidateId', 'confidence', 'option', 'reason']).has(key))) return { status: 'rejected', reason: 'unknown-property' };
  if (typeof raw.candidateId !== 'string' || !context.candidates.some(candidate => candidate.candidateId === raw.candidateId)) return { status: 'rejected', reason: 'unknown-candidate' };
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) return { status: 'rejected', reason: 'invalid-confidence' };
  if (raw.option !== undefined && (!Array.isArray(context.options) || !context.options.some(option => Object.is(option, raw.option) || String(option) === String(raw.option)))) return { status: 'rejected', reason: 'invalid-option' };
  if (raw.reason !== undefined && typeof raw.reason !== 'string') return { status: 'rejected', reason: 'invalid-reason' };
  return { status: 'proposed', candidateId: raw.candidateId, confidence: raw.confidence, ...(raw.option === undefined ? {} : { option: raw.option }), ...(raw.reason === undefined ? {} : { reason: raw.reason }) };
}

export function pathSegmentsExist(profile, segments) {
  if (!Array.isArray(segments) || !segments.length) return false;
  let current = profile;
  for (const segment of segments) {
    if ((typeof segment === 'string' && FORBIDDEN_SEGMENTS.has(segment)) || current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, segment)) return false;
    current = current[segment];
  }
  return true;
}

export function readPathSegments(profile, segments) {
  return pathSegmentsExist(profile, segments) ? segments.reduce((value, segment) => value[segment], profile) : undefined;
}

function resumeCandidates(value, path = [], output = []) {
  if (output.length >= 200 || value === null || value === undefined) return output;
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item, index) => resumeCandidates(item, [...path, index], output));
    return output;
  }
  if (record(value)) {
    for (const [key, child] of Object.entries(value)) resumeCandidates(child, [...path, key], output);
    return output;
  }
  const text = String(value);
  if (text.length <= 2000) output.push({ candidateId: `resume-${output.length + 1}`, path: path.join('.'), value: text, valueType: typeof value });
  return output;
}

export function validateActionProposal(raw, pageModel = {}) {
  if (!record(raw)) return { status: 'rejected', reason: 'invalid-output' };
  if (JSON.stringify(raw).length > 10000) return { status: 'rejected', reason: 'output-too-large' };
  if (Object.keys(raw).some(key => !new Set(['tool', 'target', 'arguments', 'reason', 'confidence']).has(key))) return { status: 'rejected', reason: 'unknown-property' };
  if (Object.keys(raw).some(key => EXECUTABLE_KEYS.has(key))) return { status: 'rejected', reason: 'forbidden-property' };
  if (typeof raw.tool !== 'string' || !ALLOWED_TOOLS.has(raw.tool)) return { status: 'rejected', reason: 'unknown-tool' };
  if (raw.confidence !== undefined && (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1)) return { status: 'rejected', reason: 'invalid-confidence' };
  if (raw.reason !== undefined && typeof raw.reason !== 'string') return { status: 'rejected', reason: 'invalid-reason' };
  const targetRequired = !['wait', 'undo', 'ask_user'].includes(raw.tool);
  if (targetRequired && (typeof raw.target !== 'string' || !raw.target)) return { status: 'rejected', reason: 'target-required' };
  if (targetRequired) {
    const ids = new Set([
      ...(Array.isArray(pageModel.controls) ? pageModel.controls.map(control => control?.controlId) : []),
      ...(Array.isArray(pageModel.sections) ? pageModel.sections.map(section => section?.id ?? section?.sectionId) : [])
    ]);
    if (!ids.has(raw.target)) return { status: 'rejected', reason: 'target-not-found' };
  }
  const args = record(raw.arguments) ? raw.arguments : {};
  if (Object.keys(args).some(key => EXECUTABLE_KEYS.has(key))) return { status: 'rejected', reason: 'forbidden-argument' };
  return { status: 'proposed', tool: raw.tool, ...(targetRequired ? { target: raw.target } : {}), arguments: { ...args }, ...(raw.reason === undefined ? {} : { reason: raw.reason }), ...(raw.confidence === undefined ? {} : { confidence: raw.confidence }) };
}

export function buildActionModelInput(pageModel = {}, task = {}, resume = {}) {
  const controls = Array.isArray(pageModel.controls)
    ? pageModel.controls.map(control => ({
      controlId: String(control.controlId ?? ''),
      label: String(control.label ?? ''),
      role: String(control.role ?? ''),
      controlType: String(control.controlType ?? ''),
      value: control.value ?? '',
      options: Array.isArray(control.options) ? control.options.map(String).slice(0, 100) : [],
      sectionId: control.sectionId ?? null
    }))
    : [];
  const sections = Array.isArray(pageModel.sections)
    ? pageModel.sections.map(section => ({ id: String(section.id ?? section.sectionId ?? ''), label: String(section.label ?? '') }))
    : [];
  return guarded({
    page: { pageIdentity: pageModel.pageIdentity ?? {}, fingerprint: pageModel.fingerprint ?? '', controls, sections },
    resume: { candidates: resumeCandidates(resume) },
    task: { status: task.status ?? 'pending', step: Number.isInteger(task.step) ? task.step : 0 }
  });
}

// ---------------------------------------------------------------------------
// 规划层：只读的「映射建议」边界（模型永远不能产出可执行动作）
// ---------------------------------------------------------------------------

/**
 * 构造给本地模型的只读输入：页面语义字段 + 简历 entries + deterministic 计划摘要。
 * 不包含任何可执行动作、选择器或脚本片段。
 */
export function buildPlannerModelInput(pageModel = {}, resumeIndex = {}, plan = {}, task = {}) {
  const controls = (Array.isArray(pageModel.controls) ? pageModel.controls : []).map(control => ({
    controlId: String(control.controlId ?? ''),
    label: truncate(control.label ?? '', 80),
    fieldKey: control.fieldKey ? String(control.fieldKey) : null,
    sectionKey: control.sectionKey ? String(control.sectionKey) : null,
    itemIndex: Number.isInteger(control.itemIndex) ? control.itemIndex : null,
    controlType: String(control.controlType ?? ''),
    currentValue: truncate(control.value ?? '', 120),
    options: Array.isArray(control.options) ? control.options.map(String).slice(0, 60) : []
  }));
  const sections = (Array.isArray(pageModel.sections) ? pageModel.sections : []).map(section => ({
    key: section.key ?? section.sectionKey ?? null,
    label: truncate(section.label ?? '', 80),
    itemCount: Number.isInteger(section.itemCount) ? section.itemCount : null
  }));
  const entries = (Array.isArray(resumeIndex.entries) ? resumeIndex.entries : []).slice(0, 200).map((entry, index) => ({
    entryId: `entry-${index + 1}`,
    section: entry.section,
    itemIndex: entry.itemIndex,
    field: entry.field,
    value: truncate(entry.value ?? '', 200)
  }));
  return guarded({
    page: { pageIdentity: pageModel.pageIdentity ?? {}, fingerprint: pageModel.fingerprint ?? '', sections, controls: controls.slice(0, 300) },
    resume: { entries, missing: Array.isArray(resumeIndex.missing) ? resumeIndex.missing.slice() : [] },
    plan: {
      stepCount: Array.isArray(plan.steps) ? plan.steps.length : 0,
      summary: plan.summary ?? {},
      controls: (Array.isArray(plan.steps) ? plan.steps : []).slice(0, 300).map(step => ({ controlId: step.controlId ?? null, fieldKey: step.fieldKey ?? null, status: step.status ?? null }))
    },
    task: { status: task.status ?? 'pending' }
  });
}

/**
 * 校验本地模型返回的「映射建议」：只允许 controlId → entryId 的只读建议，绝不允许执行动作。
 */
export function validatePlannerSuggestion(raw, { controlIds = [], entryIds = [] } = {}) {
  if (!record(raw)) return { status: 'rejected', reason: 'invalid-output' };
  if (JSON.stringify(raw).length > 5000) return { status: 'rejected', reason: 'output-too-large' };
  const keys = Object.keys(raw);
  if (raw.status === 'abstain') {
    if (keys.some(key => !new Set(['status', 'reason']).has(key)) || typeof raw.reason !== 'string' || !raw.reason) return { status: 'rejected', reason: 'invalid-abstain' };
    return { status: 'abstain', reason: raw.reason };
  }
  if (keys.some(key => EXECUTABLE_KEYS.has(key))) return { status: 'rejected', reason: 'forbidden-property' };
  if (keys.some(key => !new Set(['controlId', 'entryId', 'confidence', 'reason']).has(key))) return { status: 'rejected', reason: 'unknown-property' };
  if (typeof raw.controlId !== 'string' || !controlIds.includes(raw.controlId)) return { status: 'rejected', reason: 'unknown-control' };
  if (raw.entryId !== undefined && (typeof raw.entryId !== 'string' || !entryIds.includes(raw.entryId))) return { status: 'rejected', reason: 'unknown-entry' };
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) return { status: 'rejected', reason: 'invalid-confidence' };
  if (raw.reason !== undefined && typeof raw.reason !== 'string') return { status: 'rejected', reason: 'invalid-reason' };
  return {
    status: 'suggestion',
    controlId: raw.controlId,
    ...(raw.entryId === undefined ? {} : { entryId: raw.entryId }),
    confidence: raw.confidence,
    ...(raw.reason === undefined ? {} : { reason: raw.reason })
  };
}
