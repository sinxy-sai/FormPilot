import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResumeIndex } from '../src/core/resume-index.mjs';
import {
  DEFAULT_LIMIT,
  FIELD_MAP,
  OPTION_ALIASES,
  SECTION_ALIASES,
  matchPageSectionKey,
  matchSelectOption,
  planFill,
  selectValuesEqual
} from '../src/core/matcher.mjs';

// ---------------------------------------------------------------------------
// pageModel 构造器（契约 §3 形状；§9 真机语义字段名，手写、不依赖 DOM）
// ---------------------------------------------------------------------------

const pageModel = ({ sections = [], controls = [], actions = [], fingerprint = 'page-fingerprint-test' } = {}) => ({
  pageIdentity: { origin: 'https://jobs.bytedance.com', route: '/experienced/resume/edit', title: '编辑简历' },
  sections,
  controls,
  actions,
  dialogs: [],
  fingerprint
});

const section = (id, label, { key, repeatable = true, itemCount = 0, addActionId } = {}) => ({
  id,
  label,
  ...(key ? { key } : {}),
  repeatable,
  itemCount,
  ...(addActionId ? { addActionId } : {})
});

let controlSeed = 0;
const control = (label, { type = 'text', value = '', options, sectionId, sectionKey, itemIndex, fieldKey, itemRole, visible = true, disabled = false, readonly = false, id } = {}) => {
  controlSeed += 1;
  return {
    controlId: id ?? `ctrl-${controlSeed}`,
    selectorToken: `control-token-${controlSeed}`,
    label,
    role: type,
    controlType: type,
    value,
    ...(options ? { options } : {}),
    visible,
    disabled,
    readonly,
    ...(sectionId === undefined ? {} : { sectionId }),
    ...(sectionKey === undefined ? {} : { sectionKey }),
    ...(itemIndex === undefined ? {} : { itemIndex }),
    ...(fieldKey === undefined ? {} : { fieldKey }),
    ...(itemRole === undefined ? {} : { itemRole })
  };
};

const resume = {
  基本信息: {
    姓名: '林知远',
    电话区号: '+86',
    手机号: '13800000000',
    邮箱: 'linzhiyuan@example.com',
    证件类型: '中国 - 居民身份证',
    证件号: '110101200001011234',
    城市: '杭州'
  },
  教育经历: [{ 学校: '云岭科技大学', 学历: '本科', 专业: '人工智能与数据工程', 开始时间: '2022-09', 结束时间: '2026-06' }],
  项目经历: [
    { 名称: '灵犀知识库问答平台', 角色: '个人开发', 开始时间: '2025-03', 结束时间: '至今', 链接: 'https://example.com/lingxi', 描述: '知识库平台' },
    { 名称: '青禾任务协作看板', 角色: '前端负责人', 开始时间: '2024-10', 结束时间: '2025-02', 链接: 'https://example.com/qinghe', 描述: '任务看板' },
    { 名称: '城市骑行数据分析', 角色: '数据分析', 开始时间: '2024-05', 结束时间: '2024-08', 链接: 'https://example.com/bike', 描述: '数据分析' }
  ]
};
const index = buildResumeIndex(resume);

const stepOf = (plan, predicate) => plan.steps.find(predicate);
const stepsFor = (plan, sectionKey) => plan.steps.filter(step => step.sectionKey === sectionKey);

// ---------------------------------------------------------------------------
// §9 真机常量
// ---------------------------------------------------------------------------

test('§9 显式常量存在且与契约映射表一致', () => {
  assert.equal(SECTION_ALIASES.project.includes('项目经历'), true);
  assert.equal(SECTION_ALIASES.award.includes('获奖'), true);
  assert.equal(SECTION_ALIASES.award.includes('竞赛'), true);
  assert.equal(SECTION_ALIASES.work_samples.includes('作品'), true);

  assert.equal(FIELD_MAP.basic.name, 'name');
  assert.equal(FIELD_MAP.education.field_of_study, 'major');
  assert.equal(FIELD_MAP.education.degree, 'degree');
  assert.equal(FIELD_MAP.project.role, 'role');
  assert.equal(FIELD_MAP.award.date, 'date');
  assert.equal(FIELD_MAP.language.proficiency, 'proficiency');
  assert.equal(FIELD_MAP.sns.sns_type, 'platform');
  assert.equal(FIELD_MAP.sns.link, 'account');
  assert.equal(FIELD_MAP.summary.self_evaluation, 'content');
  assert.equal(FIELD_MAP.project.start_end_time, FIELD_MAP.education.start_end_time);
  assert.deepEqual(FIELD_MAP.work, FIELD_MAP.internship);

  assert.ok(OPTION_ALIASES.degree['本科'].includes('学士'));
  assert.ok(OPTION_ALIASES.language['英语'].includes('english'));
  assert.ok(OPTION_ALIASES.proficiency['日常会话'].includes('日常沟通'));
  assert.ok(OPTION_ALIASES.platform['微信'].includes('wechat'));

  assert.equal(matchPageSectionKey('获奖'), 'award');
  assert.equal(matchPageSectionKey('竞赛'), 'award');
  assert.equal(matchPageSectionKey('作品'), 'work_samples');
  assert.equal(matchPageSectionKey('简历'), 'resume');
  assert.equal(matchPageSectionKey('教育经历'), 'education');
});

test('§9 下拉选项别名 / 大小写 / 包含匹配', () => {
  assert.equal(matchSelectOption(['博士', 'MBA', '硕士', '本科'], '本科', 'degree'), '本科');
  assert.equal(matchSelectOption(['博士', '硕士'], '本科', 'degree'), null);
  assert.equal(matchSelectOption(['English', '汉语'], '英语', 'language'), 'English');
  assert.equal(matchSelectOption(['日常沟通'], '日常会话', 'proficiency'), '日常沟通');
  assert.equal(matchSelectOption(['GitHub', 'WeChat'], 'Github', 'platform'), 'GitHub');
  assert.equal(matchSelectOption(['WeChat'], '微信', 'platform'), 'WeChat');
  assert.equal(matchSelectOption(['浙江省 - 杭州市', '上海市'], '杭州', 'city'), '浙江省 - 杭州市');
  assert.equal(matchSelectOption(['北京', '广州'], '杭州', 'city'), null);
  assert.equal(selectValuesEqual('English', '英语', 'language'), true);
  assert.equal(selectValuesEqual('深圳', '杭州', 'city'), false);
  assert.equal(selectValuesEqual('浙江省 - 杭州市', '杭州', 'city'), true);
});

// ---------------------------------------------------------------------------
// 基础：严格分区 / 字段映射 / kind
// ---------------------------------------------------------------------------

