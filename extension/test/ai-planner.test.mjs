import test from 'node:test';
import assert from 'node:assert/strict';
import { buildModelInput, validateModelProposal } from '../src/ai/schema.mjs';
import { createLocalModelProvider, unavailableProvider } from '../src/ai/provider.mjs';
import { createEnhancedPlan, rankCandidates } from '../src/ai/rule-first-planner.mjs';

test('buildModelInput exposes candidate metadata and no resume values', () => {
  const sentinel = 'SENTINEL_PHONE_13800000000';
  const field = { id:'f1', label:'毕业院校', section:'教育经历', controlType:'text', options:['云岭科技大学','其他'], value: sentinel };
  const candidates = [{ candidateId:'c1', pathSegments:['教育经历','学校'], displayPath:'教育经历.学校', valueType:'string', value: sentinel }, { candidateId:'c2', pathSegments:['projects',0,'name'], displayPath:'projects[0].name', valueType:'string' }];
  const input = buildModelInput(field, candidates);
  assert.equal(JSON.stringify(input).includes(sentinel), false);
  assert.deepEqual(input.candidates[0].pathSegments, ['教育经历','学校']);
  assert.equal(input.candidates[0].candidateId, 'c1');
});

test('validateModelProposal accepts only known candidate and legal option', () => {
  const context = { fieldId:'f1', candidates:[{candidateId:'c1',pathSegments:['教育经历','学校']}], options:['云岭科技大学','其他'] };
  assert.equal(validateModelProposal({candidateId:'c1',confidence:.91,option:'云岭科技大学',reason:'ok'}, context).status, 'proposed');
  assert.equal(validateModelProposal({candidateId:'evil',confidence:1}, context).status, 'rejected');
  assert.equal(validateModelProposal({candidateId:'c1',confidence:Infinity}, context).status, 'rejected');
  assert.equal(validateModelProposal({candidateId:'c1',confidence:1,selector:'#x'}, context).status, 'rejected');
  assert.equal(validateModelProposal({candidateId:'c1',confidence:1,option:'Unknown'}, context).status, 'rejected');
  assert.equal(validateModelProposal({candidateId:'c1',confidence:1,path:'x'}, context).status, 'rejected');
});

test('provider wraps generate and unavailable provider abstains', async () => {
  const provider = createLocalModelProvider({ generate: async input => ({ candidateId: input.candidates[0].candidateId, confidence:.8 }) });
  assert.deepEqual(await provider.generate({ candidates:[{candidateId:'c1'}] }), { candidateId:'c1', confidence:.8 });
  const result = await unavailableProvider.generate({});
  assert.equal(result.status, 'abstain');
});

test('rule-first planner bypasses provider for high confidence and uses it for low confidence', async () => {
  const profile = { basics:{ name:'Alice', phone:'SENTINEL_PHONE' }, education:[{ school:'SENTINEL_SCHOOL' }], projects:[{ name:'Project A' }, {name:'Project B'}] };
  const fields = [{ id:'high', label:'姓名', controlType:'text' }, { id:'low', label:'毕业院校', section:'教育经历', controlType:'text' }];
  let calls = 0;
  const provider = createLocalModelProvider({ generate: async input => { calls++; assert.equal(JSON.stringify(input).includes('SENTINEL'), false); return { candidateId: input.candidates[0].candidateId, confidence:.8 }; } });
  const plan = await createEnhancedPlan(fields, profile, { provider, matcher: async field => field.id === 'high' ? { path:'basics.name', value:'Alice', confidence:.95, source:'rule' } : { path:null, value:null, confidence:.5, source:'unmatched' } });
  assert.equal(calls, 1);
  assert.equal(plan[0].status, 'proposed');
  assert.equal(plan[0].value, 'Alice');
});

test('ambiguous repeated entries are manual and duplicate sections are scoped', async () => {
  const profile = { education:[{school:'A'}], projects:[{name:'P1'},{name:'P2'}] };
  const fields = [{id:'p', label:'项目名称', section:'项目经历', controlType:'text'}];
  const plan = await createEnhancedPlan(fields, profile, { provider: unavailableProvider });
  assert.equal(plan[0].status, 'manual');
  assert.equal(plan[0].reason, 'ambiguous');
});

