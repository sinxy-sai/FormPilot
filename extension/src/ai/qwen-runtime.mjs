/** Optional Qwen text-generation runtime. It receives metadata only; values are read locally after validation. */
export async function createQwenRuntime(config, { importTransformers = () => import('@huggingface/transformers') } = {}) {
  const { pipeline, env } = await importTransformers();
  if (typeof pipeline !== 'function') throw new Error('transformers-pipeline-unavailable');
  env.allowRemoteModels = config.allowNetwork === true;
  env.allowLocalModels = true;
  let generator;
  const bundledUrl = new URL('../../models/qwen2.5-0.5b', import.meta.url);
  const localPath = bundledUrl.pathname.replace(/^\/([A-Za-z]:)/, '$1');
  const modelId = config.modelId === 'bundled:qwen2.5-0.5b' ? (globalThis.location?.protocol === 'chrome-extension:' ? bundledUrl.href : localPath) : config.modelId;
  const load = async () => { generator ??= await pipeline('text-generation', modelId, { dtype: config.dtype, device: config.backend, revision: config.revision, local_files_only: modelId.startsWith('chrome-extension:') }); return generator; };
  const generate = async (input, { signal } = {}) => {
    if (signal?.aborted) throw new Error('cancelled');
    const prompt = `You are the FormPilot local form planner. Return exactly one JSON object and no explanation. Choose at most one safe action for the current page. Allowed tools: type, check, select, ask_user, wait. For type use {"tool":"type","target":"control-id","arguments":{"value":"resume value"},"confidence":0.0}. Use only a controlId present in page.controls and a value copied from resume.candidates. If no safe high-confidence match exists, return {"tool":"ask_user","arguments":{"question":"..."},"confidence":0.0}. Never return selectors, scripts, submit, click, or arbitrary code. Input:\n${JSON.stringify(input)}`;
    const result = await (await load())(prompt, { max_new_tokens: 220, do_sample: false });
    if (signal?.aborted) throw new Error('cancelled');
    const raw = Array.isArray(result) ? (result[0]?.generated_text ?? result[0]?.text ?? '') : (result?.generated_text ?? result?.text ?? '');
    const text = Array.isArray(raw) ? String(raw.at(-1)?.content ?? raw.at(-1)?.text ?? '') : String(raw ?? '');
    if (typeof text !== 'string') throw new Error('unexpected-generation-output');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return { status:'abstain', reason:'invalid-json' };
    try { return JSON.parse(match[0]); } catch { return { status:'abstain', reason:'invalid-json' }; }
  };
  return Object.freeze({ generate, async dispose() { generator=undefined; } });
}
export const createDefaultQwenRuntime = createQwenRuntime;
