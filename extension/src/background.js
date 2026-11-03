import { createTaskSnapshot } from './core/models.mjs';
import { createBrowserLocalRuntime } from './ai/local-runtime.mjs';
import { loadTask, saveTask, invalidateTask } from './core/storage.mjs';
import { createRuntimeContext, runNextStep } from './runtime/orchestrator.mjs';

const runtimes = new Map();
const memory = new Map();
let localRuntime;
let localRuntimeKey;

const write = async task => { memory.set(task.tabId, task); try { await saveTask(task); } catch {} return task; };
async function send(tabId, message, frameId) { const options = Number.isInteger(frameId) ? { frameId } : undefined; return options ? chrome.tabs.sendMessage(tabId, message, options) : chrome.tabs.sendMessage(tabId, message); }

async function startRuntime(message, sender) {
  const tabId = message.tabId ?? sender?.tab?.id;
  if (!Number.isInteger(tabId)) throw new Error('tabId required');
  const task = await write(createTaskSnapshot({ tabId, frameId: message.frameId ?? sender?.frameId ?? 0, documentId: message.documentId, url: message.url ?? sender?.tab?.url ?? '', pageFingerprint: message.pageFingerprint, resumeRevision: message.resumeRevision }));
  const config = message.config ?? null;
  const configKey = JSON.stringify({ config, consented: message.consented === true });
  if (localRuntimeKey !== configKey) { localRuntime?.dispose?.(); localRuntime = createBrowserLocalRuntime({ config, consented: message.consented === true }); localRuntimeKey = configKey; }
  const context = createRuntimeContext({ resume: message.resume ?? {}, pageModel: message.pageModel ?? {}, task, provider: { generate: (input, options) => localRuntime.generate(input, options) } });
  context.inspect = async () => send(tabId, { type: 'inspect-page' }, task.frameId);
  context.execute = async action => send(tabId, { type: 'execute-tool', action, pageFingerprint: context.pageModel?.fingerprint }, task.frameId);
  runtimes.set(tabId, context);
  return write({ ...task, status: 'running' });
}

async function stepRuntime(message, sender) { const tabId = message.tabId ?? sender?.tab?.id; const context = runtimes.get(tabId); if (!context) throw new Error('runtime not started'); const result = await runNextStep(context); return write({ ...context.task, runtime: result }); }
async function stopRuntime(message, sender) { const tabId = message.tabId ?? sender?.tab?.id; const context = runtimes.get(tabId); runtimes.delete(tabId); if (!context) return null; return write({ ...context.task, status: 'stopped' }); }
export async function handleMessage(message, sender = {}) { switch (message?.type) { case 'runtime/start': return startRuntime(message, sender); case 'runtime/step': return stepRuntime(message, sender); case 'runtime/stop': return stopRuntime(message, sender); default: return null; } }
if (globalThis.chrome?.runtime?.onMessage) chrome.runtime.onMessage.addListener((message, sender, respond) => { handleMessage(message, sender).then(respond).catch(error => respond({ error: error.message })); return true; });
if (globalThis.chrome?.tabs?.onUpdated) chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.url || change.status === 'loading') invalidateTask(tabId, change.url ? 'url-changed' : 'navigation').catch(() => {}); });
