import { createTransformersProvider } from './transformers-provider.mjs';
import { createDefaultTransformersRuntime } from './transformers-runtime.mjs';
import { createQwenProvider } from './qwen-provider.mjs';
import { createDefaultQwenRuntime } from './qwen-runtime.mjs';
let provider; const pending=new Map();
export function createModelProvider(config, options = {}) {
  if (config?.kind === 'qwen') return createQwenProvider({ config, consented: config.downloadConsent === true, runtimeFactory: options.runtimeFactory ?? createDefaultQwenRuntime, timeoutMs: options.timeoutMs });
  return createTransformersProvider({ config, runtimeFactory: options.runtimeFactory ?? createDefaultTransformersRuntime, timeoutMs: options.timeoutMs });
}
export async function handleModelMessage(data,postMessage,options={}){if(data?.type==='cancel'){pending.get(data.id)?.controller.abort();return}if(data?.type!=='generate')return;if(pending.has(data.id)){postMessage({id:data.id,result:{status:'abstain',reason:'duplicate-request'}});return}provider??=options.provider??createModelProvider(options.config??data.config,{runtimeFactory:options.runtimeFactory,timeoutMs:data.timeoutMs??10000});const controller=new AbortController();const token=Symbol(data.id);pending.set(data.id,{controller,token});try{const result=await provider.generate(data.input,{signal:controller.signal,timeoutMs:data.timeoutMs});postMessage({id:data.id,result})}catch(error){postMessage({id:data.id,result:{status:'abstain',reason:controller.signal.aborted?'cancelled':'provider-error'}})}finally{if(pending.get(data.id)?.token===token)pending.delete(data.id)}}
if(typeof self!=='undefined')self.onmessage=e=>handleModelMessage(e.data,v=>self.postMessage(v)).catch(()=>self.postMessage({id:e.data?.id,result:{status:'abstain',reason:'provider-error'}}));
