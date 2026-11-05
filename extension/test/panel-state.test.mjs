import test from 'node:test';
import assert from 'node:assert/strict';
import {
  initialPanelState,
  reducePanelState,
  resumeOverview,
  pageOverview,
  matchRows,
  planOverview,
  summarizeResults,
  selectReadiness,
  backupOverview,
  FILL_MODE
} from '../src/core/panel-state.mjs';

const pageModel = {
  pageIdentity: { origin: 'https://jobs.bytedance.com', route: '/experienced/resume/edit' },
  fingerprint: 'page-abc',
  sections: [
    { id: 'section-basic', label: '基本信息', key: 'basic', itemCount: 1 },
    { id: 'section-project', label: '项目经历', key: 'project', itemCount: 2, repeatable: true }
  ],
  controls: [
    { controlId: 'control-1', label: '姓名', controlType: 'text', value: '张三', sectionId: 'section-basic', sectionKey: 'basic', fieldKey: 'name' },
    { controlId: 'control-2', label: '手机号', controlType: 'text', value: '', sectionId: 'section-basic', sectionKey: 'basic', fieldKey: 'mobile' },
    { controlId: 'control-3', label: '项目名称', controlType: 'text', value: '旧项目', sectionId: 'section-project', sectionKey: 'project', itemIndex: 0, fieldKey: 'name' }
  ],
  actions: [{ actionId: 'action-add-project', kind: 'add-item', sectionId: 'section-project', label: '添加项目经历' }]
};

const resumeIndex = {
  schemaVersion: 1,
  basics: { name: { text: '张三' }, mobile: { text: '13800000000' } },
  atention: {},
  items: {
    project: [{ itemIndex: 0, path: ['项目经历', 0], fields: { name: { text: '新项目' } } }],
    education: [{ itemIndex: 0, path: ['教育经历', 0], fields: { school: { text: '某大学' } } }]
  },
  entries: [{ section: 'basic', itemIndex: null, field: 'name', key: '姓名', path: ['姓名'], value: '张三', type: 'text' }],
  coverage: { known: [], unknown: [] },
  missing: ['mobile']
};

const readyPlan = {
  mode: FILL_MODE.fillEmpty,
  steps: [
    { stepId: 'step-1', kind: 'fill', controlId: 'control-1', value: '张三', sourcePath: ['姓名'], fieldKey: 'name', sectionKey: 'basic', confidence: 0.95, status: 'ready' },
    { stepId: 'step-2', kind: 'fill', controlId: 'control-2', value: '13800000000', sourcePath: ['手机'], fieldKey: 'mobile', sectionKey: 'basic', confidence: 0.95, status: 'ready' },
    { stepId: 'step-3', kind: 'fill', controlId: 'control-3', value: '新项目', sourcePath: ['项目经历', 0, 'name'], fieldKey: 'name', sectionKey: 'project', itemIndex: 0, confidence: 0.9, status: 'conflict', reason: 'existing-value-differs' },
    { stepId: 'step-4', kind: 'add-item', actionId: 'action-add-project', value: '', fieldKey: 'name', sectionKey: 'project', confidence: 0.9, status: 'ready' }
  ],
  summary: { total: 4, ready: 2, conflicts: 1, skipped: 0, unsupported: 0, missingFields: ['mobile'], outOfRangeItems: [] }
};

function reviewState() {
  let state = initialPanelState;
  state = reducePanelState(state, { type: 'resume/load', resume: { basics: {} }, index: resumeIndex, fileName: 'resume.json' });
  state = reducePanelState(state, { type: 'page/inspected', pageModel });
  state = reducePanelState(state, { type: 'plan/set', plan: readyPlan });
  return state;
}

test('resume/load records index and message, clears a previous plan', () => {
  let state = reducePanelState(initialPanelState, { type: 'page/inspected', pageModel });
  state = reducePanelState(state, { type: 'plan/set', plan: readyPlan });
  assert.ok(state.plan);
  state = reducePanelState(state, { type: 'resume/load', resume: { a: 1 }, index: resumeIndex, fileName: 'r.json' });
  assert.equal(state.status, 'reviewing');
  assert.equal(state.plan, null);
  assert.deepEqual(state.results, []);
  assert.equal(state.message.code, 'resumeLoaded');
  assert.equal(state.message.params.fileName, 'r.json');
});

