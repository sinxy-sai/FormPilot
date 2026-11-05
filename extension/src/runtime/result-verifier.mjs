// result-verifier.mjs — read-back verification for the fill engine v2 (contract §5).
//
// The executor never trusts that a write "worked": every mutation is followed by
// reading the current page state and comparing it with the intended value. The
// page-shape knowledge (native input / native select / custom combobox /
// checkbox / date) lives here so control-executor.mjs stays about sequencing.
//
// Everything here is pure with respect to the element it receives: it only reads
// attributes/properties, never writes and never polls.

/** Visible labels that mean "no end date". */
export const ONGOING_TEXT_PATTERN = /至今|现在|目前|present|current|now/i;
/** Exact values that mean "no end date" (after trimming). */
export const ONGOING_VALUE_PATTERN = /^(至今|今|present|now|current)$/i;
/** Date text we are willing to type without opening a calendar widget. */
export const DATE_TEXT_PATTERN = /^\d{4}(-\d{2})?$/;

const DECORATION = /[▾▸▼⌄⌃▲◂▶►•·⋯…]+/g;

/** Read an attribute with a boolean-safe property fallback (`false` means absent). */
export function attribute(element, name) {
  const value = element?.getAttribute?.(name);
  if (value !== null && value !== undefined) return String(value);
  const property = element?.[name];
  if (property === undefined || property === null) return '';
  if (typeof property === 'boolean') return property ? 'true' : '';
  if (typeof property === 'object') return '';
  return String(property);
}

export function tagName(element) {
  return String(element?.tagName ?? '').toLowerCase();
}

export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

export function normalizeKey(value) {
  return normalizeText(value).toLocaleLowerCase();
}

export function sameText(first, second) {
  return normalizeKey(first) === normalizeKey(second);
}

/** Remove decorative glyphs (dropdown arrows) so textContent comparisons work. */
export function stripDecoration(value) {
  return normalizeText(String(value ?? '').replace(DECORATION, ' '));
}

export function isCheckboxElement(element) {
  return String(element?.type ?? '').toLowerCase() === 'checkbox' || normalizeKey(attribute(element, 'role')) === 'checkbox';
}

export function isComboboxElement(element) {
  const role = normalizeKey(attribute(element, 'role'));
  if (role === 'combobox') return true;
  return Boolean(element?.closest?.('[class*="ud__select__selector"]'));
}

export function isNativeSelect(element) {
  return tagName(element) === 'select';
}

const DISPLAY_SELECTORS = [
  '.selectValue',
  '.areaCodeValue',
  '[class*="ud__select__selector__selectItem"]',
  '[class*="ud__select__selector__tag"]',
  '.ud__tag',
  '.chip',
  '[data-value]'
];

const classTokensOf = element => String(attribute(element, 'class') || '').split(/\s+/).filter(Boolean);

/**
 * Real page: the `.ud__select__selector` container (the click target and the
 * owner of the visible label). Inner elements like
 * `.ud__select__selector__search__input` also contain the prefix, so the match
 * must be on the base class token, not on a substring.
 */
export function udSelectTrigger(element) {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    if (classTokensOf(node).some(token => /^ud__select__selector(-[A-Za-z0-9]+)?$/.test(token))) return node;
  }
  return null;
}

/**
 * Root element that owns the visible label of a custom select.
 * Real ByteDance page: input[role=combobox] lives inside .ud__select__selector,
 * and the display text is in .ud__select__selector__selectItem — never in the
 * input's value, which stays empty.
 */
export function comboboxRoot(element) {
  if (!element) return null;
  return udSelectTrigger(element)
    || element.closest?.('.formily-select, [class*="formily-select"]')
    || element.closest?.('[class*="resumeEditForm-multiSelect"]')
    || element;
}

/**
 * Every plausible "displayed value" of a custom combobox, most specific first.
 * Contract §5 order: aria-valuetext → .selectValue/[data-value] textContent →
 * element.textContent. The real page adds .ud__select__selector__selectItem;
 * multi-select chip groups can show several values, so the executor compares
 * against the whole list instead of only the first match.
 */
