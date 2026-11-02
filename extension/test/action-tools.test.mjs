import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_DEFINITIONS, normalizePlannedAction } from '../src/runtime/action-tools.mjs';
import { createPageModel } from '../src/core/page-model.mjs';

const page = createPageModel({ sections: [{ id: 's1', label: 'Profile' }], controls: [
  { controlId: 'name', controlType: 'text', label: 'Name' },
  { controlId: 'agree', controlType: 'checkbox', label: 'Agree to terms' }
] });

test('defines only constrained browser tools', () => {
  assert.deepEqual(Object.keys(TOOL_DEFINITIONS), ['focus','open','type','check','select','wait','read_value','verify','ask_user','undo']);
});
test('normalizes legal text and checkbox actions against PageModel ids', () => {
  assert.deepEqual(normalizePlannedAction({ tool:'type', target:'name', arguments:{ value:'Ada' }, confidence: .95 }, page), { tool:'type', target:'name', arguments:{ value:'Ada' }, confidence:.95 });
  assert.equal(normalizePlannedAction({ tool:'check', target:'agree', arguments:{ checked:true } }, page).tool, 'check');
  assert.equal(normalizePlannedAction({ tool:'focus', target:'s1', arguments:{} }, page).target, 's1');
});
test('rejects unknown tools, arbitrary selectors, scripts, and mismatched values', () => {
  for (const raw of [
    { tool:'click', target:'name', arguments:{} },
    { tool:'focus', target:'#name', arguments:{} },
    { tool:'type', target:'name', arguments:{ value: 3 } },
    { tool:'check', target:'agree', arguments:{ checked:'yes' } },
    { tool:'type', target:'name', arguments:{ value:'x', selector:'#name' } },
    { tool:'type', target:'name', arguments:{ value:'x', script:'alert(1)' } },
    { tool:'type', target:'missing', arguments:{ value:'x' } }
  ]) assert.equal(normalizePlannedAction(raw, page).rejected, true);
});