test('resume/error keeps the previously loaded resume', () => {
  let state = reviewState();
  const previous = state.resume;
  state = reducePanelState(state, { type: 'resume/error', message: 'bad json' });
  assert.deepEqual(state.resume, previous);
  assert.equal(state.message.code, 'resumeInvalid');
  assert.equal(state.message.kind, 'error');
});

test('resumeOverview reports section item counts and missing fields', () => {
  const overview = resumeOverview(resumeIndex);
  assert.deepEqual(overview.sections, [
    { sectionKey: 'project', count: 1 },
    { sectionKey: 'education', count: 1 }
  ]);
  assert.equal(overview.itemCount, 2);
  assert.deepEqual(overview.missing, ['mobile']);
});

test('pageOverview exposes fingerprint, controls and section item counts', () => {
  const overview = pageOverview({ page: { pageModel } });
  assert.equal(overview.inspected, true);
  assert.equal(overview.fingerprint, 'page-abc');
  assert.equal(overview.controls, 3);
  assert.equal(overview.sections.find(section => section.key === 'project').itemCount, 2);
  assert.equal(overview.sections.find(section => section.key === 'project').controlCount, 1);
  assert.equal(pageOverview({}).inspected, false);
});

test('plan/set derives review rows with conflict and skip states', () => {
  const state = reviewState();
  const rows = matchRows(state);
  assert.equal(rows.length, 4);
  const byId = Object.fromEntries(rows.map(row => [row.stepId, row]));
  assert.equal(byId['step-1'].pageLabel, '姓名');
  assert.equal(byId['step-1'].status, 'ready');
  assert.equal(byId['step-3'].status, 'conflict');
  assert.equal(byId['step-3'].currentValue, '旧项目');
  assert.equal(byId['step-3'].targetValue, '新项目');
  assert.equal(byId['step-3'].confidence, 0.9);
  assert.equal(byId['step-4'].kind, 'add-item');
  assert.equal(byId['step-4'].pageLabel, '添加项目经历');
});

test('planOverview counts ready/conflict/add-item steps', () => {
  const overview = planOverview(readyPlan);
  assert.equal(overview.total, 4);
  assert.equal(overview.ready, 2);
  assert.equal(overview.conflicts, 1);
  assert.equal(overview.addItems, 1);
  assert.equal(overview.actionable, 3);
});

test('fill/result merges executor results into rows and summary', () => {
  let state = reviewState();
  state = reducePanelState(state, { type: 'fill/start' });
  assert.equal(state.status, 'filling');
  const results = [
    { stepId: 'step-1', kind: 'fill', status: 'skipped', reason: 'already-correct', changed: false, fieldKey: 'name', sectionKey: 'basic', controlId: 'control-1', value: '张三' },
    { stepId: 'step-2', kind: 'fill', status: 'verified', changed: true, before: '', after: '13800000000', fieldKey: 'mobile', sectionKey: 'basic', controlId: 'control-2', value: '13800000000' },
    { stepId: 'step-3', kind: 'fill', status: 'conflict', changed: false, before: '旧项目', fieldKey: 'name', sectionKey: 'project', controlId: 'control-3', value: '新项目' },
    { stepId: 'legacy-step', kind: 'add-item', status: 'verified', changed: true, fieldKey: 'name', sectionKey: 'project', actionId: 'action-add-project' }
  ];
  state = reducePanelState(state, { type: 'fill/result', results, plan: readyPlan, summary: summarizeResults(results) });
  assert.equal(state.status, 'done');
  assert.equal(state.page.stale, true);
  assert.equal(state.summary.ok, 2);
  assert.equal(state.summary.conflict, 1);
  const rows = matchRows(state);
  const byId = Object.fromEntries(rows.map(row => [row.stepId, row]));
  assert.equal(byId['step-2'].status, 'done');
  assert.equal(byId['step-3'].status, 'conflict');
  assert.equal(byId['legacy-step'].status, 'done', 'result rows outside the final plan stay visible');
  assert.equal(byId['legacy-step'].pageLabel, '添加项目经历');
  assert.equal(state.message.code, 'fillDone');
});

test('summarizeResults counts failed and manual results', () => {
  const summary = summarizeResults([
    { status: 'verified' },
    { status: 'failed' },
    { status: 'manual' },
    { status: 'skipped' },
    { status: 'conflict' }
  ]);
  assert.deepEqual(summary, { total: 5, ok: 1, conflict: 1, failed: 1, skipped: 1, manual: 1 });
});

