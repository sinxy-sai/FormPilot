import { inspectPage } from './page-inspector.mjs';
import { fingerprintPageModel } from '../core/page-model.mjs';

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
export function readActual(element) {
  if (!element) return undefined;
  if (element.type === 'checkbox' || element.getAttribute?.('role') === 'checkbox') return Boolean(element.checked);
  if (element.tagName?.toLowerCase() === 'select' || element.options) return String(element.value ?? '');
  return String(element.value ?? element.textContent ?? '');
}
function expected(action = {}) {
  const args = action.arguments || action;
  if (action.tool === 'check' || action.type === 'checkbox') return Boolean(args.checked);
  if (action.tool === 'select' || action.type === 'native-select') return String(args.value ?? '');
  if (action.type === 'custom-select') return String(args.optionText ?? '');
  if (action.tool === 'type' || ['text','textarea','date','email','tel','url','number','password','search'].includes(action.type)) return String(args.value ?? '');
  return undefined;
}
function equalActual(action, actual, target) {
  if (action.tool === 'check' || action.type === 'checkbox') return Boolean(actual) === Boolean((action.arguments || action).checked);
  if (action.tool === 'select' || action.type === 'native-select') return String(actual) === String((action.arguments || action).value ?? '');
  if (action.type === 'custom-select') return text(actual) === text((action.arguments || action).optionText);
  const wanted = expected(action); return wanted === undefined ? true : String(actual) === wanted;
}
function hasPageError(document, context = {}) {
  if (context.pageError || context.error) return true;
  return Boolean(document?.querySelector?.('[data-formpilot-error], [role="alert"][data-error], .formpilot-error'));
}
function currentFingerprint(document, context = {}) {
  if (typeof context.getPageFingerprint === 'function') return context.getPageFingerprint();
  try { return inspectPage(document, { capabilities: context.capabilities }).pageModel.fingerprint; } catch { return undefined; }
}

export async function verifyAction(document, action, result = {}, context = {}) {
  const element = result.element || context.element || (typeof context.resolveElement === 'function' ? context.resolveElement(action?.target || action?.controlId) : null);
  const actual = result.actual !== undefined ? result.actual : readActual(element);
  if (!element && action?.tool !== 'wait' && action?.tool !== 'ask_user' && action?.tool !== 'undo') return { verified: false, reason: 'target-disappeared', actual };
  if (element && element.isConnected === false && action?.tool !== 'wait' && action?.tool !== 'ask_user' && action?.tool !== 'undo') return { verified: false, reason: 'target-disappeared', actual };
  if (hasPageError(document, context)) return { verified: false, reason: 'page-error', actual };
  const expectedFingerprint = context.pageFingerprint || context.expectedFingerprint || action?.pageFingerprint;
  const fingerprint = currentFingerprint(document, context);
  if (expectedFingerprint && fingerprint && expectedFingerprint !== fingerprint && context.allowStructureChange !== true) return { verified: false, reason: 'structure-changed', actual };
  if (result.reason && result.reason !== 'verified') return { verified: false, reason: result.reason, actual };
  if (result.changed === false && ['type','check','select'].includes(action?.tool)) return { verified: false, reason: 'value-unchanged', actual };
  if (!equalActual(action, actual, element)) return { verified: false, reason: 'value-unchanged', actual };
  return { verified: true, reason: undefined, actual };
}

export { expected as expectedValue };

