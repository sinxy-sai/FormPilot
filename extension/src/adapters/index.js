import { bytedanceCampusAdapter } from './bytedance-campus.js';

export const adapters = [bytedanceCampusAdapter];

export function adapterFor(location) {
  return adapters.find((adapter) => adapter.matches(location)) || null;
}
