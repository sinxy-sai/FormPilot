export function createAdapter({ name = 'legacy-site-adapter', version = '1', priority = -100, matches, inspect, activate, fill, read, verify, tools } = {}) {
  return {
    name, version, priority, tools: tools || [],
    matches: typeof matches === 'function' ? matches : () => false,
    inspect: typeof inspect === 'function' ? inspect : () => [],
    activate: typeof activate === 'function' ? activate : () => false,
    fill: typeof fill === 'function' ? fill : () => ({ type: 'manual', reason: 'fill-not-implemented', applied: false }),
    read: typeof read === 'function' ? read : (field) => field?.value,
    verify: typeof verify === 'function' ? verify : () => ({ verified: false, applied: false }),
  };
}
