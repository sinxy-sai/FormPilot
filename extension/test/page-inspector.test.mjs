import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectPage, inspectControls } from '../src/runtime/page-inspector.mjs';

class Element {
  constructor(tagName, attrs = {}, props = {}) { this.tagName = tagName.toUpperCase(); this.attrs = attrs; this.children = []; Object.assign(this, props); this.dataset = {}; this.style = {}; }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  querySelector() { return null; }
  closest() { return null; }
  get labels() { return this._label ? [this._label] : []; }
}
class Document {
  constructor(elements) { this.elements = elements; this.title = 'Apply'; this.location = { origin: 'https://example.test', pathname: '/apply', search: '' }; }
  querySelectorAll(selector) { if (selector.includes('option')) return []; return this.elements.filter((el) => ['INPUT','TEXTAREA','SELECT'].includes(el.tagName) || el.getAttribute('role') === 'combobox'); }
  getElementById() { return null; }
}
const label = (text) => ({ textContent: text });

test('inspects accessible controls and excludes hidden controls', () => {
  const name = new Element('input', { id: 'name', placeholder: 'Full name' }, { type: 'text', value: 'Ada' });
  name._label = label('Name');
  const email = new Element('input', { 'aria-label': 'Email address' }, { type: 'email', value: '' });
  const check = new Element('input', {}, { type: 'checkbox', checked: true, disabled: true });
  const select = new Element('select', { name: 'country' }, { value: 'cn', options: [{ text: 'China', value: 'cn' }, { text: 'US', value: 'us' }] });
  const combo = new Element('div', { role: 'combobox', 'aria-label': 'City' }, { value: 'Shanghai' });
  const hidden = new Element('input', { hidden: '' }, { type: 'text', value: 'ignore' });
  const doc = new Document([name, email, check, select, combo, hidden]);
  const { pageModel } = inspectPage(doc);
  assert.equal(pageModel.controls.length, 5);
  assert.deepEqual(pageModel.controls.map((c) => c.label), ['Name', 'Email address', '', 'country', 'City']);
  assert.equal(pageModel.controls[2].controlType, 'checkbox');
  assert.equal(pageModel.controls[2].disabled, true);
  assert.equal(pageModel.controls[3].controlType, 'native-select');
  assert.deepEqual(pageModel.controls[3].options, ['China', 'US']);
  assert.equal(pageModel.controls[4].controlType, 'combobox');
  assert.match(pageModel.controls[0].selectorToken, /^control-token-/);
  assert.doesNotMatch(pageModel.controls[0].selectorToken, /[#\[]/);
});

test('legacy inspectControls exposes fields while using normalized models', () => {
  const field = new Element('input', { name: 'name' }, { type: 'text', value: 'Ada' });
  const doc = new Document([field]);
  const [result] = inspectControls(doc);
  assert.equal(result.fieldId, 'field-0');
  assert.equal(result.selector, 'input[name="name"]');
  assert.equal(result.selectorToken, 'control-token-0');
  assert.equal(result.value, 'Ada');
});