test('basic 分区：页面语义 fieldKey 经 FIELD_MAP 映射（0.95），label 别名兜底（0.85）', () => {
  const page = pageModel({
    sections: [section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 })],
    controls: [
      control('姓名', { id: 'name', sectionId: 's-basic', fieldKey: 'name' }),
      control('手机号码', { id: 'mobile', sectionId: 's-basic', fieldKey: 'mobile' }),
      control('区号', { id: 'area-code', sectionId: 's-basic', fieldKey: 'mobile', type: 'combobox', options: ['+86', '+1'] }),
      control('手机号码', { id: 'mobile-by-label', sectionId: 's-basic' }),
      control('邮箱', { id: 'email', sectionId: 's-basic', fieldKey: 'email', type: 'email' }),
      control('性别', { id: 'gender', sectionId: 's-basic', type: 'combobox', options: ['男', '女'] }),
      control('是否服从调剂', { id: 'agree', sectionId: 's-basic', type: 'checkbox', value: false })
    ]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  const byId = new Map(plan.steps.map(step => [step.controlId, step]));
  assert.equal(byId.get('name').value, '林知远');
  assert.equal(byId.get('name').confidence, 0.95);
  assert.equal(byId.get('name').kind, 'fill');
  assert.equal(byId.get('name').fieldKey, 'name');
  // mobile 被区号下拉 + 手机号文本共用：下拉 -> areaCode，文本 -> mobile
  assert.equal(byId.get('area-code').fieldKey, 'areaCode');
  assert.equal(byId.get('area-code').value, '+86');
  assert.equal(byId.get('area-code').kind, 'select');
  assert.equal(byId.get('mobile').fieldKey, 'mobile');
  assert.equal(byId.get('mobile').value, '13800000000');
  assert.equal(byId.get('mobile').confidence, 0.95);
  assert.equal(byId.get('mobile-by-label').confidence, 0.85);
  assert.equal(byId.get('mobile-by-label').value, '13800000000');
  assert.equal(byId.get('email').kind, 'fill');
  // 简历没有性别 / 服从调剂，不生成步骤，也不瞎填
  assert.equal(byId.has('gender'), false);
  assert.equal(byId.has('agree'), false);
  assert.equal(plan.summary.ready, 5);
  assert.equal(plan.summary.conflicts, 0);
  assert.equal(plan.mode, 'fill-empty');
});

test('§9 同名不同模块：name（基本信息/项目/获奖）、link（项目/社交）、desc（项目/获奖）绝不串味', () => {
  const resumeWithAwards = {
    基本信息: { 姓名: '刘**（已脱敏）', 手机号: '183****4818', 邮箱: 'a@b.com' },
    项目经历: [
      { 名称: '项目甲', 角色: '开发', 链接: 'https://project.example/a', 描述: '项目甲描述', 开始时间: '2026-01', 结束时间: '至今' },
      { 名称: '项目乙', 角色: '负责人', 链接: 'https://project.example/b', 描述: '项目乙描述', 开始时间: '2025-01', 结束时间: '2025-12' }
    ],
    竞赛: [
      { 名称: '获奖甲', 描述: '获奖甲描述' },
      { 名称: '获奖乙', 描述: '获奖乙描述' }
    ],
    社交账号: [{ 平台: 'Github', 账号: 'https://github.com/user' }]
  };
  const idx = buildResumeIndex(resumeWithAwards);
  const page = pageModel({
    sections: [
      section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 }),
      section('s-project', '项目经历', { key: 'project', itemCount: 2, addActionId: 'add-project' }),
      section('s-award', '获奖', { key: 'award', itemCount: 2, addActionId: 'add-award' }),
      section('s-sns', '社交账号', { key: 'sns', itemCount: 1, addActionId: 'add-sns' })
    ],
    controls: [
      control('姓名', { id: 'basic-name', sectionId: 's-basic', fieldKey: 'name' }),
      control('项目名称', { id: 'p0-name', sectionId: 's-project', itemIndex: 0, fieldKey: 'name' }),
      control('项目名称', { id: 'p1-name', sectionId: 's-project', itemIndex: 1, fieldKey: 'name' }),
      control('项目链接', { id: 'p0-link', sectionId: 's-project', itemIndex: 0, fieldKey: 'link' }),
      control('项目描述', { id: 'p0-desc', sectionId: 's-project', itemIndex: 0, fieldKey: 'desc', type: 'textarea' }),
      control('获奖名称', { id: 'a0-name', sectionId: 's-award', itemIndex: 0, fieldKey: 'name' }),
      control('获奖名称', { id: 'a1-name', sectionId: 's-award', itemIndex: 1, fieldKey: 'name' }),
      control('获奖描述', { id: 'a0-desc', sectionId: 's-award', itemIndex: 0, fieldKey: 'desc', type: 'textarea' }),
      control('平台', { id: 'sns-platform', sectionId: 's-sns', itemIndex: 0, fieldKey: 'sns_type', type: 'combobox', options: ['Github', 'QQ'] }),
      control('URL / ID', { id: 'sns-link', sectionId: 's-sns', itemIndex: 0, fieldKey: 'link' })
    ],
    actions: [
      { actionId: 'add-project', kind: 'add-item', sectionId: 's-project', label: '添加' },
      { actionId: 'add-award', kind: 'add-item', sectionId: 's-award', label: '添加' },
      { actionId: 'add-sns', kind: 'add-item', sectionId: 's-sns', label: '添加' }
    ]
  });
  const plan = planFill({ resumeIndex: idx, pageModel: page });
  const byId = new Map(plan.steps.map(step => [step.controlId, step]));

  assert.equal(byId.get('basic-name').value, '刘**（已脱敏）');
  assert.equal(byId.get('p0-name').value, '项目甲');
  assert.equal(byId.get('p1-name').value, '项目乙');
  assert.equal(byId.get('p0-link').value, 'https://project.example/a');
  assert.equal(byId.get('p0-desc').value, '项目甲描述');
  assert.equal(byId.get('a0-name').value, '获奖甲');
  assert.equal(byId.get('a1-name').value, '获奖乙');
  assert.equal(byId.get('a0-desc').value, '获奖甲描述');
  assert.equal(byId.get('sns-platform').value, 'Github');
  assert.equal(byId.get('sns-link').value, 'https://github.com/user');

  // 竞赛数据绝不会写进项目区，项目数据也绝不会写进获奖区
  assert.equal(stepsFor(plan, 'project').some(step => /获奖/.test(String(step.value))), false);
  assert.equal(stepsFor(plan, 'award').some(step => /项目/.test(String(step.value))), false);
  assert.deepEqual(stepsFor(plan, 'project').map(step => step.sourcePath[0]), ['项目经历', '项目经历', '项目经历', '项目经历']);
  assert.deepEqual(stepsFor(plan, 'award').map(step => step.sourcePath[0]), ['竞赛', '竞赛', '竞赛']);
});