test('navigation invalidation clears the actionable plan but keeps the page record', () => {
  let state = reviewState();
  assert.equal(selectReadiness(state).canFill, true);
  state = reducePanelState(state, { type: 'page/invalidated', reason: 'url-changed' });
  assert.equal(state.status, 'invalidated');
  assert.equal(state.plan, null);
  assert.equal(state.page.pageModel.fingerprint, 'page-abc');
  assert.equal(state.message.code, 'pageInvalidated');
  const readiness = selectReadiness(state);
  assert.equal(readiness.canFill, false);
  assert.ok(readiness.reasons.includes('page-invalidated'));
});

test('readiness requires resume, page and a plan with actionable steps', () => {
  assert.equal(selectReadiness(initialPanelState).canFill, false);
  let state = reducePanelState(initialPanelState, { type: 'resume/load', resume: { a: 1 }, index: resumeIndex });
  assert.equal(selectReadiness(state).canFill, false);
  assert.ok(selectReadiness(state).reasons.includes('page-missing'));
  state = reducePanelState(state, { type: 'page/inspected', pageModel });
  assert.equal(selectReadiness(state).canFill, false);
  state = reducePanelState(state, { type: 'plan/set', plan: { mode: 'fill-empty', steps: [{ stepId: 's', kind: 'fill', status: 'conflict' }] } });
  assert.equal(selectReadiness(state).canFill, false);
  assert.ok(selectReadiness(state).reasons.includes('nothing-to-fill'));
  state = reducePanelState(state, { type: 'plan/set', plan: readyPlan });
  const readiness = selectReadiness(state);
  assert.equal(readiness.canFill, true);
  assert.equal(readiness.canInspect, true);
  assert.equal(readiness.canBackup, true);
  assert.equal(readiness.canUndo, false);
});

test('backup events track the newest snapshot and allow restore', () => {
  let state = reducePanelState(initialPanelState, { type: 'page/inspected', pageModel });
  state = reducePanelState(state, { type: 'fill/start' });
  // fill/start keeps the panel busy; a backup result still updates the record
  const backup = { backupId: 'b1', capturedAt: '2026-11-05T08:05:00.000Z', pageIdentity: pageModel.pageIdentity, controls: [{ controlId: 'control-1', label: '姓名', value: '张三' }] };
  state = reducePanelState(state, { type: 'backup/saved', backup, backups: [backup] });
  const overview = backupOverview(state);
  assert.equal(overview.available, true);
  assert.equal(overview.controlsCount, 1);
  assert.equal(overview.lastCapturedAt, '2026-11-05T08:05:00.000Z');
  assert.equal(state.message.code, 'backupSaved');
});

test('backup/restored refreshes page state and reports partial failures', () => {
  let state = reviewState();
  state = reducePanelState(state, { type: 'backup/restore-start' });
  state = reducePanelState(state, { type: 'backup/restored', restored: 7, failed: 2 });
  assert.equal(state.status, 'reviewing');
  assert.equal(state.plan, null);
  assert.equal(state.page.stale, true);
  assert.equal(state.message.code, 'restorePartial');
  assert.equal(state.message.params.restored, 7);
});

test('undo/result reports the undone count or nothing-to-undo', () => {
  let state = reviewState();
  state = reducePanelState(state, { type: 'undo/result', undone: 3 });
  assert.equal(state.message.code, 'undoDone');
  assert.equal(state.busy, false);
  state = reducePanelState(state, { type: 'undo/result', undone: 0 });
  assert.equal(state.message.code, 'undoNothing');
});

test('mode/set defaults to fill-empty and accepts overwrite', () => {
  let state = reducePanelState(initialPanelState, { type: 'mode/set', mode: 'overwrite' });
  assert.equal(state.mode, FILL_MODE.overwrite);
  state = reducePanelState(state, { type: 'mode/set', mode: 'nonsense' });
  assert.equal(state.mode, FILL_MODE.fillEmpty);
});

test('reset clears the review but keeps the fill mode preference', () => {
  let state = reviewState();
  state = reducePanelState(state, { type: 'mode/set', mode: FILL_MODE.overwrite });
  state = reducePanelState(state, { type: 'reset' });
  assert.equal(state.plan, null);
  assert.equal(state.resume, null);
  assert.equal(state.mode, FILL_MODE.overwrite);
});
