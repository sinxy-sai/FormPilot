import { createLocalModelProvider } from './provider.mjs';
import { loadQwenModelConfig } from './model-config.mjs';
import { createLogger } from '../core/logger.mjs';

const log = createLogger('qwen');
const errorInfo = error => ({ name: String(error?.name || 'Error'), message: String(error?.message || error || 'unknown'), stack: String(error?.stack || '').slice(0, 2000) });

export function createQwenProvider({ config, consented=false, runtimeFactory, timeoutMs=10000 } = {}) {
  const modelConfig = loadQwenModelConfig({ ...(config || {}), downloadConsent: config?.downloadConsent === true || consented === true });
  if (modelConfig.status !== 'ready' || typeof runtimeFactory !== 'function') return Object.freeze({ async generate() { return { status:'abstain', reason:modelConfig.reason === 'model-evidence-required' ? 'unavailable' : 'disabled' }; }, config:modelConfig });
  let loading;
  const load = async () => { loading ??= Promise.resolve().then(() => runtimeFactory(modelConfig)); return loading; };
  const generate = async (input, options={}) => { let runtime; try { runtime=await load(); } catch (error) { loading=undefined; log.error('model-load-failed', { stage:'runtimeFactory', modelId:modelConfig.modelId, revision:modelConfig.revision, backend:modelConfig.backend, dtype:modelConfig.dtype, ...errorInfo(error) }); return {status:'abstain',reason:'load-failed'}; } if(typeof runtime?.generate!=='function') { log.error('model-runtime-invalid', { stage:'runtimeFactory', modelId:modelConfig.modelId }); return {status:'abstain',reason:'unavailable'}; } try { return await runtime.generate(input, options); } catch (error) { log.error('model-generate-failed', { stage:'generate', modelId:modelConfig.modelId, backend:modelConfig.backend, ...errorInfo(error) }); return {status:'abstain',reason:'provider-error'}; } };
  const wrapped=createLocalModelProvider({generate,timeoutMs});
  return Object.freeze({...wrapped, config:modelConfig, async dispose(){const runtime=loading&&await loading.catch(()=>null); await runtime?.dispose?.(); loading=undefined;}});
}
