// control-executor.mjs — fill engine v2 execution layer (contract §5).
//
// Responsibilities:
//  1. Resolve a PageModel `controlId`/`actionId` to a DOM element. The runtime
//     never accepts a CSS selector or a script from outside: only model ids and
//     the opaque `selectorToken` the inspector produced (index into its control
//     query) are used.
//  2. Write with native property setters + real `input`/`change`/`blur` events so
//     React/Vue controlled components update their state.
//  3. Read the page back and verify (result-verifier.mjs). Nothing is reported as
//     done unless the read-back matches.
//  4. Keep an in-memory (and serializable) undo stack.
//
// Behavioral notes:
//  - Custom comboboxes only exist after a click; opening options are polled for
//    (1500ms / 50ms), and the popup is always closed again so it cannot leak
//    into the next step.
//  - Date fields are typed as `YYYY-MM`/`YYYY` and read back. Read-only inputs or
//    inputs that reformat the value are reported as `manual`; the executor never
//    guesses calendar cells. "至今" prefers a same-group ongoing checkbox, then a
//    writable text input, and only then gives up with `manual`.
//  - `mode: 'fill-empty'` (default) never overwrites an existing, different
//    value: that is reported as `conflict`.

import { hasScriptKey, normalizePlannedAction } from './action-tools.mjs';
import {
  DATE_TEXT_PATTERN,
  ONGOING_TEXT_PATTERN,
  ONGOING_VALUE_PATTERN,
  attribute,
  comboboxRoot,
  isCheckboxElement,
  isNativeSelect,
  normalizeKey,
  normalizeText,
  readActual,
  readDisplayCandidates,
  readElementValue,
  tagName,
  udSelectTrigger,
  verifyAction,
  verifyCheckboxValue,
  verifyComboboxValue,
  verifyNativeSelectValue
} from './result-verifier.mjs';

// The inspector's control query. Contract §3: selectorToken indexes
// queryAllDeep(document, selector), so this must stay in sync with page-inspector.
const DEFAULT_CONTROL_SELECTOR = 'input, textarea, select, [role="combobox"], [contenteditable="true"]';
const DEFAULT_ACTION_SELECTOR = 'button, [role="button"], a';
const CONTROL_TOKEN_PREFIX = 'control-token-';
const ACTION_TOKEN_PREFIX = 'action-token-';
const POLL_TIMEOUT_MS = 1500;
const POLL_INTERVAL_MS = 50;
const CLOSE_TIMEOUT_MS = 600;
const SETTLE_MS = 50;
const ONGOING_TEXT = '至今';
const STEP_KINDS = new Set(['fill', 'select', 'check', 'add-item']);
// Anything that looks like "commit/cancel/delete this form" must never be
// clicked (invariant 1, recon §3: 底部「保存」.atsx-btn-primary、「取消」, 卡片删除按钮).
const FORBIDDEN_ACTION_LABEL = /保存|提交|投递|预览|确认|取消|删除|移除|save|submit|apply|preview|confirm|cancel|delete|remove|reset|清空/i;
// Class prefixes for destructive/committing controls on real recruiting pages.
const FORBIDDEN_ACTION_CLASS = /atsx-btn-primary|apply-form-array-card-delete|apply-form-array-card-remove|data-save|data-submit/i;

const eventTargetOf = element => {
  const view = element?.ownerDocument?.defaultView;
  return view || globalThis;
};
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function queryAllDeep(root, selector) {
  if (!root?.querySelectorAll) return [];
  const output = [...root.querySelectorAll(selector)];
  for (const host of root.querySelectorAll('*') || []) {
    if (host?.shadowRoot) output.push(...queryAllDeep(host.shadowRoot, selector));
  }
  return output;
}

function dispatch(element, type, { bubbles = true } = {}) {
  if (typeof element?.dispatchEvent !== 'function') return false;
  const EventCtor = eventTargetOf(element).Event || globalThis.Event;
  try {
    return element.dispatchEvent(new EventCtor(type, { bubbles, cancelable: false, composed: true }));
  } catch {
    return false;
  }
}

function dispatchKey(element, key) {
  if (typeof element?.dispatchEvent !== 'function') return;
  const view = eventTargetOf(element);
  const EventCtor = view.KeyboardEvent || view.Event || globalThis.Event;
  let event;
  try {
    event = new EventCtor('keydown', { bubbles: true, cancelable: true, key, code: key });
  } catch {
    event = new view.Event('keydown', { bubbles: true, cancelable: true });
  }
  try {
    Object.defineProperty(event, 'key', { value: key });
  } catch {
    /* non-extensible event object — page still sees a keydown */
  }
  element.dispatchEvent(event);
}

function focusElement(element) {
  if (typeof element?.focus === 'function') element.focus();
}

function blurElement(element) {
  if (typeof element?.blur === 'function') element.blur();
  dispatch(element, 'blur', { bubbles: false });
}

const PROTOTYPE_NAMES = { input: 'HTMLInputElement', textarea: 'HTMLTextAreaElement', select: 'HTMLSelectElement' };

/** Native property setter (React controlled components ignore plain assignment). */
function propertySetter(element, property) {
  const tag = tagName(element);
  const ctorName = PROTOTYPE_NAMES[tag];
  const view = element?.ownerDocument?.defaultView;
  const Ctor = (ctorName && view?.[ctorName]) || (ctorName && globalThis[ctorName]);
  const descriptor = Ctor ? Object.getOwnPropertyDescriptor(Ctor.prototype, property) : undefined;
  if (typeof descriptor?.set === 'function') return descriptor.set;
  for (let proto = Object.getPrototypeOf(element ?? {}); proto; proto = Object.getPrototypeOf(proto)) {
    const candidate = Object.getOwnPropertyDescriptor(proto, property);
    if (typeof candidate?.set === 'function') return candidate.set;
  }
  return null;
}

function writeProperty(element, property, value) {
  const setter = propertySetter(element, property);
  if (setter) {
    setter.call(element, value);
    return 'native';
  }
  element[property] = value;
  return 'assignment';
}

function isRendered(element) {
  if (!element) return false;
  for (let current = element; current; current = current.parentElement) {
    if (current.hidden === true) return false;
    if (attribute(current, 'hidden') !== '') return false;
    if (attribute(current, 'aria-hidden') === 'true') return false;
    const style = current.style;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    const computed = current.ownerDocument?.defaultView?.getComputedStyle?.(current);
    if (computed && (computed.display === 'none' || computed.visibility === 'hidden')) return false;
  }
  return true;
}

function controlTypeOf(element) {
  const tag = tagName(element);
  const type = String(element?.type ?? '').toLowerCase();
  const role = normalizeKey(attribute(element, 'role'));
  if (role === 'combobox') return 'combobox';
  if (tag === 'select') return 'native-select';
  if (tag === 'textarea') return 'textarea';
  if (type === 'checkbox' || role === 'checkbox') return 'checkbox';
  if (type === 'radio' || role === 'radio') return 'radio';
  if (type === 'date') return 'date';
  if (type === 'file') return 'file';
  if (tag === 'input') return type && type !== 'text' ? type : 'text';
  return 'text';
}

