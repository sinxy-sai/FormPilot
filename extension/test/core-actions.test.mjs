import test from 'node:test';
import assert from 'node:assert/strict';
import { createFieldDescriptor, compareFieldValue } from '../src/core/field-model.mjs';
import { createFieldAction, validateFieldAction } from '../src/core/action-model.mjs';

test('normalizes descriptors for all supported and blocked controls', () => {
  assert.equal(createFieldDescriptor({ id: 'a', type: 'text' }).controlType, 'text');
  assert.equal(createFieldDescriptor({ id: 'b', tagName: 'TEXTAREA' }).controlType, 'textarea');
  assert.equal(createFieldDescriptor({ id: 'c', type: 'checkbox' }).controlType, 'checkbox');
  assert.equal(createFieldDescriptor({ id: 'd', tagName: 'SELECT' }).controlType, 'native-select');
  assert.equal(createFieldDescriptor({ id: 'e', role: 'combobox' }).controlType, 'custom-select');
  assert.equal(createFieldDescriptor({ id: 'f', controlType: 'combobox' }).controlType, 'custom-select');
  assert.equal(createFieldDescriptor({ id: 'g', type: 'date' }).controlType, 'date');
  assert.equal(createFieldDescriptor({ id: 'h', type: 'file' }).controlType, 'manual');
  assert.equal(createFieldDescriptor({ id: 'i', disabled: true }).controlType, 'manual');
  assert.equal(createFieldDescriptor({ id: 'j', readonly: true }).controlType, 'manual');
  assert.equal(createFieldDescriptor({ id: 'k', controlType: 'text', disabled: true }).controlType, 'manual');
  assert.equal(createFieldDescriptor({ id: 'l', controlType: 'text', readonly: true }).controlType, 'manual');
  assert.equal(createFieldDescriptor({ id: 'm', controlType: 'text', type: 'file' }).controlType, 'manual');
});

test('creates discriminated actions only from approved proposals', () => {
  assert.deepEqual(createFieldAction({ id: 't', controlType: 'text' }, { status: 'approved', value: 'hello' }), { type: 'text', value: 'hello' });
  assert.deepEqual(createFieldAction({ id: 'a', controlType: 'textarea' }, { status: 'approved', value: 'hello' }), { type: 'textarea', value: 'hello' });
  assert.deepEqual(createFieldAction({ id: 'd', controlType: 'date' }, { status: 'approved', value: '2000-01-01' }), { type: 'date', value: '2000-01-01' });
  assert.deepEqual(createFieldAction({ id: 'c', controlType: 'checkbox' }, { status: 'approved', value: true }), { type: 'checkbox', checked: true });
  assert.deepEqual(createFieldAction({ id: 'n', controlType: 'native-select', options: ['A'] }, { status: 'approved', value: 'A' }), { type: 'native-select', value: 'A' });
  assert.deepEqual(createFieldAction({ id: 's', controlType: 'custom-select', options: ['A'] }, { status: 'approved', value: 'A' }), { type: 'custom-select', optionText: 'A' });
  assert.equal(createFieldAction({ id: 't', controlType: 'text' }, { status: 'proposed', value: 'x' }).type, 'manual');
  assert.equal(createFieldAction({ id: 't', controlType: 'text' }, { value: 'x' }).type, 'manual');
  for (const value of [1, true, null]) assert.equal(createFieldAction({ id: 't', controlType: 'text' }, { status: 'approved', value }).type, 'manual');
  assert.equal(createFieldAction({ id: 'c', controlType: 'checkbox' }, { status: 'approved', value: '是' }).type, 'manual');
  assert.equal(createFieldAction({ id: 'n', controlType: 'native-select' }, { status: 'approved', value: 'A' }).type, 'manual');
  assert.equal(createFieldAction({ id: 'x', controlType: 'bogus' }, { status: 'approved', value: 'x' }).type, 'manual');
});

test('validates discriminants, matching fields, payload types, and manual reasons', () => {
  const field = { id: 'ok', controlType: 'checkbox' };
  assert.deepEqual(validateFieldAction({ type: 'checkbox', checked: true }, field), { valid: true });
  for (const action of [null, {}, { type: 'text', value: 'x' }, { type: 'checkbox' }, { type: 'checkbox', checked: 'yes' }, { type: 'manual' }, { type: 'manual', reason: '   ' }]) assert.equal(validateFieldAction(action, field).valid, false);
  assert.equal(validateFieldAction({ type: 'native-select', value: 'x' }, field).valid, false);
  assert.equal(validateFieldAction({ type: 'text', value: 2 }, { id: 'x', controlType: 'text' }).valid, false);
  assert.equal(validateFieldAction({ type: 'native-select', value: 'B' }, { id: 'x', controlType: 'native-select', options: ['A'] }).valid, false);
  assert.equal(validateFieldAction({ type: 'manual', reason: 'review' }, { id: 'x', controlType: 'text' }).valid, true);
});

test('compares ordinary text normalized and sensitive values exactly', () => {
  assert.equal(compareFieldValue({ controlType: 'text' }, 'Ａlice  Smith', 'alice smith').verified, true);
  for (const field of [{ controlType: 'text', name: 'email' }, { controlType: 'text', name: 'phone' }, { controlType: 'text', label: 'Identification number' }]) {
    assert.equal(compareFieldValue(field, 'A 1', 'a 1').verified, false);
    assert.equal(compareFieldValue(field, 'A 1', 'A 1').verified, true);
  }
});