export function readDisplayCandidates(element) {
  if (!element) return [];
  const root = comboboxRoot(element) || element;
  const candidates = [];
  const push = value => {
    const text = normalizeText(value);
    if (text && !candidates.includes(text)) candidates.push(text);
  };
  push(attribute(root, 'aria-valuetext'));
  push(attribute(element, 'aria-valuetext'));
  for (const selector of DISPLAY_SELECTORS) {
    for (const holder of root.querySelectorAll?.(selector) || []) {
      push(holder.textContent);
      push(attribute(holder, 'data-value'));
      push(attribute(holder, 'aria-label'));
    }
  }
  push(element.value);
  push(attribute(root, 'data-value'));
  push(attribute(element, 'data-value'));
  push(stripDecoration(root.textContent));
  return candidates;
}

export function readDisplayValue(element) {
  return readDisplayCandidates(element)[0] ?? '';
}

/** Canonical current value for a model control: boolean for checkboxes, text otherwise. */
export function readElementValue(element, control = {}) {
  if (!element) return undefined;
  const controlType = normalizeKey(control?.controlType);
  if (isCheckboxElement(element) || controlType === 'checkbox') return Boolean(element.checked);
  if (isComboboxElement(element) || controlType === 'combobox') return readDisplayValue(element);
  if (isNativeSelect(element) || controlType === 'native-select') return String(element.value ?? '');
  return String(element.value ?? '');
}

function selectedOption(element) {
  const options = [...(element?.options || element?.querySelectorAll?.('option') || [])];
  if (!options.length) return null;
  const selectedIndex = Number(element?.selectedIndex ?? -1);
  if (Number.isInteger(selectedIndex) && selectedIndex >= 0 && options[selectedIndex]) return options[selectedIndex];
  return options.find(option => option?.selected) || null;
}

export function readSelectedOption(element) {
  return selectedOption(element);
}

/** Text input / textarea read-back (strict, per contract §5). */
export function verifyTextValue(element, expected) {
  const actual = String(element?.value ?? '');
  const wanted = String(expected ?? '');
  if (actual === wanted) return { ok: true, actual };
  return { ok: false, actual, reason: `value-mismatch: expected "${wanted}", read back "${actual}"` };
}

/** Date inputs are text inputs with a calendar affordance; same strict read-back. */
export function verifyDateValue(element, expected) {
  return verifyTextValue(element, expected);
}

export function verifyCheckboxValue(element, expected) {
  const actual = Boolean(element?.checked);
  if (actual === Boolean(expected)) return { ok: true, actual };
  return { ok: false, actual, reason: `checkbox-mismatch: expected ${Boolean(expected)}, read back ${actual}` };
}

/** Native <select>: accept the option value as well as the option label. */
export function verifyNativeSelectValue(element, expected, option = null) {
  const actual = String(element?.value ?? '');
  const candidates = [expected, option?.value]
    .filter(value => value !== undefined && value !== null)
    .map(value => String(value));
  if (candidates.includes(actual)) return { ok: true, actual };
  const selected = selectedOption(element);
  if (selected && (sameText(selected.textContent ?? selected.text, expected) || candidates.includes(String(selected.value)))) {
    return { ok: true, actual };
  }
  return { ok: false, actual, reason: `select-mismatch: expected "${expected}", read back "${actual}"` };
}

/**
 * Custom combobox: the DOM usually keeps the value in a label node
 * (.selectValue / .areaCodeValue / .chip) and mirrors it in data-value.
 * Accept the target text, the matched option label, or the matched option value.
 */
export function verifyComboboxValue(element, expected, option = null) {
  const candidates = readDisplayCandidates(element).map(normalizeKey);
  const wanted = normalizeKey(expected);
  if (candidates.includes(wanted)) return { ok: true, actual: readDisplayValue(element) };
  const accepted = [option?.textContent, attribute(option, 'data-value'), attribute(option, 'aria-label'), option?.value]
    .map(normalizeKey)
    .filter(Boolean);
  const hit = candidates.find(candidate => accepted.includes(candidate));
  if (hit) return { ok: true, actual: hit };
  return {
    ok: false,
    actual: readDisplayValue(element),
    reason: `combobox-mismatch: expected "${expected}", displayed "${readDisplayValue(element)}"`
  };
}