test('§9 真机形状：9 个项目卡片全部字段来自同一 resume item（不串味）', () => {
  const nineProjects = Array.from({ length: 9 }, (_, i) => ({
    名称: `项目${i}`, 角色: `角色${i}`, 开始时间: '2026-01', 结束时间: i % 2 === 0 ? '至今' : '2026-02',
    链接: `https://example.com/p/${i}`, 描述: `描述${i}`
  }));
  const idx = buildResumeIndex({ 项目经历: nineProjects, 竞赛: [{ 名称: '获奖A' }, { 名称: '获奖B' }, { 名称: '获奖C' }] });
  const sections = [
    section('s0', '简历', { repeatable: false, itemCount: 1 }),
    section('s1', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 }),
    section('s2', '工作经历', { key: 'work', itemCount: 0 }),
    section('s3', '教育经历', { key: 'education', itemCount: 1, addActionId: 'add-edu' }),
    section('s4', '实习经历', { key: 'internship', itemCount: 0 }),
    section('s5', '项目经历', { key: 'project', itemCount: 9, addActionId: 'add-project' }),
    section('s6', '作品', { key: 'work_samples', itemCount: 0 }),
    section('s7', '获奖', { key: 'award', itemCount: 3, addActionId: 'add-award' }),
    section('s8', '语言能力', { key: 'language', itemCount: 0, addActionId: 'add-language' }),
    section('s9', '自我评价', { key: 'summary', repeatable: false, itemCount: 1 }),
    section('s10', '社交账号', { key: 'sns', itemCount: 0, addActionId: 'add-sns' })
  ];
  const controls = [];
  for (let i = 0; i < 9; i += 1) {
    controls.push(control('项目名称', { id: `p${i}-name`, sectionId: 's5', itemIndex: i, fieldKey: 'name' }));
    controls.push(control('角色', { id: `p${i}-role`, sectionId: 's5', itemIndex: i, fieldKey: 'role' }));
    controls.push(control('', { id: `p${i}-link`, sectionId: 's5', itemIndex: i, fieldKey: 'link' }));
    controls.push(control('描述', { id: `p${i}-desc`, sectionId: 's5', itemIndex: i, fieldKey: 'desc', type: 'textarea' }));
    controls.push(control('开始时间', { id: `p${i}-start`, sectionId: 's5', itemIndex: i, fieldKey: 'start_end_time', itemRole: 'start' }));
    controls.push(control('结束时间', { id: `p${i}-end`, sectionId: 's5', itemIndex: i, fieldKey: 'start_end_time', itemRole: 'end' }));
  }
  for (let i = 0; i < 3; i += 1) {
    controls.push(control('获奖名称', { id: `a${i}-name`, sectionId: 's7', itemIndex: i, fieldKey: 'name' }));
  }
  const page = pageModel({
    sections,
    controls,
    actions: [
      { actionId: 'add-edu', kind: 'add-item', sectionId: 's3', label: '添加' },
      { actionId: 'add-project', kind: 'add-item', sectionId: 's5', label: '添加' },
      { actionId: 'add-award', kind: 'add-item', sectionId: 's7', label: '添加' },
      { actionId: 'add-language', kind: 'add-item', sectionId: 's8', label: '添加' },
      { actionId: 'add-sns', kind: 'add-item', sectionId: 's10', label: '添加' }
    ]
  });
  const plan = planFill({ resumeIndex: idx, pageModel: page });
  assert.deepEqual(plan.summary.outOfRangeItems, []);
  assert.equal(plan.steps.filter(step => step.kind === 'add-item').length, 0);
  for (let i = 0; i < 9; i += 1) {
    const owned = plan.steps.filter(step => step.sectionKey === 'project' && step.itemIndex === i);
    const byField = new Map(owned.map(step => [step.fieldKey, step]));
    assert.equal(byField.get('name').value, `项目${i}`);
    assert.equal(byField.get('role').value, `角色${i}`);
    assert.equal(byField.get('link').value, `https://example.com/p/${i}`);
    assert.equal(byField.get('desc').value, `描述${i}`);
    assert.equal(byField.get('start').value, '2026-01');
    assert.equal(byField.get('end').value, i % 2 === 0 ? '至今' : '2026-02');
    // 来源路径必须全部指向同一个 itemIndex
    assert.equal(owned.every(step => step.sourcePath[1] === i), true);
    assert.equal(byField.get('name').sourcePath.join('.'), `项目经历.${i}.名称`);
  }
});

test('§9 start_end_time：两个输入按 itemRole 或 DOM 顺序分 start/end', () => {
  const page = pageModel({
    sections: [section('s-edu', '教育经历', { key: 'education', itemCount: 1 })],
    controls: [
      control('开始时间', { id: 'start-by-role', sectionId: 's-edu', itemIndex: 0, fieldKey: 'start_end_time', itemRole: 'start' }),
      control('结束时间', { id: 'end-by-role', sectionId: 's-edu', itemIndex: 0, fieldKey: 'start_end_time', itemRole: 'end' })
    ]
  });
  let plan = planFill({ resumeIndex: index, pageModel: page });
  assert.equal(stepOf(plan, step => step.controlId === 'start-by-role').value, '2022-09');
  assert.equal(stepOf(plan, step => step.controlId === 'end-by-role').value, '2026-06');

  const pageByOrder = pageModel({
    sections: [section('s-edu', '教育经历', { key: 'education', itemCount: 1 })],
    controls: [
      control('开始时间', { id: 'first', sectionId: 's-edu', itemIndex: 0, fieldKey: 'start_end_time' }),
      control('结束时间', { id: 'second', sectionId: 's-edu', itemIndex: 0, fieldKey: 'start_end_time' })
    ]
  });
  plan = planFill({ resumeIndex: index, pageModel: pageByOrder });
  assert.equal(stepOf(plan, step => step.controlId === 'first').fieldKey, 'start');
  assert.equal(stepOf(plan, step => step.controlId === 'first').value, '2022-09');
  assert.equal(stepOf(plan, step => step.controlId === 'second').fieldKey, 'end');
  assert.equal(stepOf(plan, step => step.controlId === 'second').value, '2026-06');
});

