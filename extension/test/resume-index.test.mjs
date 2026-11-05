import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildResumeIndex,
  entryType,
  isFieldKey,
  isSectionKey,
  matchFieldKey,
  matchSectionKey,
  matchUniqueFieldByLabel,
  normalizeDate,
  normalizeKey,
  uniqueSectionForFieldKey,
  SECTION_KEYS,
  REPEATABLE_SECTION_KEYS
} from '../src/core/resume-index.mjs';

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const chineseResume = {
  基本信息: {
    姓名: '林知远',
    性别: '男',
    出生日期: '2001-03',
    电话区号: '+86',
    手机号: '13800000000',
    邮箱: 'linzhiyuan@example.com',
    证件类型: '中国 - 居民身份证',
    证件号: '110101200001011234',
    城市: '杭州'
  },
  求职意向: {
    期望职位: '后端开发工程师',
    期望城市: '杭州',
    求职类型: '校招',
    到岗时间: '随时到岗'
  },
  教育经历: {
    开始时间: '2022-09',
    结束时间: '2026-06',
    培养方式: '统招全日制',
    学校: '云岭科技大学',
    学历: '本科',
    学院: '信息工程学院',
    专业: '人工智能与数据工程',
    GPA: '3.7/4.0'
  },
  项目经历: [
    {
      名称: '灵犀知识库问答平台',
      角色: '个人开发',
      开始时间: '2025-03',
      结束时间: '至今',
      链接: 'https://example.com/projects/lingxi-kb',
      描述: '项目简介：知识库平台'
    },
    {
      名称: '青禾任务协作看板',
      角色: '前端负责人',
      开始时间: '2024-10',
      结束时间: '2025-02',
      链接: 'https://example.com/projects/qinghe-board',
      描述: '项目简介：任务协作看板'
    }
  ],
  竞赛: [{ 名称: '云岭杯软件创新竞赛', 描述: '校级二等奖' }],
  语言能力: [{ 语言: '英语', 水平: '日常会话' }],
  自我评价: { 内容: '本人踏实、注重工程质量。' },
  社交账号: [{ 平台: 'Github', 账号: 'https://example.com/github/x' }]
};

const englishResume = {
  basics: { name: 'Ada Lovelace', mobile: '+8613800000000', email: 'ada@example.com', city: 'London', 'full name': 'Ada Lovelace' },
  intention: { position: 'Backend Engineer', 'expected city': 'Berlin' },
  education: [{ school: 'Cambridge', degree: 'Bachelor', major: 'Mathematics', start: 'Sep 2019', end: 'Jun 2023' }],
  'work experience': [{ company: 'Analytical Engines', title: 'Engineer', start: '2023-07', end: 'present', description: 'Built things' }],
  projects: [{ name: 'Difference Engine', role: 'Author', link: 'https://example.com/de', description: 'A machine' }],
  awards: [{ name: 'Best Paper', date: '2024' }],
  languages: [{ language: 'English', proficiency: 'Native' }],
  summary: 'Curious and rigorous.',
  sns: [{ platform: 'GitHub', account: 'ada' }]
};

const japaneseResume = {
  基本情報: { 氏名: '山田太郎', メール: 'taro@example.jp', 電話番号: '09000000000', 居住地: '東京' },
  学歴: [{ 学校名: '東京大学', 学位: '学士', 専攻: '情報工学', 開始日: '2020-04', 終了日: '2024-03' }],
  職歴: [{ 会社名: 'サンプル株式会社', 役職: 'エンジニア', 開始: '2024-04', 終了: '現在', 業務内容: '開発' }],
  自己PR: '責任感があります',
  語学: [{ 言語: '日本語', 語学レベル: 'ネイティブ' }]
};

const koreanResume = {
  기본정보: { 이름: '김철수', 이메일: 'chulsoo@example.kr', 휴대폰: '01000000000', 거주지: '서울' },
  학력: [{ 학교명: '서울대학교', 학위: '학사', 전공: '컴퓨터공학', 시작일: '2020-03', 종료일: '2024-02' }],
  경력: [{ 회사명: '예시 주식회사', 직책: '엔지니어', 시작: '2024-03', 종료: '현재', 내용: '개발' }],
  자기소개: '성실합니다',
  언어: [{ 언어: '한국어', 수준: '모국어' }]
};

// ---------------------------------------------------------------------------
// §1 词表 / 别名
// ---------------------------------------------------------------------------

