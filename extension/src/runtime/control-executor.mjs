import { inspectPage } from './page-inspector.mjs';
import { verifyAction } from './result-verifier.mjs';
import { normalizePlannedAction } from './action-tools.mjs';
import { validatePlannedAction } from './action-guard.mjs';
const history = new WeakMap();
const visible = element => Boolean(element && (!element.getClientRects || element.getClientRects().length));
const readActual = element => element?.type === 'checkbox' ? Boolean(element.checked) : String(element?.value ?? element?.textContent ?? '');
function resolveElement(document, action, pageModel) { const control = pageModel?.controls?.find(item => item.controlId === action.target); if (!control?.selectorToken) return null; return [...(document?.querySelectorAll?.('input,textarea,select,[role="combobox"],[contenteditable="true"]') || [])].filter(visible)[Number(control.selectorToken.slice('control-token-'.length))] || null; }
export async function executeTool(document, rawAction = {}, context = {}) {
  const action = rawAction?.tool ? rawAction : normalizePlannedAction(rawAction, context.pageModel || inspectPage(document).pageModel); if (action?.rejected) return { status: 'skipped', reason: action.reason, changed: false };
  const gate = validatePlannedAction(action, { pageModel: context.pageModel || inspectPage(document).pageModel, task: { status: 'pending' } }); if (!gate.allowed) return { status: 'skipped', reason: gate.reason, changed: false };
  if (action.tool === 'ask_user') return { status: 'manual', reason: 'user-input-required', changed: false };
  if (action.tool === 'wait') { await new Promise(resolve => setTimeout(resolve, Number(action.arguments?.ms || 0))); return { status: 'verified', changed: false }; }
  const element = resolveElement(document, action, context.pageModel); if (!element) return { status: 'skipped', reason: 'target-disappeared', changed: false };
  if (action.tool === 'read_value') return { status: 'verified', actual: readActual(element), changed: false };
  if (action.tool === 'verify') return verifyAction(document, action, { actual: readActual(element) }, context);
  const before = readActual(element); const args = action.arguments || {};
  if (action.tool === 'focus') element.focus?.();
  else if (action.tool === 'type') { const setter = Object.getOwnPropertyDescriptor(element.constructor?.prototype || {}, 'value')?.set; setter ? setter.call(element, String(args.value ?? '')) : element.value = String(args.value ?? ''); element.dispatchEvent?.(new Event('input', { bubbles: true })); element.dispatchEvent?.(new Event('change', { bubbles: true })); }
  else if (action.tool === 'check') { element.checked = Boolean(args.checked); element.dispatchEvent?.(new Event('change', { bubbles: true })); }
  else if (action.tool === 'select') { const option = [...(element.options || [])].find(item => String(item.value) === String(args.value) || String(item.text) === String(args.value)); if (!option) return { status:'skipped', reason:'option-not-found', changed:false }; element.value = option.value; element.dispatchEvent?.(new Event('change', { bubbles: true })); }
  else return { status:'skipped', reason:'unsupported-tool', changed:false };
  const actual = readActual(element); const expected = action.tool === 'check' ? Boolean(args.checked) : String(args.value ?? ''); const verified = action.tool === 'focus' || actual === expected; if (!verified) return { status:'skipped', reason:'verification-failed', before, actual, changed:actual !== before };
  if (actual !== before) { const entries = history.get(document) || []; entries.push({ element, before }); history.set(document, entries); }
  return { status:'verified', before, actual, changed: actual !== before };
}
export function undoLastFill(document) { const entries = history.get(document) || []; let undone = 0; for (const entry of entries.reverse()) { if (entry.element?.isConnected === false) continue; entry.element.value = entry.before; entry.element.dispatchEvent?.(new Event('input', { bubbles:true })); entry.element.dispatchEvent?.(new Event('change', { bubbles:true })); undone += 1; } history.delete(document); return { undone }; }
