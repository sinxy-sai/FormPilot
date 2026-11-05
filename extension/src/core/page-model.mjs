/**
 * page-model.mjs — FormPilot 页面模型（契约 §3）
 * =====================================================================
 * PageModel = { pageIdentity, sections, controls, actions, dialogs, fingerprint }
 * Section   = { id, label, key?, repeatable, itemCount, addActionId? }
 * Control   = { controlId, selectorToken, label, role, controlType, value, options?,
 *               visible, disabled, readonly, sectionId?, sectionKey?, itemIndex?,
 *               fieldKey?, itemRole?, displayText?, placeholder?, dateFormat?, labelSource? }
 * PageAction= { actionId, kind:'add-item', sectionId, label, selectorToken? }
 *
 * 约定：
 * - 纯函数、无 DOM、无 IO；输入不合法抛 TypeError。
 * - fingerprint 覆盖「结构字段」（控件/分区/动作/身份），**不包含** value、displayText、
 *   占位符等易变内容，也不包含 capturedAt；同一页面值变了 fingerprint 不变
 *   （add-item 等真正改变结构时才变）。
 * - 旧的 normalizeControlModel / fingerprintPageModel / isSamePageModel 保持可用。
 */

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const stableHash = value => {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (const char of text) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `page-${(hash >>> 0).toString(16)}`;
};

const SECTION_KEYS = ['basic', 'work', 'internship', 'education', 'project', 'award', 'language', 'summary', 'sns', 'intention', 'resume', 'attachment', 'work_samples'];
const CONTROL_TYPES = ['text', 'textarea', 'number', 'email', 'tel', 'url', 'date', 'checkbox', 'radio', 'native-select', 'combobox', 'file', 'hidden'];
const ACTION_KINDS = ['add-item'];

/** 把可选的字符串字段挂到目标对象上（不存在就不产生 key，保证旧调用形状不变）。 */
function assignString(target, key, value) {
  if (typeof value === 'string' && value !== '') target[key] = value;
}

/** 归一化单个控件。controlId 必填；selectorToken 必须是 control-token-<n>。 */
export function normalizeControlModel(input = {}) {
  if (!record(input) || typeof input.controlId !== 'string' || !input.controlId) throw new TypeError('controlId is required');
  const options = Array.isArray(input.options) ? input.options.map(String) : undefined;
  const selectorToken = typeof input.selectorToken === 'string' && /^control-token-[A-Za-z0-9_-]+$/.test(input.selectorToken) ? input.selectorToken : undefined;
  const model = {
    controlId: input.controlId,
    selectorToken,
    label: String(input.label ?? input.name ?? input.placeholder ?? ''),
    role: String(input.role ?? ''),
    controlType: String(input.controlType ?? input.type ?? 'unknown'),
    ...(input.value === undefined ? {} : { value: input.value }),
    ...(options ? { options } : {}),
    visible: input.visible !== false,
    disabled: input.disabled === true,
    readonly: input.readonly === true || input.readOnly === true,
    ...(typeof input.sectionId === 'string' && input.sectionId ? { sectionId: input.sectionId } : {})
  };
  // v2 扩展字段：只在提供时出现，兼容旧调用方（deepEqual 断言）。
  const sectionKey = input.sectionKey;
  if (typeof sectionKey === 'string' && SECTION_KEYS.includes(sectionKey)) model.sectionKey = sectionKey;
  if (Number.isInteger(input.itemIndex) && input.itemIndex >= 0) model.itemIndex = input.itemIndex;
  assignString(model, 'fieldKey', input.fieldKey);
  if (input.itemRole === 'start' || input.itemRole === 'end') model.itemRole = input.itemRole;
  assignString(model, 'labelSource', input.labelSource);
  assignString(model, 'displayText', input.displayText);
  assignString(model, 'placeholder', input.placeholder);
  assignString(model, 'dateFormat', input.dateFormat);
  if (CONTROL_TYPES.includes(input.controlType)) model.controlType = input.controlType;
  return model;
}