test('section 与 field 词表符合契约 §1', () => {
  assert.deepEqual([...SECTION_KEYS], ['basic', 'intention', 'work', 'internship', 'education', 'project', 'award', 'language', 'summary', 'sns']);
  assert.deepEqual([...REPEATABLE_SECTION_KEYS], ['work', 'internship', 'education', 'project', 'award', 'language', 'sns']);
  assert.equal(isSectionKey('education'), true);
  assert.equal(isSectionKey('教育经历'), false);
  assert.equal(isFieldKey('education', 'school'), true);
  assert.equal(isFieldKey('education', 'company'), false);
});

test('多语言 section / field 别名归一化', () => {
  for (const label of ['教育经历', '教育背景', 'education', '学歴', '학력', '教育經歷']) assert.equal(matchSectionKey(label), 'education', label);
  for (const label of ['基本信息', 'basic info', '基本情報', '기본정보', 'basics']) assert.equal(matchSectionKey(label), 'basic', label);
  for (const label of ['项目经历', 'projects', 'プロジェクト', '프로젝트']) assert.equal(matchSectionKey(label), 'project', label);
  for (const label of ['竞赛', '获奖', 'awards', '受賞', '수상']) assert.equal(matchSectionKey(label), 'award', label);
  for (const label of ['自我评价', 'self evaluation', '自己PR', '자기소개']) assert.equal(matchSectionKey(label), 'summary', label);
  for (const label of ['社交账号', 'sns', 'social accounts', 'SNS']) assert.equal(matchSectionKey(label), 'sns', label);
  for (const label of ['求职意向', 'intention', '希望職種', '희망직무']) assert.equal(matchSectionKey(label), 'intention', label);

  assert.equal(matchFieldKey('basic', '手机号'), 'mobile');
  assert.equal(matchFieldKey('basic', 'phone number'), 'mobile');
  assert.equal(matchFieldKey('basic', '姓名（必填）'), 'name');
  assert.equal(matchFieldKey('education', '毕业院校'), 'school');
  assert.equal(matchFieldKey('education', '卒業'), 'end');
  assert.equal(matchFieldKey('work', '会社名'), 'company');
  assert.equal(matchFieldKey('language', 'proficiency'), 'proficiency');
  assert.equal(matchFieldKey('basic', '不存在的字段'), null);
  assert.equal(normalizeKey(' E-Mail '), 'email');
});

test('section 无信息时只接受唯一 label 归属，歧义返回 null', () => {
  assert.deepEqual(matchUniqueFieldByLabel('期望职位'), { sectionKey: 'intention', field: 'position' });
  assert.deepEqual(matchUniqueFieldByLabel('毕业院校'), { sectionKey: 'education', field: 'school' });
  assert.equal(matchUniqueFieldByLabel('城市'), null); // basic.city 与 intention.city 都可能
  assert.equal(matchUniqueFieldByLabel('name'), null); // basic/project/award 都有 name
  assert.equal(uniqueSectionForFieldKey('school'), 'education');
  assert.equal(uniqueSectionForFieldKey('name'), null);
  assert.equal(uniqueSectionForFieldKey('city'), null);
});

// ---------------------------------------------------------------------------
// §2 ResumeIndex 形状
// ---------------------------------------------------------------------------

