import { strict as assert } from 'node:assert';
import { createServer } from 'vite';
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const modelConfig = {
  modelId: 'Xenova/bge-small-zh-v1.5',
  revision: '75c43b069aac4d136ba6bc1122f995fedcfd2781',
  dtype: 'q8',
  backend: 'webgpu',
  allowNetwork: true,
};

let server;
let browser;
try {
  server = await createServer({ root, server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  await server.listen();
  const address = server.httpServer.address();
  const base = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: false, args: ['--enable-unsafe-webgpu'] });
  const page = await browser.newPage();
  await page.goto(`${base}/extension/test/webgpu-harness.html`);
  const info = await page.evaluate(async (config) => {
    const browserInfo = { userAgent: navigator.userAgent, platform: navigator.platform };
    if (!navigator.gpu) return { browserInfo, available: false };
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) return { browserInfo, available: false, adapter: null };
    const result = { browserInfo, available: true, adapter: { features: [...adapter.features] } };
    try {
      const { createTransformersRuntime } = await import('/extension/src/ai/transformers-runtime.mjs');
      const runtime = await createTransformersRuntime(config);
      const started = performance.now();
      const vectors = await runtime.embed(['毕业院校', '教育经历.学校']);
      result.model = { ok: true, latencyMs: Math.round((performance.now() - started) * 100) / 100, dimensions: vectors.map((row) => row.length) };
      await runtime.dispose();
    } catch (error) {
      result.model = { ok: false, error: String(error?.stack || error) };
    }
    return result;
  }, modelConfig);
  console.log(JSON.stringify({ browserVersion: await browser.version(), ...info }, null, 2));
  if (!info.available) {
    console.log('SKIP (unavailable): navigator.gpu/requestAdapter unavailable');
  } else {
    if (info.model?.ok) {
      assert.deepEqual(info.model.dimensions, [512, 512]);
      console.log('PASS: WebGPU adapter and BGE embedding verified');
    } else {
      console.log(`FAIL (model): ${info.model?.error || 'unknown model failure'}`);
      process.exitCode = 1;
    }
  }
} catch (error) {
  if (/Executable doesn't exist|browserType\.launch|Failed to launch|Missing X server|No usable sandbox|cannot open display|display/i.test(String(error?.message))) {
    console.log(`SKIP (unavailable): ${error.message}`);
  } else {
    throw error;
  }
} finally {
  await browser?.close();
  await server?.close();
}

