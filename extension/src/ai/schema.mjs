import { normalizePlannedAction } from '../runtime/action-tools.mjs';
const FORBIDDEN = new Set(['__proto__','prototype','constructor']);
const forbiddenKeys = new Set(['path','pathSegments','resumePath','candidatePath','value','selector','selectors','script','javascript','click','submit','action','code','handler','onclick','targetSelector','url','file','files','filename']);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function buildModelInput(field, candidates) {
  const safeField = { id: field?.id ?? '', label: field?.label ?? field?.name ?? '', section: field?.section ?? '', controlType: field?.controlType ?? '' };
  if (Array.isArray(field?.options)) safeField.options = field.options.map(String).slice(0, 100);
  const safeCandidates = (candidates || []).map((c, i) => ({
    candidateId: String(c.candidateId ?? c.id ?? `candidate-${i+1}`),
    pathSegments: Array.isArray(c.pathSegments) ? c.pathSegments.slice() : [],
    displayPath: String(c.displayPath ?? c.path ?? ''),
    valueType: String(c.valueType ?? 'unknown')
  }));
  const input = { field: safeField, candidates: safeCandidates };
  const serialized = JSON.stringify(input);
  if (serialized.length > 20000) throw new RangeError('model-input-too-large');
  return input;
}
export function validateModelProposal(raw, context = {}) {
  if (!record(raw) || !Array.isArray(context.candidates)) return { status:'rejected', reason:'invalid-output' };
  if (JSON.stringify(raw).length > 10000) return { status:'rejected', reason:'output-too-large' };
  const keys = Object.keys(raw);
  if (raw.status === 'abstain') {
    if (keys.some(k => !new Set(['status','reason']).has(k)) || typeof raw.reason !== 'string' || !raw.reason) return { status:'rejected', reason:'invalid-abstain' };
    return { status:'abstain', reason:raw.reason };
  }
  if (keys.some(k => forbiddenKeys.has(k))) return { status:'rejected', reason:'forbidden-property' };
  if (keys.some(k => !new Set(['candidateId','confidence','option','reason']).has(k))) return { status:'rejected', reason:'unknown-property' };
  if (typeof raw.candidateId !== 'string' || !context.candidates.some(c => c.candidateId === raw.candidateId)) return { status:'rejected', reason:'unknown-candidate' };
  if (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1) return { status:'rejected', reason:'invalid-confidence' };
  if (raw.option !== undefined && (!Array.isArray(context.options) || !context.options.some(o => Object.is(o, raw.option) || String(o) === String(raw.option)))) return { status:'rejected', reason:'invalid-option' };
  if (raw.reason !== undefined && typeof raw.reason !== 'string') return { status:'rejected', reason:'invalid-reason' };
  return { status:'proposed', candidateId: raw.candidateId, confidence: raw.confidence, ...(raw.option === undefined ? {} : { option: raw.option }), ...(raw.reason === undefined ? {} : { reason: raw.reason }) };
}
export function pathSegmentsExist(profile, segments) {
  if (!Array.isArray(segments) || !segments.length) return false;
  let current = profile;
  for (const seg of segments) { if ((typeof seg === 'string' && FORBIDDEN.has(seg)) || current == null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, seg)) return false; current = current[seg]; }
  return true;
}
export function readPathSegments(profile, segments) { return pathSegmentsExist(profile, segments) ? segments.reduce((v,s)=>v[s], profile) : undefined; }


export function validateActionProposal(raw, pageModel = {}) {
  if (!record(raw)) return { status: 'rejected', reason: 'invalid-output' };
  if (JSON.stringify(raw).length > 10000) return { status: 'rejected', reason: 'output-too-large' };
  const allowed = new Set(['tool', 'target', 'arguments', 'reason', 'confidence']);
  if (Object.keys(raw).some(key => !allowed.has(key))) return { status: 'rejected', reason: 'unknown-property' };
  if (Object.keys(raw).some(key => forbiddenKeys.has(key))) return { status: 'rejected', reason: 'forbidden-property' };
  if (raw.confidence !== undefined && (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1)) return { status: 'rejected', reason: 'invalid-confidence' };
  if (raw.reason !== undefined && typeof raw.reason !== 'string') return { status: 'rejected', reason: 'invalid-reason' };
  const normalized = normalizePlannedAction(raw, pageModel);
  if (normalized?.rejected) return { status: 'rejected', reason: normalized.reason };
  return { status: 'proposed', ...normalized };
}

export function buildActionModelInput(pageModel = {}, task = {}) {
  const controls = Array.isArray(pageModel.controls) ? pageModel.controls.map(control => ({
    controlId: String(control.controlId ?? ''), label: String(control.label ?? ''), role: String(control.role ?? ''), controlType: String(control.controlType ?? ''), options: Array.isArray(control.options) ? control.options.map(String).slice(0, 100) : [], sectionId: control.sectionId ?? null
  })) : [];
  const sections = Array.isArray(pageModel.sections) ? pageModel.sections.map(section => ({ id: String(section.id ?? section.sectionId ?? ''), label: String(section.label ?? '') })) : [];
  const input = { page: { pageIdentity: pageModel.pageIdentity ?? {}, fingerprint: pageModel.fingerprint ?? '', controls, sections }, task: { status: task.status ?? 'pending', step: Number.isInteger(task.step) ? task.step : 0 } };
  if (JSON.stringify(input).length > 20000) throw new RangeError('model-input-too-large');
  return input;
}
