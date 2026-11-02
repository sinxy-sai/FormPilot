import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageModel, normalizeControlModel, fingerprintPageModel, isSamePageModel } from '../src/core/page-model.mjs';

test('normalizes controls and requires a stable control id', () => {
  assert.throws(() => normalizeControlModel({ label: 'Name' }), /controlId/);
  assert.deepEqual(normalizeControlModel({ controlId: 'f1', label: '姓名', type: 'text', options: [1, 'A'], readOnly: true }), {
    controlId: 'f1', selectorToken: undefined, label: '姓名', role: '', controlType: 'text', options: ['1', 'A'], visible: true, disabled: false, readonly: true
  });
});

test('creates a page model and fingerprint that excludes values and capture time', () => {
  const first = createPageModel({ pageIdentity: { origin: 'https://example.test', route: '/apply' }, capturedAt: 'a', controls: [{ controlId: 'f1', label: 'Name', controlType: 'text', value: 'Alice' }] });
  const second = createPageModel({ pageIdentity: { origin: 'https://example.test', route: '/apply' }, capturedAt: 'b', controls: [{ controlId: 'f1', label: 'Name', controlType: 'text', value: 'Bob' }] });
  assert.equal(first.fingerprint, second.fingerprint);
  assert.equal(isSamePageModel(first, second), true);
});

test('fingerprint changes when page structure changes', () => {
  const one = createPageModel({ pageIdentity: { origin: 'https://example.test', route: '/apply' }, controls: [{ controlId: 'f1', label: 'Name', controlType: 'text' }] });
  const two = createPageModel({ pageIdentity: { origin: 'https://example.test', route: '/apply' }, controls: [{ controlId: 'f1', label: 'Name', controlType: 'text' }, { controlId: 'f2', label: 'Email', controlType: 'text' }] });
  assert.notEqual(fingerprintPageModel(one), fingerprintPageModel(two));
  assert.equal(isSamePageModel(one, two), false);
});
