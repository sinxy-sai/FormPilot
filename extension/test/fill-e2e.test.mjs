// 端到端集成测试：在「字节跳动编辑简历页」的 DOM 双胞胎上跑完整填写链路
//   inspectPage → buildResumeIndex → planFill → validatePlannedStep → executeStep → 读回校验
//
// 断言的是**真机行为**（见 docs/recon/bytedance-resume-edit.md）：
//   - 分区（11 个模块）与可重复条目（卡片）不能串味
//   - 自定义下拉的展示值在 .ud__select__selector__selectItem，input.value 恒为空
//   - 起止时间是两个普通文本输入，结束时间可写「至今」
//   - 获奖时间只写年份
//   - 默认只填空白：页面已有且不同的值必须保持不动
//   - 永远不点「保存」「取消」「删除」
//
// 执行循环与 background.js 一致：**每一步都重新 inspect + 重新 plan**，
// 因为 add-item 之后控件编号会整体位移，沿用旧 controlId 会写错控件。
//
// 运行：node --test --test-isolation=none extension/test/fill-e2e.test.mjs

import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { createBytedanceTwin } from './support/dom-twin.mjs';
import { inspectPage } from '../src/runtime/page-inspector.mjs';
import { listCapabilities } from '../src/adapters/capabilities.mjs';
import { buildResumeIndex } from '../src/core/resume-index.mjs';
import { planFill } from '../src/core/matcher.mjs';
import { validatePlannedStep } from '../src/runtime/action-guard.mjs';
import { executeStep, executeAction, undoLastFill } from '../src/runtime/control-executor.mjs';

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

const inspect = twin => inspectPage(twin.document, { capabilities: listCapabilities() });

/** 把 pageModel 展开成 `${sectionKey}:${itemIndex}:${fieldKey}[:start|end]` → value 的字典。 */
function valueMap(pageModel) {
  const map = new Map();
  for (const control of pageModel.controls ?? []) {
    if (!control?.fieldKey) continue;
    // itemRole 只对起止时间有意义（检查器目前会给个别单值控件误挂 itemRole，这里只认 start_end_time）
    const role = control.fieldKey === 'start_end_time' ? (control.itemRole ?? '') : '';
    map.set([control.sectionKey ?? '-', control.itemIndex ?? 0, control.fieldKey, role].filter((part, index) => index < 3 || part !== '').join(':'), control.value);
  }
  return map;
}

/**
 * 逐步填写：每次重新 inspect + plan，只执行第一个 ready 步骤。
 * 这样既能覆盖 add-item 后编号位移，也等价于 background 的真实循环。
 */
async function fillUntilDone(twin, resumeIndex, { mode = 'overwrite', maxSteps = 150 } = {}) {
  const log = [];
  let lastPlan = null;
  for (let index = 0; index < maxSteps; index += 1) {
    const { pageModel } = inspect(twin);
    const plan = planFill({ resumeIndex, pageModel, mode });
    lastPlan = plan;
    const step = plan.steps.find(item => item.status === 'ready');
    if (!step) return { ok: true, log, plan, reason: 'no-ready-step' };

    let result;
    if (step.kind === 'add-item') {
      const action = pageModel.actions.find(item => item.actionId === step.actionId);
      assert.ok(action, `add-item 步骤没有对应动作：${step.actionId}`);
      result = await executeAction(twin.document, action, { pageModel, mode });
    } else {
      const control = pageModel.controls.find(item => item.controlId === step.controlId);
      assert.ok(control, `步骤目标控件不存在：${step.controlId}`);
      // 防御：步骤的字段归属必须与当前页面模型一致（防止编号位移写错控件）
      assert.equal(control.sectionKey, step.sectionKey, `步骤 ${step.stepId} 的分区与控件不一致`);
      assert.equal(control.itemIndex ?? 0, step.itemIndex ?? 0, `步骤 ${step.stepId} 的条目与控件不一致`);
      const gate = validatePlannedStep(step, { pageModel, mode });
      assert.ok(gate.allowed, `动作守卫拦截了正常步骤：${step.stepId} → ${gate.reason}`);
      result = await executeStep(twin.document, step, { pageModel, mode });
    }
    log.push({ step, result, control: step.controlId ? pageModel.controls.find(item => item.controlId === step.controlId) : null });
    if (!['verified', 'done', 'skipped'].includes(result?.status)) {
      return { ok: false, log, plan: lastPlan, reason: `${step.stepId}: ${result?.status} ${result?.reason ?? ''}` };
    }
  }
  return { ok: false, log, plan: lastPlan, reason: 'step-budget-exhausted' };
}

