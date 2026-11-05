/**
 * FormPilot 动作守卫（执行前最后一道闸门）。
 *
 * 兼容两种输入：
 *  - 新 step 结构：{ stepId, kind:'fill'|'select'|'check'|'add-item', controlId?, actionId?,
 *                    value, fieldKey, sectionKey, itemIndex?, confidence, status, overwrite? }
 *  - 旧 action 结构（向后兼容 D/B 的过渡期代码）：{ tool, target, arguments:{ value|checked }, confidence }
 *
 * 不变量（契约 §0 / §9）：
 *  - 绝不点击保存/提交/投递/预览/确认/取消/删除/同意条款/隐私声明类控件；
 *  - 绝不操作 file/upload 类控件；
 *  - 默认只填空白（fill-empty）：status==='conflict' 的步骤不得执行；
 *  - overwrite 模式必须显式标记（step.overwrite === true 且 mode === 'overwrite'）；
 *  - 低置信度拦截；页面指纹变化拦截；disabled/readonly/不可见控件拦截。
 */

import { matchSelectOption } from '../core/matcher.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const DEFAULT_MIN_CONFIDENCE = 0.7;

const SENSITIVE_PATTERN = /(?:submit|send|apply|finish|final|confirm|captcha|save|cancel|delete|preview|保存|提交|发送|申请|确认|同意|声明|授权|隐私|条款|协议|取消|删除|预览|登录|consent|agree|certif|acknowledge|terms|privacy|authorization)/i;
const FILE_PATTERN = /(?:file|upload|attachment|简历附件|文件上传|上传|附件)/i;

const TOOL_TO_KIND = Object.freeze({
  type: 'fill',
  fill: 'fill',
  select: 'select',
  check: 'check',
  focus: 'focus',
  open: 'open',
  wait: 'wait',
  read_value: 'read',
  verify: 'verify',
  ask_user: 'ask-user',
  undo: 'undo',
  'add-item': 'add-item'
});

const EDIT_KINDS = new Set(['fill', 'select', 'check']);
const META_KINDS = new Set(['wait', 'ask-user', 'undo']);
const PASSIVE_KINDS = new Set(['focus', 'open', 'read', 'verify']);

const EDITABLE_CONTROL_TYPES = new Set(['text', 'textarea', 'date', 'email', 'tel', 'url', 'number', 'password', 'search', 'month', 'year']);
const SELECT_CONTROL_TYPES = new Set(['native-select', 'custom-select', 'combobox', 'select', 'dropdown', 'multi-select']);

const controlsOf = pageModel => (Array.isArray(pageModel?.controls) ? pageModel.controls : []);
const sectionsOf = pageModel => (Array.isArray(pageModel?.sections) ? pageModel.sections : []);
const actionsOf = pageModel => (Array.isArray(pageModel?.actions) ? pageModel.actions : []);

const normalizeStep = input => {
  if (!record(input)) return { rejected: true, reason: 'invalid-step' };
  const kind = TOOL_TO_KIND[input.kind] ?? TOOL_TO_KIND[input.tool] ?? null;
  const target = input.controlId ?? input.actionId ?? input.target ?? null;
  const args = record(input.arguments) ? input.arguments : {};
  const value = input.value !== undefined ? input.value : (args.value !== undefined ? args.value : args.checked);
  return {
    kind,
    controlId: kind === 'add-item' ? null : (input.controlId ?? input.target ?? null),
    actionId: input.actionId ?? (kind === 'add-item' ? (input.target ?? null) : null),
    target,
    value,
    confidence: input.confidence,
    status: typeof input.status === 'string' ? input.status : 'ready',
    overwrite: input.overwrite === true,
    fieldKey: input.fieldKey,
    sectionKey: input.sectionKey,
    itemIndex: input.itemIndex,
    tool: input.tool,
    arguments: args
  };
};

const base = (allowed, reason, requiresUser = false) => ({ allowed, ...(reason ? { reason } : {}), requiresUser });
const lower = value => String(value ?? '').toLowerCase();
const labelOf = control => `${control?.label ?? ''} ${control?.ariaLabel ?? ''} ${control?.i18nLabel ?? ''} ${control?.role ?? ''} ${control?.fieldKey ?? ''}`;

/**
 * 校验一个计划步骤是否可以执行。
 * @param {object} step 计划步骤（kind 结构）或旧 action 结构（tool 结构）
 * @param {{ pageModel?: object, pageFingerprint?: string, mode?: 'fill-empty'|'overwrite', task?: object, minConfidence?: number }} options
 * @returns {{ allowed: boolean, reason?: string, requiresUser: boolean }}
 */