test('rankCandidates handles cosine scores and rejects bad dimensions', async () => {
  const embed = async texts => texts.map(t => t === 'field' ? [1,0] : t === 'a' ? [1,0] : [0,1]);
  const ranked = await rankCandidates({label:'field'}, [{candidateId:'a', label:'a'}, {candidateId:'b',label:'b'}], embed);
  assert.deepEqual(ranked.map(x=>x.candidateId), ['a','b']);
  await assert.rejects(() => rankCandidates({label:'field'}, [{candidateId:'a',label:'a'}], async () => [[1,0],[1]]));
  await assert.rejects(() => rankCandidates({label:'field'}, [{candidateId:'a',label:'a'}], async () => [[0,0],[0,0]]));
  await assert.rejects(() => rankCandidates({label:'field'}, [{candidateId:'a',label:'a'}], async () => [[1,0],[NaN,1]]));
});

test('provider enforces timeout even when generator ignores signal and preserves caller abort', async () => {
  const slow = createLocalModelProvider({ timeoutMs: 10, generate: async () => new Promise(() => {}) });
  const started = Date.now();
  assert.deepEqual(await slow.generate({}), { status:'abstain', reason:'timeout' });
  assert.ok(Date.now() - started < 500);
  const controller = new AbortController(); controller.abort();
  const aborting = createLocalModelProvider({ timeoutMs: 1000, generate: async (_input, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancel')))) });
  assert.deepEqual(await aborting.generate({}, { signal: controller.signal }), { status:'abstain', reason:'cancelled' });
});

test('schema accepts explicit abstain and rejects oversized output', () => {
  const context = { candidates:[{candidateId:'c1'}] };
  assert.deepEqual(validateModelProposal({status:'abstain', reason:'uncertain'}, context), {status:'abstain', reason:'uncertain'});
  assert.equal(validateModelProposal({status:'abstain', reason:'x'.repeat(20000)}, context).status, 'rejected');
});

test('planner uses repeatIndex scope, lossless paths, and rejects missing high rule path', async () => {
  const profile = { 'a.b': { 'c[d]': 'safe' }, projects:[{name:'P1'},{name:'P2'}] };
  const fields = [{id:'p1', label:'项目名称', section:'项目经历', repeatIndex:1}];
  const plan = await createEnhancedPlan(fields, profile, { provider: unavailableProvider, matcher: async () => ({pathSegments:['projects',1,'name'], confidence:.95, source:'rule'}) });
  assert.equal(plan[0].value, 'P2');
  const missing = await createEnhancedPlan([{id:'x',label:'x'}], profile, { provider: unavailableProvider, matcher: async () => ({path:'missing.path', confidence:1, source:'rule'}) });
  assert.equal(missing[0].status, 'manual');
});

test('caller abort settles immediately when generator ignores signal', async () => {
  const provider = createLocalModelProvider({ timeoutMs: 1000, generate: async () => new Promise(() => {}) });
  const controller = new AbortController();
  const pending = provider.generate({}, { signal: controller.signal });
  controller.abort();
  assert.deepEqual(await pending, { status:'abstain', reason:'cancelled' });
});

test('missing repeat candidate never falls back to all candidates', async () => {
  const profile = { projects:[{name:'P1'}] };
  const plan = await createEnhancedPlan([{id:'p', label:'项目名称', section:'项目经历', repeatIndex:3}], profile, { provider: unavailableProvider });
  assert.deepEqual(plan[0], { fieldId:'p', status:'manual', reason:'repeat-index-not-found' });
});

test('lossy dotted rule paths are manual without explicit pathSegments', async () => {
  const profile = { 'a.b': { 'c[d]':'safe' } };
  const plan = await createEnhancedPlan([{id:'x', label:'x'}], profile, { provider: unavailableProvider, matcher: async () => ({ path:'a.b.c[d]', confidence:1, source:'rule' }) });
  assert.equal(plan[0].status, 'manual');
  assert.equal(plan[0].reason, 'ambiguous-path');
});