test('中文简历：canonical 形状、条目、entries、type', () => {
  const index = buildResumeIndex(chineseResume);
  assert.equal(index.schemaVersion, 1);
  assert.equal(index.basics.name.text, '林知远');
  assert.equal(index.basics.mobile.text, '13800000000');
  assert.equal(index.basics.areaCode.text, '+86');
  assert.equal(index.basics.city.text, '杭州');
  assert.equal(index.basics.gender.text, '男');
  assert.equal(index.basics.birthday.text, '2001-03');
  assert.equal(index.basics.birthday.year, 2001);
  assert.equal(index.basics.birthday.month, 3);
  assert.equal(index.intention.position.text, '后端开发工程师');
  assert.equal(index.intention.jobType.text, '校招');

  // 单对象教育经历 -> 1 条 item；数组项目经历 -> 2 条
  assert.equal(index.items.education.length, 1);
  assert.equal(index.items.education[0].itemIndex, 0);
  assert.deepEqual(index.items.education[0].path, ['教育经历']);
  assert.equal(index.items.education[0].fields.school.text, '云岭科技大学');
  assert.equal(index.items.education[0].fields.gpa.text, '3.7/4.0');
  assert.equal(index.items.project.length, 2);
  assert.deepEqual(index.items.project[0].path, ['项目经历', 0]);
  assert.deepEqual(index.items.project[1].path, ['项目经历', 1]);
  assert.equal(index.items.project[0].fields.name.text, '灵犀知识库问答平台');
  assert.equal(index.items.award.length, 1);
  assert.equal(index.items.language.length, 1);
  assert.equal(index.items.sns.length, 1);
  assert.equal(index.items.summary, undefined); // 契约 items 只含 7 个可重复 section

  // entries 扁平表：basic/intention/summary 的 itemIndex 为 0，字段 canonical
  const byPath = new Map(index.entries.map(entry => [entry.path.join('.'), entry]));
  assert.equal(byPath.get('基本信息.姓名').field, 'name');
  assert.equal(byPath.get('基本信息.姓名').key, '姓名');
  assert.equal(byPath.get('教育经历.学校').itemIndex, 0);
  assert.equal(byPath.get('项目经历.0.名称').itemIndex, 0);
  assert.equal(byPath.get('项目经历.0.名称').section, 'project');
  assert.equal(byPath.get('项目经历.0.链接').type, 'url');
  assert.equal(byPath.get('项目经历.0.描述').type, 'longtext');
  assert.equal(byPath.get('项目经历.0.开始时间').type, 'date');
  assert.equal(byPath.get('基本信息.城市').type, 'select');
  assert.ok(byPath.get('自我评价.内容'));
  assert.equal(byPath.get('自我评价.内容').section, 'summary');
  assert.equal(byPath.get('求职意向.期望职位').section, 'intention');
  assert.deepEqual(index.missing, []);
  assert.deepEqual([...index.coverage.known], ['基本信息', '求职意向', '教育经历', '项目经历', '竞赛', '语言能力', '自我评价', '社交账号']);
  assert.deepEqual(index.coverage.unknown, []);
});

test('英文 key 简历归一化', () => {
  const index = buildResumeIndex(englishResume);
  assert.equal(index.basics.name.text, 'Ada Lovelace');
  assert.equal(index.basics.email.text, 'ada@example.com');
  assert.equal(index.intention.position.text, 'Backend Engineer');
  assert.equal(index.intention.city.text, 'Berlin');
  assert.equal(index.items.education[0].fields.school.text, 'Cambridge');
  assert.equal(index.items.education[0].fields.start.text, '2019-09');
  assert.equal(index.items.education[0].fields.end.text, '2023-06');
  assert.equal(index.items.work[0].fields.company.text, 'Analytical Engines');
  assert.equal(index.items.work[0].fields.end.text, '至今');
  assert.equal(index.items.work[0].fields.ongoing.ongoing, true);
  assert.equal(index.items.project[0].fields.link.text, 'https://example.com/de');
  assert.equal(index.entries.find(entry => entry.section === 'project' && entry.field === 'link').type, 'url');
  assert.equal(index.items.award[0].fields.date.text, '2024');
  assert.equal(index.items.language[0].fields.proficiency.text, 'Native');
  assert.ok(index.entries.some(entry => entry.section === 'summary' && entry.value === 'Curious and rigorous.'));
  assert.equal(index.items.sns[0].fields.account.text, 'ada');
});

test('日文 key 简历归一化', () => {
  const index = buildResumeIndex(japaneseResume);
  assert.equal(index.basics.name.text, '山田太郎');
  assert.equal(index.basics.email.text, 'taro@example.jp');
  assert.equal(index.items.education[0].fields.school.text, '東京大学');
  assert.equal(index.items.work[0].fields.company.text, 'サンプル株式会社');
  assert.equal(index.items.work[0].fields.end.text, '至今');
  assert.ok(index.entries.some(entry => entry.section === 'summary' && entry.value === '責任感があります'));
  assert.equal(index.items.language[0].fields.language.text, '日本語');
});

test('韩文 key 简历归一化', () => {
  const index = buildResumeIndex(koreanResume);
  assert.equal(index.basics.name.text, '김철수');
  assert.equal(index.basics.email.text, 'chulsoo@example.kr');
  assert.equal(index.items.education[0].fields.school.text, '서울대학교');
  assert.equal(index.items.work[0].fields.company.text, '예시 주식회사');
  assert.equal(index.items.work[0].fields.end.text, '至今');
  assert.ok(index.entries.some(entry => entry.section === 'summary' && entry.value === '성실합니다'));
});

test('对象与数组两种 section 形状都接受', () => {
  const single = buildResumeIndex({ 教育经历: { 学校: 'A 大学' } });
  const multi = buildResumeIndex({ 教育经历: [{ 学校: 'A 大学' }, { 学校: 'B 大学' }] });
  assert.equal(single.items.education.length, 1);
  assert.equal(single.items.education[0].itemIndex, 0);
  assert.equal(multi.items.education.length, 2);
  assert.equal(multi.items.education[1].itemIndex, 1);
  assert.equal(multi.items.education[1].fields.school.text, 'B 大学');
  const singleProject = buildResumeIndex({ 项目经历: { 名称: '单项目' } });
  assert.equal(singleProject.items.project.length, 1);
  assert.equal(singleProject.items.project[0].fields.name.text, '单项目');
});

