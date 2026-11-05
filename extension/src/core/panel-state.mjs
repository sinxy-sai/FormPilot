/**
 * Panel state (fill engine v2, task D).
 *
 * Everything the side panel renders is derived here. `reducePanelState` is a
 * pure reducer: it never touches chrome.*, never does i18n, never formats
 * user-facing text. Messages are stored as `{ kind, code, params }` and the
 * side panel translates `code` through chrome.i18n. Keeping it pure makes the
 * whole review flow testable without a browser.
 */

export const PANEL_STATE_VERSION = 1;

export const FILL_MODE = Object.freeze({
  fillEmpty: 'fill-empty',
  overwrite: 'overwrite'
});

export const PANEL_STATUS = Object.freeze({
  idle: 'idle',
  ready: 'ready',
  inspecting: 'inspecting',
  reviewing: 'reviewing',
  filling: 'filling',
  restoring: 'restoring',
  done: 'done',
  invalidated: 'invalidated',
  error: 'error'
});

const normalMode = mode => (mode === FILL_MODE.overwrite ? FILL_MODE.overwrite : FILL_MODE.fillEmpty);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const initialPanelState = Object.freeze({
  version: PANEL_STATE_VERSION,
  status: PANEL_STATUS.idle,
  busy: false,
  mode: FILL_MODE.fillEmpty,
  resume: null,
  page: null,
  backups: Object.freeze({ list: [], latest: null }),
  plan: null,
  results: [],
  summary: null,
  message: null
});

function message(kind, code, params) {
  return code ? { kind, code, ...(params && Object.keys(params).length ? { params } : {}) } : null;
}

function nextStatus(current, fallback) {
  return ['filling', 'restoring', 'inspecting'].includes(current) ? fallback : current;
}

export function summarizeResults(results = []) {
  const counts = { total: 0, ok: 0, conflict: 0, failed: 0, skipped: 0, manual: 0 };
  for (const result of Array.isArray(results) ? results : []) {
    counts.total += 1;
    switch (result?.status) {
      case 'done':
      case 'verified': counts.ok += 1; break;
      case 'conflict': counts.conflict += 1; break;
      case 'failed': counts.failed += 1; break;
      case 'manual': counts.manual += 1; break;
      default: counts.skipped += 1;
    }
  }
  return counts;
}

export function planOverview(plan) {
  const steps = Array.isArray(plan?.steps) ? plan.steps : [];
  const counts = { total: steps.length, ready: 0, conflicts: 0, skipped: 0, unsupported: 0, addItems: 0, fields: 0 };
  for (const step of steps) {
    const status = step?.status ?? 'ready';
    if (step?.kind === 'add-item') {
      if (status === 'ready') counts.addItems += 1;
      else if (status === 'unsupported') counts.unsupported += 1;
      else counts.skipped += 1;
      continue;
    }
    counts.fields += 1;
    switch (status) {
      case 'ready': counts.ready += 1; break;
      case 'conflict': counts.conflicts += 1; break;
      case 'unsupported': counts.unsupported += 1; break;
      default: counts.skipped += 1;
    }
  }
  const summary = record(plan?.summary) ? plan.summary : {};
  return {
    ...counts,
    mode: normalMode(plan?.mode),
    missingFields: Array.isArray(summary.missingFields) ? summary.missingFields : [],
    outOfRangeItems: Array.isArray(summary.outOfRangeItems) ? summary.outOfRangeItems : [],
    actionable: counts.ready + counts.addItems
  };
}

export function resumeOverview(resumeIndex) {
  const items = record(resumeIndex?.items) ? resumeIndex.items : {};
  const sections = Object.entries(items)
    .filter(([, value]) => Array.isArray(value) && value.length > 0)
    .map(([sectionKey, value]) => ({ sectionKey, count: value.length }));
  const basics = record(resumeIndex?.basics) ? Object.keys(resumeIndex.basics) : [];
  const intention = record(resumeIndex?.intention) ? Object.keys(resumeIndex.intention) : [];
  const missing = Array.isArray(resumeIndex?.missing) ? resumeIndex.missing.filter(item => typeof item === 'string') : [];
  const unknown = Array.isArray(resumeIndex?.coverage?.unknown) ? resumeIndex.coverage.unknown : [];
  return {
    sections,
    basics,
    intention,
    missing,
    unknown,
    entryCount: Array.isArray(resumeIndex?.entries) ? resumeIndex.entries.length : 0,
    itemCount: sections.reduce((sum, section) => sum + section.count, 0)
  };
}

