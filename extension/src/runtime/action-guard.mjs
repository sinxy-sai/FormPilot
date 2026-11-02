import { normalizePlannedAction, TOOL_DEFINITIONS, TOOL_SET } from './action-tools.mjs';

const LOW_CONFIDENCE = 0.8;
const sensitive = /(?:submit|send|apply|finish|final|confirm|captcha|登录|提交|发送|申请|确认|同意|声明|授权|隐私|条款|协议|consent|agree|certif|acknowledge|terms|privacy|authorization)/i;
const fileLike = /(?:file|upload|attachment|文件|上传|附件)/i;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function controls(pageModel) { return Array.isArray(pageModel?.controls) ? pageModel.controls : []; }
function sections(pageModel) { return Array.isArray(pageModel?.sections) ? pageModel.sections : []; }
function findTarget(action, pageModel) {
  return controls(pageModel).find(c => c?.controlId === action.target) || sections(pageModel).find(s => (s?.id ?? s?.sectionId) === action.target);
}
function samePage(pageModel, task) {
  const expected = task?.pageFingerprint ?? task?.pageModelFingerprint;
  return !expected || !pageModel?.fingerprint || expected === pageModel.fingerprint;
}
function baseResult(allowed, reason = undefined, requiresUser = false) { return { allowed, ...(reason ? { reason } : {}), requiresUser }; }

export function validatePlannedAction(action, { pageModel = {}, resume, task } = {}) {
  const normalized = normalizePlannedAction(action, pageModel);
  if (normalized?.rejected) return baseResult(false, normalized.reason, false);
  if (!samePage(pageModel, task)) return baseResult(false, 'page-changed', true);
  if (task?.status === 'invalidated' || task?.status === 'completed' || task?.status === 'undone') return baseResult(false, 'task-not-active', false);
  if (resume?.revision !== undefined && task?.resumeRevision !== undefined && resume.revision !== task.resumeRevision) return baseResult(false, 'resume-changed', true);
  if (normalized.confidence !== undefined && normalized.confidence < LOW_CONFIDENCE) return baseResult(false, 'low-confidence', true);
  if (normalized.tool === 'wait' || normalized.tool === 'ask_user') return baseResult(true, undefined, false);
  if (normalized.tool === 'undo') return task?.lastAction || task?.history?.length ? baseResult(true) : baseResult(false, 'nothing-to-undo', false);
  const target = findTarget(normalized, pageModel);
  if (!target) return baseResult(false, 'target-not-found', false);
  const label = `${target.label ?? ''} ${target.role ?? ''} ${target.controlType ?? ''}`;
  if (sensitive.test(label)) return baseResult(false, 'sensitive-control', true);
  if (fileLike.test(label) || String(target.controlType ?? '').toLowerCase() === 'file') return baseResult(false, 'file-operation', true);
  if (target.disabled === true || target.readonly === true) return baseResult(false, 'control-not-editable', false);
  if (normalized.tool === 'type' && !['text', 'textarea', 'date', 'email', 'tel', 'url', 'number', 'password', 'search'].includes(String(target.controlType).toLowerCase())) return baseResult(false, 'type-control-mismatch', false);
  if (normalized.tool === 'check' && String(target.controlType).toLowerCase() !== 'checkbox') return baseResult(false, 'check-control-mismatch', false);
  if (normalized.tool === 'select') {
    if (!['native-select', 'custom-select', 'combobox', 'select'].includes(String(target.controlType).toLowerCase())) return baseResult(false, 'select-control-mismatch', false);
    if (Array.isArray(target.options) && !target.options.map(String).includes(String(normalized.arguments.value))) return baseResult(false, 'option-not-found', false);
  }
  return baseResult(true);
}

export { TOOL_DEFINITIONS, TOOL_SET };