const typeMatches = (modelType, elementType) => {
  const wanted = normalizeKey(modelType);
  const actual = normalizeKey(elementType);
  if (wanted === actual) return true;
  if (wanted === 'native-select' && actual === 'select') return true;
  if (wanted === 'text' && actual === '') return true;
  return false;
};

function parseTokenIndex(token, prefix) {
  if (typeof token !== 'string' || !token.startsWith(prefix)) return null;
  const index = Number(token.slice(prefix.length));
  return Number.isInteger(index) && index >= 0 ? index : null;
}
const controlTokenIndex = token => parseTokenIndex(token, CONTROL_TOKEN_PREFIX) ?? parseTokenIndex(token, ACTION_TOKEN_PREFIX);

function findControl(pageModel, controlId) {
  return (pageModel?.controls || []).find(control => control?.controlId === controlId) || null;
}

/** Resolve controlId → { control, element } (or { error }). */
function resolveControl(document, pageModel, controlId, context = {}) {
  const control = findControl(pageModel, controlId);
  if (!control) return { error: 'control-not-found' };
  if (typeof context.resolveElement === 'function') {
    const hook = context.resolveElement(controlId, control);
    if (hook) return { control, element: hook };
  }
  const index = parseTokenIndex(control.selectorToken, CONTROL_TOKEN_PREFIX);
  if (index === null) return { control, error: 'invalid-selector-token' };
  const selector = typeof context.controlSelector === 'string' && context.controlSelector ? context.controlSelector : DEFAULT_CONTROL_SELECTOR;
  const nodes = queryAllDeep(document, selector);
  // page-inspector contract: control-token-<n> indexes the control query AFTER
  // dropping file inputs (attachments do not occupy a control slot). Keep the
  // raw-index candidate as a fallback for older inspectors; the type check
  // decides when both exist.
  const withoutFiles = nodes.filter(node => controlTypeOf(node) !== 'file');
  const candidates = [];
  if (withoutFiles[index]) candidates.push(withoutFiles[index]);
  if (nodes[index] && !candidates.includes(nodes[index])) candidates.push(nodes[index]);
  const element = candidates.find(candidate => typeMatches(control.controlType, controlTypeOf(candidate))) || candidates[0];
  if (!element) return { control, error: 'control-element-missing', index };
  return { control, element };
}

function isReadonlyControl(element, control = {}) {
  return control.readonly === true || element?.readOnly === true || element?.readonly === true
    || attribute(element, 'readonly') !== '' || attribute(element, 'aria-readonly') === 'true';
}

function isDisabledControl(element, control = {}) {
  return control.disabled === true || element?.disabled === true || attribute(element, 'aria-disabled') === 'true';
}

async function pollUntil(check, { timeoutMs = POLL_TIMEOUT_MS, intervalMs = POLL_INTERVAL_MS } = {}) {
  const startedAt = Date.now();
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() - startedAt >= timeoutMs) return null;
    await delay(intervalMs);
  }
}

/** Section ids come either as `section-<key>` or bare `<key>`; compare normalized. */
function sameSectionId(first, second) {
  if (!first || !second) return true;
  const normalize = value => String(value).startsWith('section-') ? String(value) : `section-${value}`;
  return normalize(first) === normalize(second);
}

/**
 * A plan step is only valid against the PageModel it was planned from. After an
 * add-item the inspector assigns new controlIds/selectorTokens, so an old step
 * can silently point at a *different* field (the historical "wrong field"
 * bug). Cross-check the step's section/item metadata against the resolved
 * control and refuse to write instead of guessing.
 */
function stepControlMismatch(step, control) {
  const stepSection = normalizeKey(step?.sectionKey);
  const controlSection = normalizeKey(control?.sectionKey);
  if (stepSection && controlSection && stepSection !== controlSection) {
    return `sectionKey ${step.sectionKey} != ${control.sectionKey}`;
  }
  if (!sameSectionId(step?.sectionId, control?.sectionId)) {
    return `sectionId ${step.sectionId} != ${control.sectionId}`;
  }
  if (step?.itemIndex !== undefined && control?.itemIndex !== undefined && Number(step.itemIndex) !== Number(control.itemIndex)) {
    return `itemIndex ${step.itemIndex} != ${control.itemIndex}`;
  }
  return null;
}

function stepPageMismatch(step, context, pageModel) {
  const expected = step?.pageFingerprint || context?.pageFingerprint || context?.expectedFingerprint;
  const actual = pageModel?.fingerprint;
  if (expected && actual && String(expected) !== String(actual)) return `${expected} != ${actual}`;
  return null;
}

function makeResult(stepId, status, { before, after, reason, changed } = {}) {
  return { stepId, status, before, after, ...(reason ? { reason } : {}), changed: Boolean(changed) };
}

// ---------------------------------------------------------------------------
// Page model access
// ---------------------------------------------------------------------------

async function inspectNow(document, context) {
  try {
    if (typeof context.inspectPage === 'function') {
      const inspected = await context.inspectPage(document, context);
      return inspected?.pageModel || inspected || null;
    }
    const { inspectPage } = await import('./page-inspector.mjs');
    const inspected = inspectPage(document, context.capabilities ? { capabilities: context.capabilities } : {});
    return inspected?.pageModel || null;
  } catch {
    return null;
  }
}

async function ensurePageModel(document, context, { fresh = false } = {}) {
  if (!fresh && context.pageModel) return context.pageModel;
  const pageModel = await inspectNow(document, context);
  if (pageModel) context.pageModel = pageModel;
  return pageModel;
}

// ---------------------------------------------------------------------------
// Undo stack: memory (element refs) + serializable log (tokens & values)
// ---------------------------------------------------------------------------

const undoStacks = new WeakMap();

function pushUndo(document, entry) {
  if (!document) return;
  const stack = undoStacks.get(document) || [];
  stack.push({
    element: entry.element,
    controlId: entry.controlId,
    selectorToken: entry.selectorToken,
    recordKind: entry.recordKind || 'value',
    before: entry.before,
    after: entry.after,
    stepId: entry.stepId,
    recordedAt: new Date().toISOString()
  });
  undoStacks.set(document, stack);
}

/** Serializable view of the undo stack (no DOM references). */
export function getUndoLog(document) {
  return (undoStacks.get(document) || []).map(entry => ({
    controlId: entry.controlId,
    selectorToken: entry.selectorToken,
    recordKind: entry.recordKind,
    before: entry.before,
    after: entry.after,
    stepId: entry.stepId,
    recordedAt: entry.recordedAt
  }));
}

export function clearUndo(document) {
  return undoStacks.delete(document);
}

