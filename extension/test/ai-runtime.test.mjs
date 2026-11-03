import test from 'node:test';
import assert from 'node:assert/strict';
import { loadModelConfig, loadQwenModelConfig } from '../src/ai/model-config.mjs';
import { createTransformersProvider } from '../src/ai/transformers-provider.mjs';
import { createQwenProvider } from '../src/ai/qwen-provider.mjs';
import { createQwenRuntime } from '../src/ai/qwen-runtime.mjs';
import { handleModelMessage, createModelProvider } from '../src/ai/model-worker.mjs';
import { createTransformersRuntime } from '../src/ai/transformers-runtime.mjs';

test('default BGE candidate is pinned but disabled by default', () => {
  assert.equal(loadModelConfig().enabled, false);
  assert.equal(loadModelConfig().modelId, 'Xenova/bge-small-zh-v1.5');
  assert.equal(loadModelConfig().revision, '75c43b069aac4d136ba6bc1122f995fedcfd2781');
  assert.equal(loadModelConfig().evidence, 'verified');
});
test('Qwen is disabled without verified revision and consent', async () => {
  assert.equal(loadQwenModelConfig().status, 'unavailable');
  const p=createQwenProvider({config:{enabled:true,modelId:'some/qwen',revision:'main',evidence:'verified',allowNetwork:true},runtimeFactory:async()=>({generate:async()=>({candidateId:'c1',confidence:1})})});
  assert.deepEqual(await p.generate({}),{status:'abstain',reason:'unavailable'});
});
test('Qwen runtime parses injected strict JSON output', async () => {
  const runtime=await createQwenRuntime({modelId:'test/qwen',revision:'r1',dtype:'q4',backend:'wasm',allowNetwork:false},{importTransformers:async()=>({env:{},pipeline:async()=>async()=>[{generated_text:'{"candidateId":"c1","confidence":0.8}'}]})});
  assert.deepEqual(await runtime.generate({field:{id:'f'},candidates:[{candidateId:'c1'}]}),{candidateId:'c1',confidence:0.8});
});

test('local provider is unavailable without verified evidence', async () => { const p=createTransformersProvider({config:{enabled:true,allowNetwork:true,evidence:'unverified',revision:'main'},runtimeFactory:async()=>({generate:async()=>({})})}); assert.deepEqual(await p.generate({}),{status:'abstain',reason:'unavailable'}); });
test('invalid JSON config and model output abstain safely', async () => { assert.equal(loadModelConfig('{').reason,'invalid-json'); const p=createTransformersProvider({config:{enabled:true,allowNetwork:true,evidence:'verified',revision:'r1'},runtimeFactory:async()=>({generate:async()=>'{bad'})}); assert.deepEqual(await p.generate({}),{status:'abstain',reason:'invalid-json'}); });
test('provider timeout and caller cancellation settle', async () => { const p=createTransformersProvider({config:{enabled:true,allowNetwork:true,evidence:'verified',revision:'r1'},timeoutMs:10,runtimeFactory:async()=>({generate:async()=>new Promise(()=>{})})}); assert.deepEqual(await p.generate({}),{status:'abstain',reason:'timeout'}); const c=new AbortController(); const q=createTransformersProvider({config:{enabled:true,allowNetwork:true,evidence:'verified',revision:'r1'},runtimeFactory:async()=>({generate:async()=>new Promise(()=>{})})}); const pending=q.generate({},{signal:c.signal}); c.abort(); assert.deepEqual(await pending,{status:'abstain',reason:'cancelled'}); });
test('worker loads provider once and supports cancellation', async () => { let loads=0, messages=[]; const provider={generate:async(_input,{signal})=>new Promise((resolve,reject)=>{const t=setTimeout(()=>resolve({status:'abstain',reason:'done'}),30);signal.addEventListener('abort',()=>{clearTimeout(t);reject(Error('cancel'))},{once:true})})}; const options={provider}; const a=handleModelMessage({type:'generate',id:'a',input:{}},v=>messages.push(v),options); await handleModelMessage({type:'cancel',id:'a'},()=>{},options); await a; assert.equal(messages[0].result.status,'abstain'); });
test('model worker selects the optional local text generation provider only by explicit kind', async () => {
  const provider = createModelProvider({ kind: 'qwen', enabled: true, modelId: 'test/qwen', revision: 'r1', dtype: 'q4', backend: 'wasm', evidence: 'verified', allowNetwork: true, downloadConsent: true }, { runtimeFactory: async () => ({ generate: async () => ({ candidateId: 'c1', confidence: 0.9 }) }) });
  assert.deepEqual(await provider.generate({}), { candidateId: 'c1', confidence: 0.9 });
});

test('transformers runtime lazily loads and normalizes injected pipeline output', async () => {
  let imports = 0, calls = 0;
  const runtime = await createTransformersRuntime({ modelId:'test/model', revision:'r1', dtype:'q8', backend:'wasm', allowNetwork:false }, { importTransformers: async () => { imports++; return { env:{}, pipeline: async (_task, _id, options) => { assert.equal(options.device,'wasm'); return async () => { calls++; return [[3,4]]; }; } }; } });
  assert.equal(imports, 1); assert.deepEqual(await runtime.embed('label'), [[0.6, 0.8]]); assert.equal(calls, 1);
});

