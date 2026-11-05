// 生成一个自包含的引擎 bundle（IIFE），挂到 window.__formPilotEngine。
// 用途：在真实页面的 DevTools/自动化环境里直接跑 inspect → plan → execute，
// 不依赖扩展消息通道（真机只读勘察与端到端验证用）。
//
// 运行：node scripts/build-engine-bundle.mjs
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { build } from 'vite';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'dist/live');
await mkdir(out, { recursive: true });

await build({
  configFile: false,
  root,
  logLevel: 'warn',
  build: {
    outDir: out,
    emptyOutDir: true,
    minify: false,
    target: 'esnext',
    lib: {
      entry: resolve(root, 'scripts/engine-entry.mjs'),
      formats: ['iife'],
      name: 'FormPilotEngine',
      fileName: () => 'engine.js'
    },
    rollupOptions: { output: { inlineDynamicImports: true } }
  }
});

console.log(`Built engine bundle at ${resolve(out, 'engine.js')}`);
