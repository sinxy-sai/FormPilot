const TASK_PREFIX = 'formpilot.task.';
const STRATEGY_PREFIX = 'formpilot.strategy.';
const STRATEGY_INDEX_KEY = 'formpilot.strategy.index';
const BACKUP_PREFIX = 'formpilot.backup.';
const PLAN_PREFIX = 'formpilot.plan.';
const RESULT_PREFIX = 'formpilot.result.';

export const BACKUP_LIMIT = 5;
export const UNKNOWN_PAGE_KEY = 'unknown';
let injectedStorageArea;

function getArea() {
  if (injectedStorageArea) return injectedStorageArea;
  if (globalThis.chrome?.storage?.local) return globalThis.chrome.storage.local;
  throw new Error('chrome.storage.local is unavailable; inject a storageArea in tests');
}
export const taskStorageKey = tabId => `${TASK_PREFIX}${tabId}`;
export const strategyStorageKey = id => `${STRATEGY_PREFIX}${id}`;
export { STRATEGY_INDEX_KEY };
export const backupStorageKey = pageIdentity => `${BACKUP_PREFIX}${pageStorageKey(pageIdentity)}`;
export const planStorageKey = pageIdentity => `${PLAN_PREFIX}${pageStorageKey(pageIdentity)}`;
export const resultStorageKey = pageIdentity => `${RESULT_PREFIX}${pageStorageKey(pageIdentity)}`;
export function setStorageArea(storageArea) { if (!storageArea || typeof storageArea.get !== 'function' || typeof storageArea.set !== 'function') throw new TypeError('storageArea must implement get and set'); injectedStorageArea = storageArea; }
function assertTabId(tabId) { if (!Number.isInteger(tabId)) throw new TypeError('tabId must be an integer'); }
export async function loadTask(tabId) { assertTabId(tabId); const result = await getArea().get(taskStorageKey(tabId)); return result?.[taskStorageKey(tabId)] ?? null; }
export async function saveTask(task) { if (!task || !Number.isInteger(task.tabId)) throw new TypeError('task.tabId is required'); await getArea().set({ [taskStorageKey(task.tabId)]: { ...task, updatedAt: task.updatedAt ?? new Date().toISOString() } }); }
export async function invalidateTask(tabId, reason) { assertTabId(tabId); const task = await loadTask(tabId); if (!task) return; await saveTask({ ...task, status: 'invalidated', invalidatedReason: String(reason ?? 'invalidated'), updatedAt: new Date().toISOString() }); }
export async function loadStrategy(id) { if (typeof id !== 'string' || !id) throw new TypeError('strategy id is required'); const result = await getArea().get(strategyStorageKey(id)); return result?.[strategyStorageKey(id)] ?? null; }
export async function saveStrategyRecord(strategy) { if (!strategy || typeof strategy.id !== 'string' || !strategy.id) throw new TypeError('strategy.id is required'); await getArea().set({ [strategyStorageKey(strategy.id)]: strategy }); }
export async function removeStrategyRecord(id) { if (typeof id !== 'string' || !id) return; const area = getArea(); const result = await area.get(STRATEGY_INDEX_KEY); const ids = Array.isArray(result?.[STRATEGY_INDEX_KEY]) ? result[STRATEGY_INDEX_KEY] : []; await area.set({ [STRATEGY_INDEX_KEY]: ids.filter(item => item !== id) }); }
export async function listStrategyRecords() { const result = await getArea().get(STRATEGY_INDEX_KEY); const ids = Array.isArray(result?.[STRATEGY_INDEX_KEY]) ? result[STRATEGY_INDEX_KEY] : []; const values = await Promise.all(ids.map(id => loadStrategy(id))); return values.filter(Boolean); }
export async function saveStrategyIndex(ids) { if (!Array.isArray(ids)) throw new TypeError('strategy ids must be an array'); await getArea().set({ [STRATEGY_INDEX_KEY]: ids }); }

/* ---------------------------------------------------------------------------
 * Backup / last-plan / last-result persistence (fill engine v2)
 *
 * Every write that touches a page is preceded by a page snapshot. Snapshots are
 * stored per `origin + route` and the newest five are kept. When the page
 * identity is missing we degrade to a shared `unknown` bucket instead of
 * throwing, so the panel can always tell the user what is (not) backed up.
 * ------------------------------------------------------------------------- */

/** Stable, storage-safe page bucket. Degrades to `unknown` without identity. */
export function pageStorageKey(pageIdentity) {
  const origin = String(pageIdentity?.origin ?? '').trim();
  const route = String(pageIdentity?.route ?? '').trim();
  const raw = `${origin}${route}`;
  if (!raw) return UNKNOWN_PAGE_KEY;
  const safe = raw.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 200);
  return safe || UNKNOWN_PAGE_KEY;
}

