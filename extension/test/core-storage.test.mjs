import test from 'node:test';
import assert from 'node:assert/strict';
import { setStorageArea, loadTask, saveTask, invalidateTask, taskStorageKey } from '../src/core/storage.mjs';

test('stores tasks by tab and invalidates without deleting', async () => {
  const data = new Map();
  const area = { async get(key) { return data.has(key) ? { [key]: data.get(key) } : {}; }, async set(obj) { for (const [k, v] of Object.entries(obj)) data.set(k, v); } };
  setStorageArea(area);
  const task = { tabId: 12, url: 'https://example.test', status: 'pending-review', updatedAt: '2026-01-01T00:00:00.000Z' };
  await saveTask(task);
  assert.deepEqual(await loadTask(12), task);
  assert.equal(await loadTask(13), null);
  await invalidateTask(12, 'url-changed');
  const invalidated = await loadTask(12);
  assert.equal(invalidated.status, 'invalidated');
  assert.equal(invalidated.invalidatedReason, 'url-changed');
  assert.ok(data.has(taskStorageKey(12)));
});

test('requires a task tab id', async () => {
  await assert.rejects(() => saveTask({}), /tabId/);
  await assert.rejects(() => loadTask('12'), /tabId/);
});
