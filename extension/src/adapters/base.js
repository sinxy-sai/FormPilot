export function createAdapter({ matches, inspect, activate, fill, verify } = {}) {
  return {
    matches: typeof matches === 'function' ? matches : () => false,
    inspect: typeof inspect === 'function' ? inspect : () => [],
    activate: typeof activate === 'function' ? activate : () => false,
    fill: typeof fill === 'function' ? fill : () => ({ type: 'manual', reason: 'fill-not-implemented', applied: false }),
    verify: typeof verify === 'function' ? verify : () => ({ verified: false, applied: false }),
  };
}