export function validatePlannedStep(step, { pageModel = {}, pageFingerprint, mode = 'fill-empty', task, minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  const normalized = normalizeStep(step);
  if (normalized.rejected) return base(false, normalized.reason, false);
  if (!EDIT_KINDS.has(normalized.kind) && !META_KINDS.has(normalized.kind) && !PASSIVE_KINDS.has(normalized.kind) && normalized.kind !== 'add-item') {
    return base(false, 'unsupported-step-kind', false);
  }
  if (mode !== 'fill-empty' && mode !== 'overwrite') return base(false, 'invalid-mode', false);

  // 页面 / 任务状态
  const expectedFingerprint = pageFingerprint ?? task?.pageFingerprint ?? task?.pageModelFingerprint;
  if (expectedFingerprint && pageModel?.fingerprint && expectedFingerprint !== pageModel.fingerprint) return base(false, 'page-changed', true);
  if (task?.status === 'invalidated' || task?.status === 'completed' || task?.status === 'undone') return base(false, 'task-not-active', false);

  // 置信度
  if (normalized.confidence !== undefined && (typeof normalized.confidence !== 'number' || !Number.isFinite(normalized.confidence) || normalized.confidence < minConfidence)) {
    return base(false, 'low-confidence', true);
  }

  // 默认只填空白：conflict 不得执行；overwrite 需显式标记
  if (normalized.status === 'conflict') return base(false, 'conflict-not-overwritable', true);
  if (normalized.status === 'skipped') return base(false, 'already-correct', false);
  if (normalized.status === 'unsupported') return base(false, 'unsupported-step', false);
  if (normalized.status !== 'ready') return base(false, 'step-not-ready', false);
  if (normalized.overwrite && mode !== 'overwrite') return base(false, 'overwrite-not-enabled', true);

  // add-item：只能用页面里登记过的添加按钮，且按钮本身不能是敏感/删除类
  if (normalized.kind === 'add-item') {
    const actions = actionsOf(pageModel);
    const action = actions.find(item => String(item?.actionId ?? '') === String(normalized.actionId ?? ''));
    if (!action) return base(false, 'action-not-found', false);
    if (String(action.kind ?? '') !== 'add-item') return base(false, 'action-not-add-item', false);
    const actionLabel = `${action.label ?? ''} ${action.text ?? ''}`;
    if (SENSITIVE_PATTERN.test(actionLabel)) return base(false, 'sensitive-action', true);
    const actionSection = sectionsOf(pageModel).find(section => String(section?.id ?? section?.sectionId ?? '') === String(action.sectionId ?? ''));
    if (normalized.sectionKey && actionSection) {
      const actionSectionKey = actionSection.key ?? actionSection.sectionKey;
      if (actionSectionKey && String(actionSectionKey) !== String(normalized.sectionKey)) return base(false, 'section-mismatch', false);
    }
    return base(true);
  }

  if (META_KINDS.has(normalized.kind)) {
    if (normalized.kind === 'undo') return task?.lastStep || task?.lastAction || task?.history?.length ? base(true) : base(false, 'nothing-to-undo', false);
    return base(true);
  }

  // 目标控件
  const controls = controlsOf(pageModel);
  const control = controls.find(item => String(item?.controlId ?? '') === String(normalized.controlId ?? ''));
  if (!control) return base(false, 'target-not-found', false);

  // 页面模型分区一致性（防御性二次校验：绝不跨分区）
  if (normalized.sectionKey && control.sectionKey && String(control.sectionKey) !== String(normalized.sectionKey)) return base(false, 'section-mismatch', false);
  if (Number.isInteger(normalized.itemIndex) && Number.isInteger(control.itemIndex) && normalized.itemIndex !== control.itemIndex) return base(false, 'item-scope-mismatch', false);

  const controlType = lower(control.controlType ?? control.type ?? 'text');
  if (controlType === 'file' || controlType === 'hidden' || FILE_PATTERN.test(labelOf(control))) return base(false, 'file-operation', true);
  if (SENSITIVE_PATTERN.test(labelOf(control))) return base(false, 'sensitive-control', true);
  if (control.visible === false) return base(false, 'control-not-visible', false);
  if (control.disabled === true || control.readonly === true || control.readOnly === true) return base(false, 'control-not-editable', false);

  if (normalized.kind === 'fill') {
    if (!EDITABLE_CONTROL_TYPES.has(controlType)) return base(false, 'type-control-mismatch', false);
    if (typeof normalized.value !== 'string' && typeof normalized.value !== 'number') return base(false, 'value-required', false);
    return base(true);
  }
  if (normalized.kind === 'check') {
    if (controlType !== 'checkbox') return base(false, 'check-control-mismatch', false);
    if (typeof normalized.value !== 'boolean') return base(false, 'check-value-required', false);
    return base(true);
  }
  if (normalized.kind === 'select') {
    if (!SELECT_CONTROL_TYPES.has(controlType)) return base(false, 'select-control-mismatch', false);
    if (normalized.value === undefined || normalized.value === null || normalized.value === '') return base(false, 'value-required', false);
    if (Array.isArray(control.options) && control.options.length > 0) {
      const option = matchSelectOption(control.options, normalized.value, normalized.fieldKey);
      if (option === null) return base(false, 'option-not-found', false);
    }
    return base(true);
  }
  // focus/open/read/verify：只允许落在非敏感、可交互控件上
  return base(true);
}

/**
 * 向后兼容导出：契约里 D 的 background.js 可能仍调用 validatePlannedAction。
 * 同时接受新 step 结构与旧 {tool,target,arguments} action 结构。
 */
export const validatePlannedAction = validatePlannedStep;

export default validatePlannedStep;
