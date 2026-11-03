import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const fixture = await readFile(resolve(root, 'examples/form-fixture.html'), 'utf8');
function serve() { const server = createServer((req, res) => { if (new URL(req.url, 'http://127.0.0.1').pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(fixture); } else { res.writeHead(404); res.end(); } }); return new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => ok(server)); }); }

async function main() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (error) { console.log(`SKIP (unavailable): ${error.message}`); return; }
  const server = await serve(); const port = server.address().port; const source = resolve(root, 'dist/extension'); const extension = await mkdtemp(resolve(tmpdir(), 'formpilot-extension-')); await cp(source, extension, { recursive: true }); let context;
  try {
    const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8')); manifest.host_permissions = ['http://127.0.0.1/*']; await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));
    context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 10000 }); assert.ok(worker); const extensionId = new URL(worker.url()).host;
    const page = await context.newPage(); await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(500); assert.ok(await page.locator('input,textarea,select').count());
    const panel = await context.newPage(); await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`); const tabs = await panel.evaluate(() => chrome.tabs.query({})); const tabId = tabs.find(tab => tab.url?.startsWith('http://127.0.0.1:'))?.id; assert.ok(Number.isInteger(tabId));
    const resume = { profile: { basics: { name: '林知远', email: 'linzhiyuan@example.com' } } }; const started = await panel.evaluate(({ tabId, resume }) => chrome.runtime.sendMessage({ type: 'runtime/start', tabId, resume }), { tabId, resume }); assert.equal(started.status, 'running');
    const stepped = await panel.evaluate(tabId => chrome.runtime.sendMessage({ type: 'runtime/step', tabId }), tabId); assert.ok(['pending', 'manual', 'completed'].includes(stepped.runtime?.status || stepped.status)); assert.equal(await page.evaluate(() => window.__finalSubmitClicked === true), false);
    const stopped = await panel.evaluate(tabId => chrome.runtime.sendMessage({ type: 'runtime/stop', tabId }), tabId); assert.equal(stopped.status, 'stopped'); console.log('PASS: Playwright extension service worker attached; runtime start -> step -> stop; submit untouched');
  } finally { await context?.close(); await new Promise(ok => server.close(ok)); await rm(extension, { recursive: true, force: true }); }
}
await main();
