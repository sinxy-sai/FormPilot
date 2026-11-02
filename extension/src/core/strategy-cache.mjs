import { loadStrategy, saveStrategyRecord, listStrategyRecords, saveStrategyIndex } from './storage.mjs';

const MAX_STRATEGIES = 50;
const MAX_ITEM_BYTES = 64 * 1024;
const sensitiveKey = /^(?:value|actual|before|after|written|secret|password|passcode|token|authorization|cookie|ssn|email|phone|telephone|credit.?card)$/i;
const stable = value => {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = stable(value[key]); return out; }, {});
};
const hash = value => { let h = 2166136261; for (const c of JSON.stringify(value)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0).toString(16); };
const versions = value => stable(value && typeof value === 'object' ? value : {});
export function createStrategyKey({ origin = '', route = '', pageFingerprint = '', capabilityVersions = {} } = {}) {
  return `strategy-${hash({ origin: String(origin), route: String(route), pageFingerprint: String(pageFingerprint), capabilityVersions: versions(capabilityVersions) })}`;
}
function sanitize(value, key = '') {
  if (sensitiveKey.test(key)) return undefined;
  if (Array.isArray(value)) return value.map(item => sanitize(item)).filter(item => item !== undefined);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).reduce((out, child) => { const safe = sanitize(value[child], child); if (safe !== undefined) out[child] = safe; return out; }, {});
}
function scopeOf(strategy) { return strategy.scope || { origin: strategy.origin || '', route: strategy.route || '' }; }
function compatible(required, actual) { const a = versions(required), b = versions(actual); return Object.keys(a).every(key => String(a[key]) === String(b[key])); }
export async function saveStrategy(input = {}) {
  const scope = scopeOf(input); const capabilityVersions = versions(input.capabilityVersions); const structureFingerprint = String(input.structureFingerprint ?? input.pageFingerprint ?? '');
  if (!scope.origin || !scope.route || !structureFingerprint) throw new TypeError('strategy scope and structureFingerprint are required');
  const id = input.id || createStrategyKey({ origin: scope.origin, route: scope.route, pageFingerprint: structureFingerprint, capabilityVersions });
  const strategy = sanitize({ id, scope: { origin: String(scope.origin), route: String(scope.route) }, structureFingerprint, capabilityVersions, steps: input.steps ?? [], verification: input.verification ?? {}, successCount: Number(input.successCount ?? 0), lastValidatedAt: input.lastValidatedAt ?? null, status: input.status || 'active', version: input.version ?? 1, createdAt: input.createdAt ?? new Date().toISOString() });
  if (JSON.stringify(strategy).length > MAX_ITEM_BYTES) throw new RangeError('strategy exceeds maximum size');
  await saveStrategyRecord(strategy);
  const all = (await listStrategyRecords()).filter(item => item.id !== id).sort((a, b) => String(b.lastValidatedAt || b.createdAt).localeCompare(String(a.lastValidatedAt || a.createdAt)));
  await saveStrategyIndex([id, ...all.map(item => item.id)].slice(0, MAX_STRATEGIES));
  return strategy;
}
export async function findStrategies(context = {}) {
  const origin = String(context.origin ?? ''); const route = String(context.route ?? ''); const fp = String(context.pageFingerprint ?? context.structureFingerprint ?? ''); const caps = context.capabilityVersions ?? {};
  const records = await listStrategyRecords();
  return records.filter(item => item.status !== 'invalidated' && item.scope?.origin === origin && item.scope?.route === route && item.structureFingerprint === fp).map(item => ({ ...item, status: compatible(item.capabilityVersions, caps) ? item.status : 'degraded', capabilityCompatible: compatible(item.capabilityVersions, caps) })).sort((a, b) => (b.successCount || 0) - (a.successCount || 0));
}
export async function recordStrategyResult(id, result = {}) {
  const strategy = await loadStrategy(id); if (!strategy) return null;
  const verified = result.verified === true || result.status === 'success' || result.status === 'verified';
  if (!verified) return invalidateStrategy(id, result.reason || 'verification-failed');
  const updated = { ...strategy, successCount: Number(strategy.successCount || 0) + 1, lastValidatedAt: new Date().toISOString(), status: 'active' }; await saveStrategyRecord(updated); return updated;
}
export async function invalidateStrategy(id, reason = 'invalidated') {
  const strategy = await loadStrategy(id); if (!strategy) return null;
  const updated = { ...strategy, status: 'invalidated', invalidatedReason: String(reason), invalidatedAt: new Date().toISOString() }; await saveStrategyRecord(updated); return updated;
}
export { MAX_STRATEGIES, MAX_ITEM_BYTES };
