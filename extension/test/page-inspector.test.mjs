/**
 * page-inspector.test.mjs — 页面检查层单测（无浏览器，基于 dom-twin）
 * 运行：node --test --test-isolation=none extension/test/page-inspector.test.mjs
 *
 * 覆盖契约 §3 + §9 的硬性要求：
 * - visible 修复（hasAttribute('hidden')，不是 element.hidden）
 * - label / labelSource（真机 data-form-field-i18n-name 优先，占位符不当正式标签）
 * - section / sectionKey / itemIndex / itemRole / fieldKey（data-form-field-name 优先）
 * - actions 只收添加按钮（删除/保存/取消绝不出现）
 * - file 进 diagnostics，hidden 保留 visible=false
 * - selectorToken 与执行器 filter(file) 下标严格一致
 * - inspectPage 无副作用（不点击、不渲染弹层、不提交）
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  createBytedanceTwin,
  createDocument,
  h,
  parseHTMLFragment,
  controlElements,
  resolveSelectorToken,
  CONTROL_SELECTOR
} from './support/dom-twin.mjs';
import { inspectPage, CONTROL_SELECTOR as INSPECTOR_CONTROL_SELECTOR, ACTION_SELECTOR } from '../src/runtime/page-inspector.mjs';
import { createPageModel, normalizeControlModel } from '../src/core/page-model.mjs';

const inspect = twin => inspectPage(twin.document, { capabilities: [] });
const refresh = twin => inspectPage(twin.document);
const tokenIndex = control => Number(String(control.selectorToken).slice('control-token-'.length));
const controlsByField = (controls, field) => controls.filter(control => control.fieldKey === field);
const controlsBySection = (controls, sectionKey) => controls.filter(control => control.sectionKey === sectionKey);
const sectionByKey = (model, key) => model.sections.find(section => section.key === key);

function twinWithModel() {
  const twin = createBytedanceTwin();
  const { pageModel, diagnostics } = inspect(twin);
  return { twin, pageModel, diagnostics };
}

// ---------------------------------------------------------------------------
// 1. 分区（真机 11 个模块）
// ---------------------------------------------------------------------------

test('sections: 11 个真机模块，标题/键/条目数/添加动作全部正确', () => {
  const { pageModel } = twinWithModel();
  assert.equal(pageModel.sections.length, 11);
  const expected = [
    ['简历', 'attachment'],
    ['基本信息', 'basic'],
    ['工作经历', 'work'],
    ['教育经历', 'education'],
    ['实习经历', 'internship'],
    ['项目经历', 'project'],
    ['作品', 'work_samples'],
    ['获奖', 'award'],
    ['语言能力', 'language'],
    ['自我评价', 'summary'],
    ['社交账号', 'sns']
  ];
  assert.deepEqual(pageModel.sections.map(section => [section.label, section.key]), expected);
  // id 稳定唯一，优先 section-<sectionKey>
  assert.equal(new Set(pageModel.sections.map(section => section.id)).size, 11);
  for (const [, key] of expected) assert.equal(sectionByKey(pageModel, key).id, `section-${key}`);

  const itemCounts = Object.fromEntries(pageModel.sections.map(section => [section.key, section.itemCount]));
  assert.deepEqual(itemCounts, { attachment: 0, basic: 0, work: 0, education: 1, internship: 0, project: 9, work_samples: 0, award: 3, language: 2, summary: 0, sns: 3 });

  // 可重复模块 repeatable + addActionId；基本信息/简历/自我评价不是可重复模块
  for (const key of ['work', 'education', 'internship', 'project', 'work_samples', 'award', 'language', 'sns']) {
    const section = sectionByKey(pageModel, key);
    assert.equal(section.repeatable, true, `${key} 应为可重复分区`);
    assert.ok(section.addActionId, `${key} 应有 addActionId`);
  }
  for (const key of ['attachment', 'basic', 'summary']) {
    const section = sectionByKey(pageModel, key);
    assert.equal(section.repeatable, false);
    assert.equal(section.addActionId, undefined);
  }
});

// ---------------------------------------------------------------------------
// 2. 控件：数量 / 唯一性 / file & hidden
// ---------------------------------------------------------------------------

test('controls: 每个真实控件恰好一次，file 进 diagnostics，hidden 保留且 visible=false', () => {
  const twin = createBytedanceTwin();
  const { pageModel, diagnostics } = inspect(twin);
  const filtered = controlElements(twin.document).filter(element => String(element.type || '').toLowerCase() !== 'file');
  assert.equal(pageModel.controls.length, filtered.length);
  assert.equal(pageModel.controls.length, 87);

  // token 与执行器一致：queryAllDeep(...).filter(type!=='file') 下标
  const seen = new Set();
  for (const control of pageModel.controls) {
    const index = tokenIndex(control);
    const element = resolveSelectorToken(twin.document, control.selectorToken);
    assert.equal(element, filtered[index], `token ${control.selectorToken} 未严格对齐 filtered 下标`);
    assert.ok(element && !seen.has(element), `控件被重复检查：${control.controlId}`);
    seen.add(element);
    assert.equal(control.labelSource === 'placeholder', false, '占位符不得冒充正式标签');
  }
  assert.equal(seen.size, filtered.length);
  assert.equal(pageModel.controls[0].selectorToken, 'control-token-0');
  assert.equal(pageModel.controls.at(-1).selectorToken, `control-token-${filtered.length - 1}`);

  // file（简历附件）不进 controls，进 diagnostics
  const fileDiagnostics = diagnostics.filter(item => item.controlType === 'file');
  assert.equal(fileDiagnostics.length, 1);
  assert.equal(fileDiagnostics[0].reason, 'file-input-not-fillable');
  assert.equal(fileDiagnostics[0].label, '简历附件');
  assert.equal(diagnostics.find(item => item.code === 'controls-inspected').count, pageModel.controls.length);
  assert.equal(pageModel.controls.some(control => control.controlType === 'file'), false);
  // 控件里绝不应出现 button（动作不是控件）
  assert.equal(pageModel.controls.some(control => control.controlType === 'unknown'), false);
});

test('controls: hidden 输入保留、visible=false，且不影响其它控件可见性', () => {
  const doc = createDocument({ title: 'hidden 测试', location: { origin: 'https://x.test', pathname: '/form' } });
  doc.body.append(h('section', {}, [
    h('h2', { text: '基本信息' }),
    h('div', { class: 'resumeEditForm-hiddenField', attrs: { 'aria-hidden': 'true' } }, [
      h('input', { attrs: { type: 'hidden', name: '_id', value: '123' } })
    ]),
    h('div', { attrs: { 'data-form-field-name': 'name', 'data-form-field-i18n-name': '姓名' } }, [
      h('input', { attrs: { type: 'text' }, value: '张三' })
    ])
  ]));
  const { pageModel } = inspectPage(doc, {});
  const hidden = pageModel.controls.find(control => control.controlType === 'hidden');
  assert.ok(hidden, 'hidden 控件必须保留在 controls');
  assert.equal(hidden.visible, false);
  assert.equal(hidden.value, '123');
  const visible = pageModel.controls.find(control => control.controlType === 'text');
  assert.equal(visible.visible, true);
  assert.equal(visible.value, '张三');
});

test('visible: hasAttribute("hidden")/aria-hidden/display:none 都能判为不可见（旧 .hidden bug 回归）', () => {
  const doc = createDocument({ title: 'vis', location: { origin: 'https://x.test', pathname: '/form' } });
  const make = (label, wrapperAttrs, style) => h('div', { attrs: { 'data-form-field-name': label, 'data-form-field-i18n-name': label, ...wrapperAttrs }, style }, [
    h('input', { attrs: { type: 'text' } })
  ]);
  doc.body.append(h('section', {}, [
    h('h2', { text: '基本信息' }),
    make('visible', {}, undefined),
    make('hiddenAttr', { hidden: '' }, undefined),
    make('ariaHidden', { 'aria-hidden': 'true' }, undefined),
    make('displayNone', {}, 'display:none'),
    make('visibilityHidden', {}, 'visibility:hidden')
  ]));
  const { pageModel } = inspectPage(doc, {});
  const byLabel = label => pageModel.controls.find(control => control.label === label);
  assert.equal(byLabel('visible').visible, true);
  assert.equal(byLabel('hiddenAttr').visible, false);
  assert.equal(byLabel('ariaHidden').visible, false);
  assert.equal(byLabel('displayNone').visible, false);
  assert.equal(byLabel('visibilityHidden').visible, false);
});

// ---------------------------------------------------------------------------
// 3. label / labelSource
// ---------------------------------------------------------------------------

test('labels: 真机标签来自 data-form-field-i18n-name，占位符/属性不冒充标签', () => {
  const { pageModel } = twinWithModel();
  const expected = {
    name: '姓名',
    mobile: '手机号码',
    email: '邮箱',
    preferred_city_list: '期望工作地点',
    school: '学校名称',
    degree: '学历',
    field_of_study: '专业',
    start_end_time: '起止时间',
    role: '项目角色',
    link: '项目链接',
    language: '语言',
    proficiency: '精通程度',
    self_evaluation: '自我评价',
    sns_type: '社交平台'
  };
  for (const [fieldKey, label] of Object.entries(expected)) {
    const control = controlsByField(pageModel.controls, fieldKey)[0];
    assert.ok(control, `缺少字段 ${fieldKey}`);
    assert.equal(control.label, label, `${fieldKey} 的 label 应为页面可见标签`);
    assert.equal(control.labelSource, 'associated');
  }
  // 社交账号卡片的 link 标签是 URL / ID
  const snsLink = controlsBySection(pageModel.controls, 'sns').find(control => control.fieldKey === 'link');
  assert.equal(snsLink.label, 'URL / ID');
  // 获奖卡片里 name 的标签是「获奖名称」、date 是「获奖时间」
  const awardControls = controlsBySection(pageModel.controls, 'award').filter(control => control.itemIndex === 0);
  assert.equal(awardControls.find(control => control.fieldKey === 'name').label, '获奖名称');
  assert.equal(awardControls.find(control => control.fieldKey === 'date').label, '获奖时间');
  // 没有工作经历复选框：包裹 label 文本
  const noExperience = pageModel.controls.find(control => control.controlType === 'checkbox');
  assert.ok(noExperience.label.includes('没有工作经历'));
  assert.equal(noExperience.labelSource, 'associated');
  // 所有正式标签都不得是「请输入…」占位符
  for (const control of pageModel.controls) if (control.labelSource !== 'placeholder') assert.doesNotMatch(control.label, /^请输入|^请选择/);
});

test('labelSource: associated / aria / sibling / placeholder / name 五种来源可区分（通用页面）', () => {
  const doc = createDocument({ title: 'label 测试', location: { origin: 'https://x.test', pathname: '/form' } });
  const fields = [];
  // associated: label[for]
  const inputFor = h('input', { attrs: { type: 'text', id: 'f-for' } });
  fields.push(h('div', { attrs: { 'data-form-field-name': 'name' } }, [h('label', { for: 'f-for', text: '姓名' }), inputFor]));
  // aria: aria-labelledby
  fields.push(h('div', {}, [h('span', { attrs: { id: 'lbl-email' }, text: '邮箱' }), h('input', { attrs: { type: 'text', 'aria-labelledby': 'lbl-email' } })]));
  // sibling: 附近 .fieldLabel 文本（不在 [data-form-field-name] 容器里）
  fields.push(h('div', {}, [h('span', { class: 'fieldLabel', text: '公司名称' }), h('input', { attrs: { type: 'text' } })]));
  // aria: aria-label
  fields.push(h('div', {}, [h('input', { attrs: { type: 'text', 'aria-label': '职位名称' } })]));
  // placeholder
  fields.push(h('div', {}, [h('input', { attrs: { type: 'text', placeholder: '请输入专业' } })]));
  // name
  fields.push(h('div', {}, [h('input', { attrs: { type: 'text', name: 'school' } })]));
  doc.body.append(h('section', {}, [h('h2', { text: '基本信息' }), ...fields]));

  const { pageModel } = inspectPage(doc, {});
  const labels = pageModel.controls.map(control => ({ label: control.label, source: control.labelSource, fieldKey: control.fieldKey }));
  assert.deepEqual(labels[0], { label: '姓名', source: 'associated', fieldKey: 'name' });
  assert.deepEqual(labels[1], { label: '邮箱', source: 'aria', fieldKey: 'email' });
  assert.deepEqual(labels[2], { label: '公司名称', source: 'sibling', fieldKey: 'company' });
  assert.deepEqual(labels[3], { label: '职位名称', source: 'aria', fieldKey: 'title' });
  assert.deepEqual(labels[4], { label: '请输入专业', source: 'placeholder', fieldKey: 'field_of_study' });
  assert.deepEqual(labels[5], { label: 'school', source: 'name', fieldKey: 'school' });
});

// ---------------------------------------------------------------------------
// 4. fieldKey / sectionKey / itemIndex / itemRole / dateFormat
// ---------------------------------------------------------------------------

test('fieldKey: 真机 data-form-field-name 优先（页面语义名），并按分区隔离', () => {
  const { pageModel } = twinWithModel();
  const expectedProject = ['name', 'role', 'start_end_time', 'start_end_time', 'link', 'desc'];
  const firstProjectCard = controlsBySection(pageModel.controls, 'project').filter(control => control.itemIndex === 0);
  assert.deepEqual(firstProjectCard.map(control => control.fieldKey), expectedProject);
  assert.deepEqual(controlsBySection(pageModel.controls, 'education').slice(0, 4).map(control => control.fieldKey), ['school', 'degree', 'field_of_study', 'start_end_time']);
  assert.deepEqual(controlsBySection(pageModel.controls, 'sns').filter(c => c.itemIndex === 0).map(c => c.fieldKey), ['sns_type', 'link']);
  assert.equal(controlsBySection(pageModel.controls, 'summary')[0].fieldKey, 'self_evaluation');
  // 同一 data-form-field-name=mobile 由控件形态区分：区号 combobox + 手机号 text
  const mobileControls = controlsByField(pageModel.controls, 'mobile');
  assert.equal(mobileControls.length, 2);
  assert.equal(mobileControls[0].controlType, 'combobox');
  assert.equal(mobileControls[0].value, '+86');
  assert.equal(mobileControls[1].controlType, 'text');
  assert.equal(mobileControls[1].value, '13800000000');
});

test('itemIndex: 9 张项目卡片全部按 DOM 顺序编号，字段不跨卡片串味', () => {
  const { pageModel } = twinWithModel();
  const projectControls = controlsBySection(pageModel.controls, 'project');
  const cards = new Map();
  for (const control of projectControls) {
    assert.equal(Number.isInteger(control.itemIndex), true, `项目控件缺少 itemIndex: ${control.label}`);
    const bucket = cards.get(control.itemIndex) ?? [];
    bucket.push(control);
    cards.set(control.itemIndex, bucket);
  }
  assert.deepEqual([...cards.keys()].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  for (const [, controls] of cards) {
    const items = new Set(controls.map(control => control.itemIndex));
    assert.equal(items.size, 1);
    // 一张卡片内每个字段（含起止角色）只出现一次
    assert.equal(new Set(controls.map(control => `${control.fieldKey}:${control.itemRole ?? ''}`)).size, controls.length);
  }
  // 教育只有 1 条、获奖 3 条
  assert.equal(new Set(controlsBySection(pageModel.controls, 'education').map(c => c.itemIndex)).size, 1);
  assert.equal(new Set(controlsBySection(pageModel.controls, 'award').map(c => c.itemIndex)).size, 3);
});

test('itemRole/dateFormat: start_end_time 两个 input 按 DOM 顺序 start/end，获奖年份 YYYY', () => {
  const { pageModel } = twinWithModel();
  for (const sectionKey of ['education', 'project', 'award']) {
    if (sectionKey === 'award') continue;
    const sectionControls = controlsBySection(pageModel.controls, sectionKey);
    const items = [...new Set(sectionControls.map(control => control.itemIndex))];
    for (const itemIndex of items) {
      const start = sectionControls.find(control => control.itemIndex === itemIndex && control.itemRole === 'start');
      const end = sectionControls.find(control => control.itemIndex === itemIndex && control.itemRole === 'end');
      assert.ok(start && end, `${sectionKey}#${itemIndex} 起止时间缺 itemRole`);
      assert.equal(start.fieldKey, 'start_end_time');
      assert.equal(end.fieldKey, 'start_end_time');
      assert.equal(start.dateFormat, 'YYYY-MM');
      assert.equal(end.dateFormat, 'YYYY-MM');
      assert.equal(Number(start.selectorToken.split('-').at(-1)) < Number(end.selectorToken.split('-').at(-1)), true, 'start 必须在 end 之前');
    }
  }
  const awardDate = controlsBySection(pageModel.controls, 'award').find(control => control.fieldKey === 'date');
  assert.equal(awardDate.controlType, 'text');
  assert.equal(awardDate.dateFormat, 'YYYY');
  assert.equal(awardDate.value, '2025');
  assert.equal(awardDate.itemRole, undefined, '获奖年份不是起止时间，不得带 itemRole');
  // itemRole 不得泄漏到非起止时间控件（自我评价曾因「自」被误标成 start）
  const leaked = pageModel.controls.filter(control => control.itemRole && control.fieldKey !== 'start_end_time' && control.fieldKey !== 'start' && control.fieldKey !== 'end');
  assert.deepEqual(leaked.map(control => `${control.fieldKey}:${control.itemRole}`), []);
  assert.equal(controlsBySection(pageModel.controls, 'summary')[0].itemRole, undefined);
  assert.equal(controlsBySection(pageModel.controls, 'summary')[0].fieldKey, 'self_evaluation');
});

// ---------------------------------------------------------------------------
// 5. 下拉（combobox）：展示值 / options / readonly / 不点击不展开
// ---------------------------------------------------------------------------

test('combobox: value 取 selectItem 文本（不是 input.value），options 只在展开时提供', () => {
  const twin = createBytedanceTwin();
  twin.openSelect('degree');
  const later = inspect(twin);
  twin.closeSelects();
  const before = inspect(twin);
  assert.ok(later.pageModel && before.pageModel);
  // 未展开时没有 options；input.value 恒为空
  const closedDegree = before.pageModel.controls.find(control => control.fieldKey === 'degree');
  assert.equal(closedDegree.controlType, 'combobox');
  assert.equal(closedDegree.value, '本科');
  assert.equal(closedDegree.displayText, '本科');
  assert.equal(closedDegree.readonly, false, 'combobox 必须对 matcher 可操作');
  assert.equal(closedDegree.options, undefined);
  const degreeInput = twin.document.querySelector('[data-form-field-name="degree"] input[role="combobox"]');
  assert.equal(degreeInput.value, '');
  assert.equal(degreeInput.readOnly, true, '真机单选下拉内部 input 带 readonly 属性');

  // 打开后 options 来自 .ud__select__list__item
  twin.openSelect('degree');
  const opened = inspect(twin);
  const openedDegree = opened.pageModel.controls.find(control => control.fieldKey === 'degree');
  assert.deepEqual(openedDegree.options, ['博士', 'MBA', '硕士', '本科', '大专', '高中', '专职', '初中', '小学']);
  // 选择后展示值变化，读回校验以展示值为准
  twin.chooseOption('degree', '硕士');
  const afterChoose = inspect(twin).pageModel.controls.find(control => control.fieldKey === 'degree');
  assert.equal(afterChoose.value, '硕士');
  assert.equal(afterChoose.displayText, '硕士');
});

test('combobox: 多选（期望工作地点）用 tag 文本 join(",")，可增删', () => {
  const twin = createBytedanceTwin();
  const control = () => inspect(twin).pageModel.controls.find(item => item.fieldKey === 'preferred_city_list');
  assert.equal(control().controlType, 'combobox');
  assert.equal(control().value, '深圳');
  twin.openSelect('preferred_city_list');
  const options = inspect(twin).pageModel.controls.find(item => item.fieldKey === 'preferred_city_list').options;
  assert.ok(options.includes('杭州'));
  twin.chooseOption('preferred_city_list', '杭州');
  const values = control().value.split(',').sort();
  assert.deepEqual(values, ['杭州', '深圳'].sort());
  twin.chooseOption('preferred_city_list', '杭州');
  assert.equal(control().value, '深圳');
  twin.closeSelects();
});

// ---------------------------------------------------------------------------
// 6. actions：只收添加按钮
// ---------------------------------------------------------------------------

test('actions: 8 个模块的「添加」按钮，删除/保存/取消永不进 actions', () => {
  const twin = createBytedanceTwin();
  const { pageModel } = inspect(twin);
  assert.equal(pageModel.actions.length, 8);
  for (const action of pageModel.actions) {
    assert.equal(action.kind, 'add-item');
    assert.match(action.actionId, /^add-item:/);
    assert.equal(action.label, '添加');
    assert.ok(action.sectionId, 'action 必须有 sectionId');
    assert.match(action.selectorToken, /^action-token-\d+$/);
    // token 用原始 action 查询下标（与 control-executor 一致）
    const rawIndex = Number(action.selectorToken.slice('action-token-'.length));
    const rawButtons = twin.document.querySelectorAll(ACTION_SELECTOR);
    const element = rawButtons[rawIndex];
    assert.ok(element, `action token 越界：${action.selectorToken}`);
    assert.match(element.getAttribute('class') || '', /apply-form-array-card-add/);
  }
  // 每个可重复分区恰好一个 action
  const actionSectionIds = new Set(pageModel.actions.map(action => action.sectionId));
  assert.equal(actionSectionIds.size, 8);
  for (const section of pageModel.sections) {
    if (section.addActionId) {
      const action = pageModel.actions.find(item => item.actionId === section.addActionId);
      assert.ok(action, `${section.label} 的 addActionId 未指向动作`);
      assert.equal(action.sectionId, section.id);
    }
  }
  // 禁止按钮不出现：删除（无文本/删除 class）、保存/取消（atsx）
  const actionTexts = pageModel.actions.map(action => action.label);
  assert.equal(actionTexts.some(label => /保存|取消|删除/.test(label)), false);
  const allActionIds = pageModel.actions.map(action => action.actionId);
  assert.equal(new Set(allActionIds).size, allActionIds.length);
  // controls 不能包含 button
  assert.equal(twin.document.querySelectorAll(CONTROL_SELECTOR).length - 1, pageModel.controls.length, '只有 file 不产生 control');
});

test('actions: 添加后 itemCount 与 fingerprint 变化，token 仍可解析', () => {
  const twin = createBytedanceTwin();
  const before = inspect(twin).pageModel;
  const beforeFingerprint = before.fingerprint;
  const beforeCount = sectionByKey(before, 'project').itemCount;
  twin.addCard('project');
  const after = inspect(twin).pageModel;
  const grown = sectionByKey(after, 'project');
  assert.equal(grown.itemCount, beforeCount + 1);
  assert.notEqual(after.fingerprint, beforeFingerprint, 'add-item 后 fingerprint 必须变化');
  const added = after.controls.filter(control => control.sectionKey === 'project' && control.itemIndex === beforeCount);
  assert.equal(added.length, 6);
  for (const control of added) {
    assert.ok(resolveSelectorToken(twin.document, control.selectorToken), `新增控件 token 不可解析：${control.selectorToken}`);
  }
});

// ---------------------------------------------------------------------------
// 7. pageModel 规范化 / 指纹 / pageIdentity
// ---------------------------------------------------------------------------

test('pageModel: pageIdentity 来自 location，fingerprint 不含 value 但含结构字段', () => {
  const twin = createBytedanceTwin();
  const first = inspect(twin).pageModel;
  assert.equal(first.pageIdentity.origin, 'https://jobs.bytedance.com');
  assert.equal(first.pageIdentity.route, '/experienced/resume/edit');
  assert.match(first.pageIdentity.title, /编辑简历/);
  assert.match(first.fingerprint, /^page-[0-9a-f]+$/);

  // 改值不改结构 -> 指纹不变
  twin.document.querySelector('[data-form-field-name="name"] input').value = '另一个名字';
  const afterValueChange = inspect(twin).pageModel;
  assert.equal(afterValueChange.fingerprint, first.fingerprint);

  // 结构变化（新增条目）-> 指纹变化
  twin.addCard('award');
  const afterStructure = inspect(twin).pageModel;
  assert.notEqual(afterStructure.fingerprint, first.fingerprint);

  // 经 createPageModel 规范化后结构一致
  const recreated = createPageModel({
    pageIdentity: first.pageIdentity,
    sections: first.sections,
    controls: first.controls.map(({ value, ...rest }) => rest),
    actions: first.actions,
    dialogs: first.dialogs
  });
  assert.equal(recreated.sections.length, 11);
  assert.equal(recreated.actions.length, 8);
});

test('pageModel: 控件字段都符合契约词表（controlType/sectionKey/itemRole 取值合法）', () => {
  const { pageModel } = twinWithModel();
  const controlTypes = new Set(['text', 'textarea', 'number', 'email', 'tel', 'url', 'date', 'checkbox', 'radio', 'native-select', 'combobox', 'file', 'hidden']);
  const sectionKeys = new Set(['basic', 'work', 'internship', 'education', 'project', 'award', 'language', 'summary', 'sns', 'intention', 'resume', 'attachment', 'work_samples']);
  for (const control of pageModel.controls) {
    assert.ok(controlTypes.has(control.controlType), `非法 controlType: ${control.controlType}`);
    assert.equal(typeof control.controlId, 'string');
    assert.match(control.selectorToken, /^control-token-\d+$/);
    assert.equal(typeof control.visible, 'boolean');
    assert.equal(typeof control.disabled, 'boolean');
    assert.equal(typeof control.readonly, 'boolean');
    assert.ok(sectionKeys.has(control.sectionKey), `非法 sectionKey: ${control.sectionKey}`);
    if (control.itemRole) assert.ok(['start', 'end'].includes(control.itemRole));
  }
  // normalizeControlModel 契约：缺 controlId 抛错；扩展字段保留
  assert.throws(() => normalizeControlModel({ label: 'x' }), /controlId/);
  const normalized = normalizeControlModel({ controlId: 'c1', controlType: 'combobox', value: '本科', displayText: '本科', sectionKey: 'education', itemIndex: 0, fieldKey: 'degree', labelSource: 'associated' });
  assert.equal(normalized.displayText, '本科');
  assert.equal(normalized.itemIndex, 0);
});

// ---------------------------------------------------------------------------
// 8. 通用页面回退：section / label / repeat item / add button
// ---------------------------------------------------------------------------

test('generic: section/fieldset + data-repeat-item + 添加/删除/保存按钮的通用回退', () => {
  const doc = createDocument({ title: '通用表单', location: { origin: 'https://generic.test', pathname: '/apply' } });
  const repeatItem = index => h('div', { attrs: { 'data-repeat-item': 'project_list' } }, [
    h('div', { attrs: { 'data-form-field-name': 'name' } }, [
      h('label', { text: '项目名称' }),
      h('input', { attrs: { type: 'text' }, value: `项目${index}` })
    ])
  ]);
  const addButton = h('button', { attrs: { type: 'button' }, text: '添加' });
  const deleteButton = h('button', { class: 'apply-form-array-card-delete', attrs: { type: 'button' }, text: '删除' });
  const saveButton = h('button', { attrs: { type: 'button' }, text: '保存' });
  doc.body.append(h('form', {}, [
    h('section', {}, [h('h2', { text: '项目经历' }), repeatItem(0), repeatItem(1), addButton, deleteButton, saveButton])
  ]));
  const { pageModel } = inspectPage(doc, {});
  assert.equal(pageModel.sections.length, 1);
  const section = pageModel.sections[0];
  assert.equal(section.key, 'project');
  assert.equal(section.label, '项目经历');
  assert.equal(section.itemCount, 2);
  assert.equal(section.repeatable, true);
  assert.equal(pageModel.controls.length, 2);
  assert.deepEqual(pageModel.controls.map(control => control.itemIndex), [0, 1]);
  assert.deepEqual(pageModel.controls.map(control => control.fieldKey), ['name', 'name']);
  assert.equal(pageModel.actions.length, 1);
  assert.equal(pageModel.actions[0].label, '添加');
  assert.equal(pageModel.actions[0].sectionId, section.id);
  assert.equal(section.addActionId, pageModel.actions[0].actionId);
});

test('generic: 原生 select 的 options、file 进 diagnostics', () => {
  const doc = createDocument({ title: 'select', location: { origin: 'https://generic.test', pathname: '/apply' } });
  doc.body.append(h('section', {}, [
    h('h2', { text: '教育经历' }),
    h('div', { attrs: { 'data-form-field-name': 'degree' } }, [
      h('label', { text: '学历' }),
      h('select', { children: [h('option', { attrs: { value: 'bachelor' }, text: '本科' }), h('option', { attrs: { value: 'master' }, text: '硕士' })] })
    ]),
    h('div', { attrs: { 'data-form-field-name': 'attachment' } }, [
      h('label', { text: '附件' }),
      h('input', { attrs: { type: 'file' } })
    ])
  ]));
  const { pageModel, diagnostics } = inspectPage(doc, {});
  const select = pageModel.controls.find(control => control.controlType === 'native-select');
  assert.deepEqual(select.options, ['本科', 'bachelor', '硕士', 'master']);
  assert.equal(pageModel.controls.length, 1, 'file 不应出现在 controls');
  assert.equal(diagnostics.filter(item => item.controlType === 'file').length, 1);
});

// ---------------------------------------------------------------------------
// 10. fixture 与双胞胎一致（离线静态页）
// ---------------------------------------------------------------------------

test('fixture: examples/bytedance-fixture.html 与真机双胞胎结构一致且离线', () => {
  const html = readFileSync(resolve(import.meta.dirname, '..', '..', 'examples', 'bytedance-fixture.html'), 'utf8');
  assert.match(html, /applyFormModuleWrapper/);
  assert.match(html, /data-form-field-name="start_end_time"/);
  assert.match(html, /ud__select__list__item/);
  assert.match(html, /apply-form-array-card-delete/);
  assert.equal(/<script[^>]+src=|<link[^>]+href=|@import/i.test(html), false, 'fixture 必须完全离线（无外链）');
  assert.equal(/src="https?:/.test(html), false);

  const body = /<body>([\s\S]*)<\/body>/.exec(html)[1]
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '');
  const doc = createDocument({
    title: '编辑简历 | 字节跳动招聘 · FormPilot 本地结构测试页',
    location: { origin: 'https://jobs.bytedance.com', pathname: '/experienced/resume/edit' }
  });
  doc.body.append(...parseHTMLFragment(body, doc));
  const fixtureModel = inspectPage(doc, {}).pageModel;
  const twinModel = twinWithModel().pageModel;

  assert.equal(fixtureModel.sections.length, 11);
  assert.deepEqual(
    fixtureModel.sections.map(section => [section.key, section.itemCount]),
    twinModel.sections.map(section => [section.key, section.itemCount])
  );
  assert.equal(fixtureModel.controls.length, twinModel.controls.length);
  assert.equal(fixtureModel.controls.length, 87);
  assert.equal(fixtureModel.actions.length, twinModel.actions.length);
  assert.equal(fixtureModel.actions.length, 8);
  assert.deepEqual(fixtureModel.controls.map(control => control.label), twinModel.controls.map(control => control.label));
  assert.deepEqual(fixtureModel.controls.map(control => control.fieldKey), twinModel.controls.map(control => control.fieldKey));
});

// ---------------------------------------------------------------------------
// 11. inspectPage 无副作用
// ---------------------------------------------------------------------------

test('inspectPage 绝不点击/修改页面：不渲染弹层、不触发保存、不改变输入值', () => {
  const twin = createBytedanceTwin();
  const valueSnapshot = () => controlElements(twin.document).map(element => `${element.localName}:${element.value}:${element.checked}`);
  const before = valueSnapshot();
  const submitsBefore = twin.submitCount();
  const dropdownsBefore = twin.document.querySelectorAll('[class*="ud__select__dropdown"]').length;

  inspect(twin);
  inspectPage(twin.document, { capabilities: [], includeScreenshot: true });

  assert.equal(twin.submitCount(), submitsBefore);
  assert.equal(twin.document.querySelectorAll('[class*="ud__select__dropdown"]').length, dropdownsBefore, 'inspect 不应展开下拉');
  assert.deepEqual(valueSnapshot(), before, 'inspect 不应修改任何控件值');
  // 2) 不返回任何按钮控件
  const { pageModel } = inspect(twin);
  assert.equal(pageModel.controls.some(control => control.role === 'button'), false);
});
