import { bytedanceCampusAdapter } from './bytedance-campus.js';
import { capabilityFromAdapter } from './capabilities.mjs';

export const adapters = [bytedanceCampusAdapter];
export const adapterCapabilities = adapters.map(capabilityFromAdapter);

export function adapterFor(location) {
  return adapters.find((adapter) => adapter.matches(location)) || null;
}