export function pageOverview(state = {}) {
  const pageModel = state.page?.pageModel;
  if (!record(pageModel)) return { inspected: false, stale: false, fingerprint: '', controls: 0, visibleControls: 0, actions: 0, sections: [], pageIdentity: null, capturedAt: null, invalidatedReason: null };
  const controls = Array.isArray(pageModel.controls) ? pageModel.controls : [];
  const sections = (Array.isArray(pageModel.sections) ? pageModel.sections : []).map(section => {
    const owned = controls.filter(control => control.sectionId === section.id);
    return {
      id: section.id,
      label: section.label ?? '',
      key: section.key ?? section.sectionKey ?? '',
      itemCount: Number.isInteger(section.itemCount) ? section.itemCount : owned.length,
      controlCount: owned.length,
      repeatable: section.repeatable === true
    };
  });
  return {
    inspected: true,
    stale: state.page?.stale === true,
    fingerprint: String(pageModel.fingerprint ?? ''),
    controls: controls.length,
    visibleControls: controls.filter(control => control.visible !== false).length,
    actions: Array.isArray(pageModel.actions) ? pageModel.actions.length : 0,
    sections,
    pageIdentity: record(pageModel.pageIdentity) ? pageModel.pageIdentity : null,
    capturedAt: state.page?.capturedAt ?? null,
    invalidatedReason: state.page?.invalidatedReason ?? null
  };
}

export function backupOverview(state = {}) {
  const list = Array.isArray(state.backups?.list) ? state.backups.list : [];
  const latest = state.backups?.latest ?? list[0] ?? null;
  return {
    available: Boolean(latest),
    count: list.length,
    latest,
    lastCapturedAt: latest?.capturedAt ?? null,
    controlsCount: Array.isArray(latest?.controls) ? latest.controls.length : 0
  };
}

const RESULT_STATUS = Object.freeze({ done: 'done', verified: 'done', conflict: 'conflict', failed: 'failed', manual: 'manual', skipped: 'skipped' });
const PLAN_STATUS = Object.freeze({ ready: 'ready', conflict: 'conflict', skipped: 'skipped', unsupported: 'unsupported' });

export function displayStatus(planStatus, resultStatus) {
  if (resultStatus && RESULT_STATUS[resultStatus]) return RESULT_STATUS[resultStatus];
  return PLAN_STATUS[planStatus] ?? 'unsupported';
}

export function normalizeConfidence(confidence) {
  const numeric = Number(confidence);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(1, numeric));
}

/** Merge plan steps + executed results + page labels into review table rows. */
export function matchRows(state = {}) {
  const steps = Array.isArray(state.plan?.steps) ? state.plan.steps : [];
  const controls = new Map();
  for (const control of state.page?.pageModel?.controls ?? []) controls.set(control.controlId, control);
  const actions = new Map();
  for (const action of state.page?.pageModel?.actions ?? []) actions.set(action.actionId, action);
  const results = new Map();
  for (const result of Array.isArray(state.results) ? state.results : []) if (result?.stepId) results.set(result.stepId, result);
  const rows = steps.map((step, index) => {
    const control = step.controlId ? controls.get(step.controlId) : null;
    const action = step.actionId ? actions.get(step.actionId) : null;
    const result = results.get(step.stepId);
    const currentValue = result && result.before !== undefined ? result.before : control ? control.value : undefined;
    return {
      stepId: step.stepId ?? `step-${index}`,
      kind: step.kind ?? 'fill',
      fieldKey: step.fieldKey ?? '',
      sectionKey: step.sectionKey ?? '',
      itemIndex: Number.isInteger(step.itemIndex) ? step.itemIndex : null,
      pageLabel: control?.label ?? action?.label ?? '',
      pageControlType: control?.controlType ?? '',
      sourcePath: Array.isArray(step.sourcePath) ? step.sourcePath.join('.') : String(step.sourcePath ?? ''),
      currentValue,
      targetValue: step.value,
      status: displayStatus(step.status, result?.status),
      planStatus: step.status ?? 'ready',
      confidence: normalizeConfidence(step.confidence),
      reason: (result?.reason ?? step.reason) ?? '',
      changed: result?.changed === true
    };
  });
  // Steps executed in an earlier pass may be absent from the final re-planned
  // plan; keep their results visible so the summary and the table agree.
  const covered = new Set(rows.map(row => row.stepId));
  for (const result of Array.isArray(state.results) ? state.results : []) {
    if (!result || !result.stepId || covered.has(result.stepId)) continue;
    const control = result.controlId ? controls.get(result.controlId) : null;
    const action = result.actionId ? actions.get(result.actionId) : null;
    rows.push({
      stepId: result.stepId,
      kind: result.kind ?? 'fill',
      fieldKey: result.fieldKey ?? '',
      sectionKey: result.sectionKey ?? '',
      itemIndex: Number.isInteger(result.itemIndex) ? result.itemIndex : null,
      pageLabel: control?.label ?? action?.label ?? '',
      pageControlType: control?.controlType ?? '',
      sourcePath: Array.isArray(result.sourcePath) ? result.sourcePath.join('.') : String(result.sourcePath ?? ''),
      currentValue: result.before,
      targetValue: result.expected ?? result.value,
      status: displayStatus(undefined, result.status),
      planStatus: result.status === 'conflict' ? 'conflict' : 'ready',
      confidence: normalizeConfidence(result.confidence),
      reason: result.reason ?? '',
      changed: result.changed === true
    });
  }
  return rows;
}