test('9 条项目 + 3 条竞赛按序保留 itemIndex（bytedance 备份形状）', () => {
  const resume = {
    基本信息: { 姓名: '张三' },
    项目经历: Array.from({ length: 9 }, (_, index) => ({ 名称: `项目${index}`, 开始时间: `2026-0${(index % 9) + 1}`, 结束时间: '至今' })),
    竞赛: Array.from({ length: 3 }, (_, index) => ({ 名称: `竞赛${index}` }))
  };
  const index = buildResumeIndex(resume);
  assert.equal(index.items.project.length, 9);
  assert.equal(index.items.award.length, 3);
  assert.deepEqual(index.items.project.map(item => item.fields.name.text), Array.from({ length: 9 }, (_, index) => `项目${index}`));
  assert.deepEqual(index.items.project.map(item => item.itemIndex), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(index.items.project.every(item => item.fields.ongoing.ongoing === true), true);
});

// ---------------------------------------------------------------------------
// §1 日期归一化
// ---------------------------------------------------------------------------

test('日期归一化支持各种写法', () => {
  const cases = [
    ['2023-09', { text: '2023-09', year: 2023, month: 9, ongoing: false }],
    ['2023-9', { text: '2023-09', year: 2023, month: 9, ongoing: false }],
    ['2023.09', { text: '2023-09', year: 2023, month: 9, ongoing: false }],
    ['2023/9', { text: '2023-09', year: 2023, month: 9, ongoing: false }],
    ['2023年9月', { text: '2023-09', year: 2023, month: 9, ongoing: false }],
    ['2023-09-01', { text: '2023-09', year: 2023, month: 9, ongoing: false }],
    ['Sep 2023', { text: '2023-09', year: 2023, month: 9, ongoing: false }],
    ['2023', { text: '2023', year: 2023, month: null, ongoing: false }],
    [2023, { text: '2023', year: 2023, month: null, ongoing: false }],
    ['至今', { text: '至今', year: null, month: null, ongoing: true }],
    ['今', { text: '至今', year: null, month: null, ongoing: true }],
    ['present', { text: '至今', year: null, month: null, ongoing: true }],
    ['now', { text: '至今', year: null, month: null, ongoing: true }],
    ['current', { text: '至今', year: null, month: null, ongoing: true }]
  ];
  for (const [input, expected] of cases) assert.deepEqual(normalizeDate(input), expected, String(input));
  // 无法解析：保留原文，字段为 null，不抛错
  assert.deepEqual(normalizeDate('待定'), { text: '待定', year: null, month: null, ongoing: false });
  assert.equal(normalizeDate(''), undefined);
  assert.equal(normalizeDate(null), undefined);
});

test('结束时间=至今 时生成合成 ongoing 字段与 entry', () => {
  const index = buildResumeIndex({ 项目经历: [{ 名称: 'X', 结束时间: '至今' }] });
  assert.equal(index.items.project[0].fields.end.text, '至今');
  assert.equal(index.items.project[0].fields.end.ongoing, true);
  assert.equal(index.items.project[0].fields.ongoing.ongoing, true);
  const entry = index.entries.find(item => item.field === 'ongoing' && item.section === 'project');
  assert.equal(entry.value, '至今');
  assert.equal(entry.type, 'date');
});

test('ongoing 也接受布尔与是/否', () => {
  const yes = buildResumeIndex({ 工作经历: [{ 公司: 'A', 至今: '是' }] });
  assert.equal(yes.items.work[0].fields.ongoing.ongoing, true);
  const no = buildResumeIndex({ 工作经历: [{ 公司: 'A', 是否至今: '否' }] });
  assert.equal(no.items.work[0].fields.ongoing.ongoing, false);
  const bool = buildResumeIndex({ 工作经历: [{ 公司: 'A', ongoing: true }] });
  assert.equal(bool.items.work[0].fields.ongoing.ongoing, true);
  const endDate = buildResumeIndex({ 工作经历: [{ 公司: 'A', 结束时间: '2025-01' }] });
  assert.equal(endDate.items.work[0].fields.ongoing, undefined);
});

// ---------------------------------------------------------------------------
// coverage / missing / 开关型 section
// ---------------------------------------------------------------------------

test('开关型 section（有实习经历:是）不产生 items，只进 coverage', () => {
  const index = buildResumeIndex({ 实习经历: { 有实习经历: '是' } });
  assert.equal(index.items.internship.length, 0);
  assert.deepEqual([...index.coverage.known], ['实习经历']);
  assert.deepEqual(index.coverage.unknown, [{ path: '实习经历.有实习经历', key: '有实习经历' }]);
  assert.deepEqual(index.missing, ['name', 'mobile', 'email', 'idType', 'idNumber', 'city']);
});

test('未知 key 进 coverage.unknown 且不抛错', () => {
  const index = buildResumeIndex({ 基本信息: { 姓名: 'A', 昵称: '小A' }, 技能: ['JavaScript'], 项目经历: [{ 名称: 'P', 无关字段: 1 }] });
  assert.equal(index.basics.name.text, 'A');
  assert.equal(index.basics.nickname, undefined);
  assert.deepEqual(index.coverage.unknown, [
    { path: '基本信息.昵称', key: '昵称' },
    { path: '技能', key: '技能' },
    { path: '项目经历.0.无关字段', key: '无关字段' }
  ]);
  assert.deepEqual([...index.coverage.known], ['基本信息', '项目经历']);
  assert.equal(index.entries.length, 2);
});

test('缺失 basic 必填项进 missing', () => {
  const index = buildResumeIndex({ 基本信息: { 姓名: 'A', 手机号: '1' }, 教育经历: { 学校: 'S' } });
  assert.deepEqual(index.missing, ['email', 'idType', 'idNumber', 'city']);
  assert.deepEqual(buildResumeIndex({}).missing, ['name', 'mobile', 'email', 'idType', 'idNumber', 'city']);
});

test('空值字段不产生 entry', () => {
  const index = buildResumeIndex({ 基本信息: { 姓名: '   ', 邮箱: null, 城市: '杭州' } });
  assert.equal(index.basics.name, undefined);
  assert.equal(index.basics.email, undefined);
  assert.equal(index.basics.city.text, '杭州');
});

test('语言 / 社交 / 竞赛 支持字符串数组', () => {
  const index = buildResumeIndex({ 语言能力: ['英语', '普通话'], 社交账号: ['https://github.com/a'], 竞赛: ['一等奖'] });
  assert.deepEqual(index.items.language.map(item => item.fields.language.text), ['英语', '普通话']);
  assert.deepEqual(index.items.sns.map(item => item.fields.account.text), ['https://github.com/a']);
  assert.deepEqual(index.items.award.map(item => item.fields.name.text), ['一等奖']);
});

// ---------------------------------------------------------------------------
// 纯函数 / 幂等 / 坏输入
// ---------------------------------------------------------------------------

test('输入非法抛 TypeError', () => {
  for (const bad of [null, undefined, 'resume', 42, [], [{}]]) assert.throws(() => buildResumeIndex(bad), TypeError);
  assert.throws(() => buildResumeIndex({ 基本信息: '林知远' }), TypeError);
  assert.throws(() => buildResumeIndex({ 教育经历: 123 }), TypeError);
  assert.throws(() => buildResumeIndex({ 项目经历: [{ 名称: 'ok' }, null, 42] }), (error) => error instanceof TypeError);
});

test('纯函数：不改输入、构建幂等', () => {
  const input = structuredClone(chineseResume);
  const snapshot = JSON.stringify(input);
  const first = buildResumeIndex(input);
  assert.equal(JSON.stringify(input), snapshot, 'buildResumeIndex 不得修改输入');
  const second = buildResumeIndex(first);
  assert.deepEqual(second, first);
  assert.notEqual(second, first);
});

test('entryType 映射', () => {
  assert.equal(entryType('start'), 'date');
  assert.equal(entryType('birthday'), 'date');
  assert.equal(entryType('desc'), 'longtext');
  assert.equal(entryType('content'), 'longtext');
  assert.equal(entryType('link'), 'url');
  assert.equal(entryType('city'), 'select');
  assert.equal(entryType('gpa'), 'text');
  assert.equal(entryType('name'), 'text');
});

test('工作年限 被识别为 basic.workYears，不再出现在未识别字段里', () => {
  const index = buildResumeIndex({ 基本信息: { 姓名: '张三', 工作年限: '应届生' }, 求职意向: { 期望职位: '后端工程师' } });
  assert.equal(index.basics.workYears?.text, '应届生');
  assert.equal(index.coverage.unknown.length, 0, `不应有未识别字段：${JSON.stringify(index.coverage.unknown)}`);
  assert.equal(index.intention.position?.text, '后端工程师');
});
