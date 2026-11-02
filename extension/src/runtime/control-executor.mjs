import { inspectPage, inspectControls } from './page-inspector.mjs';
import { fingerprintPageModel } from '../core/page-model.mjs';
import { verifyAction, readActual } from './result-verifier.mjs';

const history = new WeakMap();
const text = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const visible = (el) => Boolean(el && (el.offsetParent === undefined || el.offsetParent !== null || el.getClientRects?.().length));
const nativeSetter = (el) => Object.getOwnPropertyDescriptor(el?.constructor?.prototype || {}, 'value')?.set || Object.getOwnPropertyDescriptor(globalThis.HTMLInputElement?.prototype || {}, 'value')?.set || Object.getOwnPropertyDescriptor(globalThis.HTMLTextAreaElement?.prototype || {}, 'value')?.set;
const setValue = (el, value) => { const setter = nativeSetter(el); if (setter) setter.call(el, String(value ?? '')); else el.value = String(value ?? ''); el.dispatchEvent?.(new Event('input', { bubbles: true })); el.dispatchEvent?.(new Event('change', { bubbles: true })); el.blur?.(); };
const actual = readActual;
function elements(document) { return [...(document?.querySelectorAll?.('input, textarea, select, [role="combobox"], [contenteditable="true"]') || [])].filter(visible); }
function resolveElement(document, action) {
  if (action?.element) return action.element;
  if (action?.selector) return document?.querySelector?.(action.selector);
  const id = action?.target || action?.controlId;
  if (!id) return null;
  const inspected = inspectPage(document).pageModel.controls || [];
  const index = inspected.findIndex((control) => control.controlId === id);
  return index >= 0 ? elements(document)[index] : null;
}
function findOption(document, value) { const wanted = String(value); return [...(document?.querySelectorAll?.('[role="option"], [data-value], option, li') || [])].find((el) => visible(el) && (text(el.textContent) === wanted || String(el.value ?? '') === wanted || el.getAttribute?.('data-value') === wanted)); }
function waitMutation(document) { return new Promise((resolve) => { let done = false; const finish = () => { if (done) return; done = true; observer?.disconnect?.(); resolve(); }; const observer = document?.body && globalThis.MutationObserver ? new MutationObserver(finish) : null; observer?.observe(document.body, { subtree:true, childList:true, attributes:true, characterData:true }); queueMicrotask(finish); setTimeout(finish, 20); }); }
function fingerprint(document) { try { return inspectPage(document).pageModel.fingerprint || fingerprintPageModel(inspectPage(document).pageModel); } catch { return undefined; } }