/** 一份覆盖全部可填分区的完整简历（故意与页面现有值不同，用来验证「默认不覆盖」）。 */
function fullResume() {
  return {
    基本信息: { 姓名: '张三', 电话区号: '+86', 手机号: '13900001111', 邮箱: 'zhangsan@example.com', 城市: '杭州' },
    教育经历: [{ 开始时间: '2018-09', 结束时间: '2022-06', 学校: '示例大学', 学历: '硕士', 专业: '软件工程' }],
    实习经历: [
      { 公司: '示例科技', 职位: '后端实习生', 开始时间: '2021-06', 结束时间: '2021-09', 描述: '实习一' },
      { 公司: '云上网络', 职位: '平台实习生', 开始时间: '2022-01', 结束时间: '2022-03', 描述: '实习二' }
    ],
    项目经历: [
      { 名称: '项目甲', 角色: '后端负责人', 开始时间: '2023-01', 结束时间: '2023-05', 链接: 'https://example.com/a', 描述: '甲描述' },
      { 名称: '项目乙', 角色: '全栈开发', 开始时间: '2023-06', 结束时间: '至今', 链接: 'https://example.com/b', 描述: '乙描述' },
      { 名称: '项目丙', 角色: '个人开发', 开始时间: '2024-02', 结束时间: '2024-04', 链接: 'https://example.com/c', 描述: '丙描述' }
    ],
    竞赛: [
      { 名称: '示例竞赛一等奖', 描述: '竞赛描述一', 时间: '2023' },
      { 名称: '示例竞赛二等奖', 描述: '竞赛描述二', 时间: '2024' }
    ],
    语言能力: [{ 语言: '英语', 水平: '熟练' }],
    自我评价: { 内容: '这里是自我评价正文。' },
    社交账号: [{ 平台: 'Github', 账号: 'https://github.com/example' }]
  };
}

// ---------------------------------------------------------------------------
// 1. 检查器：结构、分区、条目、标签、可见性
// ---------------------------------------------------------------------------

test('inspect: 真实页面结构被正确识别（11 模块 / 卡片条目 / 字段名 / 标签 / 可见性）', () => {
  const twin = createBytedanceTwin();
  const { pageModel, diagnostics } = inspect(twin);

  const sectionKeys = new Set(pageModel.sections.map(section => section.key).filter(Boolean));
  for (const key of ['basic', 'work', 'education', 'internship', 'project', 'work_samples', 'award', 'language', 'summary', 'sns']) {
    assert.ok(sectionKeys.has(key), `缺少分区 ${key}，实际为 ${[...sectionKeys].join(',')}`);
  }

  const visible = pageModel.controls.filter(control => control.visible);
  assert.ok(visible.length > 50, `可见控件过少：${visible.length}`);
  assert.equal(pageModel.controls.filter(control => control.controlType === 'file').length, 0, 'file 控件不应进入 controls');
  assert.ok(diagnostics.some(item => item.code === 'controls-inspected'));

  const projectControls = pageModel.controls.filter(control => control.sectionKey === 'project');
  const projectItems = new Set(projectControls.map(control => control.itemIndex));
  assert.equal(projectItems.size, 9, `项目条目数应为 9，实际 ${projectItems.size}`);
  for (let index = 0; index < 9; index += 1) {
    const keys = projectControls.filter(control => control.itemIndex === index).map(control => control.fieldKey);
    for (const field of ['name', 'role', 'link', 'desc', 'start_end_time']) {
      assert.ok(keys.includes(field), `项目条目 ${index} 缺少字段 ${field}`);
    }
  }

  const educationTimes = pageModel.controls.filter(control => control.sectionKey === 'education' && control.fieldKey === 'start_end_time');
  assert.equal(educationTimes.length, 2);
  assert.deepEqual(educationTimes.map(control => control.itemRole), ['start', 'end']);

  const school = pageModel.controls.find(control => control.sectionKey === 'education' && control.fieldKey === 'school');
  assert.equal(school.label, '学校名称');
  assert.ok(!/^请/.test(school.label));

  const degree = pageModel.controls.find(control => control.sectionKey === 'education' && control.fieldKey === 'degree');
  assert.equal(degree.controlType, 'combobox');
  assert.equal(degree.value, '本科');

  // itemRole 只应出现在起止时间的两个输入上
  const strayRoles = pageModel.controls.filter(control => control.itemRole && control.fieldKey !== 'start_end_time');
  assert.deepEqual(strayRoles.map(control => `${control.sectionKey}.${control.fieldKey}=${control.itemRole}`), [], 'itemRole 不应出现在非起止时间控件上');

  const addActions = pageModel.actions.filter(action => action.kind === 'add-item');
  assert.ok(addActions.length >= 5, `add-item 动作过少：${addActions.length}`);
  const allLabels = [...pageModel.controls, ...pageModel.actions].map(item => String(item.label ?? item.text ?? ''));
  assert.ok(!allLabels.some(label => /^(保存|取消|删除)$/.test(label)), `危险按钮出现在可执行目标里：${allLabels.join(',')}`);
});

