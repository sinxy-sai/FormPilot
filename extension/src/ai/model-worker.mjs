let cancelled = false;
self.onmessage = async ({ data }) => {
  if (data?.type === 'cancel') { cancelled = true; return; }
  if (data?.type !== 'generate') return;
  cancelled = false;
  self.postMessage({ id: data.id, result: { status: 'abstain', reason: cancelled ? 'cancelled' : 'unavailable' } });
};
