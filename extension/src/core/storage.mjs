const TASK_PREFIX = 'formpilot.task.';
let injectedStorageArea;

function getArea() {
  if (injectedStorageArea) return injectedStorageArea;
  if (globalThis.chrome?.storage?.local) return globalThis.chrome.storage.local;
  throw new Error('chrome.storage.local is unavailable; inject a storageArea in tests');
}
export const taskStorageKey = tabId => `${TASK_PREFIX}${tabId}`;
export function setStorageArea(storageArea) { if (!storageArea || typeof storageArea.get !== 'function' || typeof storageArea.set !== 'function') throw new TypeError('storageArea must implement get and set'); injectedStorageArea = storageArea; }
function assertTabId(tabId) { if (!Number.isInteger(tabId)) throw new TypeError('tabId must be an integer'); }
export async function loadTask(tabId) { assertTabId(tabId); const result = await getArea().get(taskStorageKey(tabId)); return result?.[taskStorageKey(tabId)] ?? null; }
export async function saveTask(task) { if (!task || !Number.isInteger(task.tabId)) throw new TypeError('task.tabId is required'); await getArea().set({ [taskStorageKey(task.tabId)]: { ...task, updatedAt: task.updatedAt ?? new Date().toISOString() } }); }
export async function invalidateTask(tabId, reason) { assertTabId(tabId); const task = await loadTask(tabId); if (!task) return; await saveTask({ ...task, status: 'invalidated', invalidatedReason: String(reason ?? 'invalidated'), updatedAt: new Date().toISOString() }); }
