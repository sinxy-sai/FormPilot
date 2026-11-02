import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/runtime/control-executor.mjs';
import { normalizePlannedAction } from '../src/runtime/action-tools.mjs';
import { inspectPage } from '../src/runtime/page-inspector.mjs';
import { capabilityFromAdapter } from '../src/adapters/capabilities.mjs';

test('execute-tool rejects crafted selector and script without DOM mutation', async () => {
  let mutated = false;
  const doc = { querySelector: () => { mutated = true; return null; } };
  const action = normalizePlannedAction({ tool: 'type', target: 'c1', selector: '#secret', arguments: { value: 'x', script: 'document.body.innerHTML="pwned"' } }, { controls: [{ controlId: 'c1', controlType: 'text' }] });
  assert.equal(action.rejected, true);
  const result = await executeTool(doc, { tool: 'type', selector: '#secret', arguments: { value: 'x' } });
  assert.equal(result.reason, 'selector-not-allowed');
  assert.equal(mutated, false);
});

test('legacy adapter inspect hook is applied through capability integration', () => {
  const field = { tagName: 'INPUT', type: 'text', value: 'raw', attrs: {}, style: {}, dataset: {}, getAttribute(name) { return this.attrs[name] ?? null; }, closest() { return null; }, querySelector() { return null; }, get labels() { return []; } };
  const doc = { title: '', location: { origin: 'https://legacy.test', pathname: '/', search: '' }, querySelectorAll() { return [field]; }, getElementById() { return null; } };
  const adapter = { name: 'legacy', version: '2', matches: () => true, inspect: () => [{ label: 'Legacy Label', value: 'adapted' }] };
  const { pageModel } = inspectPage(doc, { capabilities: [capabilityFromAdapter(adapter)] });
  assert.equal(pageModel.controls[0].label, 'Legacy Label');
  assert.equal(pageModel.controls[0].value, 'adapted');
});
