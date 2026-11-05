// capabilities.mjs — capability registry for the fill engine v2 (contract §5).
//
// A capability describes one page-control "shape" (native input, native select,
// custom combobox, date-with-calendar, repeatable item…) together with the
// strategy the executor should apply. The page inspector attaches the selected
// capability name/version to each control model; the executor only needs the
// control type, but adapters/tests can use the strategy metadata.
//
// Keep the public surface stable: registerCapability / unregisterCapability /
// listCapabilities / detectCapabilities / selectCapability / capabilities.

const capabilities = [];

const lower = value => String(value ?? '').toLocaleLowerCase();
const controlTypeOf = control => lower(control?.controlType ?? control?.type);
const typeIs = (control, ...values) => values.includes(controlTypeOf(control));
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Normalize (and freeze the shape of) a capability registration. */
export function normalizeCapability(capability = {}) {
  if (!isRecord(capability)) throw new TypeError('capability must be an object');
  if (!capability.name || typeof capability.name !== 'string') throw new TypeError('capability.name is required');
  const priority = Number(capability.priority);
  return {
    name: capability.name,
    version: String(capability.version ?? capability.capabilityVersion ?? '1'),
    priority: Number.isFinite(priority) ? priority : 0,
    strategy: typeof capability.strategy === 'string' ? capability.strategy : capability.name,
    detect: typeof capability.detect === 'function' ? capability.detect : () => false,
    inspect: typeof capability.inspect === 'function' ? capability.inspect : undefined,
    activate: typeof capability.activate === 'function' ? capability.activate : undefined,
    fill: typeof capability.fill === 'function' ? capability.fill : undefined,
    read: typeof capability.read === 'function' ? capability.read : undefined,
    verify: typeof capability.verify === 'function' ? capability.verify : undefined,
    tools: Array.isArray(capability.tools) ? [...capability.tools] : [],
    options: isRecord(capability.options) ? { ...capability.options } : {},
    ...capability,
    // Re-assert the normalized fields so a spread of the raw input cannot undo them.
    name: capability.name,
    version: String(capability.version ?? capability.capabilityVersion ?? '1'),
    priority: Number.isFinite(priority) ? priority : 0,
    detect: typeof capability.detect === 'function' ? capability.detect : () => false,
    tools: Array.isArray(capability.tools) ? [...capability.tools] : []
  };
}

export function registerCapability(capability) {
  const normalized = normalizeCapability(capability);
  const existing = capabilities.findIndex(item => item.name === normalized.name);
  if (existing >= 0) capabilities.splice(existing, 1, normalized);
  else capabilities.push(normalized);
  return normalized;
}

export function unregisterCapability(name) {
  const index = capabilities.findIndex(item => item.name === name);
  if (index >= 0) return capabilities.splice(index, 1)[0];
  return null;
}

export function listCapabilities() {
  return [...capabilities];
}

export function getCapability(name) {
  return capabilities.find(capability => capability.name === name) || null;
}

function safeDetect(capability, context) {
  try {
    return capability.detect(context) === true;
  } catch {
    return false;
  }
}

const byPriority = (first, second) => second.priority - first.priority || first.name.localeCompare(second.name);

/** All capabilities that detect on the given context, highest priority first. */
export function detectCapabilities(context = {}) {
  return capabilities.filter(capability => safeDetect(capability, context)).sort(byPriority);
}

/** The best capability for a control model, falling back to generic text input. */
export function selectCapability(control = {}, available = capabilities) {
  const candidates = Array.isArray(available) ? available : detectCapabilities(available || {});
  const context = control?.context ? { ...control.context, control } : { control };
  const matching = candidates.filter(capability => safeDetect(capability, context)).sort(byPriority);
  return matching[0] || capabilities.find(capability => capability.name === 'generic-text') || null;
}

/** Strategy name for a control (executor convenience; null when unsupported). */
export function strategyForControl(control = {}, available = capabilities) {
  return selectCapability(control, available)?.strategy ?? null;
}

// ---------------------------------------------------------------------------
// Built-in page-control shapes (registered in detection-priority order).
// ---------------------------------------------------------------------------

const TEXT_TYPES = ['text', 'textarea', 'email', 'tel', 'url', 'number', 'password', 'search', 'contenteditable', ''];

registerCapability({
  name: 'generic-text',
  version: '2',
  priority: 1,
  strategy: 'text',
  detect: ({ control } = {}) => !control || typeIs(control, ...TEXT_TYPES),
  tools: ['fill', 'read', 'verify']
});

registerCapability({
  name: 'repeated-section',
  version: '2',
  priority: 10,
  strategy: 'repeat-item',
  detect: ({ control } = {}) => Boolean(control?.repeated || control?.isRepeated || control?.sectionRepeated || Number.isInteger(control?.itemIndex)),
  tools: ['activate', 'fill', 'read', 'verify'],
  options: { itemIndexAttribute: 'data-repeat-item' }
});

registerCapability({
  name: 'checkbox',
  version: '2',
  priority: 15,
  strategy: 'native-checkbox',
  detect: ({ control } = {}) => typeIs(control, 'checkbox', 'radio'),
  tools: ['fill', 'read', 'verify'],
  options: { useCheckedSetter: true, clickFallback: true }
});

registerCapability({
  name: 'native-select',
  version: '2',
  priority: 20,
  strategy: 'native-select',
  detect: ({ control } = {}) => typeIs(control, 'native-select'),
  tools: ['fill', 'read', 'verify'],
  options: { optionSelector: 'option', match: ['value', 'text'] }
});

registerCapability({
  name: 'date',
  version: '2',
  priority: 25,
  strategy: 'text-date',
  detect: ({ control } = {}) => typeIs(control, 'date', 'month'),
  tools: ['fill', 'read', 'verify'],
  options: {
    format: 'YYYY-MM',
    acceptsOngoing: true,
    // A readonly/disabled date input is filled by a human in the calendar UI.
    readonlyStrategy: 'manual'
  }
});

registerCapability({
  name: 'combobox',
  version: '2',
  priority: 30,
  strategy: 'custom-combobox',
  detect: ({ control } = {}) => typeIs(control, 'combobox', 'custom-select') || control?.role === 'combobox',
  tools: ['activate', 'fill', 'read', 'verify'],
  options: {
    optionSelector: '[role="option"]',
    listboxSelector: '[role="listbox"]',
    displaySelectors: ['.selectValue', '.areaCodeValue', '.chip', '[data-value]'],
    openTimeoutMs: 1500,
    pollIntervalMs: 50,
    closeTimeoutMs: 600
  }
});

registerCapability({
  name: 'add-item-action',
  version: '2',
  priority: 35,
  strategy: 'add-item',
  detect: ({ action, element } = {}) => action?.kind === 'add-item' || lower(action?.tool) === 'add-item' || element?.hasAttribute?.('data-add') === true,
  tools: ['add-item'],
  options: { countTimeoutMs: 1500, pollIntervalMs: 50 }
});

export { capabilities };
