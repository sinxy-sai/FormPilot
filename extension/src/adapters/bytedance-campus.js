import { createAdapter } from './base.js';

const isByteDanceCampus = (location) => /(^|\.)jobs\.bytedance\.com$/.test(location.hostname) && location.pathname.startsWith('/campus/');

export const bytedanceCampusAdapter = createAdapter({
  name: 'bytedance-campus',
  matches: isByteDanceCampus,
  inspect: (document) => [...document.querySelectorAll('input, textarea, select, [role="combobox"]')].map((field, index) => ({ index, selector: field.id ? `#${field.id}` : field.name ? `${field.tagName.toLowerCase()}[name="${field.name}"]` : `[data-formpilot-index="${index}"]`, label: field.labels?.[0]?.textContent?.trim() || field.getAttribute('aria-label') || field.getAttribute('placeholder') || field.name || '', controlType: field.type === 'checkbox' ? 'checkbox' : field.tagName.toLowerCase() === 'select' ? 'native-select' : field.getAttribute('role') === 'combobox' ? 'custom-select' : 'text', value: field.type === 'checkbox' ? Boolean(field.checked) : field.value || '', visible: true })),
  fill: (field, value) => ({ field, value, mode: field.controlType === 'combobox' ? 'select-option' : 'native-value' }),
  verify: (field, expected) => String(field.value ?? '') === String(expected ?? ''),
});
