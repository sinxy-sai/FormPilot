import { createPageModel } from '../core/page-model.mjs';
import { listCapabilities, selectCapability } from '../adapters/capabilities.mjs';

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const attr = (element, name) => { const value = element?.getAttribute?.(name); if (value !== null && value !== undefined) return value; const property = element?.[name]; return property === undefined ? null : property; };
const tag = (element) => String(element?.tagName ?? '').toLowerCase();

function isVisible(element) {
  if (!element) return false;
  if (element.hidden || attr(element, 'hidden') !== null || attr(element, 'aria-hidden') === 'true') return false;
  const style = element.style;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  const owner = element.ownerDocument?.defaultView;
  const computed = owner?.getComputedStyle?.(element);
  if (computed && (computed.display === 'none' || computed.visibility === 'hidden')) return false;
  if (element.offsetParent !== undefined && element.offsetParent === null && !element.getClientRects?.().length) return false;
  return true;
}
function labelledBy(element) { const ids = text(attr(element, 'aria-labelledby')); if (!ids) return ''; const doc = element.ownerDocument; return ids.split(/\s+/).map((id) => text(doc?.getElementById?.(id)?.textContent)).filter(Boolean).join(' '); }
function labelFor(element) { const associated = element.labels?.[0]?.textContent; if (text(associated)) return text(associated); const explicit = labelledBy(element); if (explicit) return explicit; const aria = text(attr(element, 'aria-label')); if (aria) return aria; const placeholder = text(attr(element, 'placeholder')); if (placeholder) return placeholder; return text(element.name || attr(element, 'name') || element.id || ''); }
function controlType(element) { const role = text(attr(element, 'role')).toLowerCase(); const type = text(element.type).toLowerCase(); const name = tag(element); if (role === 'combobox') return 'combobox'; if (name === 'select') return 'native-select'; if (name === 'textarea') return 'textarea'; if (type === 'checkbox' || role === 'checkbox') return 'checkbox'; if (type === 'radio' || role === 'radio') return 'radio'; if (type === 'date') return 'date'; return type && type !== 'text' ? type : 'text'; }
function roleFor(element, type) { const explicit = text(attr(element, 'role')); if (explicit) return explicit; if (type === 'checkbox' || type === 'radio') return type; if (type === 'native-select' || type === 'combobox') return 'combobox'; return 'textbox'; }
function currentValue(element, type) { if (type === 'checkbox' || type === 'radio') return Boolean(element.checked); return String(element.value ?? ''); }
function optionsFor(element, type) { if (type === 'native-select') return [...(element.options || element.querySelectorAll?.('option') || [])].map((option) => text(option.textContent || option.text || option.value)).filter(Boolean); if (type === 'combobox') { const root = element.ownerDocument; return [...(root?.querySelectorAll?.('[role="option"]') || [])].filter(isVisible).map((option) => text(option.textContent)).filter(Boolean); } return undefined; }
function selectorFor(element, index) { if (element?.id) return `#${element.id}`; const name = element?.name || attr(element, 'name'); if (name) return `${tag(element)}[name="${String(name).replace(/"/g, '\\"')}"]`; if (element?.dataset) element.dataset.formpilotIndex = String(index); return `[data-formpilot-index="${index}"]`; }
function sectionFor(element, sections) { let ancestor = element?.closest?.('fieldset, section, form, [role="group"]'); if (!ancestor) return undefined; let id = ancestor.id || ancestor.getAttribute?.('aria-label') || text(ancestor.querySelector?.('legend, h1, h2, h3, h4, h5, h6')?.textContent); if (!id) id = `section-${sections.length}`; const sectionId = `section-${id.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || sections.length}`; if (!sections.some((section) => section.id === sectionId)) sections.push({ id: sectionId, label: text(ancestor.getAttribute?.('aria-label')) || text(ancestor.querySelector?.('legend, h1, h2, h3, h4, h5, h6')?.textContent) || id }); return sectionId; }

export function inspectPage(document, { capabilities = null, includeScreenshot = false } = {}) {
  const sections = [], diagnostics = [], selector = 'input, textarea, select, [role="combobox"], [contenteditable="true"]';
  const elements = [...(document?.querySelectorAll?.(selector) || document?.elements || [])], controls = [];
  const available = Array.isArray(capabilities) ? capabilities : listCapabilities();
  elements.forEach((element, index) => {
    const visible = isVisible(element), type = controlType(element);
    if (type === 'file' || !visible) { diagnostics.push({ code: 'skip', type, visible }); return; }
    const sectionId = sectionFor(element, sections), token = `control-token-${index}`;
    const base = { controlId: `control-${index}`, selectorToken: token, label: labelFor(element), role: roleFor(element, type), controlType: type, value: currentValue(element, type), ...(optionsFor(element, type) ? { options: optionsFor(element, type) } : {}), visible, disabled: Boolean(element.disabled || attr(element, 'aria-disabled') === 'true'), readonly: Boolean(element.readOnly || element.readonly || attr(element, 'aria-readonly') === 'true'), ...(sectionId ? { sectionId } : {}) };
    let capability = null;
    try { capability = selectCapability({ ...base, element, context: { document, location: document?.location || globalThis.location, element } }, available); } catch (error) { diagnostics.push({ code: 'capability-detection-failed', controlId: base.controlId, message: String(error?.message || error) }); }
    const model = { ...base, ...(capability ? { capability: capability.name, capabilityVersion: capability.version } : {}) };
    if (capability?.inspect) { try { const inspected = capability.inspect({ document, element, control: model }); if (inspected && typeof inspected === 'object' && !Array.isArray(inspected)) Object.assign(model, inspected); } catch (error) { diagnostics.push({ code: 'capability-inspection-failed', controlId: model.controlId, capability: capability.name, message: String(error?.message || error) }); } }
    controls.push(model);
  });
  if (includeScreenshot) diagnostics.push({ code: 'screenshot-unavailable', message: 'Screenshot capture is not available in the content runtime' });
  diagnostics.push({ code: 'controls-inspected', count: controls.length });
  const location = document?.location || globalThis.location;
  const pageModel = createPageModel({ pageIdentity: { origin: location?.origin || '', route: `${location?.pathname || ''}${location?.search || ''}`, title: document?.title || '' }, sections, controls, dialogs: [...(document?.querySelectorAll?.('dialog,[role="dialog"]') || [])].map((dialog, index) => ({ id: dialog.id || `dialog-${index}`, label: text(dialog.getAttribute?.('aria-label')) || text(dialog.textContent).slice(0, 120), open: dialog.open !== false && attr(dialog, 'aria-hidden') !== 'true' })) });
  return { pageModel, diagnostics };
}
