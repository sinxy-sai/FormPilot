import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'vite';
const root=resolve(import.meta.dirname,'..'); const out=resolve(root,'dist/extension'); await mkdir(resolve(out,'src'),{recursive:true});
await build({configFile:false,root,build:{outDir:out,emptyOutDir:true,lib:{entry:resolve(root,'extension/src/content-entry.mjs'),formats:['iife'],name:'FormPilotContent',fileName:()=> 'src/content.js'},rollupOptions:{output:{entryFileNames:'src/content.js',inlineDynamicImports:true}}}});
for(const dir of ['assets','locales']) await cp(resolve(root,'extension',dir),resolve(out,dir),{recursive:true});
for(const file of ['popup.html','popup.css','popup.js','sidepanel.html','sidepanel.css']) await cp(resolve(root,'extension',file),resolve(out,file));
for(const file of ['background.js','sidepanel.js']) await cp(resolve(root,'extension/src',file),resolve(out,'src',file));
await cp(resolve(root,'extension/src/ai/model-worker.mjs'),resolve(out,'src/ai/model-worker.mjs'));
const manifest=JSON.parse(await readFile(resolve(root,'extension/manifest.json'),'utf8')); manifest.content_scripts=manifest.content_scripts.map(e=>({...e,js:['src/content.js']})); manifest.background.service_worker='src/background.js'; await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest));
for(const p of ['side_panel.default_path']) { const value=manifest.side_panel?.default_path; if(value && !(await import('node:fs')).existsSync(resolve(out,value))) throw new Error(`missing ${p}`); }
const bundle=await readFile(resolve(out,'src/content.js'),'utf8'); if(/^\s*import\s/m.test(bundle)) throw new Error('content bundle contains top-level import'); console.log(`Built extension to ${out}`);
