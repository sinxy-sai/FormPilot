import { SUPPORTED, createFieldDescriptor } from './field-model.mjs';
function manual(reason = 'manual-review-required') { return { type: 'manual', reason }; }
export function createFieldAction(fieldInput, proposal = {}) {
  const field = createFieldDescriptor(fieldInput);
  const value = proposal?.value;
  if (proposal?.status !== 'approved') return manual('proposal-not-approved');
  if (!SUPPORTED.has(field.controlType) || field.controlType === 'manual') return manual('unsupported-control');
  if (field.controlType === 'checkbox') return typeof value === 'boolean' ? { type: 'checkbox', checked: value } : manual('checkbox-boolean-required');
  if (field.controlType === 'native-select') return typeof value === 'string' && Array.isArray(field.options) && field.options.includes(value) ? { type: 'native-select', value } : manual(Array.isArray(field.options) ? 'option-not-found' : 'options-required');
  if (field.controlType === 'custom-select') return typeof value === 'string' && Array.isArray(field.options) && field.options.includes(value) ? { type: 'custom-select', optionText: value } : manual(Array.isArray(field.options) ? 'option-not-found' : 'options-required');
  if (field.controlType === 'text' || field.controlType === 'textarea' || field.controlType === 'date') return typeof value === 'string' ? { type: field.controlType, value } : manual('string-value-required');
  return manual('unsupported-control');
}
export function validateFieldAction(action, fieldInput) {
  const field = createFieldDescriptor(fieldInput);
  if (!action || typeof action !== 'object') return { valid: false, reason: 'invalid-action' };
  if (action.type === 'manual') return typeof action.reason === 'string' && action.reason.trim().length > 0 ? { valid: true } : { valid: false, reason: 'manual-reason-required' };
  if (action.type === 'checkbox') return field.controlType === 'checkbox' && typeof action.checked === 'boolean' ? { valid: true } : { valid: false, reason: 'checkbox-action-mismatch' };
  if (action.type === 'text' || action.type === 'textarea' || action.type === 'date') return field.controlType === action.type && typeof action.value === 'string' ? { valid: true } : { valid: false, reason: 'text-action-mismatch' };
  if (action.type === 'native-select') return field.controlType === 'native-select' && typeof action.value === 'string' && Array.isArray(field.options) && field.options.includes(action.value) ? { valid: true } : { valid: false, reason: 'native-select-action-mismatch' };
  if (action.type === 'custom-select') return field.controlType === 'custom-select' && typeof action.optionText === 'string' && Array.isArray(field.options) && field.options.includes(action.optionText) ? { valid: true } : { valid: false, reason: 'custom-select-action-mismatch' };
  return { valid: false, reason: 'unsupported-action' };
}
export { createFieldDescriptor };

