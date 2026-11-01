export function createLocalModelProvider({ generate, timeoutMs = 5000 } = {}) {
  if (typeof generate !== 'function') return unavailableProvider;
  return { async generate(input, options = {}) {
    const controller = new AbortController();
    const timeout = options.timeoutMs ?? timeoutMs;
    const callerSignal = options.signal;
    let timer;
    let settled = false;
    let removeAbort = () => {};
    const task = Promise.resolve().then(() => generate(input, { ...options, signal: controller.signal }));
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => { controller.abort('timeout'); reject(Object.assign(new Error('timeout'), { code:'timeout' })); }, timeout); });
    const cancellation = new Promise((_, reject) => {
      if (!callerSignal) return;
      const cancel = () => { controller.abort('cancelled'); reject(Object.assign(new Error('cancelled'), { code:'cancelled' })); };
      if (callerSignal.aborted) cancel();
      else { callerSignal.addEventListener('abort', cancel, { once:true }); removeAbort = () => callerSignal.removeEventListener('abort', cancel); }
    });
    try { return await Promise.race([task, deadline, cancellation]); }
    catch (error) { return { status:'abstain', reason: error?.code === 'timeout' ? 'timeout' : error?.code === 'cancelled' || callerSignal?.aborted || error?.message === 'cancel' ? 'cancelled' : 'provider-error' }; }
    finally { settled = true; clearTimeout(timer); removeAbort(); }
  } };
}
export const unavailableProvider = Object.freeze({ async generate() { return { status:'abstain', reason:'unavailable' }; }, async embed() { throw new Error('unavailable'); } });
