import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResumeInput, getPathValue, isValidMatchProposal, createTaskSnapshot } from '../src/core/models.mjs';

test('accepts root and versioned profile and rejects non-object roots', () => {
  const root = normalizeResumeInput({ 项目经历: [{ 名称: '示例项目' }] });
  assert.deepEqual(root, { schemaVersion: 1, profile: { 项目经历: [{ 名称: '示例项目' }] } });
  assert.deepEqual(normalizeResumeInput({ schemaVersion: 3, profile: { 姓名: 'A' } }), { schemaVersion: 3, profile: { 姓名: 'A' } });
  const freeFormProfileKey = { profile: { 自定义: '值' }, 其他: '字段' };
  assert.deepEqual(normalizeResumeInput(freeFormProfileKey), { schemaVersion: 1, profile: freeFormProfileKey });
  assert.throws(() => normalizeResumeInput([]));
  assert.throws(() => normalizeResumeInput(null));
  assert.throws(() => normalizeResumeInput({ schemaVersion: 1 }));
});

test('reads repeated array paths and protects prototype chain', () => {
  const profile = { 项目经历: [{ 名称: '示例项目' }], constructor: 'own' };
  assert.equal(getPathValue(profile, '项目经历[0].名称'), '示例项目');
  assert.equal(getPathValue(profile, ['项目经历', 0, '名称']), '示例项目');
  assert.equal(getPathValue(profile, 'constructor'), 'own');
  assert.equal(getPathValue(profile, '__proto__.polluted'), undefined);
  assert.equal(getPathValue({}, 'constructor.name'), undefined);
});

test('validates proposals against current candidate and field', () => {
  const profile = { 教育经历: { 学校: '云岭科技大学' } };
  const field = { id: 'f1', controlType: 'text' };
  assert.deepEqual(isValidMatchProposal({ status: 'proposed', path: '教育经历.学校', value: '云岭科技大学' }, profile, field), { valid: true });
  assert.equal(isValidMatchProposal({ status: 'proposed', path: '教育经历.不存在', value: 'x' }, profile, field).valid, false);
  assert.equal(isValidMatchProposal({ status: 'proposed', path: '教育经历.学校', value: 'x' }, profile, field).valid, false);
  assert.equal(isValidMatchProposal({ status: 'proposed', path: '教育经历.学校', value: 'x', script: 'alert(1)' }, profile, field).valid, false);
  assert.equal(isValidMatchProposal({ status: 'proposed', path: '教育经历.学校', value: 'x', selector: '#x' }, profile, { ...field, selector: '#x' }).valid, false);
});

test('creates task snapshots with stable fields', () => {
  const task = createTaskSnapshot({ tabId: 7, frameId: 0, documentId: 'doc-1', url: 'https://example.test/a', fields: [{ id: 'f1' }], plan: [] });
  assert.equal(task.tabId, 7);
  assert.equal(task.status, 'pending-review');
  assert.equal(typeof task.updatedAt, 'string');
  assert.equal(typeof task.pageFingerprint, 'string');
  assert.deepEqual(task.fields, [{ id: 'f1' }]);
});
