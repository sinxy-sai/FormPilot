import { cp, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { build } from 'vite';
const root=resolve(import.meta.dirname,'..'); const out=resolve(root,'dist/extension'); await mkdir(resolve(out,'src'),{recursive:true});
await build({configFile:false,root,build:{outDir:out,emptyOutDir:true,lib:{entry:resolve(root,'extension/src/content-entry.mjs'),formats:['iife'],name:'FormPilotContent',fileName:()=> 'src/content.js'},rollupOptions:{output:{entryFileNames:'src/content.js',inlineDynamicImports:true}}}});
for(const dir of ['assets','locales']) await cp(resolve(root,'extension',dir),resolve(out,dir),{recursive:true});
for(const file of ['popup.html','popup.css','popup.js','sidepanel.html','sidepanel.css']) await cp(resolve(root,'extension',file),resolve(out,file));
for(const file of ['background.js','sidepanel.js']) await cp(resolve(root,'extension/src',file),resolve(out,'src',file));
for(const dir of ['core','ai']) await cp(resolve(root,'extension/src',dir),resolve(out,'src',dir),{recursive:true});
await cp(resolve(root,'extension/src/field-matcher.mjs'),resolve(out,'src/field-matcher.mjs'));
const manifest=JSON.parse(await readFile(resolve(root,'extension/manifest.json'),'utf8')); manifest.content_scripts=manifest.content_scripts.map(e=>({...e,js:['src/content.js']})); manifest.background.service_worker='src/background.js'; await writeFile(resolve(out,'manifest.json'),JSON.stringify(manifest));
const declared = new Set(['manifest.json']);
const walk = async dir => { for (const entry of await readdir(dir,{withFileTypes:true})) { const path=resolve(dir,entry.name); if(entry.isDirectory()) await walk(path); else declared.add(relative(out,path).replaceAll('\\','/')); } }; await walk(out);
for(const [kind,path] of [['side_panel.default_path',manifest.side_panel?.default_path],['background.service_worker',manifest.background?.service_worker]]) if(path && !declared.has(path)) throw new Error(`missing ${kind}: ${path}`);
for(const entry of manifest.content_scripts ?? []) for(const path of [...(entry.js??[]),...(entry.css??[])]) if(!declared.has(path)) throw new Error(`missing content resource: ${path}`);
for(const file of ['local-runtime.mjs','model-worker.mjs','transformers-provider.mjs','transformers-runtime.mjs','qwen-provider.mjs','qwen-runtime.mjs','model-config.mjs','provider.mjs']) { const source=await readFile(resolve(out,'src/ai',file),'utf8'); if(file==='model-worker.mjs' && !source.includes('./transformers-provider.mjs')) throw new Error('worker dependency missing'); if(file==='local-runtime.mjs' && !source.includes('./model-config.mjs')) throw new Error('runtime dependency missing'); }
const bundle=await readFile(resolve(out,'src/content.js'),'utf8'); if(/^\s*import\s/m.test(bundle)) throw new Error('content bundle contains top-level import'); console.log(`Built and checked extension at ${out}`);