/** 归一化添加按钮动作（契约 §3 PageAction）。 */
export function normalizeActionModel(input = {}) {
  if (!record(input) || typeof input.actionId !== 'string' || !input.actionId) throw new TypeError('actionId is required');
  const kind = ACTION_KINDS.includes(input.kind) ? input.kind : 'add-item';
  const selectorToken = typeof input.selectorToken === 'string' && /^action-token-[A-Za-z0-9_-]+$/.test(input.selectorToken) ? input.selectorToken : undefined;
  return {
    actionId: input.actionId,
    kind,
    sectionId: String(input.sectionId ?? ''),
    ...(typeof input.sectionKey === 'string' && input.sectionKey ? { sectionKey: input.sectionKey } : {}),
    label: String(input.label ?? ''),
    ...(selectorToken ? { selectorToken } : {})
  };
}

function structuralView(page) {
  return {
    pageIdentity: page.pageIdentity ?? {},
    sections: (page.sections ?? []).map(section => ({
      id: section.id ?? section.sectionId,
      label: section.label ?? '',
      key: section.key ?? null,
      repeatable: section.repeatable === true,
      itemCount: Number.isInteger(section.itemCount) ? section.itemCount : 0,
      addActionId: section.addActionId ?? null
    })),
    controls: (page.controls ?? []).map(control => ({
      controlId: control.controlId,
      selectorToken: control.selectorToken ?? null,
      label: control.label,
      role: control.role,
      controlType: control.controlType,
      // `options` 故意不参与指纹：自定义下拉只有点开时才渲染选项，若把它算进指纹，
      // 任何一次打开/关闭下拉都会让后续所有步骤被判成「页面已变化」。
      visible: control.visible !== false,
      disabled: control.disabled === true,
      readonly: control.readonly === true,
      sectionId: control.sectionId ?? null,
      sectionKey: control.sectionKey ?? null,
      itemIndex: Number.isInteger(control.itemIndex) ? control.itemIndex : null,
      fieldKey: control.fieldKey ?? null,
      itemRole: control.itemRole ?? null
    })),
    actions: (page.actions ?? []).map(action => ({
      actionId: action.actionId,
      kind: action.kind ?? 'add-item',
      sectionId: action.sectionId ?? null,
      sectionKey: action.sectionKey ?? null,
      label: action.label ?? '',
      selectorToken: action.selectorToken ?? null
    })),
    dialogs: (page.dialogs ?? []).map(dialog => ({ id: dialog.id ?? dialog.dialogId, label: dialog.label ?? '', open: dialog.open !== false }))
  };
}

export function fingerprintPageModel(pageModel = {}) { return stableHash(structuralView(pageModel)); }

export function createPageModel(input = {}) {
  if (!record(input)) throw new TypeError('page model input must be an object');
  const controls = Array.isArray(input.controls) ? input.controls.map(normalizeControlModel) : [];
  const sections = Array.isArray(input.sections) ? input.sections.map((section, index) => {
    if (!record(section)) throw new TypeError(`section[${index}] must be an object`);
    const normalized = {
      id: String(section.id ?? section.sectionId ?? `section-${index}`),
      label: String(section.label ?? section.name ?? ''),
      repeatable: section.repeatable === true,
      itemCount: Number.isInteger(section.itemCount) ? Math.max(0, section.itemCount) : 0
    };
    if (typeof section.key === 'string' && section.key) normalized.key = section.key;
    if (typeof section.addActionId === 'string' && section.addActionId) normalized.addActionId = section.addActionId;
    return normalized;
  }) : [];
  const actions = Array.isArray(input.actions) ? input.actions.map(normalizeActionModel) : [];
  const dialogs = Array.isArray(input.dialogs) ? input.dialogs.map((dialog, index) => ({
    id: String(dialog.id ?? dialog.dialogId ?? `dialog-${index}`),
    label: String(dialog.label ?? dialog.name ?? ''),
    open: dialog.open !== false
  })) : [];
  const pageModel = {
    pageIdentity: {
      origin: String(input.pageIdentity?.origin ?? input.origin ?? ''),
      route: String(input.pageIdentity?.route ?? input.route ?? ''),
      ...(input.pageIdentity?.title === undefined && input.title === undefined ? {} : { title: String(input.pageIdentity?.title ?? input.title ?? '') })
    },
    sections,
    controls,
    actions,
    dialogs,
    mutations: Array.isArray(input.mutations) ? input.mutations.map(String) : [],
    capturedAt: String(input.capturedAt ?? new Date().toISOString())
  };
  return { ...pageModel, fingerprint: fingerprintPageModel(pageModel) };
}

export function isSamePageModel(first, second) {
  return Boolean(first?.fingerprint && second?.fingerprint && first.fingerprint === second.fingerprint);
}
