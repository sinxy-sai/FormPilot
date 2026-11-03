const capabilities = [];

function normalizeCapability(capability = {}) {
  if (!capability || typeof capability !== 'object') throw new TypeError('capability must be an object');
  if (!capability.name || typeof capability.name !== 'string') throw new TypeError('capability.name is required');
  return {
    version: String(capability.version ?? capability.capabilityVersion ?? '1'),
    priority: Number.isFinite(Number(capability.priority)) ? Number(capability.priority) : 0,
    detect: typeof capability.detect === 'function' ? capability.detect : () => false,
    inspect: typeof capability.inspect === 'function' ? capability.inspect : undefined,
    tools: capability.tools ?? [],
    activate: typeof capability.activate === 'function' ? capability.activate : undefined,
    fill: typeof capability.fill === 'function' ? capability.fill : undefined,
    read: typeof capability.read === 'function' ? capability.read : undefined,
    verify: typeof capability.verify === 'function' ? capability.verify : undefined,
    ...capability,
  };
}

export function registerCapability(capability) {
  const normalized = normalizeCapability(capability);
  const existing = capabilities.findIndex((item) => item.name === normalized.name);
  if (existing >= 0) capabilities.splice(existing, 1, normalized);
  else capabilities.push(normalized);
  return normalized;
}

export function unregisterCapability(name) {
  const index = capabilities.findIndex((item) => item.name === name);
  if (index >= 0) return capabilities.splice(index, 1)[0];
  return null;
}

export function listCapabilities() { return [...capabilities]; }

export function detectCapabilities(context = {}) {
  return capabilities.filter((capability) => {
    try { return capability.detect(context) === true; }
    catch { return false; }
  }).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

export function selectCapability(control = {}, available = capabilities) {
  const candidates = Array.isArray(available) ? available : detectCapabilities(available || {});
  const context = control?.context ? { ...control.context, control } : { control };
  const matching = candidates.filter((capability) => {
    try { return capability.detect(context) === true; }
    catch { return false; }
  }).sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  return matching[0] || capabilities.find((capability) => capability.name === 'generic-text') || null;
}

<<<<<<< HEAD
export function capabilityFromAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') return null;
  return registerCapability({
    name: adapter.name || 'legacy-site-adapter',
    version: adapter.version || '1',
    priority: Number.isFinite(Number(adapter.priority)) ? Number(adapter.priority) : -100,
    detect: ({ location, document, control } = {}) => {
      if (control && typeof adapter.inspect === 'function') {
        // Legacy adapters inspect whole documents; matching remains location based.
        return typeof adapter.matches === 'function' ? adapter.matches(location || document?.location || globalThis.location) : false;
      }
      return typeof adapter.matches === 'function' && adapter.matches(location || document?.location || globalThis.location);
    },
    inspect: ({ document } = {}) => typeof adapter.inspect === 'function' ? adapter.inspect(document) : undefined,
    tools: adapter.tools || [],
    activate: adapter.activate,
    fill: adapter.fill,
    read: adapter.read,
    verify: adapter.verify,
    legacyAdapter: adapter,
  });
}

=======
>>>>>>> 2952a65
const typeIs = (type, ...values) => values.includes(String(type || '').toLowerCase());
registerCapability({ name: 'generic-text', version: '1', priority: 1, detect: ({ control } = {}) => !control || typeIs(control.controlType, 'text', 'textarea', 'email', 'tel', 'url', 'number', 'password', 'search'), tools: ['fill', 'read', 'verify'] });
registerCapability({ name: 'native-select', version: '1', priority: 20, detect: ({ control } = {}) => typeIs(control?.controlType, 'native-select'), tools: ['fill', 'read', 'verify'] });
registerCapability({ name: 'date', version: '1', priority: 25, detect: ({ control } = {}) => typeIs(control?.controlType, 'date'), tools: ['fill', 'read', 'verify'] });
registerCapability({ name: 'combobox', version: '1', priority: 30, detect: ({ control } = {}) => typeIs(control?.controlType, 'combobox', 'custom-select'), tools: ['activate', 'fill', 'read', 'verify'] });
registerCapability({ name: 'repeated-section', version: '1', priority: 10, detect: ({ control } = {}) => Boolean(control?.repeated || control?.isRepeated || control?.sectionRepeated), tools: ['activate', 'fill', 'read', 'verify'] });

export { capabilities };
