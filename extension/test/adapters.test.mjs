import test from 'node:test';
import assert from 'node:assert/strict';
import { adapterFor } from '../src/adapters/index.js';
import { createAdapter } from '../src/adapters/base.js';

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

