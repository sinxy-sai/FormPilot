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

test('selects a permitted option by value or visible text', () => {
  const select = { tagName: 'SELECT', value: 'other', options: [{ value: 'cs', text: 'Computer Science' }, { value: 'math', text: 'Mathematics' }], dispatchEvent() {} };
  const document = { querySelector(selector) { return selector === '#major' ? select : null; } };
  const changes = applyFillPlan(document, [{ selector: '#major', value: 'Computer Science', confidence: 1 }]);
  assert.equal(select.value, 'cs');
  assert.deepEqual(changes, [{ selector: '#major', previousValue: 'other' }]);
});
