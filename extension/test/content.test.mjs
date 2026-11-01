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

import { inspectControls, executeFieldAction, executeFillPlan, undoLastFill } from '../src/runtime/control-executor.mjs';
import { convertLegacyFields } from '../src/content-entry.mjs';
import { readFileSync as readEntry } from 'node:fs';
test('built content entry retains legacy message aliases', () => {
  const entry = readEntry(new URL('../src/content-entry.mjs', import.meta.url), 'utf8');
  for (const type of ['inspect-form', 'fill-fields', 'undo-fill', 'inspect-page', 'execute-plan', 'undo-last-fill']) assert.match(entry, new RegExp(type));
});
test('legacy nested matcher payload converts to a verified text action', () => {
  const plan = convertLegacyFields([{ field: { selector: '#school', controlType: 'text' }, value: 'Demo University', confidence: 0.95 }]);
  assert.deepEqual(plan, [{ selector: '#school', action: { type: 'text', value: 'Demo University' } }]);
});

test('generic executor inspects and verifies native controls', async () => {
  const input = { tagName:'INPUT', type:'text', id:'name', name:'name', value:'', offsetParent:{}, getAttribute(){return null;}, dispatchEvent(){}, focus(){}, blur(){} };
  const textarea = { tagName:'TEXTAREA', id:'bio', value:'', offsetParent:{}, getAttribute(){return null;}, dispatchEvent(){}, focus(){}, blur(){} };
  const checkbox = { tagName:'INPUT', type:'checkbox', id:'agree', checked:false, offsetParent:{}, getAttribute(){return null;}, dispatchEvent(){}, focus(){}, blur(){} };
  const option = (value,text)=>({value,text});
  const select = { tagName:'SELECT', id:'city', value:'sh', options:[option('sh','Shanghai')], offsetParent:{}, getAttribute(){return null;}, dispatchEvent(){}, focus(){}, blur(){} };
  const doc = { querySelectorAll(){ return [input,textarea,checkbox,select]; }, querySelector(sel){ return ({'#name':input,'#bio':textarea,'#agree':checkbox,'#city':select})[sel] || null; } };
  assert.equal(inspectControls(doc).length,4);
  const result = await executeFillPlan(doc,[
    {selector:'#name', action:{type:'text',value:'Alice'}},
    {selector:'#bio', action:{type:'textarea',value:'Hello'}},
    {selector:'#agree', action:{type:'checkbox',checked:true}},
    {selector:'#city', action:{type:'native-select',value:'sh'}}
  ]);
  assert.equal(result.filled,4); assert.equal(input.value,'Alice'); assert.equal(checkbox.checked,true); assert.equal(select.value,'sh');
  assert.equal(undoLastFill(doc).undone,4); assert.equal(input.value,''); assert.equal(checkbox.checked,false);
});

test('executor reports missing custom option and continues', async () => {
 const input={tagName:'INPUT',type:'text',id:'a',value:'',offsetParent:{},getAttribute(){return null;},dispatchEvent(){}};
 const combo={tagName:'DIV',id:'combo',getAttribute(n){return n==='role'?'combobox':null;},offsetParent:{},textContent:'',click(){},querySelectorAll(){return []}};
 const doc={querySelectorAll(){return [input,combo]},querySelector(s){return s==='#a'?input:s==='#combo'?combo:null}};
 const r=await executeFillPlan(doc,[{selector:'#combo',action:{type:'custom-select',optionText:'Nope'}},{selector:'#a',action:{type:'text',value:'ok'}}]);
 assert.equal(r.filled,1); assert.equal(r.results[0].reason,'option-not-found'); assert.equal(input.value,'ok');
});


