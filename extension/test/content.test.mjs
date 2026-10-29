import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createFillPlan } from '../../packages/field-matcher/src/index.mjs';

const source = readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
function harness(element) {
  let listener;
  runInNewContext(source, {
    document: { querySelector: (selector) => selector === '#school' ? element : null, querySelectorAll: () => [element] },
    Event, location: { href: 'https://jobs.bytedance.com/campus/resume/edit' },
    chrome: { runtime: { onMessage: { addListener(fn) { listener = fn; } } } },
  });
  return async (message) => {
    let response;
    listener(message, {}, (value) => { response = value; });
    for (let attempt = 0; attempt < 20 && response === undefined; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 5));
    return response;
  };
}

test('fills the actual nested matcher payload and undoes the change', async () => {
  const element = { tagName: 'INPUT', offsetParent: {}, value: 'Before', focus() {}, dispatchEvent() {} };
  const message = harness(element);
  const fields = createFillPlan([{ selector: '#school', label: 'School' }], { education: [{ school: 'Demo University' }] });
  assert.equal((await message({ type: 'fill-fields', fields })).filled, 1);
  assert.equal(element.value, 'Demo University');
  assert.equal((await message({ type: 'undo-fill' })).undone, 1);
  assert.equal(element.value, 'Before');
});

test('reports a hidden editor instead of pretending it filled', async () => {
  const element = { tagName: 'INPUT', offsetParent: null, getClientRects: () => [], value: 'Before', focus() {}, dispatchEvent() {}, closest: () => null };
  const message = harness(element);
  const result = await message({ type: 'fill-fields', fields: [{ selector: '#school', value: 'Demo', confidence: 1 }] });
  assert.equal(result.filled, 0);
  assert.equal(result.skipped[0].reason, 'editor-not-open');
});

test('reports options that cannot be selected without clearing the current selection', async () => {
  const element = { tagName: 'SELECT', offsetParent: {}, value: 'cs', options: [{ value: 'cs', text: 'Computer Science' }], dispatchEvent() {} };
  const message = harness(element);
  const result = await message({ type: 'fill-fields', fields: [{ selector: '#school', value: 'Physics', confidence: 1 }] });
  assert.equal(result.filled, 0);
  assert.equal(result.skipped[0].reason, 'option-not-found');
  assert.equal(element.value, 'cs');
});

test('uses a native setter and verifies controlled input values', async () => {
  const element = { tagName: 'INPUT', offsetParent: {}, value: 'Before', focus() {}, dispatchEvent() {}, getAttribute() { return ''; } };
  const message = harness(element);
  const result = await message({ type: 'fill-fields', fields: [{ selector: '#school', value: 'Demo University', confidence: 1 }] });
  assert.equal(result.filled, 1);
  assert.equal(result.verified, 1);
  assert.equal(element.value, 'Demo University');
  assert.equal(element.value, 'Demo University');
});

test('inspects ByteDance formily controls with a visible field label and repeat index', async () => {
  const labelNode = { textContent: '学校名称' };
  const item = {
    tagName: 'INPUT', type: 'text', value: '北京师范大学', className: 'formily-item-school', textContent: '教育经历 学校名称', querySelector() { return { textContent: '学校名称' }; }, querySelectorAll() { return [item]; }, offsetParent: {},
    labels: [labelNode], parentElement: null,
    getAttribute(name) { return name === 'class' ? 'ud__native-input' : ''; },
    closest(selector) { if (selector.includes('formily')) return { textContent: '教育经历 学校名称', querySelector() { return { textContent: '学校名称' }; }, querySelectorAll() { return [item]; }, parentElement: { textContent: '教育经历', parentElement: null } }; return null; },
  };
  const message = harness(item);
  const result = await message({ type: 'inspect-form' });
  assert.equal(result.fields[0].label, '学校名称');
  assert.equal(result.fields[0].section, '教育经历');
  assert.equal(result.fields[0].controlType, 'text');
});

