import test from 'node:test';
import assert from 'node:assert/strict';
import { setStorageArea } from '../src/core/storage.mjs';
import { createStrategyKey, saveStrategy, findStrategies, recordStrategyResult, invalidateStrategy } from '../src/core/strategy-cache.mjs';

function area() { const data = new Map(); return { async get(key) { if (typeof key === 'string') return data.has(key) ? { [key]: data.get(key) } : {}; const out = {}; for (const k of Object.keys(key || {})) if (data.has(k)) out[k] = data.get(k); return out; }, async set(values) { for (const [k, v] of Object.entries(values)) data.set(k, v); } }; }

test('same structure hits while value changes do not affect key', async () => {
  setStorageArea(area());
  const one = await saveStrategy({ scope: { origin: 'https://example.test', route: '/form' }, structureFingerprint: 'page-1', capabilityVersions: { text: '1' }, steps: [{ fieldId: 'name', value: 'Alice' }] });
  assert.equal(createStrategyKey({ origin: 'https://example.test', route: '/form', pageFingerprint: 'page-1', capabilityVersions: { text: '1' } }), one.id);
  const hits = await findStrategies({ origin: 'https://example.test', route: '/form', pageFingerprint: 'page-1', capabilityVersions: { text: '1' }, values: { name: 'Bob' } });
  assert.equal(hits.length, 1);
  assert.equal(JSON.stringify(hits[0]).includes('Alice'), false);
});

test('capability changes degrade and failed verification invalidates', async () => {
  setStorageArea(area());
  const saved = await saveStrategy({ scope: { origin: 'https://example.test', route: '/x' }, structureFingerprint: 'p', capabilityVersions: { select: '1' } });
  assert.equal((await findStrategies({ origin: 'https://example.test', route: '/x', pageFingerprint: 'p', capabilityVersions: { select: '2' } }))[0].status, 'degraded');
  await recordStrategyResult(saved.id, { verified: false, reason: 'structure-changed' });
  assert.equal((await findStrategies({ origin: 'https://example.test', route: '/x', pageFingerprint: 'p', capabilityVersions: { select: '1' } })).length, 0);
  assert.equal((await invalidateStrategy(saved.id, 'manual')).status, 'invalidated');
});