export function selectReadiness(state = {}) {
  const status = state.status ?? PANEL_STATUS.idle;
  const busy = state.busy === true || [PANEL_STATUS.inspecting, PANEL_STATUS.filling, PANEL_STATUS.restoring].includes(status);
  const resumeReady = Boolean(state.resume && (state.resume.index || state.resume.raw));
  const page = pageOverview(state);
  const pageReady = page.inspected && status !== PANEL_STATUS.invalidated;
  const plan = planOverview(state.plan);
  const planReady = pageReady && plan.actionable > 0;
  const previousResults = Array.isArray(state.results) ? state.results : [];
  const canInspect = !busy;
  const canBackup = !busy && page.inspected;
  const canFill = !busy && resumeReady && pageReady && planReady;
  const canUndo = !busy && previousResults.some(result => result?.changed === true);
  const canRestore = !busy && backupOverview(state).available;
  const reasons = [];
  if (!resumeReady) reasons.push('resume-missing');
  if (!page.inspected) reasons.push('page-missing');
  else if (!pageReady) reasons.push('page-invalidated');
  else if (plan.actionable === 0) reasons.push('nothing-to-fill');
  if (busy) reasons.push('busy');
  return { busy, resumeReady, pageReady, planReady, canInspect, canBackup, canFill, canUndo, canRestore, reasons };
}

