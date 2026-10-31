const SUPPORTED = new Set(['text', 'textarea', 'checkbox', 'native-select', 'custom-select', 'date', 'manual']);
function inferControlType(raw = {}) {
  if (raw.disabled || raw.readonly || raw.readOnly || raw.type === 'file') return 'manual';
  if (raw.controlType === 'select') return 'native-select';
  if (raw.controlType === 'combobox') return 'custom-select';
  if (raw.controlType && SUPPORTED.has(raw.controlType)) return raw.controlType;
  if (raw.controlType) return 'manual';
  const tag = String(raw.tagName || '').toLowerCase();
  if (raw.type === 'checkbox' || (tag === 'input' && raw.inputType === 'checkbox')) return 'checkbox';
  if (tag === 'textarea') return 'textarea';
  if (tag === 'select') return 'native-select';
  if (raw.role === 'combobox' || raw.type === 'combobox') return 'custom-select';
  if (raw.type === 'date') return 'date';
  if (raw.type === 'text' || !raw.type) return 'text';
  return 'manual';
}
export function createFieldDescriptor(raw = {}) {
  if (!raw || typeof raw !== 'object') throw new TypeError('field must be an object');
  const controlType = inferControlType(raw);
  const options = Array.isArray(raw.options) ? raw.options.filter(option => typeof option === 'string') : undefined;
  return { ...raw, id: raw.id ?? raw.fieldId ?? raw.name ?? null, controlType, ...(options ? { options } : {}) };
}
const sensitivePattern = /(?:ident|身份证|证件|passport|phone|mobile|tel|email|邮箱|电话)/i;
export function isSensitiveField(field = {}) { return [field.id, field.name, field.fieldKey, field.label].filter(Boolean).some(value => sensitivePattern.test(String(value))); }
function foldText(value) { return String(value ?? '').normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase(); }
export function compareFieldValue(field, expected, actual) {
  const type = field?.controlType;
  if (type === 'checkbox') return { verified: typeof expected === 'boolean' && typeof actual === 'boolean' && expected === actual, ...(typeof expected !== 'boolean' || typeof actual !== 'boolean' ? { reason: 'checkbox-boolean-required' } : {}) };
  if (type === 'native-select' || type === 'custom-select') return { verified: typeof expected === 'string' && typeof actual === 'string' && expected === actual, ...(typeof expected !== 'string' || typeof actual !== 'string' ? { reason: 'option-string-required' } : {}) };
  if (isSensitiveField(field)) return { verified: Object.is(expected, actual), ...(!Object.is(expected, actual) ? { reason: 'sensitive-value-mismatch' } : {}) };
  const verified = foldText(expected) === foldText(actual);
  return { verified, ...(verified ? {} : { reason: 'value-mismatch' }) };
}
export { SUPPORTED };