export function verifyElementValue(element, control, expected) {
  const controlType = normalizeKey(control?.controlType);
  if (controlType === 'checkbox' || isCheckboxElement(element)) return verifyCheckboxValue(element, expected);
  if (controlType === 'native-select' || isNativeSelect(element)) return verifyNativeSelectValue(element, expected);
  if (controlType === 'combobox' || isComboboxElement(element)) return verifyComboboxValue(element, expected);
  if (controlType === 'date') return verifyDateValue(element, expected);
  return verifyTextValue(element, expected);
}

// ---------------------------------------------------------------------------
// Legacy compatibility (pre-v2 action model). The v2 executor does not use
// these, but content-entry.mjs / orchestrator.mjs still import them while the
// rewrite lands; keep the old contract alive until those files move.
// ---------------------------------------------------------------------------

export function readActual(element) {
  if (!element) return undefined;
  if (element.type === 'checkbox' || normalizeKey(attribute(element, 'role')) === 'checkbox') return Boolean(element.checked);
  if (tagName(element) === 'select' || element.options) return String(element.value ?? '');
  if (normalizeKey(attribute(element, 'role')) === 'combobox') {
    return String(element.value ?? attribute(element, 'aria-valuetext') ?? element.textContent ?? '');
  }
  return String(element.value ?? element.textContent ?? '');
}

export function expectedValue(action = {}) {
  const args = action.arguments || action;
  if (action.tool === 'check' || action.type === 'checkbox') return Boolean(args.checked);
  if (action.tool === 'select' || action.type === 'native-select') return String(args.value ?? '');
  if (action.type === 'custom-select') return String(args.optionText ?? '');
  if (action.tool === 'type' || ['text', 'textarea', 'date', 'email', 'tel', 'url', 'number', 'password', 'search'].includes(action.type)) {
    return String(args.value ?? '');
  }
  return undefined;
}

function legacyEqual(action, actual, target) {
  const args = action?.arguments || action || {};
  if (action?.tool === 'check' || action?.type === 'checkbox') return Boolean(actual) === Boolean(args.checked);
  if (action?.tool === 'select' || action?.type === 'native-select') {
    const wanted = String(args.value ?? '');
    if (String(actual) === wanted) return true;
    const option = [...(target?.options || [])].find(item => String(item.value) === wanted || sameText(item.textContent ?? item.text, wanted));
    return Boolean(option && String(actual) === String(option.value));
  }
  if (action?.type === 'custom-select') return sameText(actual, args.optionText);
  const wanted = expectedValue(action);
  return wanted === undefined ? true : String(actual) === wanted;
}

function hasPageError(document, context = {}) {
  if (context.pageError || context.error) return true;
  return Boolean(document?.querySelector?.('[data-formpilot-error], [role="alert"][data-error], .formpilot-error'));
}

async function currentFingerprint(document, context = {}) {
  if (typeof context.getPageFingerprint === 'function') return context.getPageFingerprint();
  try {
    const { inspectPage } = await import('./page-inspector.mjs');
    return inspectPage(document, { capabilities: context.capabilities }).pageModel.fingerprint;
  } catch {
    return undefined;
  }
}

export async function verifyAction(document, action, result = {}, context = {}) {
  const element = result.element || context.element || null;
  const actual = result.actual !== undefined ? result.actual : readActual(element);
  const tool = action?.tool;
  const bypass = tool === 'wait' || tool === 'ask_user' || tool === 'undo';
  if (!element && !bypass) return { verified: false, reason: 'target-disappeared', actual };
  if (element && element.isConnected === false && !bypass) return { verified: false, reason: 'target-disappeared', actual };
  if (hasPageError(document, context)) return { verified: false, reason: 'page-error', actual };
  const expectedFingerprint = context.pageFingerprint || context.expectedFingerprint || action?.pageFingerprint;
  const fingerprint = await currentFingerprint(document, context);
  if (expectedFingerprint && fingerprint && expectedFingerprint !== fingerprint && context.allowStructureChange !== true) {
    return { verified: false, reason: 'structure-changed', actual };
  }
  if (result.reason && result.reason !== 'verified') return { verified: false, reason: result.reason, actual };
  if (result.changed === false && ['type', 'check', 'select'].includes(tool)) return { verified: false, reason: 'value-unchanged', actual };
  if (!legacyEqual(action, actual, element)) return { verified: false, reason: 'value-unchanged', actual };
  return { verified: true, reason: undefined, actual };
}