export function reducePanelState(state = initialPanelState, action = {}) {
  const current = { ...initialPanelState, ...(record(state) ? state : {}) };
  const currentBackups = record(current.backups) ? current.backups : { list: [], latest: null };
  switch (action?.type) {
    case 'resume/load': {
      const resume = {
        raw: action.resume ?? null,
        index: action.index ?? null,
        fileName: String(action.fileName ?? current.resume?.fileName ?? ''),
        loadedAt: new Date().toISOString()
      };
      return {
        ...current,
        resume,
        plan: null,
        results: [],
        summary: null,
        status: current.status === PANEL_STATUS.idle ? PANEL_STATUS.ready : nextStatus(current.status, PANEL_STATUS.reviewing),
        message: message('success', 'resumeLoaded', { fileName: resume.fileName, entries: resumeOverview(resume.index).entryCount })
      };
    }
    case 'resume/error':
      return { ...current, message: message('error', 'resumeInvalid', { detail: String(action.message ?? '') }) };
    case 'resume/clear':
      return { ...current, resume: null, plan: null, results: [], summary: null, status: PANEL_STATUS.ready, message: message('info', 'resumeCleared') };
    case 'mode/set':
      return { ...current, mode: normalMode(action.mode) };
    case 'page/inspect-start':
      return { ...current, busy: true, status: PANEL_STATUS.inspecting, plan: null, results: [], summary: null, message: null };
    case 'page/inspected': {
      const pageModel = record(action.pageModel) ? action.pageModel : null;
      if (!pageModel) return { ...current, busy: false, status: PANEL_STATUS.error, message: message('error', 'inspectFailed') };
      return {
        ...current,
        busy: false,
        status: PANEL_STATUS.reviewing,
        page: { pageModel, diagnostics: Array.isArray(action.diagnostics) ? action.diagnostics : [], capturedAt: action.capturedAt ?? new Date().toISOString(), stale: false, invalidatedReason: null },
        plan: null,
        results: [],
        summary: null,
        message: message('success', 'inspectOk', { controls: pageOverview({ page: { pageModel } }).visibleControls })
      };
    }
    case 'page/inspect-fail':
      return { ...current, busy: false, status: current.page ? PANEL_STATUS.reviewing : PANEL_STATUS.error, message: message('error', 'inspectFailed', { detail: String(action.message ?? '') }) };
    case 'page/invalidated':
      return {
        ...current,
        busy: false,
        status: PANEL_STATUS.invalidated,
        page: current.page ? { ...current.page, stale: true, invalidatedReason: String(action.reason ?? 'navigation') } : null,
        plan: null,
        results: [],
        summary: null,
        message: message('warn', 'pageInvalidated', { reason: String(action.reason ?? 'navigation') })
      };
    case 'page/stale':
      return { ...current, page: current.page ? { ...current.page, stale: true } : null, plan: null, results: [], summary: null, status: PANEL_STATUS.reviewing, message: message('warn', 'inspectStale') };
    case 'backup/list': {
      const list = Array.isArray(action.backups) ? action.backups : [];
      return { ...current, backups: { list, latest: list[0] ?? currentBackups.latest ?? null } };
    }
    case 'backup/saved': {
      const backup = record(action.backup) ? action.backup : null;
      const list = Array.isArray(action.backups) ? action.backups : backup ? [backup, ...currentBackups.list] : currentBackups.list;
      return {
        ...current,
        backups: { list, latest: list[0] ?? backup },
        message: backup ? message('success', 'backupSaved', { controls: Array.isArray(backup.controls) ? backup.controls.length : 0 }) : message('error', 'backupFailed')
      };
    }
    case 'backup/failed':
      return { ...current, message: message('error', 'backupFailed', { detail: String(action.message ?? '') }) };
    case 'backup/restore-start':
      return { ...current, busy: true, status: PANEL_STATUS.restoring, message: null };
    case 'backup/restored': {
      const restored = Number(action.restored) || 0;
      const failed = Number(action.failed) || 0;
      return {
        ...current,
        busy: false,
        status: PANEL_STATUS.reviewing,
        page: current.page ? { ...current.page, stale: true } : null,
        plan: null,
        results: [],
        summary: null,
        message: failed > 0 ? message('warn', 'restorePartial', { restored, failed }) : message('success', 'restoreDone', { restored })
      };
    }
    case 'backup/restore-fail':
      return { ...current, busy: false, status: current.status === PANEL_STATUS.restoring ? PANEL_STATUS.reviewing : current.status, message: message('error', 'restoreFailed', { detail: String(action.message ?? '') }) };
    case 'plan/set': {
      const plan = record(action.plan) ? action.plan : null;
      const overview = planOverview(plan);
      return {
        ...current,
        plan,
        results: [],
        summary: null,
        status: current.status === PANEL_STATUS.invalidated ? PANEL_STATUS.reviewing : current.status === PANEL_STATUS.idle ? PANEL_STATUS.reviewing : current.status,
        message: plan ? message('info', 'planReady', { ready: overview.ready, conflicts: overview.conflicts, skipped: overview.skipped }) : message('warn', 'planEmpty')
      };
    }
    case 'plan/fail':
      return { ...current, status: PANEL_STATUS.error, message: message('error', 'planFailed', { detail: String(action.message ?? '') }) };
    case 'fill/start':
      return { ...current, busy: true, status: PANEL_STATUS.filling, results: [], summary: null, message: null };
    case 'fill/result': {
      const results = Array.isArray(action.results) ? action.results : [];
      const summary = record(action.summary) ? action.summary : summarizeResults(results);
      return {
        ...current,
        busy: false,
        status: PANEL_STATUS.done,
        plan: record(action.plan) ? action.plan : current.plan,
        results,
        summary,
        page: current.page ? { ...current.page, stale: true } : null,
        message: summary.failed > 0
          ? message('warn', 'fillPartial', { ok: summary.ok, conflict: summary.conflict, failed: summary.failed })
          : message('success', 'fillDone', { ok: summary.ok, conflict: summary.conflict, skipped: summary.skipped, manual: summary.manual })
      };
    }
    case 'fill/fail':
      return { ...current, busy: false, status: PANEL_STATUS.error, message: message('error', 'fillFailed', { detail: String(action.message ?? '') }) };
    case 'undo/result': {
      const undone = Number(action.undone) || 0;
      return {
        ...current,
        busy: false,
        status: PANEL_STATUS.reviewing,
        results: [],
        summary: null,
        page: current.page ? { ...current.page, stale: true } : null,
        message: undone > 0 ? message('success', 'undoDone', { undone }) : message('info', 'undoNothing')
      };
    }
    case 'undo/fail':
      return { ...current, busy: false, message: message('error', 'undoFailed', { detail: String(action.message ?? '') }) };
    case 'message/set':
      return { ...current, message: message(action.kind ?? 'info', action.code, action.params) };
    case 'message/clear':
      return { ...current, message: null };
    case 'reset':
      return { ...initialPanelState, mode: current.mode };
    default:
      return current;
  }
}