function resolveUndoElement(document, entry) {
  if (entry.element && entry.element.isConnected !== false) return entry.element;
  const index = parseTokenIndex(entry.selectorToken, CONTROL_TOKEN_PREFIX);
  if (index === null) return null;
  const nodes = queryAllDeep(document, DEFAULT_CONTROL_SELECTOR).filter(node => controlTypeOf(node) !== 'file');
  return nodes[index] || null;
}

function restoreUndoEntry(document, entry) {
  const element = resolveUndoElement(document, entry);
  if (!element) return false;
  const before = entry.before;
  if (entry.recordKind === 'checked') {
    writeProperty(element, 'checked', Boolean(before));
    dispatch(element, 'input');
    dispatch(element, 'change');
    return true;
  }
  if (entry.recordKind === 'display') {
    const root = comboboxRoot(element);
    const holder = root?.querySelector?.('.selectValue, .areaCodeValue, [class*="ud__select__selector__selectItem"], .chip, [data-value]');
    if (holder) holder.textContent = String(before ?? '');
    else if (typeof element.setAttribute === 'function') element.setAttribute('data-value', String(before ?? ''));
    dispatch(element, 'input');
    dispatch(element, 'change');
    return true;
  }
  writeProperty(element, 'value', String(before ?? ''));
  dispatch(element, 'input');
  dispatch(element, 'change');
  blurElement(element);
  return true;
}

