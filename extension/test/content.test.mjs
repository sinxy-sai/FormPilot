import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createFillPlan } from '../../packages/field-matcher/src/index.mjs';

const source = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
function harness(element) {
  let listener;
  runInNewContext(source, {
    document: { querySelector: (selector) => selector === '#school' ? element : null, querySelectorAll: () => [] },
    Event, chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
  });
  return (message) => {
    let response;
    listener(message, {}, (value) => { response = value; });
    return response;
  };
}

test('fills the actual nested matcher payload and undoes the change', () => {
  const element = { tagName: 'INPUT', offsetParent: {}, value: 'Before', focus() {}, dispatchEvent() {} };
  const message = harness(element);
  const fields = createFillPlan([{ selector: '#school', label: 'School' }], { education: [{ school: 'Demo University' }] });
  assert.equal(message({ type: 'fill-fields', fields }).filled, 1);
  assert.equal(element.value, 'Demo University');
  assert.equal(message({ type: 'undo-fill' }).undone, 1);
  assert.equal(element.value, 'Before');
});

test('reports a hidden editor instead of pretending it filled', () => {
  const element = { tagName: 'INPUT', offsetParent: null, getClientRects: () => [], value: 'Before', focus() {}, dispatchEvent() {}, closest: () => null };
  const message = harness(element);
  const result = message({ type: 'fill-fields', fields: [{ selector: '#school', value: 'Demo', confidence: 1 }] });
  assert.equal(result.filled, 0);
  assert.equal(result.skipped[0].reason, 'editor-not-open');
});

test('reports options that cannot be selected without clearing the current selection', () => {
  const element = { tagName: 'SELECT', offsetParent: {}, value: 'cs', options: [{ value: 'cs', text: 'Computer Science' }], dispatchEvent() {} };
  const message = harness(element);
  const result = message({ type: 'fill-fields', fields: [{ selector: '#school', value: 'Physics', confidence: 1 }] });
  assert.equal(result.filled, 0);
  assert.equal(result.skipped[0].reason, 'option-not-found');
  assert.equal(element.value, 'cs');
});
