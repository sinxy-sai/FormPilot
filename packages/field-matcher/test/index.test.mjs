import test from 'node:test';
import assert from 'node:assert/strict';
import { createFillPlan, normalizeLabel, matchField } from '../src/index.mjs';

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

test('supports editable custom profile fields', () => {
  const plan = createFillPlan([{ label: '个人评价' }], { custom: { personalEvaluation: '善于协作和持续学习' } });
  assert.equal(plan[0].path, 'custom.personalEvaluation');
  assert.equal(plan[0].value, '善于协作和持续学习');
});

test('renaming a JSON key makes an unmatched page label fillable without an alias', () => {
  const fields = [{ selector: '#personal-evaluation', label: '个人评价' }];
  const resume = { custom: { '个人优势': '善于协作和持续学习' } };
  assert.equal(createFillPlan(fields, resume)[0].confidence, 0);
  resume.custom['个人评价'] = resume.custom['个人优势'];
  delete resume.custom['个人优势'];
  const plan = createFillPlan(fields, resume);
  assert.equal(plan[0].path, 'custom.个人评价');
  assert.equal(plan[0].value, '善于协作和持续学习');
  assert.equal(plan[0].source, 'json-key');
});

test('top-level JSON field names can match page labels too', () => {
  const plan = createFillPlan([{ label: '个人评价' }], { '个人评价': '示例内容' });
  assert.equal(plan[0].path, '个人评价');
  assert.equal(plan[0].value, '示例内容');
});

test('duplicate named keys require review instead of silently choosing one', () => {
  const plan = createFillPlan([{ label: '自定义说明' }], { a: { '自定义说明': '甲' }, b: { '自定义说明': '乙' } });
  assert.equal(plan[0].confidence, 0);
  assert.equal(plan[0].source, 'ambiguous');
});

test('nonexistent paths do not become confident empty fill values', () => {
  const plan = createFillPlan([{ label: 'School' }], { education: [] });
  assert.equal(plan[0].confidence, 0);
});

test('matches localized Chinese JSON keys directly', () => {
  const plan = createFillPlan(
    [{ label: '姓名' }, { label: '学校' }, { label: '个人评价' }],
    { 基本信息: { 姓名: '中文候选人' }, 教育经历: [{ 学校: '中文大学' }], 自定义字段: { 个人评价: '善于协作' } },
  );
  assert.deepEqual(plan.map(({ path, value, source }) => ({ path, value, source })), [
    { path: '基本信息.姓名', value: '中文候选人', source: 'json-key' },
    { path: '教育经历[0].学校', value: '中文大学', source: 'json-key' },
    { path: '自定义字段.个人评价', value: '善于协作', source: 'json-key' },
  ]);
});

test('matches localized English JSON keys directly', () => {
  const plan = createFillPlan(
    [{ label: 'Full Name' }, { label: 'Personal Evaluation' }],
    { basics: { name: 'English Candidate' }, customFields: { personalEvaluation: 'Collaborative learner' } },
  );
  assert.deepEqual(plan.map(({ path, value }) => ({ path, value })), [
    { path: 'basics.name', value: 'English Candidate' },
    { path: 'customFields.personalEvaluation', value: 'Collaborative learner' },
  ]);
});

test('supports arbitrary Japanese keys and Unicode normalization', () => {
  const plan = createFillPlan(
    [{ label: '氏名' }, { label: '自己ＰＲ：' }],
    { 基本情報: { 氏名: '山田 太郎' }, プロフィール: { 自己PR: '協調性があり、継続的に学習します。' } },
  );
  assert.equal(plan[0].path, '基本情報.氏名');
  assert.equal(plan[0].value, '山田 太郎');
  assert.equal(plan[1].path, 'プロフィール.自己PR');
  assert.equal(plan[1].value, '協調性があり、継続的に学習します。');
});

test('does not force a matching user key through an English schema alias', () => {
  const plan = createFillPlan([{ label: '姓名' }], { 姓名: '用户自定义姓名', basics: { name: 'Legacy name' } });
  assert.equal(plan[0].path, '姓名');
  assert.equal(plan[0].value, '用户自定义姓名');
  assert.equal(plan[0].source, 'json-key');
});

test('matches the current Chinese resume structure used by the extension', () => {
  const resume = {
    基本信息: { 姓名: 'A', 手机号: '100', 邮箱: 'a@example.com', 城市: '深圳' },
    教育经历: { 学校: 'Demo University', 专业: 'Computer Science', 学历: '本科' },
    项目经历: [{ 名称: 'Demo Project', 描述: 'Project details' }],
  };
  assert.equal(matchField({ label: '手机号码', fieldKey: 'mobile' }, resume).value, '100');
  assert.equal(matchField({ label: '学校名称', fieldKey: 'school' }, resume).value, 'Demo University');
  assert.equal(matchField({ label: '项目名称', collectionKey: 'project_list', fieldKey: 'name', repeatIndex: 0 }, resume).value, 'Demo Project');
});

test('matches multilingual section and field keys without requiring one JSON language', () => {
  const resume = { 基本情報: { 氏名: 'A' }, 学歴: { 学校名: 'Uni' }, プロジェクト: [{ 名称: 'Project' }] };
  assert.equal(matchField({ label: 'Full Name', fieldKey: 'name', section: '基本情報' }, resume).value, 'A');
  assert.equal(matchField({ label: 'School', fieldKey: 'school', section: '学歴' }, resume).value, 'Uni');
  assert.equal(matchField({ label: 'Project Name', fieldKey: 'name', collectionKey: 'プロジェクト', repeatIndex: 0 }, resume).value, 'Project');
});
