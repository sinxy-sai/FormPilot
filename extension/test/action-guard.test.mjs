import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlannedAction } from '../src/runtime/action-tools.mjs';
import { validatePlannedAction } from '../src/runtime/action-guard.mjs';
import { createPageModel } from '../src/core/page-model.mjs';

const page = createPageModel({ controls: [
  { controlId:'name', controlType:'text', label:'Full name' },
  { controlId:'agree', controlType:'checkbox', label:'I agree to the privacy terms' },
  { controlId:'upload', controlType:'file', label:'Resume file' },
  { controlId:'submit', controlType:'button', label:'Submit application' },
  { controlId:'country', controlType:'native-select', label:'Country', options:['China','US'] }
] });
const action = raw => normalizePlannedAction(raw, page);

test('blocks submit, file, and declaration controls', () => {
  assert.deepEqual(validatePlannedAction(action({tool:'focus',target:'submit',arguments:{}}), {pageModel:page}), {allowed:false, reason:'sensitive-control', requiresUser:true});
  assert.equal(validatePlannedAction(action({tool:'type',target:'upload',arguments:{value:'x'}}), {pageModel:page}).reason, 'file-operation');
  assert.equal(validatePlannedAction(action({tool:'check',target:'agree',arguments:{checked:true}}), {pageModel:page}).reason, 'sensitive-control');
});
test('allows valid text and checkbox actions and rejects mismatched controls', () => {
  assert.equal(validatePlannedAction(action({tool:'type',target:'name',arguments:{value:'Ada'},confidence:1}), {pageModel:page}).allowed, true);
  assert.equal(validatePlannedAction(action({tool:'check',target:'agree',arguments:{checked:true}}), {pageModel:page}).allowed, false);
  assert.equal(validatePlannedAction(action({tool:'check',target:'name',arguments:{checked:true}}), {pageModel:page}).reason, 'check-control-mismatch');
  assert.equal(validatePlannedAction(action({tool:'select',target:'country',arguments:{value:'Mars'}}), {pageModel:page}).reason, 'option-not-found');
});
test('low confidence requires user confirmation instead of allowing', () => {
  const result = validatePlannedAction(action({tool:'type',target:'name',arguments:{value:'Ada'},confidence:.2}), {pageModel:page});
  assert.deepEqual(result, {allowed:false, reason:'low-confidence', requiresUser:true});
});
test('rejects stale page and inactive tasks', () => {
  assert.equal(validatePlannedAction(action({tool:'type',target:'name',arguments:{value:'Ada'}}), {pageModel:page, task:{pageFingerprint:'page-other'}}).reason, 'page-changed');
  assert.equal(validatePlannedAction(action({tool:'type',target:'name',arguments:{value:'Ada'}}), {pageModel:page, task:{status:'completed'}}).reason, 'task-not-active');
});