export async function executeTool(document, action = {}, context = {}) {
  const actionId = action.actionId || `action-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  if (action.tool === 'wait') { await new Promise(r => setTimeout(r, Number(action.arguments?.ms || 0))); return { status:'verified', actionId, before:undefined, actual:undefined, changed:false, reason:undefined }; }
  if (action.tool === 'ask_user' || action.tool === 'verify' || action.tool === 'read_value') return { status:'verified', actionId, before:undefined, actual:undefined, changed:false, reason:undefined };
  if (action.tool === 'undo') { const undone = undoLastFill(document); return { status: undone.undone ? 'verified' : 'skipped', actionId, before:undefined, actual:undefined, changed:Boolean(undone.undone), reason:undone.reason }; }
  const element = resolveElement(document, action);
  if (!element) return { status:'skipped', actionId, before:undefined, actual:undefined, changed:false, reason:'target-disappeared' };
  const before = actual(element); const pageFingerprint = fingerprint(document); const args = action.arguments || action;
  try {
    if (action.tool === 'focus') element.focus?.();
    else if (action.tool === 'open') element.click?.();
    else if (action.tool === 'type') setValue(element, args.value);
    else if (action.tool === 'check') { element.checked = Boolean(args.checked); element.dispatchEvent?.(new Event('input',{bubbles:true})); element.dispatchEvent?.(new Event('change',{bubbles:true})); element.blur?.(); }
    else if (action.tool === 'select') {
      const option = [...(element.options || [])].find((o) => String(o.value) === String(args.value) || text(o.text) === String(args.value));
      if (!option) { const custom = findOption(document, args.value); if (!custom) return { status:'skipped', actionId, before, actual:actual(element), changed:false, reason:'option-not-found' }; custom.click?.(); }
      else { element.value = option.value; element.dispatchEvent?.(new Event('input',{bubbles:true})); element.dispatchEvent?.(new Event('change',{bubbles:true})); element.blur?.(); }
    } else return { status:'skipped', actionId, before, actual:actual(element), changed:false, reason:'unsupported-action' };
  } catch (error) { return { status:'skipped', actionId, before, actual:actual(element), changed:false, reason:'page-error', error: String(error?.message || error) }; }
  await waitMutation(document);
  const result = { actionId, element, before, actual:actual(element), changed: before !== actual(element), pageFingerprint };
  const verification = await verifyAction(document, action, result, { ...context, element, pageFingerprint: context.pageFingerprint || pageFingerprint, resolveElement: (id) => resolveElement(document, { target:id }) });
  const output = { status: verification.verified ? 'verified' : 'skipped', actionId, before, actual:verification.actual, changed:result.changed, ...(verification.reason ? { reason:verification.reason } : {}) };
  if (verification.verified && output.changed) { const entries = history.get(document) || []; entries.push({ actionId, element, selector: action.selector, target: action.target, before, written: output.actual, pageFingerprint }); history.set(document, entries); }
  return output;
}

export async function executeFieldAction(document, field, action, adapter = null) {
  const selector = field?.selector || field?.field?.selector; const element = selector ? document?.querySelector?.(selector) : field?.element;
  if (!element) return { status:'skipped', reason:'element-not-found', actual:undefined, selector };
  if (action?.type === 'manual') return { status:'skipped', reason:action.reason || 'manual-review-required', actual:actual(element), selector };
  if (adapter?.activate) await adapter.activate(element, document);
  if (adapter?.fill) { const adapted = await adapter.fill(element, action?.value ?? action?.checked ?? action?.optionText, action); if (adapted?.applied === true) { const checked = await adapter.verify?.(element, action?.value ?? action?.checked ?? action?.optionText); return { status:checked === true || checked?.verified === true ? 'filled' : 'skipped', reason:checked === true || checked?.verified === true ? undefined : 'verification-failed', actual:actual(element), before:actual(element), selector }; } }
  const tool = action?.type === 'checkbox' ? 'check' : ['native-select','custom-select'].includes(action?.type) ? 'select' : 'type';
  const converted = { tool, selector, arguments: action?.type === 'checkbox' ? { checked:Boolean(action.checked) } : { value: action?.type === 'custom-select' ? action.optionText : action?.value }, element };
  const result = await executeTool(document, converted, { allowStructureChange:true });
  return { status: result.status === 'verified' ? 'filled' : 'skipped', reason: result.reason, actual: result.actual, before: result.before, selector };
}
export { inspectPage, inspectControls };
export async function executeFillPlan(document, plan = [], adapter = null) { const results = []; const changes = []; for (const item of plan) { const result = await executeFieldAction(document, item, item.action || item, adapter); results.push(result); if (result.status === 'filled') changes.push({ selector:result.selector, before:result.before, written:result.actual, pageFingerprint:fingerprint(document) }); } const existing = history.get(document) || []; history.set(document, existing.concat(changes)); return { filled:changes.length, verified:results.filter(r=>r.status==='filled').length, results, skipped:results.filter(r=>r.status!=='filled') }; }
export function undoLastFill(document) { const changes = history.get(document) || []; if (!changes.length) return { undone:0, reason:'nothing-to-undo' }; const current = fingerprint(document); if (changes.some(c=>c.pageFingerprint && current && c.pageFingerprint !== current)) { history.delete(document); return { undone:0, reason:'page-changed' }; } let undone=0; for (const item of changes.reverse()) { const el=item.element || (item.selector && document?.querySelector?.(item.selector)); if (!el) continue; if (actual(el) !== item.written) continue; if (el.type==='checkbox') { el.checked=Boolean(item.before); el.dispatchEvent?.(new Event('change',{bubbles:true})); } else setValue(el,item.before); undone++; } history.delete(document); return { undone }; }