test('§9 获奖 date 截取 4 位年份，页面年份相同则 skipped、不同则 conflict', () => {
  const awardIndex = buildResumeIndex({ 竞赛: [{ 名称: '比赛A', 时间: '2025-10', 描述: 'x' }, { 名称: '比赛B', 时间: '2024年5月' }] });
  const baseControls = [
    control('获奖名称', { id: 'a0-name', sectionId: 's-award', itemIndex: 0, fieldKey: 'name' }),
    control('时间', { id: 'a0-date', sectionId: 's-award', itemIndex: 0, fieldKey: 'date', value: '2025' }),
    control('获奖名称', { id: 'a1-name', sectionId: 's-award', itemIndex: 1, fieldKey: 'name' }),
    control('时间', { id: 'a1-date', sectionId: 's-award', itemIndex: 1, fieldKey: 'date' })
  ];
  let plan = planFill({
    resumeIndex: awardIndex,
    pageModel: pageModel({ sections: [section('s-award', '获奖', { key: 'award', itemCount: 2 })], controls: baseControls })
  });
  assert.equal(stepOf(plan, step => step.controlId === 'a0-date').value, '2025');
  assert.equal(stepOf(plan, step => step.controlId === 'a0-date').status, 'skipped');
  assert.equal(stepOf(plan, step => step.controlId === 'a1-date').value, '2024');
  assert.equal(stepOf(plan, step => step.controlId === 'a1-date').status, 'ready');

  const conflicting = baseControls.map(item => item.controlId === 'a1-date' ? { ...item, value: '2023' } : item);
  plan = planFill({
    resumeIndex: awardIndex,
    pageModel: pageModel({ sections: [section('s-award', '获奖', { key: 'award', itemCount: 2 })], controls: conflicting })
  });
  assert.equal(stepOf(plan, step => step.controlId === 'a1-date').status, 'conflict');
  assert.equal(stepOf(plan, step => step.controlId === 'a1-date').currentValue, '2023');
});

test('§9 期望工作地点（preferred_city_list）优先 intention.city，回退 basic.city', () => {
  const full = buildResumeIndex({ 基本信息: { 姓名: 'A', 城市: '杭州' }, 求职意向: { 期望城市: '上海' } });
  const page = pageModel({
    sections: [section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 })],
    controls: [control('期望工作地点', { id: 'city', sectionId: 's-basic', fieldKey: 'preferred_city_list', type: 'combobox', options: ['上海', '深圳', '北京'] })]
  });
  const plan = planFill({ resumeIndex: full, pageModel: page });
  const step = stepOf(plan, item => item.controlId === 'city');
  assert.equal(step.value, '上海');
  assert.equal(step.fieldKey, 'city');
  assert.equal(step.sectionKey, 'basic');
  assert.deepEqual(step.sourcePath, ['求职意向', '期望城市']);

  // 页面已有「深圳」而目标「上海」：多选 chip 组件用合成事件打不开弹层（真机实测），
  // 扩展无法产生可信点击，所以一律标记 unsupported('multi-select-manual') 交给人工，绝不尝试写入。
  const existing = pageModel({
    sections: [section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 })],
    controls: [control('期望工作地点', { id: 'city', sectionId: 's-basic', fieldKey: 'preferred_city_list', type: 'combobox', value: '深圳', options: ['上海', '深圳', '北京'] })]
  });
  const manualStep = stepOf(planFill({ resumeIndex: full, pageModel: existing }), item => item.controlId === 'city');
  assert.equal(manualStep.status, 'unsupported');
  assert.equal(manualStep.reason, 'multi-select-manual');
  assert.equal(manualStep.currentValue, '深圳');

  // 页面值与目标一致时仍然是 skipped（不需要动）
  const sameCity = pageModel({
    sections: [section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 })],
    controls: [control('期望工作地点', { id: 'city', sectionId: 's-basic', fieldKey: 'preferred_city_list', type: 'combobox', value: '上海', options: ['上海', '深圳', '北京'] })]
  });
  assert.equal(stepOf(planFill({ resumeIndex: full, pageModel: sameCity }), item => item.controlId === 'city').status, 'skipped');

  // 只有 basic.city 时回退
  const onlyBasic = buildResumeIndex({ 基本信息: { 姓名: 'A', 城市: '杭州' } });
  const fallback = planFill({ resumeIndex: onlyBasic, pageModel: page });
  assert.equal(stepOf(fallback, item => item.controlId === 'city').value, '杭州');
});

test('§9 工作经历模块：company / title / start_end_time / desc 映射（name 也映射到 company）', () => {
  const workIndex = buildResumeIndex({
    工作经历: [{ 公司: '星野科技', 职位: '后端开发', 开始时间: '2023-07', 结束时间: '2025-06', 描述: '做服务' }],
    实习经历: [{ 公司: '实习公司', 职位: '实习生', 开始时间: '2022-06', 结束时间: '2022-09' }]
  });
  const page = pageModel({
    sections: [
      section('s-work', '工作经历', { key: 'work', itemCount: 1, addActionId: 'add-work' }),
      section('s-intern', '实习经历', { key: 'internship', itemCount: 1, addActionId: 'add-intern' })
    ],
    controls: [
      control('公司名称', { id: 'w-company', sectionId: 's-work', itemIndex: 0, fieldKey: 'company' }),
      control('职位', { id: 'w-title', sectionId: 's-work', itemIndex: 0, fieldKey: 'title' }),
      control('开始时间', { id: 'w-start', sectionId: 's-work', itemIndex: 0, fieldKey: 'start_end_time', itemRole: 'start' }),
      control('结束时间', { id: 'w-end', sectionId: 's-work', itemIndex: 0, fieldKey: 'start_end_time', itemRole: 'end' }),
      control('描述', { id: 'w-desc', sectionId: 's-work', itemIndex: 0, fieldKey: 'desc', type: 'textarea' }),
      // 实习模块：字段名若与项目同构（name 表示公司名）
      control('公司名称', { id: 'i-company', sectionId: 's-intern', itemIndex: 0, fieldKey: 'name' })
    ],
    actions: [
      { actionId: 'add-work', kind: 'add-item', sectionId: 's-work', label: '添加' },
      { actionId: 'add-intern', kind: 'add-item', sectionId: 's-intern', label: '添加' }
    ]
  });
  const plan = planFill({ resumeIndex: workIndex, pageModel: page });
  const byId = new Map(plan.steps.map(step => [step.controlId, step]));
  assert.equal(byId.get('w-company').value, '星野科技');
  assert.equal(byId.get('w-title').value, '后端开发');
  assert.equal(byId.get('w-start').value, '2023-07');
  assert.equal(byId.get('w-end').value, '2025-06');
  assert.equal(byId.get('w-desc').value, '做服务');
  assert.equal(byId.get('i-company').value, '实习公司');
});

// ---------------------------------------------------------------------------
// 严格作用域
// ---------------------------------------------------------------------------

