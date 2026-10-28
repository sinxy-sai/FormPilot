import test from 'node:test';
import assert from 'node:assert/strict';
import { createFillPlan, normalizeLabel } from '../src/index.mjs';

test('normalizes labels before matching', () => {
  assert.equal(normalizeLabel(' Field-of-Study: '), 'field of study');
});

test('matches common application fields to structured resume values', () => {
  const plan = createFillPlan(
    [{ label: 'Full Name' }, { label: 'Field of Study' }, { label: 'Email Address' }],
    { basics: { name: 'Example Candidate', email: 'candidate@example.com' }, education: [{ major: 'Computer Science' }] },
  );
  assert.deepEqual(plan.map(({ path, value }) => ({ path, value })), [
    { path: 'basics.name', value: 'Example Candidate' },
    { path: 'education[0].major', value: 'Computer Science' },
    { path: 'basics.email', value: 'candidate@example.com' },
  ]);
});

test('user mappings override the generic rule', () => {
  const plan = createFillPlan(
    [{ label: 'Preferred Name' }],
    { basics: { name: 'Example Candidate' }, custom: { preferredName: 'Example' } },
    [{ label: 'Preferred Name', resumePath: 'custom.preferredName' }],
  );
  assert.equal(plan[0].value, 'Example');
  assert.equal(plan[0].source, 'user');
});

test('matches Chinese labels used by the local fixture', () => {
  const plan = createFillPlan(
    [{ label: '姓名' }, { label: '邮箱' }, { label: '专业' }, { label: '学位' }, { label: '项目名称' }],
    { basics: { name: '示例候选人', email: 'candidate@example.com' }, education: [{ major: '计算机科学', degree: '本科' }], projects: [{ name: 'FormPilot' }] },
  );
  assert.deepEqual(plan.map(({ path, value }) => ({ path, value })), [
    { path: 'basics.name', value: '示例候选人' },
    { path: 'basics.email', value: 'candidate@example.com' },
    { path: 'education[0].major', value: '计算机科学' },
    { path: 'education[0].degree', value: '本科' },
    { path: 'projects[0].name', value: 'FormPilot' },
  ]);
});