/** Restore every recorded write of this fill round, newest first. */
export function undoLastFill(document) {
  const stack = undoStacks.get(document) || [];
  const restored = [];
  let undone = 0;
  for (const entry of [...stack].reverse()) {
    if (restoreUndoEntry(document, entry)) {
      undone += 1;
      restored.push({ controlId: entry.controlId, stepId: entry.stepId, recordKind: entry.recordKind });
    }
  }
  undoStacks.delete(document);
  return { status: 'verified', undone, changed: undone > 0, restored };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

function writeTextRaw(element, value) {
  focusElement(element);
  writeProperty(element, 'value', value);
  dispatch(element, 'input');
  dispatch(element, 'change');
  blurElement(element);
}

/**
 * Type a text value and read it back (contract §5: one clear+rewrite retry).
 * @returns {{ actual: string, matched: boolean, retried: boolean }}
 */
function writeTextValue(element, expected) {
  const wanted = String(expected ?? '');
  writeTextRaw(element, wanted);
  let actual = String(element?.value ?? '');
  if (actual === wanted) return { actual, matched: true, retried: false };
  writeTextRaw(element, '');
  writeTextRaw(element, wanted);
  actual = String(element?.value ?? '');
  return { actual, matched: actual === wanted, retried: true };
}

/** Wait for page re-renders (React may reformat/revert right after input). */
async function readBackAfterSettle(element, expected, timeoutMs = 400) {
  await delay(SETTLE_MS);
  const wanted = String(expected ?? '');
  const matched = await pollUntil(
    () => (String(element?.value ?? '') === wanted ? wanted : null),
    { timeoutMs, intervalMs: POLL_INTERVAL_MS }
  );
  return { matched: Boolean(matched), actual: String(element?.value ?? '') };
}

function writeCheckboxValue(element, expected, { allowClick = true } = {}) {
  const desired = Boolean(expected);
  if (Boolean(element?.checked) === desired) return Boolean(element.checked);
  if (allowClick && typeof element?.click === 'function' && isRendered(element)) {
    element.click();
    if (Boolean(element.checked) === desired) return Boolean(element.checked);
  }
  writeProperty(element, 'checked', desired);
  dispatch(element, 'input');
  dispatch(element, 'change');
  return Boolean(element.checked);
}

// ---------------------------------------------------------------------------
// Custom combobox helpers
//
// Two DOM dialects must work:
//  - fixture/legacy: trigger [role="combobox"] opens a [role="option"] list;
//  - real recruiting page: .ud__select__selector (input[role=combobox]
//    inside, readOnly for single select) opens .ud__select__dropdown whose
//    options are .ud__select__list__item (text in __content), virtualised by
//    .rc-virtual-list-holder; the popup element stays in the DOM with
//    `ud-slide-up-leave` after closing, so closing is measured by visibility.
// ---------------------------------------------------------------------------

const UD_SELECT = {
  dropdown: '[class*="ud__select__dropdown"]',
  listItemContent: '[class*="ud__select__list__item__content"]',
  listHolder: '[class*="rc-virtual-list-holder"]'
};
const OPTION_QUERY = '[role="option"], [class*="ud__select__list__item"]';
const CLOSED_ANIMATION_CLASS = /leave|hidden|closing/i;

const classTokens = element => String(attribute(element, 'class') || '').split(/\s+/).filter(Boolean);
const hasClassPrefix = (element, prefix) => classTokens(element).some(token => token.startsWith(prefix));

function isUdListItem(element) {
  return classTokens(element).some(token =>
    token.startsWith('ud__select__list__item') && !token.includes('__content') && !token.includes('__check'));
}

function isOptionNode(element) {
  return normalizeKey(attribute(element, 'role')) === 'option' || isUdListItem(element);
}

/** The element that must be clicked to open a custom select. */
function comboboxTrigger(element) {
  // Real page: click the .ud__select__selector container (the inner search input
  // is readonly for single select). Fixture: the [role=combobox] trigger itself.
  return udSelectTrigger(element) || element;
}

function isDropdownVisible(dropdown) {
  if (!dropdown) return false;
  if (CLOSED_ANIMATION_CLASS.test(attribute(dropdown, 'class'))) return false;
  const style = dropdown.style;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  const computed = dropdown.ownerDocument?.defaultView?.getComputedStyle?.(dropdown);
  if (computed) {
    if (computed.display === 'none' || computed.visibility === 'hidden') return false;
    if (computed.opacity !== undefined && computed.opacity !== '' && Number(computed.opacity) === 0) return false;
  }
  const rect = dropdown.getBoundingClientRect?.();
  if (rect && rect.width === 0 && rect.height === 0) return false;
  return true;
}

function isVisibleOption(option) {
  if (!option) return false;
  if (option.hidden === true) return false;
  if (attribute(option, 'aria-hidden') === 'true') return false;
  const style = option.style;
  if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
  const rect = option.getBoundingClientRect?.();
  if (rect && rect.width === 0 && rect.height === 0) return false;
  return true;
}

function optionText(option) {
  const content = option?.querySelector?.(UD_SELECT.listItemContent);
  return normalizeText((content || option)?.textContent);
}

function optionValue(option) {
  const content = option?.querySelector?.(UD_SELECT.listItemContent);
  return attribute(option, 'data-value') || attribute(option, 'aria-label')
    || attribute(content, 'data-value') || String(option?.value ?? '');
}

function visibleDropdowns(document) {
  return queryAllDeep(document, UD_SELECT.dropdown).filter(isDropdownVisible);
}

function popupIsOpen(document, element) {
  if (attribute(element, 'aria-expanded') === 'true') return true;
  const openDropdown = visibleDropdowns(document).find(dropdown =>
    queryAllDeep(dropdown, OPTION_QUERY).some(option => isOptionNode(option) && isVisibleOption(option)));
  if (openDropdown) return true;
  return queryAllDeep(document, '[role="option"]').some(isVisibleOption);
}

/** Collect the options of the currently open popup (role=option or ud__select). */
function collectOptions(document) {
  const roots = [];
  for (const dropdown of visibleDropdowns(document)) roots.push(dropdown);
  for (const listbox of queryAllDeep(document, '[role="listbox"]')) if (isRendered(listbox)) roots.push(listbox);
  for (const root of roots) {
    const found = queryAllDeep(root, OPTION_QUERY).filter(option => isOptionNode(option) && isVisibleOption(option));
    if (found.length) return found;
  }
  return [];
}

function waitForOptions(document) {
  return pollUntil(() => {
    const options = collectOptions(document);
    return options.length ? options : null;
  }, { timeoutMs: POLL_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS }).then(options => options || []);
}

/**
 * Option matching order (contract §5): exact textContent → trimmed/lowercased →
 * contains → data-value. Falls back to aria-label.
 */
function matchOption(options, target) {
  const wantedRaw = String(target ?? '').trim();
  const wanted = normalizeKey(target);
  if (!wanted) return null;
  // Real ud__select items wrap their label in .ud__select__list__item__content.
  const exact = options.find(option => optionText(option) === wantedRaw) || options.find(option => String(option?.textContent ?? '').trim() === wantedRaw);
  if (exact) return exact;
  const normalized = options.find(option => normalizeKey(optionText(option)) === wanted);
  if (normalized) return normalized;
  // "包含" means the option label contains the target (never the reverse — that
  // would match 城市2 for a 城市25 target and select the wrong row).
  const contains = options.find(option => {
    const text = normalizeKey(optionText(option));
    return text.length > 0 && text.includes(wanted);
  });
  if (contains) return contains;
  return options.find(option => normalizeKey(optionValue(option)) === wanted)
    || options.find(option => normalizeKey(attribute(option, 'aria-label')) === wanted)
    || null;
}

/** Scroll a virtualised list one viewport step; returns true when it moved. */
function scrollVirtualList(document) {
  const holders = queryAllDeep(document, UD_SELECT.listHolder).filter(holder => isRendered(holder));
  const holder = holders[0];
  if (!holder) return false;
  const current = Number(holder.scrollTop || 0);
  const viewport = Number(holder.clientHeight || holder.getBoundingClientRect?.().height || 0) || 220;
  holder.scrollTop = current + viewport;
  dispatch(holder, 'scroll');
  return Number(holder.scrollTop || 0) > current;
}

/** Find an option, scrolling the virtual list when it is not rendered yet. */
async function findOption(document, target) {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  for (;;) {
    const options = collectOptions(document);
    const match = matchOption(options, target);
    if (match) return { match, options };
    if (!options.length) return { match: null, options };
    if (Date.now() >= deadline || !scrollVirtualList(document)) return { match: null, options };
    await delay(POLL_INTERVAL_MS);
  }
}

/** Close the dropdown so it cannot affect the next step. */
async function closePopup(document, element) {
  if (!popupIsOpen(document, element)) return true;
  dispatchKey(element, 'Escape');
  if (document?.documentElement) dispatchKey(document.documentElement, 'Escape');
  let closed = Boolean(await pollUntil(() => (!popupIsOpen(document, element) ? true : null), { timeoutMs: CLOSE_TIMEOUT_MS }));
  if (closed) return true;
  // Outside click: only ever dispatch on <body>, never on page buttons.
  if (document?.body) dispatch(document.body, 'click');
  closed = Boolean(await pollUntil(() => (!popupIsOpen(document, element) ? true : null), { timeoutMs: 300 }));
  return closed;
}

function selectNativeOption(element, expected) {
  const options = [...(element?.options || element?.querySelectorAll?.('option') || [])];
  const wanted = normalizeKey(expected);
  const option = options.find(item => String(item?.value ?? '') === String(expected ?? '').trim())
    || options.find(item => normalizeKey(item?.value) === wanted)
    || options.find(item => normalizeKey(item?.textContent ?? item?.text) === wanted)
    || options.find(item => normalizeKey(item?.textContent ?? item?.text).includes(wanted));
  if (!option) return null;
  if (typeof element.options === 'object') element.selectedIndex = options.indexOf(option);
  writeProperty(element, 'value', String(option.value ?? option.textContent ?? ''));
  if (option.selected !== undefined) option.selected = true;
  dispatch(element, 'input');
  dispatch(element, 'change');
  return option;
}

// ---------------------------------------------------------------------------
// "至今" (ongoing) handling
// ---------------------------------------------------------------------------

function isOngoingTarget(value) {
  if (typeof value === 'boolean') return value === true;
  if (typeof value === 'string') return ONGOING_VALUE_PATTERN.test(normalizeText(value));
  return false;
}

function labelTextOf(element) {
  const parts = [
    attribute(element, 'aria-label'),
    attribute(element, 'name'),
    attribute(element, 'value'),
    attribute(element, 'id')
  ];
  const label = element?.closest?.('label');
  if (label?.textContent) parts.push(label.textContent);
  if (element?.parentElement?.textContent) parts.push(element.parentElement.textContent);
  const sibling = element?.nextElementSibling;
  if (sibling?.textContent) parts.push(sibling.textContent);
  return normalizeText(parts.join(' '));
}

function findDateGroup(element) {
  const selectors = ['.resumeEditForm-dateRange', '[data-date-range]', '[data-form-field-name="start_end_time"]', '[role="group"]', 'fieldset'];
  for (const selector of selectors) {
    const group = element?.closest?.(selector);
    if (group) return group;
  }
  return element?.closest?.('[data-repeat-item], section, form') || element?.parentElement || null;
}

function findOngoingCheckbox(root, excludeElement = null) {
  if (!root?.querySelectorAll) return null;
  const boxes = [...root.querySelectorAll('input[type="checkbox"], [role="checkbox"]')];
  return boxes.find(box => box !== excludeElement && isRendered(box) && ONGOING_TEXT_PATTERN.test(labelTextOf(box))) || null;
}

// ---------------------------------------------------------------------------
// Shared read/skip/conflict helpers
// ---------------------------------------------------------------------------

function isAlreadySatisfied(element, control, expected, kind) {
  if (kind === 'check') return Boolean(element?.checked) === Boolean(expected);
  const wanted = normalizeKey(expected);
  if (!wanted) return false;
  if (kind === 'select') {
    if (readDisplayCandidates(element).some(candidate => normalizeKey(candidate) === wanted)) return true;
    return normalizeKey(element?.value) === wanted;
  }
  const current = String(element?.value ?? '');
  return current === String(expected ?? '') || normalizeKey(current) === wanted;
}

function conflictReason(element, expected, context = {}) {
  if (normalizeKey(context.mode ?? 'fill-empty') === 'overwrite') return null;
  const candidates = readDisplayCandidates(element).map(value => normalizeText(value)).filter(Boolean);
  const current = candidates[0] ?? '';
  if (!current) return null;
  const wanted = normalizeKey(expected);
  if (candidates.some(candidate => normalizeKey(candidate) === wanted)) return null;
  return `existing-value-differs: 页面已有「${current}」，只填空白模式不覆盖`;
}

function dateTextOf(value) {
  const text = normalizeText(value);
  if (ONGOING_VALUE_PATTERN.test(text)) return ONGOING_TEXT;
  const monthMatch = /^(\d{4})-(\d{1,2})$/.exec(text);
  if (monthMatch) return `${monthMatch[1]}-${String(Number(monthMatch[2])).padStart(2, '0')}`;
  const yearMatch = /^(\d{4})$/.exec(text);
  if (yearMatch) return yearMatch[1];
  return text;
}

function isDateStep(step, control, element) {
  const fieldKey = normalizeKey(step?.fieldKey);
  if (['start', 'end', 'date', 'birthday'].includes(fieldKey)) return true;
  // page-inspector metadata for the real page: fieldKey is the page semantic name
  // (start_end_time / date), itemRole distinguishes start|end, dateFormat the shape.
  const pageFieldKey = normalizeKey(control?.fieldKey);
  if (pageFieldKey === 'start_end_time' || pageFieldKey === 'date' || pageFieldKey === 'birthday') return true;
  const dateFormat = normalizeKey(control?.dateFormat);
  if (dateFormat === 'yyyy-mm' || dateFormat === 'yyyy') return true;
  if (['start', 'end'].includes(normalizeKey(control?.itemRole))) return true;
  if (normalizeKey(control?.controlType) === 'date' || controlTypeOf(element) === 'date') return true;
  const value = typeof step?.value === 'string' ? normalizeText(step.value) : '';
  return DATE_TEXT_PATTERN.test(value) || ONGOING_VALUE_PATTERN.test(value);
}

// ---------------------------------------------------------------------------
// executeStep
// ---------------------------------------------------------------------------

export async function executeStep(document, step = {}, context = {}) {
  const safeStep = record(step) ? step : {};
  const stepId = String(safeStep.stepId ?? safeStep.controlId ?? safeStep.actionId ?? 'step-unknown');
  if (!record(step)) return makeResult(stepId, 'failed', { reason: 'invalid-step' });
  if (hasScriptKey(step)) return makeResult(stepId, 'failed', { reason: 'forbidden-property: 步骤里不允许出现选择器/脚本' });
  const kind = String(step.kind ?? '');
  if (!STEP_KINDS.has(kind)) return makeResult(stepId, 'failed', { reason: `unsupported-kind: ${kind || '(missing)'}` });
  if (kind === 'add-item') return executeAction(document, { ...step, kind: 'add-item' }, context);
  if (typeof step.controlId !== 'string' || !step.controlId) return makeResult(stepId, 'failed', { reason: 'control-id-required' });

  context = context || {};
  const pageModel = await ensurePageModel(document, context);
  if (!pageModel) return makeResult(stepId, 'failed', { reason: 'page-model-unavailable' });
  const resolved = resolveControl(document, pageModel, step.controlId, context);
  if (resolved.error) return makeResult(stepId, 'failed', { reason: resolved.error });
  const { control, element } = resolved;
  if (!isRendered(element)) return makeResult(stepId, 'failed', { reason: 'control-not-visible', before: readElementValue(element, control) });
  if (isDisabledControl(element, control)) return makeResult(stepId, 'failed', { reason: 'control-disabled', before: readElementValue(element, control) });

  const before = readElementValue(element, control);
  const mismatch = stepControlMismatch(step, control);
  if (mismatch) {
    return makeResult(stepId, 'failed', {
      before,
      after: before,
      reason: `step-control-mismatch: ${mismatch}（页面结构可能已变化，请重新 inspect + plan）`
    });
  }
  const pageMismatch = stepPageMismatch(step, context, pageModel);
  if (pageMismatch) {
    return makeResult(stepId, 'failed', { before, after: before, reason: `structure-changed: 页面指纹 ${pageMismatch}` });
  }
  if (step.status === 'conflict') {
    return makeResult(stepId, 'conflict', { before, after: before, reason: step.reason || 'existing-value-differs' });
  }

  const effectiveKind = resolveKind(kind, control, element, step);
  if (isAlreadySatisfied(element, control, step.value, effectiveKind)) {
    return makeResult(stepId, 'skipped', { before, after: before, reason: 'already-correct' });
  }

  if (effectiveKind === 'fill' || effectiveKind === 'date' || effectiveKind === 'select') {
    const conflict = conflictReason(element, step.value, context);
    if (conflict) return makeResult(stepId, 'conflict', { before, after: before, reason: conflict });
  }

  // A custom select's inner search input is readonly on the real page; that must
  // not block selecting an option (only the search box is readonly, not the
  // control). readonly only makes text/date fields unfillable.
  if (isReadonlyControl(element, control) && (effectiveKind === 'fill' || effectiveKind === 'date')) {
    const reason = effectiveKind === 'date'
      ? 'readonly-date-needs-manual-picker: 日期字段只读，需要在日历里人工选择'
      : 'control-readonly: 字段只读，需要人工填写';
    return makeResult(stepId, 'manual', { before, after: before, reason });
  }

  try {
    if (effectiveKind === 'check') return await checkControl({ document, stepId, element, control, step, before });
    if (effectiveKind === 'date') return await fillDate({ document, stepId, element, control, step, before, context });
    if (effectiveKind === 'select') return await selectControl({ document, stepId, element, control, step, before, context });
    return await fillText({ document, stepId, element, control, step, before });
  } catch (error) {
    return makeResult(stepId, 'failed', { before, after: readElementValue(element, control), reason: `execution-error: ${error?.message || error}` });
  }
}

function resolveKind(kind, control, element, step = {}) {
  const elementType = controlTypeOf(element);
  if (kind === 'check' || elementType === 'checkbox') return 'check';
  if (kind === 'select' || elementType === 'combobox' || elementType === 'native-select' || elementType === 'radio') return 'select';
  if (isDateStep(step, control, element)) return 'date';
  return 'fill';
}

function recordWrite(document, { element, control, recordKind, before, after, stepId }) {
  if (before === after) return;
  pushUndo(document, {
    element,
    controlId: control?.controlId,
    selectorToken: control?.selectorToken,
    recordKind,
    before,
    after,
    stepId
  });
}

async function fillText({ document, stepId, element, control, step, before }) {
  const expected = String(step.value ?? '');
  writeTextValue(element, expected);
  const readBack = await readBackAfterSettle(element, expected);
  const after = readBack.actual;
  if (!readBack.matched) {
    return makeResult(stepId, 'failed', { before, after, reason: `value-mismatch: expected "${expected}", read back "${after}"` });
  }
  recordWrite(document, { element, control, recordKind: 'value', before, after, stepId });
  return makeResult(stepId, 'verified', { before, after, changed: before !== after });
}

/** Award date is a year-only picker on the real page: `2024-05` must be typed as `2024`. */
function isYearOnlyPicker(element, control = {}) {
  if (normalizeKey(control?.dateFormat) === 'yyyy') return true;
  if (/^yyyy$/i.test(normalizeText(attribute(element, 'placeholder')))) return true;
  if (/ud__picker/i.test(attribute(element, 'class'))) return true;
  return normalizeKey(control?.controlType) === 'date-year' || normalizeKey(control?.pickerType) === 'year';
}

function yearTextOf(value) {
  const match = /(\d{4})/.exec(normalizeText(value));
  return match ? match[1] : '';
}

async function fillDate({ document, stepId, element, control, step, before, context }) {
  const raw = step.value;
  if (isOngoingTarget(raw) || normalizeKey(step.fieldKey) === 'ongoing') {
    return applyOngoing({ document, stepId, element, control, step, before, context });
  }
  const expectedText = dateTextOf(raw);
  const expected = isYearOnlyPicker(element, control) ? (yearTextOf(expectedText) || expectedText) : expectedText;
  if (!expected) return makeResult(stepId, 'manual', { before, after: before, reason: 'date-value-empty: 没有可填写的日期值' });
  const write = writeTextValue(element, expected);
  const readBack = await readBackAfterSettle(element, expected, 600);
  const after = readBack.actual;
  if (readBack.matched) {
    recordWrite(document, { element, control, recordKind: 'value', before, after, stepId });
    return makeResult(stepId, 'verified', { before, after, changed: before !== after });
  }
  return makeResult(stepId, 'manual', {
    before,
    after,
    reason: `date-requires-manual-picker: 输入「${expected}」后读回「${after}」，需要人工在日历中选择${write.retried ? '（已重试一次）' : ''}`
  });
}

async function applyOngoing({ document, stepId, element, control, step, before, context }) {
  const group = findDateGroup(element);
  const ongoingBox = findOngoingCheckbox(group || element?.parentElement, element);
  if (ongoingBox) {
    const boxBefore = Boolean(ongoingBox.checked);
    writeCheckboxValue(ongoingBox, true);
    const boxAfter = Boolean(ongoingBox.checked);
    if (!boxAfter) {
      return makeResult(stepId, 'failed', { before, after: readElementValue(element, control), reason: 'ongoing-checkbox-not-checkable' });
    }
    recordWrite(document, {
      element: ongoingBox,
      // The page model only exposes the end-date text control; the checkbox is
      // restored through its element reference (and this log entry documents it).
      control: {},
      recordKind: 'checked',
      before: boxBefore,
      after: boxAfter,
      stepId
    });
    // Real pages often also want the end-date input to show a "present" label.
    let after = readElementValue(element, control);
    if (!isReadonlyControl(element, control) && !isDisabledControl(element, control) && String(element?.value ?? '') === '') {
      writeTextValue(element, ONGOING_TEXT);
      const readBack = await readBackAfterSettle(element, ONGOING_TEXT, 600);
      if (readBack.matched) {
        after = readBack.actual;
        recordWrite(document, { element, control, recordKind: 'value', before, after, stepId });
      }
    }
    return makeResult(stepId, 'verified', { before, after: after === '' ? { ongoing: true } : after, changed: true });
  }

  const elementType = controlTypeOf(element);
  if (elementType === 'combobox' || elementType === 'native-select') {
    return selectControl({ document, stepId, element, control, step: { ...step, value: ONGOING_TEXT }, before, context });
  }
  if (isReadonlyControl(element, control) || isDisabledControl(element, control)) {
    return makeResult(stepId, 'manual', { before, after: before, reason: 'ongoing-requires-manual: 同组没有「至今」勾选框，且结束时间字段只读' });
  }
  writeTextValue(element, ONGOING_TEXT);
  const readBack = await readBackAfterSettle(element, ONGOING_TEXT, 600);
  if (readBack.matched) {
    recordWrite(document, { element, control, recordKind: 'value', before, after: readBack.actual, stepId });
    return makeResult(stepId, 'verified', { before, after: readBack.actual, changed: before !== readBack.actual });
  }
  return makeResult(stepId, 'manual', {
    before,
    after: readBack.actual,
    reason: `ongoing-requires-manual: 「至今」写入后读回「${readBack.actual}」，需要人工确认`
  });
}

async function checkControl({ document, stepId, element, control, step, before }) {
  const expected = Boolean(step.value);
  if (!isCheckboxElement(element)) {
    return makeResult(stepId, 'failed', { before, after: before, reason: 'not-a-checkbox: 目标控件不是复选框' });
  }
  writeCheckboxValue(element, expected);
  const after = Boolean(element.checked);
  const verification = verifyCheckboxValue(element, expected);
  if (!verification.ok) return makeResult(stepId, 'failed', { before, after, reason: verification.reason });
  recordWrite(document, { element, control, recordKind: 'checked', before, after, stepId });
  return makeResult(stepId, 'verified', { before, after, changed: before !== after });
}

async function selectControl({ document, stepId, element, control, step, before, context }) {
  const elementType = controlTypeOf(element);
  const target = String(step.value ?? '');
  if (elementType === 'native-select' || isNativeSelect(element)) {
    const option = selectNativeOption(element, target);
    if (!option) return makeResult(stepId, 'failed', { before, after: before, reason: `option-not-found: <select> 中没有「${target}」` });
    const verification = verifyNativeSelectValue(element, target, option);
    const after = String(element.value ?? '');
    if (!verification.ok) return makeResult(stepId, 'failed', { before, after, reason: verification.reason });
    recordWrite(document, { element, control, recordKind: 'value', before, after, stepId });
    return makeResult(stepId, 'verified', { before, after, changed: before !== after });
  }
  return selectCombobox({ document, stepId, element, control, step, before, target });
}

function openCombobox(trigger) {
  // The real page opens on mousedown + click on .ud__select__selector; the
  // fixture opens on a plain click on [role=combobox].
  dispatch(trigger, 'mousedown');
  if (typeof trigger?.click === 'function') trigger.click();
  else dispatch(trigger, 'click');
}

async function selectCombobox({ document, stepId, element, control, step, before, target }) {
  const trigger = comboboxTrigger(element);
  focusElement(element);
  if (typeof trigger?.click !== 'function' && typeof trigger?.dispatchEvent !== 'function') {
    return makeResult(stepId, 'failed', { before, after: before, reason: 'combobox-not-clickable' });
  }
  openCombobox(trigger);
  const options = await waitForOptions(document);
  if (!options.length) {
    await closePopup(document, element);
    return makeResult(stepId, 'failed', { before, after: before, reason: 'option-list-not-opened: 点击后未出现 [role="option"] 或 .ud__select__list__item' });
  }
  const { match } = await findOption(document, target);
  if (!match) {
    const labels = options.map(option => optionText(option)).filter(Boolean);
    await closePopup(document, element);
    return makeResult(stepId, 'failed', { before, after: before, reason: `option-not-found: 下拉框中没有「${target}」（可选：${labels.join(' / ')}）` });
  }
  if (typeof match.click === 'function') match.click();
  else dispatch(match, 'click');
  // Wait until the trigger shows the selection, then always close the popup.
  const displayUpdate = await pollUntil(() => {
    const candidates = readDisplayCandidates(element).map(normalizeKey);
    const wanted = normalizeKey(target);
    const label = normalizeKey(optionText(match));
    const value = normalizeKey(optionValue(match));
    return candidates.find(candidate => candidate === wanted || (label && candidate === label) || (value && candidate === value)) || null;
  }, { timeoutMs: POLL_TIMEOUT_MS });
  const popupClosed = await closePopup(document, element);
  const verification = verifyComboboxValue(element, target, match);
  const after = readElementValue(element, control);
  if (!verification.ok) {
    return makeResult(stepId, 'failed', { before, after, reason: verification.reason });
  }
  recordWrite(document, { element, control, recordKind: 'display', before, after, stepId });
  return makeResult(stepId, 'verified', {
    before,
    after,
    changed: before !== after || Boolean(displayUpdate),
    ...(popupClosed ? {} : { reason: 'popup-stayed-open: 已选中但弹层未能关闭' })
  });
}

// ---------------------------------------------------------------------------
// executeAction (add-item)
// ---------------------------------------------------------------------------

function sectionControls(pageModel, sectionId) {
  if (!pageModel || !sectionId) return 0;
  return (pageModel.controls || []).filter(control => control?.sectionId === sectionId && control?.visible !== false).length;
}

function sectionItems(pageModel, sectionId) {
  const section = (pageModel?.sections || []).find(item => item?.id === sectionId);
  if (section && Number.isInteger(section.itemCount)) return section.itemCount;
  return sectionControls(pageModel, sectionId);
}

function domControlCount(document, context) {
  const selector = typeof context.controlSelector === 'string' && context.controlSelector ? context.controlSelector : DEFAULT_CONTROL_SELECTOR;
  return queryAllDeep(document, selector).filter(node => controlTypeOf(node) !== 'file').length;
}

function isForbiddenAction(element, action) {
  const label = normalizeText(element?.textContent || action?.label);
  if (FORBIDDEN_ACTION_LABEL.test(label)) return true;
  if (FORBIDDEN_ACTION_CLASS.test(attribute(element, 'class'))) return true;
  if (attribute(element, 'data-save') !== '' || attribute(element, 'data-submit') !== '') return true;
  if (String(element?.type ?? '').toLowerCase() === 'submit') return true;
  return false;
}

/**
 * Real page: the repeatable module (one of the 11 applyFormModuleWrapper).
 * The wrapper's own class tokens look like `applyFormModuleWrapper-windows` /
 * `applyFormModuleWrapper__2JZaE`; children use `-title` / `-content`, so a bare
 * prefix match would resolve to the title/content instead of the module.
 */
const MODULE_ROOT_TOKEN = /^applyFormModuleWrapper(__[A-Za-z0-9]+|-windows)?$/;
function moduleOf(element) {
  for (let node = element; node; node = node.parentElement) {
    if (classTokens(node).some(token => MODULE_ROOT_TOKEN.test(token))) return node;
  }
  return element?.closest?.('[class*="apply-form-module"]') || null;
}

/** Real page: one card per repeatable item (`apply-form-array-card__<hash>`). */
function cardCountIn(moduleElement) {
  if (!moduleElement?.querySelectorAll) return 0;
  return queryAllDeep(moduleElement, '[class*="apply-form-array-card__"]').length;
}

function sectionLabelFor(pageModel, sectionId) {
  return String((pageModel?.sections || []).find(section => section.id === sectionId)?.label ?? '');
}

const matchesActionLabel = (button, label) => {
  const wanted = normalizeKey(label);
  if (!wanted) return false;
  const text = normalizeKey(button.textContent);
  if (!text) return false;
  return text === wanted || text.includes(wanted) || (text.length >= 2 && wanted.includes(text));
};

function resolveActionElement(document, action, pageModel, context = {}) {
  const modelAction = (pageModel?.actions || []).find(item => item?.actionId === action.actionId) || null;
  if (typeof context.resolveAction === 'function') {
    const hook = context.resolveAction(action.actionId, modelAction);
    if (hook) return { element: hook, modelAction };
  }
  const token = action.selectorToken || modelAction?.selectorToken;
  const selector = typeof context.actionSelector === 'string' && context.actionSelector ? context.actionSelector : DEFAULT_ACTION_SELECTOR;
  const label = normalizeText(action.label || modelAction?.label);
  const all = queryAllDeep(document, selector);
  const buttons = all.filter(node => isRendered(node) && !isForbiddenAction(node, modelAction));
  const index = controlTokenIndex(token);
  if (index !== null) {
    // page-inspector contract: action-token-<n> indexes the RAW action query
    // (forbidden buttons still occupy an index), so all[index] is authoritative.
    const candidates = [all[index], buttons[index]].filter(Boolean);
    const candidate = candidates.find(node => !label || matchesActionLabel(node, label));
    if (candidate) return { element: candidate, modelAction };
  }
  if (!label) return { error: 'action-not-resolvable: 缺少 actionId 对应的 selectorToken 或 label' };
  // Every repeatable module has a button with the same label (real page: "添加"),
  // so scope by the module/section label before accepting a label match.
  const labelMatches = buttons.filter(button => matchesActionLabel(button, label));
  if (labelMatches.length === 1) return { element: labelMatches[0], modelAction };
  const sectionId = action.sectionId || modelAction?.sectionId;
  const sectionLabel = normalizeKey(sectionLabelFor(pageModel, sectionId));
  if (sectionLabel) {
    const scoped = labelMatches.filter(button => normalizeKey(moduleOf(button)?.textContent || '').includes(sectionLabel));
    if (scoped.length === 1) return { element: scoped[0], modelAction };
  }
  if (labelMatches.length > 1) return { error: `action-ambiguous: 页面上有 ${labelMatches.length} 个「${label}」按钮，无法安全定位到分区` };
  return { error: `action-element-missing: 找不到「${label}」按钮` };
}

export async function executeAction(document, action = {}, context = {}) {
  const safeAction = record(action) ? action : {};
  const stepId = String(safeAction.stepId ?? safeAction.actionId ?? 'action-unknown');
  if (!record(action)) return makeResult(stepId, 'failed', { reason: 'invalid-action' });
  if (hasScriptKey(action)) return makeResult(stepId, 'failed', { reason: 'forbidden-property: 动作里不允许出现选择器/脚本' });
  const kind = String(action.kind ?? action.tool ?? '');
  if (kind !== 'add-item') return makeResult(stepId, 'skipped', { reason: `unsupported-action: ${kind || '(missing)'}` });
  if (typeof action.actionId !== 'string' || !action.actionId) return makeResult(stepId, 'failed', { reason: 'action-id-required' });

  context = context || {};
  const pageModel = await ensurePageModel(document, context);
  if (!pageModel) return makeResult(stepId, 'failed', { reason: 'page-model-unavailable' });
  const resolved = resolveActionElement(document, action, pageModel, context);
  if (resolved.error) return makeResult(stepId, 'failed', { reason: resolved.error });
  const { element, modelAction } = resolved;
  if (isForbiddenAction(element, modelAction)) return makeResult(stepId, 'failed', { reason: 'forbidden-action: 拒绝点击保存/提交类按钮' });
  if (typeof element.click !== 'function') return makeResult(stepId, 'failed', { reason: 'action-not-clickable' });
  const actionMismatch = stepControlMismatch(action, modelAction || {});
  if (actionMismatch) {
    return makeResult(stepId, 'failed', { reason: `step-action-mismatch: ${actionMismatch}（页面结构可能已变化，请重新 inspect + plan）` });
  }

  const sectionId = action.sectionId || modelAction?.sectionId;
  const cardModule = moduleOf(element);
  const beforeCards = cardCountIn(cardModule);
  const before = {
    itemCount: sectionItems(pageModel, sectionId),
    controlCount: sectionControls(pageModel, sectionId) || domControlCount(document, context),
    ...(cardModule ? { cardCount: beforeCards } : {})
  };
  element.click();

  const advanced = await pollUntil(async () => {
    const fresh = await inspectNow(document, context);
    const domCount = domControlCount(document, context);
    const cardsNow = cardCountIn(cardModule);
    const knownSection = (pageModel.sections || []).find(section => section.id === sectionId) || null;
    const freshSection = fresh
      ? (fresh.sections || []).find(section => section.id === sectionId)
        || (knownSection?.label ? (fresh.sections || []).find(section => section.label === knownSection.label) : null)
      : null;
    const freshControlCount = freshSection ? sectionControls(fresh, freshSection.id) : 0;
    const freshItemCount = freshSection ? sectionItems(fresh, freshSection.id) : 0;
    const sectionGrew = freshControlCount > before.controlCount || freshItemCount > before.itemCount;
    const cardsGrew = cardModule ? cardsNow > beforeCards : false;
    const domGrew = domCount > before.controlCount;
    if (!sectionGrew && !cardsGrew && !domGrew) return null;
    const addedCards = Math.max(0, cardsNow - beforeCards);
    return {
      pageModel: fresh || pageModel,
      itemCount: freshItemCount > before.itemCount
        ? freshItemCount
        : before.itemCount + (addedCards || Math.max(0, domCount - before.controlCount)),
      controlCount: sectionGrew ? freshControlCount : domCount,
      ...(cardModule ? { cardCount: cardsNow } : {})
    };
  }, { timeoutMs: POLL_TIMEOUT_MS, intervalMs: POLL_INTERVAL_MS });

  if (!advanced) return makeResult(stepId, 'failed', { before, after: before, reason: 'add-item-timeout: 点击后 1500ms 内条目数没有增加' });
  if (advanced.pageModel) context.pageModel = advanced.pageModel;
  return makeResult(stepId, 'verified', {
    before,
    after: {
      itemCount: advanced.itemCount,
      controlCount: advanced.controlCount,
      ...(advanced.cardCount === undefined ? {} : { cardCount: advanced.cardCount })
    },
    changed: true
  });
}

// ---------------------------------------------------------------------------
// Legacy compatibility (executeTool) — old orchestrator/content-entry API
// ---------------------------------------------------------------------------

export async function executeTool(document, rawAction = {}, context = {}) {
  const pageModel = context.pageModel || (await ensurePageModel(document, context)) || { controls: [], sections: [] };
  const action = rawAction?.tool ? rawAction : normalizePlannedAction(rawAction, pageModel);
  if (action?.rejected) return { status: 'skipped', reason: action.reason, changed: false };
  let gate = { allowed: true };
  try {
    const { validatePlannedAction } = await import('./action-guard.mjs');
    gate = validatePlannedAction(action, { pageModel, task: { status: 'pending' } });
  } catch {
    gate = { allowed: true };
  }
  if (!gate?.allowed) return { status: 'skipped', reason: gate?.reason, changed: false };
  if (action.tool === 'ask_user') return { status: 'manual', reason: 'user-input-required', changed: false };
  if (action.tool === 'wait') {
    await delay(Math.min(Number(action.arguments?.ms || 0), 10000));
    return { status: 'verified', changed: false };
  }
  if (action.tool === 'undo') return undoLastFill(document);

  const resolved = resolveControl(document, pageModel, action.target, context);
  if (resolved.error) return { status: 'skipped', reason: resolved.error === 'control-not-found' ? 'target-disappeared' : resolved.error, changed: false };
  const { control, element } = resolved;
  if (action.tool === 'open') return { status: 'verified', changed: false };
  if (!isRendered(element)) return { status: 'skipped', reason: 'target-not-visible', changed: false };
  if (action.tool === 'read_value') return { status: 'verified', actual: readActual(element), changed: false };
  if (action.tool === 'verify') return verifyAction(document, action, { actual: readActual(element), element }, context);

  const before = readElementValue(element, control);
  const args = action.arguments || {};
  if (action.tool === 'focus') {
    focusElement(element);
    return { status: 'verified', before, actual: before, changed: false };
  }
  try {
    if (action.tool === 'type') {
      const expected = String(args.value ?? '');
      const write = writeTextValue(element, expected);
      if (!write.matched) return { status: 'skipped', reason: 'verification-failed', before, actual: write.actual, changed: write.actual !== before };
      const changed = write.actual !== before;
      recordWrite(document, { element, control, recordKind: 'value', before, after: write.actual, stepId: `${action.tool}:${action.target}` });
      return { status: 'verified', before, actual: write.actual, changed };
    }
    if (action.tool === 'check') {
      writeCheckboxValue(element, Boolean(args.checked));
      const actual = Boolean(element.checked);
      if (actual !== Boolean(args.checked)) return { status: 'skipped', reason: 'verification-failed', before, actual, changed: actual !== before };
      recordWrite(document, { element, control, recordKind: 'checked', before, after: actual, stepId: `${action.tool}:${action.target}` });
      return { status: 'verified', before, actual, changed: actual !== before };
    }
    if (action.tool === 'select') {
      const result = await selectControl({ document, stepId: `${action.tool}:${action.target}`, element, control, step: { value: args.value }, before, context });
      const actual = readElementValue(element, control);
      if (result.status !== 'verified') return { status: 'skipped', reason: result.reason, before, actual, changed: false };
      recordWrite(document, { element, control, recordKind: controlTypeOf(element) === 'native-select' ? 'value' : 'display', before, after: actual, stepId: result.stepId });
      return { status: 'verified', before, actual, changed: actual !== before };
    }
  } catch (error) {
    return { status: 'skipped', reason: `execution-error: ${error?.message || error}`, changed: false };
  }
  return { status: 'skipped', reason: 'unsupported-tool', changed: false };
}
