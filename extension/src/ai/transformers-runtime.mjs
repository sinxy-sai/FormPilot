/** Lazy Transformers.js BGE embedding runtime. */
export async function createTransformersRuntime(config, { importTransformers = () => import('@huggingface/transformers') } = {}) {
  const { pipeline, env } = await importTransformers();
  if (typeof pipeline !== 'function') throw new Error('transformers-pipeline-unavailable');
  env.allowRemoteModels = config.allowNetwork === true;
  env.allowLocalModels = true;
  let extractor;
  const load = async () => { extractor ??= await pipeline('feature-extraction', config.modelId, { dtype: config.dtype, device: config.backend, revision: config.revision }); return extractor; };
  const asRows = value => {
    if (Array.isArray(value)) return value;
    if (value?.tolist) return value.tolist();
    if (value?.data && value?.dims?.length === 3) { const [b, s, h] = value.dims; return Array.from({ length: b }, (_, bi) => Array.from({ length: h }, (_, hi) => { let sum=0; for(let si=0;si<s;si++) sum += value.data[(bi*s+si)*h+hi]; return sum/s; })); }
    throw new Error('unexpected-embedding-output');
  };
  const normalize = row => { const norm = Math.hypot(...row); return norm ? row.map(x => x / norm) : row.map(() => 0); };
  const embed = async (texts, { signal } = {}) => { if (signal?.aborted) throw new Error('cancelled'); const input = Array.isArray(texts) ? texts : [texts]; if (!input.every(text => typeof text === 'string')) throw new TypeError('embedding-input-must-be-string'); const output = await (await load())(input, { pooling: 'mean', normalize: false }); if (signal?.aborted) throw new Error('cancelled'); return asRows(output).map(normalize); };
  return Object.freeze({ embed, async generate() { return { status:'abstain', reason:'embedding-only-model' }; }, async dispose() { extractor=undefined; } });
}
export const createDefaultTransformersRuntime = createTransformersRuntime;
