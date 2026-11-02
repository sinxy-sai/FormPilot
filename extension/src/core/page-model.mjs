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

export function normalizeControlModel(input = {}) {
  if (!record(input) || typeof input.controlId !== 'string' || !input.controlId) throw new TypeError('controlId is required');
  const options = Array.isArray(input.options) ? input.options.map(String) : undefined;
  return {
    controlId: input.controlId,
    selectorToken: typeof input.selectorToken === 'string' ? input.selectorToken : input.selector,
    label: String(input.label ?? input.name ?? input.placeholder ?? ''),
    role: String(input.role ?? ''),
    controlType: String(input.controlType ?? input.type ?? 'unknown'),
    ...(input.value === undefined ? {} : { value: input.value }),
    ...(options ? { options } : {}),
    visible: input.visible !== false,
    disabled: input.disabled === true,
    readonly: input.readonly === true || input.readOnly === true,
    ...(typeof input.sectionId === 'string' ? { sectionId: input.sectionId } : {})
  };
}

function structuralView(page) {
  return {
    pageIdentity: page.pageIdentity ?? {},
    sections: (page.sections ?? []).map(section => ({ id: section.id ?? section.sectionId, label: section.label ?? '', parentId: section.parentId ?? null })),
    controls: (page.controls ?? []).map(control => ({
      controlId: control.controlId,
      label: control.label,
      role: control.role,
      controlType: control.controlType,
      options: control.options ?? [],
      visible: control.visible !== false,
      disabled: control.disabled === true,
      readonly: control.readonly === true,
      sectionId: control.sectionId ?? null
    })),
    dialogs: (page.dialogs ?? []).map(dialog => ({ id: dialog.id ?? dialog.dialogId, label: dialog.label ?? '', open: dialog.open !== false }))
  };
}

export function fingerprintPageModel(pageModel = {}) { return stableHash(structuralView(pageModel)); }

export function createPageModel(input = {}) {
  if (!record(input)) throw new TypeError('page model input must be an object');
  const controls = Array.isArray(input.controls) ? input.controls.map(normalizeControlModel) : [];
  const sections = Array.isArray(input.sections) ? input.sections.map((section, index) => ({
    id: String(section.id ?? section.sectionId ?? `section-${index}`),
    label: String(section.label ?? section.name ?? ''),
    ...(section.parentId === undefined ? {} : { parentId: section.parentId })
  })) : [];
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
    dialogs,
    mutations: Array.isArray(input.mutations) ? input.mutations.map(String) : [],
    capturedAt: String(input.capturedAt ?? new Date().toISOString())
  };
  return { ...pageModel, fingerprint: fingerprintPageModel(pageModel) };
}

export function isSamePageModel(first, second) {
  return Boolean(first?.fingerprint && second?.fingerprint && first.fingerprint === second.fingerprint);
}