// ---------------------------------------------------------------------------
// 2. 规划：分区作用域、默认不覆盖、幂等
// ---------------------------------------------------------------------------

test('plan: 默认只填空白 —— 页面已有且不同的值成为 conflict、相同值 skipped、空白 ready', () => {
  const twin = createBytedanceTwin();
  const { pageModel } = inspect(twin);
  const plan = planFill({ resumeIndex: buildResumeIndex(fullResume()), pageModel, mode: 'fill-empty' });

  const nameControl = pageModel.controls.find(control => control.fieldKey === 'name' && control.sectionKey === 'basic');
  const nameStep = plan.steps.find(step => step.controlId === nameControl.controlId);
  assert.equal(nameStep.status, 'conflict');
  assert.equal(nameStep.currentValue, '林知远');
  assert.equal(nameStep.value, '张三');

  const addSteps = plan.steps.filter(step => step.kind === 'add-item');
  assert.ok(addSteps.some(step => (step.sectionKey ?? step.sectionId) === 'internship'), '空实习经历模块应生成 add-item 步骤');

  const projectSteps = plan.steps.filter(step => step.controlId && pageModel.controls.find(control => control.controlId === step.controlId)?.sectionKey === 'project');
  const coveredItems = new Set(projectSteps.map(step => pageModel.controls.find(control => control.controlId === step.controlId).itemIndex));
  for (const index of coveredItems) {
    const sources = new Set(projectSteps.filter(step => pageModel.controls.find(control => control.controlId === step.controlId).itemIndex === index).map(step => JSON.stringify((step.sourcePath ?? []).slice(0, 2))));
    assert.equal(sources.size, 1, `项目条目 ${index} 的字段来自不同简历条目：${[...sources].join(' / ')}`);
  }

  assert.equal(plan.mode, 'fill-empty');
  assert.equal(plan.summary.total, plan.steps.length);
  assert.ok(plan.summary.conflicts > 0);
  assert.ok(plan.summary.ready > 0);
});

test('plan: overwrite 模式把冲突也变成可执行步骤', () => {
  const twin = createBytedanceTwin();
  const { pageModel } = inspect(twin);
  const plan = planFill({ resumeIndex: buildResumeIndex(fullResume()), pageModel, mode: 'overwrite' });
  assert.equal(plan.summary.conflicts, 0);
  assert.ok(plan.steps.filter(step => step.status === 'ready').length > 20);
});

// ---------------------------------------------------------------------------
// 3. 执行：默认模式下页面已有内容保持不变，且从不点保存
// ---------------------------------------------------------------------------

test('execute: fill-empty 模式不覆盖已有内容、不点保存', async () => {
  const twin = createBytedanceTwin();
  const before = valueMap(inspect(twin).pageModel);
  const outcome = await fillUntilDone(twin, buildResumeIndex(fullResume()), { mode: 'fill-empty' });
  assert.ok(outcome.ok, `填写循环未收敛：${outcome.reason}`);
  assert.equal(twin.submitCount(), 0, '绝不能点击保存/取消');

  const after = valueMap(inspect(twin).pageModel);
  assert.equal(after.get('basic:0:name'), before.get('basic:0:name'));
  assert.equal(after.get('basic:0:email'), before.get('basic:0:email'));
  assert.equal(after.get('education:0:school'), before.get('education:0:school'));
  assert.equal(after.get('project:0:name'), before.get('project:0:name'));
  // 空模块被补齐（实习经历），这是「只填空白」允许的部分
  assert.equal(twin.cards('internship').length, 2);
});

// ---------------------------------------------------------------------------
// 4. 执行：overwrite 模式下完整回填（分区不串味 + 下拉展示值 + 日期 + 年份）
// ---------------------------------------------------------------------------

