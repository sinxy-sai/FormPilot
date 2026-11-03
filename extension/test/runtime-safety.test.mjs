import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTool } from '../src/runtime/control-executor.mjs';

test('runtime rejects arbitrary selectors before touching the DOM', async () => {
  let queried = false;
  const document = { querySelectorAll() { queried = true; return []; } };
  const result = await executeTool(document, { tool: 'type', selector: '#secret', arguments: { value: 'x' } }, { pageModel: { controls: [] } });
  assert.equal(result.status, 'skipped');
  assert.match(result.reason, /forbidden|selector|target|action/i);
  assert.equal(queried, false);
});

test('read_value returns the observed control value', async () => {
  const element = { value: 'Ada', getClientRects: () => [1] };
  const document = { querySelectorAll() { return [element]; } };
  const result = await executeTool(document, { tool: 'read_value', target: 'control-0' }, { pageModel: { controls: [{ controlId: 'control-0', selectorToken: 'control-token-0', controlType: 'text', visible: true }] } });
  assert.equal(result.status, 'verified');
  assert.equal(result.actual, 'Ada');
});

