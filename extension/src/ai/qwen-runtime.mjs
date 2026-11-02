/** Optional Qwen text-generation runtime. It receives metadata only; values are read locally after validation. */
export async function createQwenRuntime(config, { importTransformers = () => import('@huggingface/transformers') } = {}) {
  const { pipeline, env } = await importTransformers();
  if (typeof pipeline !== 'function') throw new Error('transformers-pipeline-unavailable');
  env.allowRemoteModels = config.allowNetwork === true;
  env.allowLocalModels = true;
  let generator;
  const load = async () => { generator ??= await pipeline('text-generation', config.modelId, { dtype: config.dtype, device: config.backend, revision: config.revision }); return generator; };
  const generate = async (input, { signal } = {}) => {
    if (signal?.aborted) throw new Error('cancelled');
    const prompt = `Return one JSON object only. Select a candidateId or abstain.\n${JSON.stringify(input)}`;
    const result = await (await load())(prompt, { max_new_tokens: 160, do_sample: false });
    if (signal?.aborted) throw new Error('cancelled');
    const text = Array.isArray(result) ? (result[0]?.generated_text ?? result[0]?.text ?? '') : (result?.generated_text ?? result?.text ?? '');
    if (typeof text !== 'string') throw new Error('unexpected-generation-output');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { status:'abstain', reason:'invalid-json' };
    try { return JSON.parse(match[0]); } catch { return { status:'abstain', reason:'invalid-json' }; }
  };
  return Object.freeze({ generate, async dispose() { generator=undefined; } });
}
export const createDefaultQwenRuntime = createQwenRuntime;