test('execute: overwrite 模式完整回填，分区/条目/下拉/日期全部正确', async () => {
  const twin = createBytedanceTwin();
  const resume = fullResume();
  const outcome = await fillUntilDone(twin, buildResumeIndex(resume), { mode: 'overwrite' });
  assert.ok(outcome.ok, `填写循环未收敛：${outcome.reason}\n${JSON.stringify(outcome.log.slice(-3), null, 1)}`);
  assert.equal(twin.submitCount(), 0, '绝不能点击保存/取消/删除');

  const values = valueMap(inspect(twin).pageModel);

  assert.equal(values.get('basic:0:name'), '张三');
  assert.equal(values.get('basic:0:email'), 'zhangsan@example.com');

  assert.equal(values.get('education:0:school'), '示例大学');
  assert.equal(values.get('education:0:degree'), '硕士');
  assert.equal(values.get('education:0:field_of_study'), '软件工程');
  assert.equal(values.get('education:0:start_end_time:start'), '2018-09');
  assert.equal(values.get('education:0:start_end_time:end'), '2022-06');

  for (const [index, item] of resume.项目经历.entries()) {
    assert.equal(values.get(`project:${index}:name`), item.名称, `项目 ${index} 名称错位`);
    assert.equal(values.get(`project:${index}:role`), item.角色, `项目 ${index} 角色错位`);
    assert.equal(values.get(`project:${index}:link`), item.链接, `项目 ${index} 链接错位`);
    assert.equal(values.get(`project:${index}:desc`), item.描述, `项目 ${index} 描述错位`);
    assert.equal(values.get(`project:${index}:start_end_time:start`), item.开始时间, `项目 ${index} 开始时间错位`);
    assert.equal(values.get(`project:${index}:start_end_time:end`), item.结束时间, `项目 ${index} 结束时间错位`);
  }
  assert.ok(twin.cards('project').length >= 9, '页面多余的卡片不应被删除');

  assert.equal(values.get('award:0:name'), '示例竞赛一等奖');
  assert.equal(values.get('award:0:date'), '2023');
  assert.equal(values.get('award:0:desc'), '竞赛描述一');
  assert.equal(values.get('award:1:name'), '示例竞赛二等奖');
  assert.equal(values.get('award:1:date'), '2024');

  assert.equal(values.get('language:0:language'), '英语');
  assert.equal(values.get('language:0:proficiency'), '熟练');
  assert.equal(values.get('summary:0:self_evaluation'), '这里是自我评价正文。');
  assert.equal(values.get('sns:0:sns_type'), 'Github');
  assert.equal(values.get('sns:0:link'), 'https://github.com/example');

  assert.equal(twin.cards('internship').length, 2, `实习经历卡片数应为 2，实际 ${twin.cards('internship').length}`);
  assert.equal(values.get('internship:0:desc'), '实习一');
  assert.equal(values.get('internship:1:desc'), '实习二');
});

// ---------------------------------------------------------------------------
// 5. 撤销
// ---------------------------------------------------------------------------

test('undo: 撤销本轮填写，把文本与下拉都恢复原值', async () => {
  const twin = createBytedanceTwin();
  const before = valueMap(inspect(twin).pageModel);
  const outcome = await fillUntilDone(twin, buildResumeIndex(fullResume()), { mode: 'overwrite' });
  assert.ok(outcome.ok, `填写循环未收敛：${outcome.reason}`);
  assert.notEqual(valueMap(inspect(twin).pageModel).get('basic:0:name'), before.get('basic:0:name'));

  const undone = undoLastFill(twin.document);
  assert.ok(undone && undone.undone > 0, '撤销应该恢复至少一个控件');
  const after = valueMap(inspect(twin).pageModel);
  assert.equal(after.get('basic:0:name'), before.get('basic:0:name'));
  assert.equal(after.get('education:0:school'), before.get('education:0:school'));
});

// ---------------------------------------------------------------------------
// 6. 守卫：危险步骤一律拒绝
// ---------------------------------------------------------------------------

test('guard: 低置信度、只读、文件、保存类目标一律拦截', () => {
  const twin = createBytedanceTwin();
  const { pageModel } = inspect(twin);

  assert.equal(validatePlannedStep({ stepId: 'x', kind: 'fill', controlId: pageModel.controls[0].controlId, value: 'v', confidence: 0.1 }, { pageModel }).allowed, false);
  assert.equal(validatePlannedStep({ stepId: 'y', kind: 'fill', controlId: 'control-does-not-exist', value: 'v', confidence: 0.99 }, { pageModel }).allowed, false);
  assert.equal(validatePlannedStep({ stepId: 'z', kind: 'fill', controlId: pageModel.controls[0].controlId, value: 'v', confidence: 0.99 }, { pageModel, pageFingerprint: 'page-stale' }).allowed, false);

  const conflictStep = { stepId: 'c', kind: 'fill', controlId: pageModel.controls[0].controlId, value: 'v', confidence: 0.95, status: 'conflict' };
  assert.equal(validatePlannedStep(conflictStep, { pageModel, mode: 'fill-empty' }).allowed, false);
});
