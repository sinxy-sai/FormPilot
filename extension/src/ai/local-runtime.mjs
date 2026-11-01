import { loadModelConfig } from './model-config.mjs';
export function createBrowserLocalRuntime({ config, consented=false, WorkerCtor=globalThis.Worker }={}) {
  const modelConfig=loadModelConfig(config); let worker; let sequence=0; const pending=new Map();
  const unavailable=async()=>({status:'abstain',reason:modelConfig.status==='invalid'?'invalid-config':consented?'unavailable':'download-not-consented'});
  const ensure=()=>{ if(modelConfig.status!=='ready'||!consented||typeof WorkerCtor!=='function') return null; try { worker ??= new WorkerCtor('src/ai/model-worker.mjs',{type:'module'}); } catch { worker=undefined; return null; } worker.onerror=()=>{ for(const p of pending.values()) p.resolve({status:'abstain',reason:'worker-error'}); pending.clear(); }; worker.onmessage=event=>{const p=pending.get(event.data?.id);if(p){pending.delete(event.data.id);p.resolve(event.data.result)}}; return worker; };
  async function generate(input, options={}) { const w=ensure(); if(!w)return unavailable(); const id=`local-${++sequence}`; return new Promise(resolve=>{pending.set(id,{resolve}); const cancel=()=>{w.postMessage({type:'cancel',id}); pending.delete(id); resolve({status:'abstain',reason:'cancelled'})}; options.signal?.addEventListener('abort',cancel,{once:true}); w.postMessage({type:'generate',id,input,config:modelConfig,timeoutMs:options.timeoutMs}); }); }
  return Object.freeze({ generate, get enabled(){return Boolean(ensure())}, dispose(){worker?.terminate?.();worker=undefined;pending.clear()} });
}