test('strict 分区：教育数据绝不写进项目分区，反之亦然', () => {
  const page = pageModel({
    sections: [
      section('s-edu', '教育经历', { key: 'education', itemCount: 1 }),
      section('s-project', '项目经历', { key: 'project', itemCount: 1, addActionId: 'add-project' })
    ],
    controls: [
      control('学校', { id: 'project-school', sectionId: 's-project', itemIndex: 0 }),
      control('项目名称', { id: 'project-name', sectionId: 's-project', itemIndex: 0 }),
      control('名称', { id: 'edu-name', sectionId: 's-edu', itemIndex: 0 }),
      control('学校', { id: 'edu-school', sectionId: 's-edu', itemIndex: 0 })
    ],
    actions: [{ actionId: 'add-project', kind: 'add-item', sectionId: 's-project', label: '添加项目经历' }]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  assert.equal(plan.steps.some(step => step.controlId === 'project-school'), false);
  assert.equal(plan.steps.some(step => step.controlId === 'edu-name'), false);
  assert.equal(stepOf(plan, step => step.controlId === 'project-name').sectionKey, 'project');
  assert.equal(stepOf(plan, step => step.controlId === 'project-name').value, '灵犀知识库问答平台');
  assert.equal(stepOf(plan, step => step.controlId === 'edu-school').value, '云岭科技大学');
  assert.equal(stepOf(plan, step => step.controlId === 'edu-school').sectionKey, 'education');
});

test('重复 label（项目名称/开始时间）按 itemIndex 对齐，不按出现次数串味', () => {
  const page = pageModel({
    sections: [section('s-project', '项目经历', { key: 'project', itemCount: 3, addActionId: 'add-project' })],
    controls: [
      control('项目名称', { id: 'p0-name', sectionId: 's-project', itemIndex: 0 }),
      control('开始时间', { id: 'p0-start', sectionId: 's-project', itemIndex: 0 }),
      control('项目名称', { id: 'p1-name', sectionId: 's-project', itemIndex: 1 }),
      control('开始时间', { id: 'p1-start', sectionId: 's-project', itemIndex: 1 }),
      control('项目名称', { id: 'p2-name', sectionId: 's-project', itemIndex: 2 }),
      control('开始时间', { id: 'p2-start', sectionId: 's-project', itemIndex: 2 })
    ]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  const byId = new Map(plan.steps.map(step => [step.controlId, step]));
  assert.deepEqual(plan.summary.outOfRangeItems, []);
  assert.equal(byId.get('p0-name').value, '灵犀知识库问答平台');
  assert.equal(byId.get('p0-start').value, '2025-03');
  assert.equal(byId.get('p1-name').value, '青禾任务协作看板');
  assert.equal(byId.get('p1-start').value, '2024-10');
  assert.equal(byId.get('p2-name').value, '城市骑行数据分析');
  assert.equal(byId.get('p2-start').value, '2024-05');
  assert.deepEqual(byId.get('p1-name').sourcePath, ['项目经历', 1, '名称']);
  assert.equal(byId.get('p1-name').itemIndex, 1);
});

test('同一 section 两个 item 的字段各自映射，同 label 不同 item 不互相覆盖', () => {
  const page = pageModel({
    sections: [section('s-project', '项目经历', { key: 'project', itemCount: 2 })],
    controls: [
      control('描述', { id: 'p0-desc', sectionId: 's-project', itemIndex: 0, fieldKey: 'desc', type: 'textarea' }),
      control('描述', { id: 'p1-desc', sectionId: 's-project', itemIndex: 1, fieldKey: 'desc', type: 'textarea' })
    ]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  assert.equal(stepOf(plan, step => step.controlId === 'p0-desc').value, '知识库平台');
  assert.equal(stepOf(plan, step => step.controlId === 'p1-desc').value, '任务看板');
});

// ---------------------------------------------------------------------------
// add-item / 条目数
// ---------------------------------------------------------------------------

test('3 个项目 vs 页面 2 个条目：先生成 1 条 add-item，summary 记录 outOfRangeItems', () => {
  const page = pageModel({
    sections: [section('s-project', '项目经历', { key: 'project', itemCount: 2, addActionId: 'add-project' })],
    controls: [
      control('项目名称', { id: 'p0-name', sectionId: 's-project', itemIndex: 0, fieldKey: 'name' }),
      control('项目名称', { id: 'p1-name', sectionId: 's-project', itemIndex: 1, fieldKey: 'name' })
    ],
    actions: [{ actionId: 'add-project', kind: 'add-item', sectionId: 's-project', label: '添加项目经历' }]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  const addSteps = plan.steps.filter(step => step.kind === 'add-item');
  assert.equal(addSteps.length, 1);
  assert.equal(plan.steps[0].kind, 'add-item', 'add-item 必须是第一批步骤');
  const add = addSteps[0];
  assert.equal(add.actionId, 'add-project');
  assert.equal(add.sectionKey, 'project');
  assert.equal(add.itemIndex, 2);
  assert.equal(add.status, 'ready');
  assert.deepEqual(add.sourcePath, ['项目经历', 2]);
  assert.deepEqual(plan.summary.outOfRangeItems, [{ section: 'project', resumeCount: 3, pageCount: 2 }]);
  assert.equal(plan.steps.filter(step => step.kind === 'fill').length, 2);
});

test('页面没有 add 动作时 add-item 标记 unsupported 并给出原因', () => {
  const page = pageModel({
    sections: [section('s-project', '项目经历', { key: 'project', itemCount: 1 })],
    controls: [control('项目名称', { id: 'p0-name', sectionId: 's-project', itemIndex: 0 })]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  const addSteps = plan.steps.filter(step => step.kind === 'add-item');
  assert.equal(addSteps.length, 2);
  assert.equal(addSteps.every(step => step.status === 'unsupported' && step.reason === 'no-add-action'), true);
  assert.equal(plan.summary.unsupported, 2);
  assert.deepEqual(plan.summary.outOfRangeItems, [{ section: 'project', resumeCount: 3, pageCount: 1 }]);
});

test('页面条目比简历多：不填多余卡片、不删，只在 summary.pageExtra 报告', () => {
  const page = pageModel({
    sections: [section('s-project', '项目经历', { key: 'project', itemCount: 5, addActionId: 'add-project' })],
    controls: [0, 1, 2, 3, 4].map(itemIndex => control('项目名称', { id: `p${itemIndex}`, sectionId: 's-project', itemIndex, fieldKey: 'name' }))
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  assert.equal(plan.steps.length, 3);
  assert.deepEqual(plan.summary.outOfRangeItems, []);
  assert.deepEqual(plan.summary.pageExtra, [{ section: 'project', resumeCount: 3, pageCount: 5 }]);
  assert.equal(plan.steps.filter(step => step.kind === 'add-item').length, 0);
});

test('单条目分区（itemCount=1 / repeatable=false）无 itemIndex 时按 0 处理', () => {
  const page = pageModel({
    sections: [section('s-edu', '教育经历', { key: 'education', repeatable: false, itemCount: 1 })],
    controls: [control('学校名称', { id: 'edu-school', sectionId: 's-edu', fieldKey: 'school' })]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  const step = stepOf(plan, item => item.controlId === 'edu-school');
  assert.ok(step);
  assert.equal(step.value, '云岭科技大学');
  assert.equal(step.itemIndex, 0);

  const repeatableSingle = pageModel({
    sections: [section('s-edu', '教育经历', { key: 'education', itemCount: 1 })],
    controls: [control('学校名称', { id: 'edu-school-2', sectionId: 's-edu', fieldKey: 'school' })]
  });
  assert.equal(stepOf(planFill({ resumeIndex: index, pageModel: repeatableSingle }), item => item.controlId === 'edu-school-2').value, '云岭科技大学');
});

test('可重复分区（itemCount>1）但控件无 itemIndex：不猜条目，不产生步骤', () => {
  const page = pageModel({
    sections: [section('s-project', '项目经历', { key: 'project', itemCount: 2 })],
    controls: [control('项目名称', { id: 'no-item-index', sectionId: 's-project', fieldKey: 'name' })]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  assert.equal(plan.steps.some(step => step.controlId === 'no-item-index'), false);
});

// ---------------------------------------------------------------------------
// conflict / overwrite / skipped（幂等）
// ---------------------------------------------------------------------------

test('页面已有值不同 -> conflict 且不 ready；mode=overwrite 才 ready 并显式标记', () => {
  const base = {
    sections: [section('s-edu', '教育经历', { key: 'education', itemCount: 1 })],
    controls: [control('学校名称', { id: 'edu-school', sectionId: 's-edu', itemIndex: 0, fieldKey: 'school', value: '旧学校' })]
  };
  const safe = planFill({ resumeIndex: index, pageModel: pageModel(base) });
  const conflict = stepOf(safe, step => step.controlId === 'edu-school');
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.currentValue, '旧学校');
  assert.equal(conflict.value, '云岭科技大学');
  assert.equal(conflict.overwrite, undefined);
  assert.equal(safe.summary.conflicts, 1);
  assert.equal(safe.summary.ready, 0);

  const overwrite = planFill({ resumeIndex: index, pageModel: pageModel(base), mode: 'overwrite' });
  const ready = stepOf(overwrite, step => step.controlId === 'edu-school');
  assert.equal(ready.status, 'ready');
  assert.equal(ready.overwrite, true);
  assert.equal(ready.currentValue, '旧学校');
  assert.equal(overwrite.summary.ready, 1);
  assert.equal(overwrite.summary.conflicts, 0);
  assert.equal(overwrite.mode, 'overwrite');
});

test('页面值已等于目标 -> skipped/already-correct（幂等，不重复写）', () => {
  const page = pageModel({
    sections: [
      section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 }),
      section('s-edu', '教育经历', { key: 'education', itemCount: 1 })
    ],
    controls: [
      control('姓名', { id: 'name', sectionId: 's-basic', fieldKey: 'name', value: ' 林知远 ' }),
      control('学校名称', { id: 'edu-school', sectionId: 's-edu', itemIndex: 0, fieldKey: 'school', value: '云岭科技大学' })
    ]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  assert.equal(plan.steps.length, 2);
  assert.equal(plan.steps.every(step => step.status === 'skipped' && step.reason === 'already-correct'), true);
  assert.equal(plan.summary.skipped, 2);
  assert.equal(plan.summary.ready, 0);
  assert.deepEqual(planFill({ resumeIndex: index, pageModel: page }), plan);
});

test('日期按年月比较：2022年9月 与 2022-09 视为相同，不同则 conflict', () => {
  const sections = [section('s-edu', '教育经历', { key: 'education', itemCount: 1 })];
  const same = pageModel({ sections, controls: [control('开始时间', { id: 'start', sectionId: 's-edu', itemIndex: 0, fieldKey: 'start_end_time', itemRole: 'start', value: '2022年9月' })] });
  assert.equal(stepOf(planFill({ resumeIndex: index, pageModel: same }), step => step.controlId === 'start').status, 'skipped');
  const diff = pageModel({ sections, controls: [control('开始时间', { id: 'start', sectionId: 's-edu', itemIndex: 0, fieldKey: 'start_end_time', itemRole: 'start', value: '2023-09' })] });
  assert.equal(stepOf(planFill({ resumeIndex: index, pageModel: diff }), step => step.controlId === 'start').status, 'conflict');
});

// ---------------------------------------------------------------------------
// kind 映射 / 过滤
// ---------------------------------------------------------------------------

test('combobox 与 native-select -> select，hidden/file/不可见/禁用/只读不产生步骤', () => {
  const page = pageModel({
    sections: [section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 })],
    controls: [
      control('期望工作地点', { id: 'city', sectionId: 's-basic', fieldKey: 'preferred_city_list', type: 'combobox', options: ['杭州', '上海'] }),
      control('证件类型', { id: 'id-type', sectionId: 's-basic', fieldKey: 'id_type', type: 'native-select', options: ['中国 - 居民身份证'] }),
      control('姓名', { id: 'hidden-name', sectionId: 's-basic', fieldKey: 'name', type: 'hidden' }),
      control('附件', { id: 'file', sectionId: 's-basic', fieldKey: 'attachment_resume', type: 'file' }),
      control('邮箱', { id: 'invisible', sectionId: 's-basic', fieldKey: 'email', visible: false }),
      control('手机号', { id: 'disabled', sectionId: 's-basic', fieldKey: 'mobile', disabled: true }),
      control('证件号', { id: 'readonly', sectionId: 's-basic', fieldKey: 'id_number', readonly: true })
    ]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  assert.deepEqual(plan.steps.map(step => step.controlId), ['city', 'id-type']);
  assert.equal(plan.steps[0].kind, 'select');
  assert.equal(plan.steps[0].value, '杭州');
  assert.equal(plan.steps[1].kind, 'select');
  assert.equal(plan.steps[1].value, '中国 - 居民身份证');
});

test('combobox 选项别名匹配：命中 ready，命中不到 unsupported + 可用选项', () => {
  const languageIndex = buildResumeIndex({ 语言能力: [{ 语言: '英语', 水平: '日常会话' }] });
  const page = pageModel({
    sections: [section('s-language', '语言能力', { key: 'language', itemCount: 1 })],
    controls: [
      control('语言', { id: 'language', sectionId: 's-language', itemIndex: 0, fieldKey: 'language', type: 'combobox', options: ['English', '普通话'] }),
      control('精通程度', { id: 'proficiency', sectionId: 's-language', itemIndex: 0, fieldKey: 'proficiency', type: 'combobox', options: ['日常沟通', '熟练'] })
    ]
  });
  const plan = planFill({ resumeIndex: languageIndex, pageModel: page });
  assert.equal(stepOf(plan, step => step.controlId === 'language').status, 'ready');
  assert.equal(stepOf(plan, step => step.controlId === 'proficiency').status, 'ready');

  const badPage = pageModel({
    sections: [section('s-language', '语言能力', { key: 'language', itemCount: 1 })],
    controls: [control('精通程度', { id: 'proficiency', sectionId: 's-language', itemIndex: 0, fieldKey: 'proficiency', type: 'combobox', options: ['熟练', '良好'] })]
  });
  const bad = stepOf(planFill({ resumeIndex: languageIndex, pageModel: badPage }), step => step.controlId === 'proficiency');
  assert.equal(bad.status, 'unsupported');
  assert.equal(bad.reason, 'option-not-found');
  assert.deepEqual(bad.availableOptions, ['熟练', '良好']);
});

test('checkbox 的 ongoing 目标值转 boolean（结束时间=至今 的合成 ongoing）', () => {
  const page = pageModel({
    sections: [section('s-project', '项目经历', { key: 'project', itemCount: 1 })],
    controls: [
      control('至今', { id: 'p0-ongoing', sectionId: 's-project', itemIndex: 0, type: 'checkbox', value: false }),
      control('结束时间', { id: 'p0-end', sectionId: 's-project', itemIndex: 0, fieldKey: 'start_end_time', itemRole: 'end' })
    ]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  const check = stepOf(plan, step => step.controlId === 'p0-ongoing');
  assert.equal(check.kind, 'check');
  assert.equal(check.value, true);
  assert.equal(check.status, 'ready');
  // 字节真机没有「至今」checkbox，结束时间就是普通文本：直接写「至今」
  const end = stepOf(plan, step => step.controlId === 'p0-end');
  assert.equal(end.kind, 'fill');
  assert.equal(end.value, '至今');
  assert.equal(end.status, 'ready');
});

test('结束时间在页面已有「至今」时 skipped（幂等）', () => {
  const page = pageModel({
    sections: [section('s-project', '项目经历', { key: 'project', itemCount: 1 })],
    controls: [control('结束时间', { id: 'p0-end', sectionId: 's-project', itemIndex: 0, fieldKey: 'start_end_time', itemRole: 'end', value: '至今' })]
  });
  const step = stepOf(planFill({ resumeIndex: index, pageModel: page }), item => item.controlId === 'p0-end');
  assert.equal(step.status, 'skipped');
  assert.equal(step.reason, 'already-correct');
});

// ---------------------------------------------------------------------------
// 无分区页面：0.7 强匹配，绝不猜
// ---------------------------------------------------------------------------

test('页面无分区信息：页面语义 fieldKey / 唯一 label -> confidence 0.7；歧义不产生步骤', () => {
  const intentIndex = buildResumeIndex({
    基本信息: { 姓名: '林知远', 手机号: '13800000000', 城市: '杭州' },
    求职意向: { 期望职位: '后端开发工程师' },
    教育经历: [{ 学校: '云岭科技大学' }]
  });
  const page = pageModel({
    sections: [],
    controls: [
      control('期望职位', { id: 'position' }),
      control('毕业院校', { id: 'school' }),
      control('名称', { id: 'ambiguous-name' }),
      control('手机号', { id: 'mobile' })
    ]
  });
  const plan = planFill({ resumeIndex: intentIndex, pageModel: page });
  const byId = new Map(plan.steps.map(step => [step.controlId, step]));
  assert.equal(byId.get('position').value, '后端开发工程师');
  assert.equal(byId.get('position').confidence, 0.7);
  assert.equal(byId.get('school').value, '云岭科技大学');
  assert.equal(byId.get('school').confidence, 0.7);
  assert.equal(byId.has('ambiguous-name'), false);
  // 唯一 label 命中（手机号只在 basic 有）-> 0.7
  assert.equal(byId.get('mobile').confidence, 0.7);
  assert.equal(byId.get('mobile').fieldKey, 'mobile');

  // page 语义 fieldKey 唯一归属（单独一页，避免同字段重复造成歧义）
  const byFieldKey = planFill({
    resumeIndex: intentIndex,
    pageModel: pageModel({ sections: [], controls: [control('学校名称', { id: 'school-by-field-key', fieldKey: 'school' })] })
  });
  const schoolStep = stepOf(byFieldKey, step => step.controlId === 'school-by-field-key');
  assert.equal(schoolStep.sectionKey, 'education');
  assert.equal(schoolStep.confidence, 0.7);
  assert.equal(schoolStep.value, '云岭科技大学');

  // 无分区且可重复板块里同字段出现多次：无法确定 itemIndex -> 歧义，不猜
  const duplicated = planFill({
    resumeIndex: intentIndex,
    pageModel: pageModel({
      sections: [],
      controls: [control('学校名称', { id: 's1', fieldKey: 'school' }), control('学校名称', { id: 's2', fieldKey: 'school' })]
    })
  });
  assert.equal(duplicated.steps.length, 0);
});

// ---------------------------------------------------------------------------
// summary / limit / 参数校验
// ---------------------------------------------------------------------------

test('summary 计数与 missingFields / outOfRangeItems 完整', () => {
  const page = pageModel({
    sections: [
      section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 }),
      section('s-project', '项目经历', { key: 'project', itemCount: 1, addActionId: 'add-project' }),
      section('s-edu', '教育经历', { key: 'education', itemCount: 1 })
    ],
    controls: [
      control('姓名', { id: 'name', sectionId: 's-basic', fieldKey: 'name' }),
      control('邮箱', { id: 'email', sectionId: 's-basic', fieldKey: 'email', value: 'old@example.com' }),
      control('期望工作地点', { id: 'city', sectionId: 's-basic', fieldKey: 'preferred_city_list', value: '杭州' }),
      control('项目名称', { id: 'p0-name', sectionId: 's-project', itemIndex: 0, fieldKey: 'name', value: '灵犀知识库问答平台' }),
      control('GPA', { id: 'gpa', sectionId: 's-edu', itemIndex: 0, fieldKey: 'gpa' })
    ],
    actions: [{ actionId: 'add-project', kind: 'add-item', sectionId: 's-project', label: '添加项目经历' }]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page });
  const { summary } = plan;
  assert.equal(summary.total, plan.steps.length);
  assert.equal(summary.ready + summary.conflicts + summary.skipped + summary.unsupported, summary.total);
  assert.equal(summary.ready, 3); // name + city(skipped? no：杭州=杭州 是 skipped) —— 见下方断言
  assert.equal(summary.conflicts, 1);
  assert.equal(summary.skipped, 2);
  assert.ok(summary.missingFields.includes('education.gpa'));
  assert.deepEqual(summary.outOfRangeItems, [{ section: 'project', resumeCount: 3, pageCount: 1 }]);
  assert.deepEqual(summary.pageExtra, []);
  assert.equal(summary.truncated, false);
  assert.equal(summary.dropped, 0);
  assert.equal(summary.plannedTotal, plan.steps.length);
});

test('limit 截断并给出 summary 提示', () => {
  const page = pageModel({
    sections: [section('s-project', '项目经历', { key: 'project', itemCount: 3 })],
    controls: [
      control('项目名称', { id: 'p0', sectionId: 's-project', itemIndex: 0, fieldKey: 'name' }),
      control('项目名称', { id: 'p1', sectionId: 's-project', itemIndex: 1, fieldKey: 'name' }),
      control('项目名称', { id: 'p2', sectionId: 's-project', itemIndex: 2, fieldKey: 'name' })
    ]
  });
  const full = planFill({ resumeIndex: index, pageModel: page });
  assert.equal(full.steps.length, 3);
  const limited = planFill({ resumeIndex: index, pageModel: page, limit: 2 });
  assert.equal(limited.steps.length, 2);
  assert.equal(limited.summary.truncated, true);
  assert.equal(limited.summary.dropped, 1);
  assert.equal(limited.summary.plannedTotal, 3);
  assert.equal(limited.summary.total, 2);
  assert.equal(DEFAULT_LIMIT, 200);
});

test('参数非法抛 TypeError', () => {
  assert.throws(() => planFill({ resumeIndex: null, pageModel: pageModel({}) }), TypeError);
  assert.throws(() => planFill({ resumeIndex: index, pageModel: null }), TypeError);
  assert.throws(() => planFill({ resumeIndex: index, pageModel: pageModel({}), mode: 'force' }), TypeError);
  assert.throws(() => planFill({ resumeIndex: index, pageModel: pageModel({}), limit: 0 }), TypeError);
});

test('接受裸简历（内部自动 buildResumeIndex），且不修改输入', () => {
  const snapshot = JSON.stringify(resume);
  const plan = planFill({
    resumeIndex: resume,
    pageModel: pageModel({
      sections: [section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 })],
      controls: [control('姓名', { id: 'name', sectionId: 's-basic', fieldKey: 'name' })]
    })
  });
  assert.equal(plan.steps[0].value, '林知远');
  assert.equal(JSON.stringify(resume), snapshot);
});

test('确定性：同输入同输出（步骤顺序稳定，无时间戳）', () => {
  const page = pageModel({
    sections: [
      section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 }),
      section('s-project', '项目经历', { key: 'project', itemCount: 2, addActionId: 'add-project' })
    ],
    controls: [
      control('项目名称', { id: 'p1', sectionId: 's-project', itemIndex: 1, fieldKey: 'name' }),
      control('姓名', { id: 'name', sectionId: 's-basic', fieldKey: 'name' }),
      control('项目名称', { id: 'p0', sectionId: 's-project', itemIndex: 0, fieldKey: 'name' })
    ],
    actions: [{ actionId: 'add-project', kind: 'add-item', sectionId: 's-project', label: '添加项目经历' }]
  });
  const first = planFill({ resumeIndex: index, pageModel: page });
  const second = planFill({ resumeIndex: index, pageModel: page });
  assert.deepEqual(first, second);
  assert.deepEqual(first.steps.map(step => step.stepId), second.steps.map(step => step.stepId));
  assert.equal(first.steps.filter(step => step.kind === 'add-item').length, 1);
  assert.equal(first.steps[0].kind, 'add-item');
});

test('简历缺字段：页面需要的字段进 missingFields，不产生步骤', () => {
  const sparse = buildResumeIndex({ 基本信息: { 姓名: '只填了名字' } });
  const page = pageModel({
    sections: [section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 })],
    controls: [
      control('姓名', { id: 'name', sectionId: 's-basic', fieldKey: 'name' }),
      control('邮箱', { id: 'email', sectionId: 's-basic', fieldKey: 'email' }),
      control('证件号', { id: 'idNumber', sectionId: 's-basic', fieldKey: 'id_number' })
    ]
  });
  const plan = planFill({ resumeIndex: sparse, pageModel: page });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].controlId, 'name');
  assert.ok(plan.summary.missingFields.includes('basic.email'));
  assert.ok(plan.summary.missingFields.includes('basic.idNumber'));
  assert.ok(plan.summary.missingFields.includes('basic.mobile'));
});

test('多选「期望工作地点」一律 manual：不生成会失败的写入步骤', () => {
  const index = buildResumeIndex({ 求职意向: { 期望城市: '杭州' } });
  const page = pageModel({
    sections: [section('s-basic', '基本信息', { key: 'basic', repeatable: false, itemCount: 1 })],
    controls: [control('期望工作地点', { id: 'city', sectionId: 's-basic', fieldKey: 'preferred_city_list', type: 'combobox', value: '深圳', options: ['深圳', '杭州'] })]
  });
  const plan = planFill({ resumeIndex: index, pageModel: page, mode: 'overwrite' });
  const step = stepOf(plan, item => item.controlId === 'city');
  assert.equal(step.status, 'unsupported');
  assert.equal(step.reason, 'multi-select-manual');
  assert.equal(step.currentValue, '深圳');
  assert.equal(step.value, '杭州');
});

test('条目身份冲突：只填空白模式下不该把两条记录拼在一起（overwrite 不受影响）', () => {
  const index = buildResumeIndex({
    竞赛: [{ 名称: '2024年高教社杯', 描述: '获奖描述一' }],
    项目经历: [{ 名称: '项目甲', 描述: '项目描述一' }]
  });
  const page = pageModel({
    sections: [
      section('s-award', '获奖', { key: 'award', itemCount: 1 }),
      section('s-project', '项目经历', { key: 'project', itemCount: 1 })
    ],
    controls: [
      control('获奖名称', { id: 'a0-name', sectionId: 's-award', itemIndex: 0, fieldKey: 'name', value: '示例奖项名' }),
      control('描述', { id: 'a0-desc', sectionId: 's-award', itemIndex: 0, fieldKey: 'desc', type: 'textarea' }),
      control('项目名称', { id: 'p0-name', sectionId: 's-project', itemIndex: 0, fieldKey: 'name', value: '项目甲' }),
      control('描述', { id: 'p0-desc', sectionId: 's-project', itemIndex: 0, fieldKey: 'desc', type: 'textarea' })
    ]
  });

  const emptyPlan = planFill({ resumeIndex: index, pageModel: page, mode: 'fill-empty' });
  // 获奖卡片的名称对不上 -> 名称 conflict，空描述也必须 conflict（而不是 ready）
  assert.equal(stepOf(emptyPlan, step => step.controlId === 'a0-name').status, 'conflict');
  const awardDesc = stepOf(emptyPlan, step => step.controlId === 'a0-desc');
  assert.equal(awardDesc.status, 'conflict');
  assert.equal(awardDesc.reason, 'item-identity-conflict');
  // 项目卡片身份字段一致 -> 描述正常可写
  assert.equal(stepOf(emptyPlan, step => step.controlId === 'p0-desc').status, 'ready');

  // overwrite 模式会连身份字段一起改写，所以全部 ready
  const overwritePlan = planFill({ resumeIndex: index, pageModel: page, mode: 'overwrite' });
  assert.equal(stepOf(overwritePlan, step => step.controlId === 'a0-desc').status, 'ready');
});
