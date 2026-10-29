import test from 'node:test';
import assert from 'node:assert/strict';
import { adapterFor } from '../src/adapters/index.js';

test('selects the ByteDance campus adapter only for campus pages', () => {
  assert.ok(adapterFor(new URL('https://jobs.bytedance.com/campus/resume/edit')));
  assert.equal(adapterFor(new URL('https://jobs.bytedance.com/')), null);
  assert.equal(adapterFor(new URL('https://example.com/campus/resume/edit')), null);
});
