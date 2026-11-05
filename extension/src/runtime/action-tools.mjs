// action-tools.mjs — constrained legacy action vocabulary (pre-v2) plus the
// shared forbidden-key guard used by the v2 executor.
//
// The v2 fill engine does not let any planner hand the runtime a CSS selector or
// a script: actions only reference ids that exist in the PageModel. The legacy
// tool vocabulary (focus/type/check/select/...) is kept because the old
// orchestrator/content-entry pair still imports it while the rewrite lands.

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const TOOL_NAMES = Object.freeze(['focus', 'open', 'type', 'check', 'select', 'wait', 'read_value', 'verify', 'ask_user', 'undo']);
export const TOOL_SET = new Set(TOOL_NAMES);

const noArguments = { type: 'object', properties: {}, required: [], additionalProperties: false };
const target = { type: 'string', minLength: 1 };

export const TOOL_DEFINITIONS = Object.freeze({
  focus: { name: 'focus', description: 'Focus a known page control', parameters: noArguments, target: true },
  open: { name: 'open', description: 'Open a known section or control affordance', parameters: noArguments, target: true },
  type: { name: 'type', description: 'Type text into a known text control', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }, target: true },
  check: { name: 'check', description: 'Set a known checkbox state', parameters: { type: 'object', properties: { checked: { type: 'boolean' } }, required: ['checked'], additionalProperties: false }, target: true },
  select: { name: 'select', description: 'Select a known option', parameters: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }, target: true },
  wait: { name: 'wait', description: 'Wait briefly for a page update', parameters: { type: 'object', properties: { ms: { type: 'integer', minimum: 0, maximum: 10000 } }, required: [], additionalProperties: false }, target: false },
  read_value: { name: 'read_value', description: 'Read a known control value', parameters: noArguments, target: true },
  verify: { name: 'verify', description: 'Verify a known control state', parameters: noArguments, target: true },
  ask_user: { name: 'ask_user', description: 'Ask the user for a decision', parameters: { type: 'object', properties: { question: { type: 'string', minLength: 1, maxLength: 1000 } }, required: ['question'], additionalProperties: false }, target: false },
  undo: { name: 'undo', description: 'Undo the last verified action', parameters: noArguments, target: false }
});

/**
 * Keys that would smuggle a selector/script/URL into the runtime. The v2 executor
 * rejects any step/action carrying one of these (defense in depth on top of the
 * "only controlId/actionId" contract).
 */
export const SCRIPT_KEYS = Object.freeze([
  'selector', 'selectors', 'css', 'xpath', 'query', 'querySelector', 'script', 'javascript',
  'code', 'expression', 'evaluate', 'handler', 'onclick', 'src', 'href'
]);
export const SCRIPT_KEY_SET = new Set(SCRIPT_KEYS);

export function isScriptKey(key) {
  return SCRIPT_KEY_SET.has(String(key ?? '').toLowerCase());
}

/** Deep check for selector/script smuggling inside a plan step or action. */
export function hasScriptKey(value) {
  if (Array.isArray(value)) return value.some(hasScriptKey);
  if (!isRecord(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (isScriptKey(key)) return true;
    if (hasScriptKey(child)) return true;
  }
  return false;
}

// Legacy action normalization keeps the old (wider) forbidden list untouched.
const FORBIDDEN_KEYS = new Set(['selector', 'selectors', 'script', 'javascript', 'code', 'handler', 'onclick', 'path', 'pathSegments', 'resumePath', 'candidatePath', 'url', 'file', 'files', 'filename', 'submit', 'click', 'action']);
const forbiddenKey = key => FORBIDDEN_KEYS.has(String(key).toLowerCase());

function hasForbidden(value) {
  if (!isRecord(value) && !Array.isArray(value)) return false;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKey(key)) return true;
    if (hasForbidden(child)) return true;
  }
  return false;
}

function targetsFor(pageModel = {}) {
  const controls = Array.isArray(pageModel.controls) ? pageModel.controls : [];
  const sections = Array.isArray(pageModel.sections) ? pageModel.sections : [];
  return {
    controls,
    sections,
    ids: new Set([...controls.map(control => control?.controlId), ...sections.map(section => section?.id ?? section?.sectionId)].filter(Boolean))
  };
}

function argumentError(tool, args) {
  if (!isRecord(args)) return 'invalid-arguments';
  if (Object.keys(args).some(forbiddenKey)) return 'forbidden-property';
  const definition = TOOL_DEFINITIONS[tool].parameters;
  const allowed = new Set(Object.keys(definition.properties || {}));
  if (Object.keys(args).some(key => !allowed.has(key))) return 'unknown-argument';
  for (const key of definition.required || []) if (!(key in args)) return `missing-${key}`;
  if (tool === 'type' && typeof args.value !== 'string') return 'type-value-required';
  if (tool === 'check' && typeof args.checked !== 'boolean') return 'check-boolean-required';
  if (tool === 'select' && typeof args.value !== 'string') return 'select-value-required';
  if (tool === 'wait' && args.ms !== undefined && (!Number.isInteger(args.ms) || args.ms < 0 || args.ms > 10000)) return 'wait-ms-invalid';
  if (tool === 'ask_user' && (typeof args.question !== 'string' || !args.question.trim())) return 'question-required';
  return null;
}

const ALLOWED_ACTION_KEYS = new Set(['tool', 'target', 'arguments', 'reason', 'confidence']);

export function normalizePlannedAction(raw, pageModel = {}) {
  if (!isRecord(raw)) return { rejected: true, reason: 'invalid-action' };
  if (hasForbidden(raw)) return { rejected: true, reason: 'forbidden-property' };
  if (Object.keys(raw).some(key => !ALLOWED_ACTION_KEYS.has(key))) return { rejected: true, reason: 'unknown-property' };
  if (typeof raw.tool !== 'string' || !TOOL_SET.has(raw.tool)) return { rejected: true, reason: 'unknown-tool' };
  const definition = TOOL_DEFINITIONS[raw.tool];
  if (definition.target && (typeof raw.target !== 'string' || !raw.target)) return { rejected: true, reason: 'target-required' };
  if (!definition.target && raw.target !== undefined && raw.target !== null) return { rejected: true, reason: 'target-not-allowed' };
  const { ids } = targetsFor(pageModel);
  if (definition.target && !ids.has(raw.target)) return { rejected: true, reason: 'target-not-found' };
  const args = raw.arguments === undefined ? {} : raw.arguments;
  const argReason = argumentError(raw.tool, args);
  if (argReason) return { rejected: true, reason: argReason };
  if (raw.confidence !== undefined && (typeof raw.confidence !== 'number' || !Number.isFinite(raw.confidence) || raw.confidence < 0 || raw.confidence > 1)) {
    return { rejected: true, reason: 'invalid-confidence' };
  }
  if (raw.reason !== undefined && typeof raw.reason !== 'string') return { rejected: true, reason: 'invalid-reason' };
  return {
    tool: raw.tool,
    ...(definition.target ? { target: raw.target } : {}),
    arguments: { ...args },
    ...(raw.reason === undefined ? {} : { reason: raw.reason }),
    ...(raw.confidence === undefined ? {} : { confidence: raw.confidence })
  };
}

export function isNormalizedPlannedAction(value) {
  return isRecord(value) && typeof value.tool === 'string' && TOOL_SET.has(value.tool);
}

export { isRecord as record };
