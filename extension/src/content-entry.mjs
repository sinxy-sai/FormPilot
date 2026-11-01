import { inspectControls, executeFillPlan, undoLastFill } from './runtime/control-executor.mjs';
import { adapterFor } from './adapters/index.js';

export function convertLegacyFields(fields = []) { return fields.filter((item) => item?.confidence !== 0 && item?.value != null).map((item) => { const field = item.field || item; const selector = item.selector ?? field.selector; const controlType = item.controlType ?? field.controlType ?? field.type; const type = item.type || (controlType === 'checkbox' ? 'checkbox' : controlType === 'native-select' || controlType === 'select' ? 'native-select' : controlType === 'custom-select' || controlType === 'combobox' ? 'custom-select' : controlType === 'textarea' ? 'textarea' : controlType === 'date' ? 'date' : 'text'); return { selector, action: { type, ...(type === 'checkbox' ? { checked: Boolean(item.value) } : type === 'custom-select' ? { optionText: String(item.value) } : { value: String(item.value) }) } }; }); }

const pageFingerprint = (fields) => { let h=2166136261; for (const c of JSON.stringify(fields.map(({selector,label,section,fieldKey,controlType,type})=>({selector,label,section,fieldKey,controlType,type})))) { h ^= c.charCodeAt(0); h=Math.imul(h,16777619); } return `page-${(h>>>0).toString(16)}`; };
const documentId = globalThis.__formPilotDocumentId || (globalThis.__formPilotDocumentId = `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`);
if (typeof chrome !== 'undefined' && chrome.runtime && !globalThis.__formPilotContentLoaded) {
  globalThis.__formPilotContentLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const adapter = adapterFor(globalThis.location);
    if (message?.type === 'inspect-page' || message?.type === 'inspect-form') { const fields = inspectControls(document, adapter); sendResponse(message.type === 'inspect-form' ? { runtimeVersion: '0.2.2', documentId, pageFingerprint: pageFingerprint(fields), frameId: _sender?.frameId ?? 0, url: globalThis.location?.href || '', site: adapter?.name || 'generic', fields, editorsOpened: 0 } : { fields, items: fields.map((field) => ({ status: 'ready', reason: null, actual: field.value, field })) }); return true; }
    if (message?.type === 'execute-plan') { executeFillPlan(document, message.plan || [], adapter).then((result) => sendResponse(result)); return true; }
    if (message?.type === 'fill-fields') { executeFillPlan(document, convertLegacyFields(message.fields || []), adapter).then((result) => sendResponse({ filled: result.filled, verified: result.verified, skipped: result.skipped, results: result.results })); return true; }
    if (message?.type === 'undo-last-fill') { sendResponse(undoLastFill(document)); return true; }
    if (message?.type === 'undo-fill') { sendResponse(undoLastFill(document)); return true; }
  });
}
export { inspectControls, executeFillPlan, undoLastFill };
