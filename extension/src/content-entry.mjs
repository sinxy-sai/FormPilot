<<<<<<< HEAD
import { inspectPage, inspectControls, executeFillPlan, executeTool, undoLastFill } from './runtime/control-executor.mjs';
import { verifyAction } from './runtime/result-verifier.mjs';
import { adapterFor } from './adapters/index.js';
import { fingerprintPageModel } from './core/page-model.mjs';
import { normalizePlannedAction } from './runtime/action-tools.mjs';
import { validatePlannedAction } from './runtime/action-guard.mjs';
import { capabilityFromAdapter } from './adapters/capabilities.mjs';

export function convertLegacyFields(fields = []) { return fields.filter((item) => item?.confidence !== 0 && item?.value != null).map((item) => { const field = item.field || item; const selector = item.selector ?? field.selector; const controlType = item.controlType ?? field.controlType ?? field.type; const type = item.type || (controlType === 'checkbox' ? 'checkbox' : controlType === 'native-select' || controlType === 'select' ? 'native-select' : controlType === 'custom-select' || controlType === 'combobox' ? 'custom-select' : controlType === 'textarea' ? 'textarea' : controlType === 'date' ? 'date' : 'text'); return { selector, action: { type, ...(type === 'checkbox' ? { checked: Boolean(item.value) } : type === 'custom-select' ? { optionText: String(item.value) } : { value: String(item.value) }) } }; }); }
const documentId = globalThis.__formPilotDocumentId || (globalThis.__formPilotDocumentId = `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`);
const openEditors = (adapter) => { if (typeof adapter?.activate === 'function') return Number(adapter.activate(document) || 0); let opened = 0; for (const button of document.querySelectorAll('button, a, [role="button"], [data-edit]')) { const visible = button.offsetParent !== null || button.getClientRects?.().length; if (visible && /编辑|edit/i.test(String(button.textContent || ''))) { button.click?.(); opened += 1; } } return opened; };
const inspectWithAdapter = (adapter) => inspectPage(document, { capabilities: adapter ? [capabilityFromAdapter(adapter)] : undefined });
if (typeof chrome !== 'undefined' && chrome.runtime && !globalThis.__formPilotContentLoaded) { globalThis.__formPilotContentLoaded = true; chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => { const adapter = adapterFor(globalThis.location); if (message?.type === 'inspect-page' || message?.type === 'inspect-form') { (async () => { const editorsOpened = openEditors(adapter); await new Promise((resolve) => setTimeout(resolve, 0)); const inspected = inspectWithAdapter(adapter); const fields = inspectControls(document, adapter); const pageModel = inspected.pageModel; sendResponse(message.type === 'inspect-form' ? { runtimeVersion: '0.2.2', documentId, pageModel, diagnostics: inspected.diagnostics, pageFingerprint: pageModel.fingerprint || fingerprintPageModel(pageModel), frameId: _sender?.frameId ?? 0, url: globalThis.location?.href || '', site: adapter?.name || 'generic', fields, editorsOpened } : { pageModel, diagnostics: inspected.diagnostics, pageFingerprint: pageModel.fingerprint, fields, items: fields.map((field) => ({ status: 'ready', reason: null, actual: field.value, field })) }); })(); return true; }
 if (message?.type === 'execute-tool') { const inspected = inspectWithAdapter(adapter); const raw = message.action || message.tool || {}; const action = normalizePlannedAction(raw, inspected.pageModel); const gate = validatePlannedAction(action, { pageModel: inspected.pageModel, task: { status:'pending', pageFingerprint: message.pageFingerprint || inspected.pageModel.fingerprint } }); if (action.rejected || !gate.allowed) { sendResponse({ status:'skipped', reason: action.rejected ? action.reason : gate.reason, actual:undefined, changed:false }); return true; } executeTool(document, action, { pageFingerprint: message.pageFingerprint || inspected.pageModel.fingerprint, capabilities: adapter, pageModel: inspected.pageModel }).then(sendResponse); return true; }
 if (message?.type === 'verify-action') { verifyAction(document, message.action || {}, message.result || {}, { pageFingerprint: message.pageFingerprint }).then(sendResponse); return true; }
 if (message?.type === 'execute-plan') { executeFillPlan(document, message.plan || [], adapter).then((result) => sendResponse(result)); return true; }
 if (message?.type === 'fill-fields') { executeFillPlan(document, convertLegacyFields(message.fields || []), adapter).then((result) => sendResponse({ filled: result.filled, verified: result.verified, skipped: result.skipped, results: result.results })); return true; }
 if (message?.type === 'undo-last-fill' || message?.type === 'undo-fill') { sendResponse(undoLastFill(document)); return true; }
 }); }
export { inspectControls, inspectPage, executeFillPlan, executeTool, verifyAction, undoLastFill };
=======
import { inspectPage } from './runtime/page-inspector.mjs';
import { executeTool } from './runtime/control-executor.mjs';
import { verifyAction } from './runtime/result-verifier.mjs';
import { listCapabilities } from './adapters/capabilities.mjs';
const documentId = globalThis.__formPilotDocumentId || (globalThis.__formPilotDocumentId = `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`);
if (typeof chrome !== 'undefined' && chrome.runtime && !globalThis.__formPilotContentLoaded) {
  globalThis.__formPilotContentLoaded = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'inspect-page') { sendResponse({ runtimeVersion: '0.4.0', documentId, ...inspectPage(document, { capabilities: listCapabilities() }) }); return true; }
    if (message?.type === 'execute-tool') { const inspected = inspectPage(document, { capabilities: listCapabilities() }); executeTool(document, message.action || {}, { pageModel: inspected.pageModel, pageFingerprint: message.pageFingerprint || inspected.pageModel.fingerprint }).then(sendResponse); return true; }
    if (message?.type === 'verify-action') { verifyAction(document, message.action || {}, message.result || {}, { pageFingerprint: message.pageFingerprint }).then(sendResponse); return true; }
    return undefined;
  });
}
export { inspectPage, executeTool, verifyAction };
>>>>>>> 2952a65
