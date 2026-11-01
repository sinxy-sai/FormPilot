import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cp, mkdtemp, rm, readFile as readJsonFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const fixture = await readFile(resolve(root, 'examples/form-fixture.html'), 'utf8');
const resume = await readFile(resolve(root, 'examples/resume.json'), 'utf8');

function serve() {
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://127.0.0.1').pathname;
    if (path === '/resume.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(resume); return; }
    if (path === '/' || path === '/form-fixture.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(fixture); return; }
    res.writeHead(404); res.end('not found');
  });
  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveServer(server));
  });
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (error) {
    console.log(`SKIP (unavailable): Playwright is not installed (${error.code || error.message})`);
    return;
  }

  const server = await serve();
  const address = server.address();
  const base = `http://127.0.0.1:${address.port}`;
  const sourceExtensionPath = resolve(root, 'dist/extension');
  const extensionPath = await mkdtemp(resolve(tmpdir(), 'formpilot-extension-'));
  await cp(sourceExtensionPath, extensionPath, { recursive: true });
  const testManifest = JSON.parse(await readJsonFile(resolve(extensionPath, 'manifest.json'), 'utf8'));
  testManifest.host_permissions = [...new Set([...(testManifest.host_permissions || []), 'http://127.0.0.1/*'])];
  await writeFile(resolve(extensionPath, 'manifest.json'), JSON.stringify(testManifest));
  let context;
  try {
    // Chromium's MV3 service worker is not exposed by Playwright's headless
    // launch here; headed mode is required for the extension background worker.
    context = await chromium.launchPersistentContext('', {
      headless: false,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 10000 });
    const extensionId = new URL(worker.url()).host;
    const panelPage = await context.newPage();
    await panelPage.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    await panelPage.locator('#resume').setInputFiles({ name: 'resume.json', mimeType: 'application/json', buffer: Buffer.from(resume) });
    await panelPage.waitForFunction(() => document.querySelector('#status')?.textContent.includes('ready'));
    const fixturePage = await context.newPage();
    await fixturePage.goto(`${base}/form-fixture.html`);
    await fixturePage.bringToFront();
    const tabId = await worker.evaluate(async () => (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id);
    assert.ok(Number.isInteger(tabId), 'fixture tab should be available to the extension');

    const inspect = await panelPage.evaluate(async ({ tabId }) => chrome.runtime.sendMessage({ type: 'task/inspect', tabId }), { tabId });
    assert.equal(inspect.status, 'pending-review');
    assert.ok(inspect.fields.some((field) => field.name === 'fullName'), 'scan should find text fields');
    assert.ok(inspect.fields.some((field) => field.name === 'city'), 'scan should find native select');

    const byName = Object.fromEntries(inspect.fields.map((field) => [field.name, field]));
    const plan = [
      { field: byName.fullName, selector: byName.fullName.selector, value: '林知远', confidence: 0.99 },
      { field: byName.email, selector: byName.email.selector, value: 'linzhiyuan@example.com', confidence: 0.99 },
      { field: byName.city, selector: byName.city.selector, value: '北京', confidence: 0.99 },
      { field: byName.degree, selector: byName.degree.selector, value: '本科', confidence: 0.99 },
      { field: byName.consent, selector: byName.consent.selector, value: true, confidence: 0.99, status: 'manual' },
      { field: byName.city, selector: byName.city.selector, value: '不存在的选项', confidence: 0.99 },
    ];
    const resumeRevision = await panelPage.evaluate(async () => (await chrome.storage.local.get(['resumeRevision'])).resumeRevision);
    await panelPage.evaluate(async ({ tabId, inspected, plan, resumeRevision }) => chrome.runtime.sendMessage({ type: 'task/start', tabId, ...inspected, plan, resumeRevision }), { tabId, inspected: inspect, plan, resumeRevision });
    const approved = await panelPage.evaluate(async ({ tabId, plan }) => chrome.runtime.sendMessage({ type: 'task/approve', tabId, plan }), { tabId, plan });
    assert.equal(approved.status, 'approved');
    assert.equal(approved.plan.find((item) => item.field?.name === 'consent')?.status, 'manual', 'manual fields stay manual');

    const executed = await panelPage.evaluate(async ({ tabId, approvalToken, url, frameId, documentId, pageFingerprint }) => chrome.runtime.sendMessage({ type: 'task/execute', tabId, approvalToken, url, frameId, documentId, pageFingerprint }), { tabId, approvalToken: approved.approvalToken, url: approved.url, frameId: approved.frameId, documentId: approved.documentId, pageFingerprint: approved.pageFingerprint });
    assert.equal(executed.status, 'completed');
    assert.equal(await fixturePage.locator('#full-name').inputValue(), '林知远');
    assert.equal(await fixturePage.locator('#email').inputValue(), 'linzhiyuan@example.com');
    assert.equal(await fixturePage.locator('#city').inputValue(), 'beijing', 'valid native select survives an unknown option');
    assert.equal(await fixturePage.locator('#degree').inputValue(), 'bachelor', 'native select matches visible text');

    const undone = await panelPage.evaluate(async ({ tabId, url, frameId, documentId, pageFingerprint }) => chrome.runtime.sendMessage({ type: 'task/undo', tabId, url, frameId, documentId, pageFingerprint }), { tabId, url: approved.url, frameId: approved.frameId, documentId: approved.documentId, pageFingerprint: approved.pageFingerprint });
    assert.equal(undone.status, 'undone');
    assert.equal(await fixturePage.locator('#full-name').inputValue(), '', 'undo restores prior text');

    const stale = await panelPage.evaluate(async ({ tabId }) => chrome.runtime.sendMessage({ type: 'task/inspect', tabId }), { tabId });
    await fixturePage.goto(`${base}/form-fixture.html?navigation=2`);
    await fixturePage.bringToFront();
    const rejected = await panelPage.evaluate(async ({ tabId, plan }) => chrome.runtime.sendMessage({ type: 'task/approve', tabId, plan }), { tabId, plan: stale.plan || [] });
    assert.match(rejected.error || '', /stale|context|required|connection|receiving end/i, 'navigation invalidates the old task');
    console.log('PASS: scan -> review -> fill -> verify -> undo; unknown option, manual field, and navigation edge cases');
  } catch (error) {
    if (/Executable doesn't exist|browserType\.launch|Failed to launch|Missing X server|No usable sandbox|cannot open display|display/i.test(String(error?.message))) {
      console.log(`SKIP (unavailable): ${error.message}`);
      return;
    }
    throw error;
  } finally {
    await context?.close();
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(extensionPath, { recursive: true, force: true });
  }
}

await main();