function normalizeControlSnapshot(control) {
  if (!control || typeof control !== 'object' || typeof control.controlId !== 'string' || !control.controlId) return null;
  return {
    controlId: control.controlId.slice(0, 120),
    label: String(control.label ?? '').slice(0, 300),
    value: control.value === undefined ? '' : String(control.value).slice(0, 4000),
    ...(typeof control.fieldKey === 'string' ? { fieldKey: control.fieldKey.slice(0, 60) } : {}),
    ...(typeof control.sectionKey === 'string' ? { sectionKey: control.sectionKey.slice(0, 60) } : {}),
    ...(typeof control.sectionId === 'string' ? { sectionId: control.sectionId.slice(0, 120) } : {}),
    ...(Number.isInteger(control.itemIndex) ? { itemIndex: control.itemIndex } : {}),
    ...(typeof control.controlType === 'string' ? { controlType: control.controlType.slice(0, 40) } : {})
  };
}

/** Normalize a raw snapshot so persisted backups always share one shape. */
export function normalizeBackup(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('backup must be an object');
  const pageIdentity = {
    origin: String(input.pageIdentity?.origin ?? ''),
    route: String(input.pageIdentity?.route ?? ''),
    ...(input.pageIdentity?.title === undefined ? {} : { title: String(input.pageIdentity.title ?? '').slice(0, 300) })
  };
  const controls = Array.isArray(input.controls) ? input.controls.map(normalizeControlSnapshot).filter(Boolean) : [];
  const capturedAt = typeof input.capturedAt === 'string' && input.capturedAt ? input.capturedAt : new Date().toISOString();
  return {
    backupId: typeof input.backupId === 'string' && input.backupId ? input.backupId.slice(0, 120) : `backup-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`,
    capturedAt,
    reason: typeof input.reason === 'string' && input.reason ? input.reason.slice(0, 80) : 'manual',
    url: String(input.url ?? '').slice(0, 2000),
    pageIdentity,
    ...(typeof input.fingerprint === 'string' ? { fingerprint: input.fingerprint.slice(0, 120) } : {}),
    ...(typeof input.resumeFingerprint === 'string' ? { resumeFingerprint: input.resumeFingerprint.slice(0, 120) } : {}),
    controls
  };
}

async function readMany(keys) {
  const area = getArea();
  const result = await area.get(keys);
  return result && typeof result === 'object' ? result : {};
}

export async function loadBackups(pageIdentity) {
  const key = backupStorageKey(pageIdentity);
  const stored = await readMany(key);
  const list = stored?.[key];
  return Array.isArray(list) ? list.filter(entry => entry && typeof entry === 'object') : [];
}

export async function loadLatestBackup(pageIdentity) {
  const backups = await loadBackups(pageIdentity);
  return backups[0] ?? null;
}

export async function findBackup(pageIdentity, backupId) {
  if (typeof backupId !== 'string' || !backupId) return null;
  const backups = await loadBackups(pageIdentity);
  return backups.find(entry => entry.backupId === backupId) ?? null;
}

/** Persist a snapshot, keeping the newest `limit` entries. Returns saved backup + list. */
export async function saveBackup(backup, { limit = BACKUP_LIMIT } = {}) {
  const normalized = normalizeBackup(backup);
  const max = Number.isInteger(limit) && limit > 0 ? limit : BACKUP_LIMIT;
  const existing = await loadBackups(normalized.pageIdentity);
  const deduped = existing.filter(entry => entry.backupId !== normalized.backupId);
  const backups = [normalized, ...deduped].slice(0, max);
  await getArea().set({ [backupStorageKey(normalized.pageIdentity)]: backups });
  return { backup: normalized, backups };
}

export async function loadPagePlan(pageIdentity) {
  const key = planStorageKey(pageIdentity);
  const stored = await readMany(key);
  return stored?.[key] ?? null;
}

export async function savePagePlan(pageIdentity, plan) {
  if (!plan || typeof plan !== 'object') throw new TypeError('plan must be an object');
  const record = { plan, savedAt: new Date().toISOString() };
  await getArea().set({ [planStorageKey(pageIdentity)]: record });
  return record;
}

export async function loadPageResult(pageIdentity) {
  const key = resultStorageKey(pageIdentity);
  const stored = await readMany(key);
  return stored?.[key] ?? null;
}

export async function savePageResult(pageIdentity, result) {
  if (!result || typeof result !== 'object') throw new TypeError('result must be an object');
  const record = { ...result, savedAt: result.savedAt ?? new Date().toISOString() };
  await getArea().set({ [resultStorageKey(pageIdentity)]: record });
  return record;
}

/** Everything the side panel needs to restore a review session for a page. */
export async function loadPageRunState(pageIdentity) {
  const backups = await loadBackups(pageIdentity);
  const [planRecord, resultRecord] = await Promise.all([loadPagePlan(pageIdentity), loadPageResult(pageIdentity)]);
  return {
    backups,
    latestBackup: backups[0] ?? null,
    plan: planRecord?.plan ?? null,
    planSavedAt: planRecord?.savedAt ?? null,
    result: resultRecord ?? null
  };
}
