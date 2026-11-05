import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeContext, planNextStep, runNextStep } from '../src/runtime/orchestrator.mjs';
import { createPageModel } from '../src/core/page-model.mjs';
import { validatePlannerSuggestion } from '../src/ai/schema.mjs';

test('planner uses cached action before provider', async () => {
  let calls = 0;
  const context = createRuntimeContext({ pageModel:{fingerprint:'p',controls:[{controlId:'c1',label:'Name',controlType:'text'}]}, task:{plan:[{tool:'type',target:'c1',arguments:{value:'A'},confidence:0.95}]}, provider:{generate:async()=>{calls++;}} });
  const next = await planNextStep(context);
  assert.equal(next.status,'action'); assert.equal(next.action.target,'c1'); assert.equal(calls,0);
});

test('runNextStep records success and advances step', async () => {
  const context = createRuntimeContext({ pageModel:{fingerprint:'p',controls:[{controlId:'c1',label:'Name',controlType:'text'}]}, task:{plan:[{tool:'type',target:'c1',arguments:{value:'A'},confidence:0.95}]}, execute:async()=>({status:'verified',actual:'A'}) });
  const result = await runNextStep(context);
  assert.equal(result.step,1); assert.equal(result.lastResult.status,'verified');
});

test('repeated failures become manual', async () => {
  const context = createRuntimeContext({ pageModel:{fingerprint:'p',controls:[{controlId:'c1',label:'Name',controlType:'text'}]}, task:{plan:[{tool:'type',target:'c1',arguments:{value:'A'},confidence:0.95}]}, execute:async()=>({status:'skipped',reason:'target-disappeared'}), maxFailures:2 });
  await runNextStep(context); const result=await runNextStep(context); assert.equal(result.status,'manual');
});

test('planner plans deterministically from the resume without calling the local model', async () => {
  let calls = 0;
  const pageModel = createPageModel({
    pageIdentity: { origin: '', route: '', title: '' },
    sections: [{ id: 'section-basic', label: '基本信息', key: 'basic' }],
    controls: [{ controlId: 'control-0', selectorToken: 'control-token-0', label: '姓名', role: 'textbox', controlType: 'text', value: '', visible: true, sectionId: 'section-basic', sectionKey: 'basic', fieldKey: 'name' }]
  });
  const context = createRuntimeContext({
    resume: { 基本信息: { 姓名: '林知远' } },
    pageModel,
    mode: 'fill-empty',
    provider: { generate: async () => { calls += 1; return { controlId: 'control-0', entryId: 'resume-1' }; } }
  });
  const next = await planNextStep(context);
  assert.equal(next.status, 'action');
  assert.equal(next.step.controlId, 'control-0');
  assert.equal(next.step.value, '林知远');
  assert.equal(next.step.sourcePath.join('.'), '基本信息.姓名');
  assert.equal(calls, 0, '确定性规划能给出步骤时不应调用本地模型');
});

test('local model suggestions are read-only: value/tool/target are rejected', async () => {
  assert.equal(validatePlannerSuggestion({ controlId: 'control-0', value: '林知远' }, { controlIds: ['control-0'], entryIds: ['resume-1'] }).status, 'rejected');
  assert.equal(validatePlannerSuggestion({ controlId: 'control-0', tool: 'select', target: 'control-0' }, { controlIds: ['control-0'], entryIds: ['resume-1'] }).status, 'rejected');
  const accepted = validatePlannerSuggestion({ controlId: 'control-0', entryId: 'resume-1', confidence: 0.7 }, { controlIds: ['control-0'], entryIds: ['resume-1'] });
  assert.equal(accepted.status, 'suggestion');
  assert.equal(accepted.controlId, 'control-0');
  assert.equal(accepted.entryId, 'resume-1');
});
