import test from 'node:test';
import assert from 'node:assert/strict';
import { createRuntimeContext, planNextStep, runNextStep } from '../src/runtime/orchestrator.mjs';

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
