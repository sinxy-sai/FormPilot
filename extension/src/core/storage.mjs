const TASK_PREFIX = 'formpilot.task.';
const STRATEGY_PREFIX = 'formpilot.strategy.';
const STRATEGY_INDEX_KEY = 'formpilot.strategy.index';
let injectedStorageArea;

function getArea() {
  if (injectedStorageArea) return injectedStorageArea;
  if (globalThis.chrome?.storage?.local) return globalThis.chrome.storage.local;
  throw new Error('chrome.storage.local is unavailable; inject a storageArea in tests');
}
export const taskStorageKey = tabId => `${TASK_PREFIX}${tabId}`;
export const strategyStorageKey = id => `${STRATEGY_PREFIX}${id}`;
export { STRATEGY_INDEX_KEY };
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
