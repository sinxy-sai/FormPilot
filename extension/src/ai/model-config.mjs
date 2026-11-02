export const DEFAULT_MODEL_CONFIG = Object.freeze({ enabled:false, modelId:'Xenova/bge-small-zh-v1.5', revision:'75c43b069aac4d136ba6bc1122f995fedcfd2781', dtype:'q8', backend:'webgpu', license:'unknown', sizeBytes:null, evidence:'verified', allowNetwork:false, downloadConsent:false });
export const DEFAULT_QWEN_MODEL_CONFIG = Object.freeze({ enabled:false, modelId:'', revision:'unverified', dtype:'q4', backend:'wasm', license:'unknown', sizeBytes:null, evidence:'unverified', allowNetwork:false, downloadConsent:false });
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function loadModelConfig(source=DEFAULT_MODEL_CONFIG) { let value=source; if(typeof source==='string'){try{value=JSON.parse(source)}catch{return {...DEFAULT_MODEL_CONFIG,status:'invalid',reason:'invalid-json'}}} if(!record(value)) return {...DEFAULT_MODEL_CONFIG,status:'invalid',reason:'invalid-config'}; const config={...DEFAULT_MODEL_CONFIG,...value}; if(typeof config.modelId!=='string'||!config.modelId||typeof config.revision!=='string'||!config.revision) return {...DEFAULT_MODEL_CONFIG,status:'invalid',reason:'invalid-model-identity'}; if(!['webgpu','wasm'].includes(config.backend)||typeof config.enabled!=='boolean'||typeof config.allowNetwork!=='boolean'||typeof config.downloadConsent!=='boolean') return {...DEFAULT_MODEL_CONFIG,status:'invalid',reason:'invalid-runtime-options'}; if(config.enabled&&(config.revision==='unverified'||config.evidence!=='verified'||config.allowNetwork!==true)) return {...config,enabled:false,status:'unavailable',reason:'model-evidence-required'}; return {...config,status:config.enabled?'ready':'unavailable',reason:config.enabled?undefined:'disabled'}; }

export function loadQwenModelConfig(source=DEFAULT_QWEN_MODEL_CONFIG) {
  let value=source;
  if(typeof source==='string'){try{value=JSON.parse(source)}catch{return {...DEFAULT_QWEN_MODEL_CONFIG,status:'invalid',reason:'invalid-json'}}}
  if(!record(value)) return {...DEFAULT_QWEN_MODEL_CONFIG,status:'invalid',reason:'invalid-config'};
  const config={...DEFAULT_QWEN_MODEL_CONFIG,...value};
  if(typeof config.modelId!=='string'||!config.modelId||typeof config.revision!=='string'||!config.revision) return {...config,status:'unavailable',reason:'model-evidence-required'};
  if(!['webgpu','wasm'].includes(config.backend)||typeof config.enabled!=='boolean'||typeof config.allowNetwork!=='boolean'||typeof config.downloadConsent!=='boolean') return {...config,status:'invalid',reason:'invalid-runtime-options'};
  if(config.enabled&&(config.revision==='unverified'||config.evidence!=='verified'||config.allowNetwork!==true||config.downloadConsent!==true)) return {...config,enabled:false,status:'unavailable',reason:'model-evidence-required'};
  return {...config,status:config.enabled?'ready':'unavailable',reason:config.enabled?undefined:'disabled'};
}
