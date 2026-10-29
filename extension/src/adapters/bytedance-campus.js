import { createAdapter } from './base.js';

const isByteDanceCampus = (location) => /(^|\.)jobs\.bytedance\.com$/.test(location.hostname) && location.pathname.startsWith('/campus/');

export const bytedanceCampusAdapter = createAdapter({
  matches: isByteDanceCampus,
  inspect: (document) => document.querySelectorAll('input, textarea, select').length,
  fill: (field, value) => ({ field, value, mode: field.controlType === 'combobox' ? 'select-option' : 'native-value' }),
  verify: (field, expected) => String(field.value ?? '') === String(expected ?? ''),
});
