import test from 'node:test';
import assert from 'node:assert/strict';
import { adapterFor } from '../src/adapters/index.js';
import { createAdapter } from '../src/adapters/base.js';
import { registerCapability, detectCapabilities, selectCapability } from '../src/adapters/capabilities.mjs';

test('selects the ByteDance campus adapter only for campus pages', () => {
  assert.ok(adapterFor(new URL('https://jobs.bytedance.com/campus/resume/edit')));
  assert.equal(adapterFor(new URL('https://jobs.bytedance.com/')), null);
  assert.equal(adapterFor(new URL('https://example.com/campus/resume/edit')), null);
});

test('provides safe adapter defaults and does not claim legacy fill success', () => {
  const adapter = createAdapter({ matches: () => true, inspect: () => 3 });
  assert.equal(adapter.activate(), false);
  assert.deepEqual(adapter.fill({}, 'x'), { type: 'manual', reason: 'fill-not-implemented', applied: false });
  assert.deepEqual(adapter.verify({}, 'x'), { verified: false, applied: false });
});

test('registers capabilities and selects the highest priority match', () => {
  registerCapability({ name: 'test-low', priority: 2, detect: ({ control }) => control?.controlType === 'text' });
  registerCapability({ name: 'test-high', priority: 9, detect: ({ control }) => control?.controlType === 'text' });
  const matches = detectCapabilities({ control: { controlType: 'text' } });
  assert.equal(matches[0].name, 'test-high');
  assert.equal(selectCapability({ controlType: 'text' }, matches).name, 'test-high');
});

test('falls back to generic text when no capability matches', () => {
  assert.equal(selectCapability({ controlType: 'unknown' }, []).name, 'generic-text');
});
