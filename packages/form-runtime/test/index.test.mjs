import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFillPlan, undoFillPlan } from '../src/index.mjs';

function fakeDocument() {
  const input = { value: 'old', id: 'email', tagName: 'INPUT', type: 'text', name: 'email', dispatchEvent() {} };
  return { input, querySelector(selector) { return selector === '#email' ? input : null; } };
}

test('fills fields and returns reversible changes', () => {
  const document = fakeDocument();
  const changes = applyFillPlan(document, [{ selector: '#email', value: 'new@example.com', confidence: 1 }]);
  assert.equal(document.input.value, 'new@example.com');
  assert.deepEqual(changes, [{ selector: '#email', previousValue: 'old' }]);
  undoFillPlan(document, changes);
  assert.equal(document.input.value, 'old');
});

test('skips unmatched or empty-confidence fields', () => {
  const document = fakeDocument();
  const changes = applyFillPlan(document, [{ selector: '#email', value: 'x', confidence: 0 }]);
  assert.deepEqual(changes, []);
  assert.equal(document.input.value, 'old');
});
