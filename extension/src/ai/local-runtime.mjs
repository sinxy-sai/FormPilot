import { loadModelConfig } from './model-config.mjs';
import { createLogger } from '../core/logger.mjs';
const log = createLogger('local-runtime');
export function createBrowserLocalRuntime({ config, consented=false, WorkerCtor=globalThis.Worker }={}) {
  const modelConfig=loadModelConfig(config); let worker; let sequence=0; const pending=new Map();
  const unavailable=async()=>({status:'abstain',reason:modelConfig.status==='invalid'?'invalid-config':consented?'unavailable':'download-not-consented'});
  const ensure=()=>{ if(modelConfig.status!=='ready'||!consented||typeof WorkerCtor!=='function') { log.warn('model-unavailable', { status:modelConfig.status, reason:modelConfig.reason, consented, workerAvailable:typeof WorkerCtor==='function', modelId:modelConfig.modelId, backend:modelConfig.backend }); return null; } try { worker ??= new WorkerCtor('src/ai/model-worker.mjs',{type:'module'}); } catch (error) { worker=undefined; log.error('worker-create-failed', { modelId:modelConfig.modelId, backend:modelConfig.backend, name:String(error?.name||'Error'), message:String(error?.message||error), stack:String(error?.stack||'').slice(0,2000) }); return null; } worker.onerror=event=>{ log.error('worker-error', { message:String(event?.message||'worker-error'), filename:String(event?.filename||''), lineno:event?.lineno, colno:event?.colno }); for(const p of pending.values()) p.resolve({status:'abstain',reason:'worker-error'}); pending.clear(); }; worker.onmessage=event=>{const p=pending.get(event.data?.id);if(p){pending.delete(event.data.id);p.resolve(event.data.result)}}; log.info('worker-ready', { modelId:modelConfig.modelId, backend:modelConfig.backend }); return worker; };
  async function generate(input, options={}) { const w=ensure(); if(!w)return unavailable(); const id=`local-${++sequence}`; return new Promise(resolve=>{pending.set(id,{resolve}); const cancel=()=>{w.postMessage({type:'cancel',id}); pending.delete(id); resolve({status:'abstain',reason:'cancelled'})}; options.signal?.addEventListener('abort',cancel,{once:true}); w.postMessage({type:'generate',id,input,config:modelConfig,timeoutMs:options.timeoutMs}); }); }
  return Object.freeze({ generate, get enabled(){return Boolean(ensure())}, dispose(){worker?.terminate?.();worker=undefined;pending.clear()} });
}


