/**
 * dom-twin.mjs — FormPilot 测试用「零依赖最小 DOM 替身」
 * =====================================================================
 * 为什么存在：本机沙箱无法启动 Chromium（mojo named pipe 被拒），
 * 所以 page-inspector / control-executor / fill-e2e 的单测都在 Node 里
 * 用这棵「双胞胎」元素树跑。它不是 jsdom，只实现 FormPilot 真正用到的 API，
 * 行为尽量贴近浏览器（事件冒泡、原生 value/checked setter、可见性、
 * 自定义下拉点击后才生成 .ud__select__list__item 等）。
 *
 * 纯 ESM、零依赖、无 IO，可直接 `node --test`。
 *
 * ---------------------------------------------------------------------
 * 导出接口（稳定约定，B 的 control-executor.test.mjs 可直接依赖）
 * ---------------------------------------------------------------------
 * 元素构造
 *   h(tag, props?, children?) -> Element
 *     props:
 *       attrs: { name: value }      // 直接 setAttribute；false/null/undefined 跳过，true -> 空属性
 *       dataset: { fooBar: 'x' }    // -> data-foo-bar
 *       style: 'display:none' | { display: 'flex' }
 *       text: '文本'                 // 追加一个文本节点
 *       children / 第三参: Array<Element|string>
 *       on: { click: fn }            // addEventListener
 *       onclick / oninput / ...      // 简写，同上
 *       shadow: Array<Element>       // attachShadow({mode:'open'}) 后挂载
 *       rect: { width, height }      // 覆盖 getBoundingClientRect
 *       value / checked / selected / selectedIndex / disabled / readOnly /
 *       type / name / id / className / title / placeholder / href / htmlFor ...
 *       其它 key 一律当属性处理：h('label', { for: 'x', class: 'y' })
 *
 *   createDocument({ title?, location?, body?, html? }) -> Document
 *     location: { origin?, pathname?, search?, hash?, href? }
 *
 *   createBytedanceTwin() -> TwinPage
 *     按真实招聘站点「编辑简历」页复刻：
 *     - 11 个模块：[class*="applyFormModuleWrapper"]，标题在
 *       [class*="applyFormModuleWrapper-title"] [class*="applyFormModuleWrapper-text"]
 *     - 字段容器 .ud-formily-item + data-form-field-name / data-form-field-i18n-name
 *       （页面没有 id / name / label[for]）
 *     - 自定义下拉：.ud__select / .ud__select__selector，展示值在
 *       .ud__select__selector__selectItem，input[role=combobox].value 恒为空；
 *       点击后才有 .ud__select__list__item 弹层；关闭后弹层留在 DOM（display:none）
 *     - 起止时间：两个普通 text input；获奖时间：.ud__picker-input[placeholder=YYYY]
 *     - 可重复卡片：[class*="apply-form-array-card__"]；添加按钮
 *       button[class*="apply-form-array-card-add"]；删除按钮
 *       button[class*="apply-form-array-card-delete"]（禁止点击）
 *     - 底部 保存/.atsx-btn-primary、取消/.atsx-btn-default（点击只计数）
 *     返回 { document, window, submits, submitCount(), rawControlElements(),
 *            controlElements(), buildCard(sectionKey, index), addCard(sectionKey, n?),
 *            addButton(sectionKey), module(sectionKey), select(field),
 *            openSelect(field), options(field), chooseOption(field, label),
 *            closeSelects(), click(target), moduleTitles() }
 *
 * DOM 能力（元素上）
 *   querySelector / querySelectorAll（支持 tag、#id、.class、*、
 *     [attr]、[attr="v"]、[attr^="v"] 等 6 种比较符、逗号列表、后代/子代）
 *   matches / closest
 *   getAttribute / setAttribute / hasAttribute / removeAttribute / toggleAttribute
 *   getAttributeNames / dataset / classList / style / id / className / hidden
 *   appendChild / append / prepend / insertBefore / removeChild / remove /
 *   replaceChildren
 *   addEventListener / removeEventListener / dispatchEvent / click() / focus() /
 *   blur(); 事件冒泡到 document 与 defaultView；click 默认行为含
 *   checkbox/radio 切换、label -> 控件转发
 *   value / checked / selected / options / selectedIndex（原生 setter 定义在
 *     HTMLInputElement.prototype / HTMLTextAreaElement.prototype /
 *     HTMLSelectElement.prototype 上，可用 Object.getOwnPropertyDescriptor 取到）
 *   textContent / innerHTML / outerHTML
 *   getClientRects() / getBoundingClientRect()（默认非零；display:none /
 *     [hidden] / input[type=hidden] 时为零）
 *   labels（label[for] + 包裹 label）、ownerDocument、defaultView
 *   document.defaultView: { Event, MouseEvent, CustomEvent, getComputedStyle,
 *     location, setTimeout, requestAnimationFrame, addEventListener, ... }
 *   shadowRoot: h(el, { shadow: [...] }) 或 el.attachShadow({mode:'open'})
 *
 * 选择器辅助
 *   CONTROL_SELECTOR  = 'input, textarea, select, [role="combobox"], [contenteditable="true"]'
 *   ACTION_SELECTOR   = 'button, [role="button"], a'
 *   queryAllDeep(root, selector)            // 与 page-inspector 完全同款深查询
 *   controlElements(document)               // 原样返回深查询结果（含 file/hidden）
 *   resolveSelectorToken(document, token)   // 'control-token-<n>' -> 原始下标元素
 *   serializeNode(node)                     // outerHTML（fixture 生成用）
 *
 * 全局注入（可选，给直接引用 HTMLInputElement 的代码兜底）
 *   installDomGlobals()  // 只补 undefined 的全局，幂等
 *
 * ---------------------------------------------------------------------
 * 用法示例
 * ---------------------------------------------------------------------
 * import { createBytedanceTwin } from './support/dom-twin.mjs';
 * const twin = createBytedanceTwin();
 * const { inspectPage } = await import('../../src/runtime/page-inspector.mjs');
 * const { pageModel } = inspectPage(twin.document, { capabilities: [] });
 * twin.document.querySelector('[class*="applyFormModuleWrapper__"]');  // 第一个模块
 * twin.submits;                                                        // 保存/取消点击次数（应恒为 0）
 *
 * 自定义小页面：
 *   import { h, createDocument, fire } from './support/dom-twin.mjs';
 *   const doc = createDocument({ title: 'T', location: { origin: 'https://t', pathname: '/x' } });
 *   const input = h('input', { attrs: { type: 'text', name: 'q' }, value: 'v' });
 *   doc.body.append(h('section', {}, [h('label', { for: 'q', text: '问题' }), input]));
 *   // input.labels[0].textContent === '问题'
 */

// ---------------------------------------------------------------------------
// 基础工具
// ---------------------------------------------------------------------------

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const HIDDEN_TAGS = new Set(['head', 'script', 'style', 'title', 'meta', 'link', 'template', 'base']);
const DEFAULT_RECT = Object.freeze({ width: 120, height: 24 });

const escapeText = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttr = value => String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const toKebab = value => String(value).replace(/[A-Z]/g, match => `-${match.toLowerCase()}`);
const toCamel = value => String(value).replace(/-([a-z])/g, (_, char) => char.toUpperCase());

const applyAttribute = (element, name, value) => {
  if (value === undefined || value === null || value === false) return;
  element.setAttribute(String(name).toLowerCase(), value === true ? '' : String(value));
};

const appendNodes = (parent, value) => {
  if (value === undefined || value === null) return;
  if (Array.isArray(value)) { for (const item of value) appendNodes(parent, item); return; }
  if (typeof value === 'string' || typeof value === 'number') { parent.appendChild(new TwinTextNode(parent.ownerDocument, String(value))); return; }
  parent.appendChild(value);
};

const setEventProperty = (event, name, value) => {
  try {
    Object.defineProperty(event, name, { value, writable: true, configurable: true, enumerable: true });
  } catch {
    try { event[name] = value; } catch { /* read-only foreign event: ignore */ }
  }
};

// ---------------------------------------------------------------------------
// 事件
// ---------------------------------------------------------------------------

export class TwinEvent {
  constructor(type, init = {}) {
    this.type = String(type);
    this.bubbles = init.bubbles === true;
    this.cancelable = init.cancelable === true;
    this.composed = init.composed === true;
    this.detail = init.detail ?? null;
    this.defaultPrevented = false;
    this.target = null;
    this.currentTarget = null;
    this.eventPhase = 0;
    this.timeStamp = Date.now();
    this.isTrusted = false;
    this._stop = false;
    this._immediateStop = false;
    this._path = [];
  }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this._stop = true; }
  stopImmediatePropagation() { this._stop = true; this._immediateStop = true; }
  composedPath() { return [...this._path]; }
}

export class TwinMouseEvent extends TwinEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.button = init.button ?? 0;
    this.buttons = init.buttons ?? 0;
    this.clientX = init.clientX ?? 0;
    this.clientY = init.clientY ?? 0;
    this.ctrlKey = init.ctrlKey === true;
    this.shiftKey = init.shiftKey === true;
    this.altKey = init.altKey === true;
    this.metaKey = init.metaKey === true;
  }
}

export class TwinCustomEvent extends TwinEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.detail = init.detail ?? null;
  }
}

export function fire(element, type, init = {}) {
  const event = new TwinEvent(type, { bubbles: true, cancelable: true, ...init });
  element.dispatchEvent(event);
  return event;
}

function addListener(node, type, listener, options) {
  if (!listener) return;
  if (!node._listeners) node._listeners = new Map();
  const capture = typeof options === 'boolean' ? options : options?.capture === true;
  const once = typeof options === 'object' && options !== null && options.once === true;
  const list = node._listeners.get(String(type)) || [];
  if (list.some(entry => entry.listener === listener && entry.capture === capture)) return;
  list.push({ listener, capture, once });
  node._listeners.set(String(type), list);
}

function removeListener(node, type, listener, options) {
  if (!listener || !node._listeners) return;
  const capture = typeof options === 'boolean' ? options : options?.capture === true;
  const list = node._listeners.get(String(type));
  if (!list) return;
  const next = list.filter(entry => !(entry.listener === listener && entry.capture === capture));
  if (next.length) node._listeners.set(String(type), next); else node._listeners.delete(String(type));
}

function invokeListeners(node, event, capture) {
  const list = node._listeners?.get(event.type);
  if (!list || !list.length) return;
  setEventProperty(event, 'currentTarget', node);
  for (const entry of [...list]) {
    if (entry.capture !== capture) continue;
    if (entry.once) removeListener(node, event.type, entry.listener, { capture });
    entry.listener.call(node, event);
    if (event._immediateStop) break;
  }
}

function dispatchThroughTree(target, event) {
  if (!event || typeof event.type !== 'string') throw new TypeError('dispatchEvent requires an event with a type');
  const path = [];
  for (let node = target; node; node = node.parentNode) path.push(node);
  const document = target.nodeType === 9 ? target : target.ownerDocument;
  const window = document?.defaultView;
  if (window && !path.includes(window)) path.push(window);
  setEventProperty(event, 'target', target);
  setEventProperty(event, '_path', path);
  const bubbles = event.bubbles === true;
  for (let index = path.length - 1; index >= 1; index -= 1) {
    setEventProperty(event, 'eventPhase', 1);
    invokeListeners(path[index], event, true);
    if (event._stop) break;
  }
  if (!event._stop) {
    setEventProperty(event, 'eventPhase', 2);
    invokeListeners(target, event, true);
    invokeListeners(target, event, false);
  }
  if (bubbles && !event._stop) {
    for (let index = 1; index < path.length; index += 1) {
      setEventProperty(event, 'eventPhase', 3);
      invokeListeners(path[index], event, false);
      if (event._stop) break;
    }
  }
  setEventProperty(event, 'eventPhase', 0);
  setEventProperty(event, 'currentTarget', null);
  return !event.defaultPrevented;
}

// ---------------------------------------------------------------------------
// CSS 选择器引擎（够用的子集）
//   tag | * | #id | .class | [attr] | [attr=v] | [attr~=v] [attr|=v]
//   [attr^=v] [attr$=v] [attr*=v] [+ i/s flag]
//   :first-child :last-child :not(...) :checked :disabled :enabled :empty
//   逗号列表；后代（空格）、子代（>）、相邻兄弟（+）、一般兄弟（~）
// ---------------------------------------------------------------------------

const selectorCache = new Map();

function readIdent(text, start) {
  let index = start;
  while (index < text.length && /[A-Za-z0-9_\-]/.test(text[index])) index += 1;
  return { value: text.slice(start, index), next: index };
}

function readBalanced(text, start, open, close) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (quote) { if (char === quote && text[index - 1] !== '\\') quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === open) depth += 1;
    else if (char === close) { depth -= 1; if (depth === 0) return { value: text.slice(start + 1, index), next: index + 1 }; }
  }
  throw new Error(`dom-twin selector: unbalanced "${open}...${close}" in "${text}"`);
}

function parseAttrExpression(content) {
  const match = /^\s*([^\s~|^$*!=\]]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\s\]]+))\s*([iIsS])?)?\s*$/.exec(content);
  if (!match) throw new Error(`dom-twin selector: unsupported attribute selector [${content}]`);
  const value = match[3] ?? match[4] ?? match[5];
  return {
    name: match[1].toLowerCase(),
    op: match[2] ?? null,
    value: value === undefined ? null : value,
    insensitive: match[6] ? match[6].toLowerCase() === 'i' : false
  };
}

function parseCompound(text) {
  const predicates = [];
  let index = 0;
  if (text[index] === '*') index += 1;
  else if (/[A-Za-z]/.test(text[index] || '')) {
    const read = readIdent(text, index);
    predicates.push({ kind: 'tag', value: read.value.toLowerCase() });
    index = read.next;
  }
  while (index < text.length) {
    const char = text[index];
    if (char === '#') {
      const read = readIdent(text, index + 1);
      predicates.push({ kind: 'id', value: read.value });
      index = read.next;
    } else if (char === '.') {
      const read = readIdent(text, index + 1);
      predicates.push({ kind: 'class', value: read.value });
      index = read.next;
    } else if (char === '[') {
      const read = readBalanced(text, index, '[', ']');
      predicates.push({ kind: 'attr', ...parseAttrExpression(read.value) });
      index = read.next;
    } else if (char === ':') {
      const read = readIdent(text, index + 1);
      let args = null;
      let next = read.next;
      if (text[next] === '(') {
        const balanced = readBalanced(text, next, '(', ')');
        args = balanced.value;
        next = balanced.next;
      }
      predicates.push({ kind: 'pseudo', name: read.value.toLowerCase(), args });
      index = next;
    } else if (char === '*') {
      index += 1;
    } else {
      throw new Error(`dom-twin selector: unsupported syntax "${text}" at "${text.slice(index)}"`);
    }
  }
  if (!predicates.length) predicates.push({ kind: 'tag', value: '*' });
  return predicates;
}

function parseComplexSelector(part) {
  const compounds = [];
  const combinators = [];
  let buffer = '';
  let index = 0;
  let pendingDescendant = false;
  const flush = () => {
    const trimmed = buffer.trim();
    if (!trimmed) return false;
    if (compounds.length > combinators.length) combinators.push(' ');
    compounds.push(parseCompound(trimmed));
    buffer = '';
    pendingDescendant = false;
    return true;
  };
  while (index < part.length) {
    const char = part[index];
    if (char === '[' || char === '(') {
      const close = char === '[' ? ']' : ')';
      const balanced = readBalanced(part, index, char, close);
      buffer += part.slice(index, balanced.next);
      index = balanced.next;
      continue;
    }
    if (/\s/.test(char)) {
      if (flush()) pendingDescendant = true;
      index += 1;
      continue;
    }
    if (char === '>' || char === '+' || char === '~') {
      flush();
      combinators.push(char);
      index += 1;
      continue;
    }
    buffer += char;
    index += 1;
  }
  flush();
  if (!compounds.length) throw new Error(`dom-twin selector: empty selector part "${part}"`);
  if (combinators.length !== compounds.length - 1) throw new Error(`dom-twin selector: malformed "${part}"`);
  return { compounds, combinators };
}

function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let buffer = '';
  for (let index = 0; index < selector.length; index += 1) {
    const char = selector[index];
    if (quote) { buffer += char; if (char === quote && selector[index - 1] !== '\\') quote = null; continue; }
    if (char === '"' || char === "'") { quote = char; buffer += char; continue; }
    if (char === '[' || char === '(') { depth += 1; buffer += char; continue; }
    if (char === ']' || char === ')') { depth -= 1; buffer += char; continue; }
    if (char === ',' && depth === 0) { parts.push(buffer); buffer = ''; continue; }
    buffer += char;
  }
  if (buffer.trim()) parts.push(buffer);
  return parts.map(part => part.trim()).filter(Boolean);
}

function parseSelector(selector) {
  const key = String(selector);
  const cached = selectorCache.get(key);
  if (cached) return cached;
  const parsed = splitSelectorList(key).map(parseComplexSelector);
  selectorCache.set(key, parsed);
  return parsed;
}

function compareAttribute(actual, predicate) {
  const normalize = value => (predicate.insensitive ? String(value).toLowerCase() : String(value));
  const expected = predicate.op ? normalize(predicate.value) : null;
  switch (predicate.op) {
    case null: return true;
    case '=': return normalize(actual) === expected;
    case '~=': return normalize(actual).split(/\s+/).includes(expected);
    case '|=': return normalize(actual) === expected || normalize(actual).startsWith(`${expected}-`);
    case '^=': return normalize(actual).startsWith(expected);
    case '$=': return normalize(actual).endsWith(expected);
    case '*=': return normalize(actual).includes(expected);
    default: return false;
  }
}

function matchesPredicate(element, predicate) {
  switch (predicate.kind) {
    case 'tag': return predicate.value === '*' || element.localName === predicate.value;
    case 'id': return element.id === predicate.value;
    case 'class': return element.classList.contains(predicate.value);
    case 'attr': {
      const actual = element.getAttribute(predicate.name);
      if (actual === null) return false;
      return compareAttribute(actual, predicate);
    }
    case 'pseudo': {
      switch (predicate.name) {
        case 'first-child': return !element.previousElementSibling;
        case 'last-child': return !element.nextElementSibling;
        case 'empty': return element.childNodes.length === 0;
        case 'checked': return element.checked === true || element.selected === true;
        case 'disabled': return element.disabled === true;
        case 'enabled': return element.disabled !== true;
        case 'not': return !matchesSelector(element, predicate.args || '');
        default: throw new Error(`dom-twin selector: unsupported pseudo-class :${predicate.name}`);
      }
    }
    default: return false;
  }
}

function matchesCompound(element, predicates) {
  for (const predicate of predicates) if (!matchesPredicate(element, predicate)) return false;
  return true;
}

function matchesComplex(element, complex) {
  const { compounds, combinators } = complex;
  let node = element;
  let index = compounds.length - 1;
  if (!matchesCompound(node, compounds[index])) return false;
  while (index > 0) {
    const combinator = combinators[index - 1];
    if (combinator === '>') {
      node = node.parentElement;
      if (!node || !matchesCompound(node, compounds[index - 1])) return false;
    } else if (combinator === ' ') {
      do { node = node.parentElement; } while (node && !matchesCompound(node, compounds[index - 1]));
      if (!node) return false;
    } else if (combinator === '+') {
      node = node.previousElementSibling;
      if (!node || !matchesCompound(node, compounds[index - 1])) return false;
    } else if (combinator === '~') {
      node = node.previousElementSibling;
      while (node && !matchesCompound(node, compounds[index - 1])) node = node.previousElementSibling;
      if (!node) return false;
    } else {
      return false;
    }
    index -= 1;
  }
  return true;
}

function matchesSelector(element, selector) {
  if (!element || element.nodeType !== 1) return false;
  return parseSelector(selector).some(complex => matchesComplex(element, complex));
}

function collectDescendants(root, includeRoot) {
  const output = [];
  const walk = node => {
    for (const child of node.childNodes) {
      if (child.nodeType === 1) { output.push(child); walk(child); }
    }
  };
  if (includeRoot && root.nodeType === 1) output.push(root);
  walk(root);
  return output;
}

function queryAllFrom(root, selector, includeRoot) {
  const parsed = parseSelector(selector);
  return collectDescendants(root, includeRoot).filter(element => parsed.some(complex => matchesComplex(element, complex)));
}

class TwinNodeList extends Array {
  item(index) { return this[index] ?? null; }
}

// ---------------------------------------------------------------------------
// 样式 / 尺寸
// ---------------------------------------------------------------------------

function parseStyleText(textValue) {
  const style = new Map();
  for (const part of String(textValue || '').split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    const name = part.slice(0, colon).trim().toLowerCase();
    const value = part.slice(colon + 1).trim();
    if (name) style.set(name, value);
  }
  return style;
}

function serializeStyle(style) {
  return [...style.entries()].map(([name, value]) => `${name}: ${value}`).join('; ');
}

function createStyleProxy(element, store) {
  const sync = () => {
    if (element._styleSyncing) return;
    element._styleSyncing = true;
    try {
      element.setAttribute('style', serializeStyle(store));
    } finally {
      element._styleSyncing = false;
    }
  };
  const target = {};
  Object.defineProperties(target, {
    getPropertyValue: { value: name => store.get(String(name).toLowerCase()) ?? '', enumerable: false },
    setProperty: {
      value: (name, value) => {
        const key = String(name).toLowerCase();
        if (value === undefined || value === null || value === '') store.delete(key); else store.set(key, String(value));
        sync();
      },
      enumerable: false
    },
    removeProperty: { value: name => { store.delete(String(name).toLowerCase()); sync(); }, enumerable: false },
    cssText: {
      get: () => serializeStyle(store),
      set: value => { store.clear(); for (const [name, itemValue] of parseStyleText(value)) store.set(name, itemValue); sync(); },
      enumerable: false
    }
  });
  return new Proxy(target, {
    get(object, property) {
      if (typeof property !== 'string') return Reflect.get(object, property);
      if (Reflect.has(object, property)) return Reflect.get(object, property);
      return store.get(toKebab(property)) ?? '';
    },
    set(object, property, value) {
      if (typeof property !== 'string') return Reflect.set(object, property, value);
      if (Reflect.has(object, property)) { Reflect.set(object, property, value); return true; }
      const key = toKebab(property);
      if (value === undefined || value === null || value === '') store.delete(key); else store.set(key, String(value));
      sync();
      return true;
    },
    has(object, property) {
      if (typeof property !== 'string') return Reflect.has(object, property);
      return Reflect.has(object, property) || store.has(toKebab(property));
    },
    ownKeys() { return [...Reflect.ownKeys(target), ...[...store.keys()].map(toCamel)]; },
    getOwnPropertyDescriptor(object, property) {
      if (typeof property === 'string' && store.has(toKebab(property))) {
        return { value: store.get(toKebab(property)), writable: true, enumerable: true, configurable: true };
      }
      return Reflect.getOwnPropertyDescriptor(object, property);
    }
  });
}

function refreshInlineStyle(element) {
  if (!element._styleStore) return;
  element._styleStore.clear();
  for (const [name, value] of parseStyleText(element.getAttribute('style') || '')) element._styleStore.set(name, value);
}

export function getComputedStyle(element) {
  if (!element) return { display: 'none', visibility: 'hidden', getPropertyValue: () => '' };
  const inline = element._styleStore || parseStyleText(element.getAttribute('style') || '');
  let display = inline.get('display') || '';
  let visibility = inline.get('visibility') || '';
  if (!display) {
    if (element.hasAttribute('hidden')) display = 'none';
    else if (HIDDEN_TAGS.has(element.localName)) display = 'none';
    else if (element.localName === 'input' && String(element.getAttribute('type') || '').toLowerCase() === 'hidden') display = 'none';
    else display = 'block';
  }
  if (!visibility) {
    visibility = 'visible';
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const inherited = ancestor._styleStore?.get('visibility') ?? '';
      if (inherited === 'hidden') { visibility = 'hidden'; break; }
      if (inherited === 'visible') break;
    }
  }
  const computed = { getPropertyValue: name => (inline.get(String(name).toLowerCase()) || '') };
  for (const [name, value] of inline) Object.defineProperty(computed, toCamel(name), { value, enumerable: true, configurable: true });
  Object.defineProperty(computed, 'display', { value: display, enumerable: true, configurable: true });
  Object.defineProperty(computed, 'visibility', { value: visibility, enumerable: true, configurable: true });
  return computed;
}

function makeRect(width, height) {
  return { x: 0, y: 0, top: 0, left: 0, width, height, right: width, bottom: height, toJSON() { return { width, height }; } };
}

function computedRect(element) {
  const computed = getComputedStyle(element);
  if (computed.display === 'none') return makeRect(0, 0);
  const rect = element.__rect ?? DEFAULT_RECT;
  return makeRect(rect.width ?? DEFAULT_RECT.width, rect.height ?? DEFAULT_RECT.height);
}

// ---------------------------------------------------------------------------
// 节点基类
// ---------------------------------------------------------------------------

export class TwinNode {
  constructor(ownerDocument = null) {
    this.ownerDocument = ownerDocument;
    this.parentNode = null;
    this.childNodes = [];
    this._listeners = new Map();
  }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get childElementCount() { return this.children.length; }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { const children = this.children; return children[children.length - 1] ?? null; }
  get nextSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    return index >= 0 ? siblings[index + 1] ?? null : null;
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const siblings = this.parentNode.childNodes;
    const index = siblings.indexOf(this);
    return index > 0 ? siblings[index - 1] : null;
  }
  get nextElementSibling() {
    let sibling = this.nextSibling;
    while (sibling && sibling.nodeType !== 1) sibling = sibling.nextSibling;
    return sibling;
  }
  get previousElementSibling() {
    let sibling = this.previousSibling;
    while (sibling && sibling.nodeType !== 1) sibling = sibling.previousSibling;
    return sibling;
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node.nodeType === 9;
  }
  get textContent() {
    let output = '';
    for (const child of this.childNodes) output += child.nodeType === 3 ? child.data : child.textContent;
    return output;
  }
  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (value !== undefined && value !== null && value !== '') this.appendChild(new TwinTextNode(this.ownerDocument, String(value)));
  }
  get nodeValue() { return null; }
  set nodeValue(_value) { /* noop */ }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  getRootNode() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node;
  }
  appendChild(node) { return this.insertBefore(node, null); }
  append(...nodes) { for (const node of nodes) appendNodes(this, node); }
  prepend(...nodes) {
    for (const node of [...nodes].reverse()) {
      if (typeof node === 'string' || typeof node === 'number') this.insertBefore(new TwinTextNode(this.ownerDocument, String(node)), this.firstChild);
      else this.insertBefore(node, this.firstChild);
    }
  }
  insertBefore(node, reference) {
    if (typeof node === 'string' || typeof node === 'number') node = new TwinTextNode(this.ownerDocument, String(node));
    if (!node || typeof node !== 'object') throw new TypeError('insertBefore requires a node');
    if (node === this) throw new Error('cannot insert a node into itself');
    if (node.nodeType === 1 && node.contains(this)) throw new Error('cannot insert an ancestor into its descendant');
    if (node.parentNode) node.parentNode.removeChild(node);
    const index = reference === null || reference === undefined ? this.childNodes.length : this.childNodes.indexOf(reference);
    if (index < 0) throw new Error('insertBefore reference is not a child of this node');
    node.parentNode = this;
    this.childNodes.splice(index, 0, node);
    setOwnerDocument(node, this.ownerDocument || this);
    return node;
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    if (index < 0) throw new Error('removeChild: node is not a child');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  replaceChild(next, current) {
    const index = this.childNodes.indexOf(current);
    if (index < 0) throw new Error('replaceChild: node is not a child');
    this.childNodes.splice(index, 1, next);
    current.parentNode = null;
    next.parentNode = this;
    setOwnerDocument(next, this.ownerDocument || this);
    return current;
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    this.append(...nodes);
  }
  querySelector(selector) { return queryAllFrom(this, selector, false)[0] ?? null; }
  querySelectorAll(selector) { return TwinNodeList.from(queryAllFrom(this, selector, false)); }
  dispatchEvent(event) { return dispatchThroughTree(this, event); }
  addEventListener(type, listener, options) { addListener(this, type, listener, options); }
  removeEventListener(type, listener, options) { removeListener(this, type, listener, options); }
}

function setOwnerDocument(node, document) {
  if (!node || node.nodeType === 9) return;
  node.ownerDocument = document;
  for (const child of node.childNodes) setOwnerDocument(child, document);
  if (node.shadowRoot) setOwnerDocument(node.shadowRoot, document);
}

export class TwinTextNode extends TwinNode {
  constructor(ownerDocument, data) {
    super(ownerDocument);
    this.nodeType = 3;
    this.data = String(data ?? '');
  }
  get nodeName() { return '#text'; }
  get localName() { return '#text'; }
  get textContent() { return this.data; }
  set textContent(value) { this.data = String(value ?? ''); }
  get nodeValue() { return this.data; }
  set nodeValue(value) { this.data = String(value ?? ''); }
  get outerHTML() { return escapeText(this.data); }
}

export class TwinDocumentFragment extends TwinNode {
  constructor(ownerDocument = null) {
    super(ownerDocument);
    this.nodeType = 11;
  }
  get nodeName() { return '#document-fragment'; }
}

export class TwinShadowRoot extends TwinDocumentFragment {
  constructor(host, mode = 'open') {
    super(host.ownerDocument);
    this.host = host;
    this.mode = mode;
  }
  get parentNode() { return null; }
  set parentNode(_value) { /* shadow root is never a child */ }
  getRootNode() { return this; }
}

// ---------------------------------------------------------------------------
// 元素
// ---------------------------------------------------------------------------

export class HTMLElement extends TwinNode {
  constructor(ownerDocument = null, tag = 'div') {
    super(ownerDocument);
    this.nodeType = 1;
    this.localName = String(tag).toLowerCase();
    this._attrs = new Map();
    this._styleStore = null;
    this._shadowRoot = null;
    this._value = undefined;
    this._checked = undefined;
    this._selected = undefined;
    this.__rect = undefined;
  }
  get tagName() { return this.localName.toUpperCase(); }
  get nodeName() { return this.tagName; }
  get nodeValue() { return null; }
  getAttributeNames() { return [...this._attrs.keys()]; }
  get attributes() { return [...this._attrs.entries()].map(([name, value]) => ({ name, value })); }
  getAttribute(name) {
    const value = this._attrs.get(String(name).toLowerCase());
    return value === undefined ? null : value;
  }
  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    this._attrs.set(key, String(value));
    if (key === 'style') refreshInlineStyle(this);
    return undefined;
  }
  removeAttribute(name) {
    this._attrs.delete(String(name).toLowerCase());
    if (String(name).toLowerCase() === 'style') refreshInlineStyle(this);
  }
  hasAttribute(name) { return this._attrs.has(String(name).toLowerCase()); }
  toggleAttribute(name, force) {
    const enabled = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (enabled) this.setAttribute(name, ''); else this.removeAttribute(name);
    return enabled;
  }
  get id() { return this.getAttribute('id') ?? ''; }
  set id(value) { this.setAttribute('id', value); }
  get className() { return this.getAttribute('class') ?? ''; }
  set className(value) { this.setAttribute('class', value); }
  get classList() {
    const element = this;
    const read = () => (element.getAttribute('class') || '').split(/\s+/).filter(Boolean);
    const write = list => element.setAttribute('class', list.join(' '));
    return {
      get length() { return read().length; },
      get value() { return element.getAttribute('class') || ''; },
      set value(value) { element.setAttribute('class', String(value)); },
      add: (...tokens) => { const list = read(); for (const token of tokens) if (token && !list.includes(token)) list.push(token); write(list); },
      remove: (...tokens) => write(read().filter(token => !tokens.includes(token))),
      contains: token => read().includes(String(token)),
      item: index => read()[index] ?? null,
      toggle: (token, force) => {
        const has = read().includes(String(token));
        const wanted = force === undefined ? !has : Boolean(force);
        if (wanted && !has) element.classList.add(token);
        else if (!wanted && has) element.classList.remove(token);
        return wanted;
      }
    };
  }
  get dataset() {
    if (this._datasetProxy) return this._datasetProxy;
    const element = this;
    const attrName = property => `data-${toKebab(property)}`;
    this._datasetProxy = new Proxy({}, {
      get(_target, property) {
        if (typeof property !== 'string') return undefined;
        const value = element.getAttribute(attrName(property));
        return value === null ? undefined : value;
      },
      set(_target, property, value) {
        if (typeof property !== 'string') return false;
        element.setAttribute(attrName(property), value === undefined || value === null ? '' : String(value));
        return true;
      },
      has(_target, property) { return typeof property === 'string' && element.hasAttribute(attrName(property)); },
      deleteProperty(_target, property) { if (typeof property === 'string') element.removeAttribute(attrName(property)); return true; },
      ownKeys() {
        return element.getAttributeNames().filter(name => name.startsWith('data-')).map(name => toCamel(name.slice(5)));
      },
      getOwnPropertyDescriptor(_target, property) {
        if (typeof property !== 'string') return undefined;
        const value = element.getAttribute(attrName(property));
        if (value === null) return undefined;
        return { value, writable: true, enumerable: true, configurable: true };
      }
    });
    return this._datasetProxy;
  }
  get style() {
    if (!this._styleStore) {
      this._styleStore = parseStyleText(this.getAttribute('style') || '');
      this._styleProxy = createStyleProxy(this, this._styleStore);
    }
    return this._styleProxy;
  }
  set style(value) {
    if (typeof value === 'string') { this.setAttribute('style', value); return; }
    const store = this._styleStore || (this.style, this._styleStore);
    store.clear();
    for (const [name, item] of Object.entries(value || {})) store.set(toKebab(name), String(item));
    this.setAttribute('style', serializeStyle(store));
  }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { this.toggleAttribute('hidden', Boolean(value)); }
  get title() { return this.getAttribute('title') ?? ''; }
  set title(value) { this.setAttribute('title', value); }
  get tabIndex() { const value = this.getAttribute('tabindex'); return value === null ? 0 : Number(value) || 0; }
  set tabIndex(value) { this.setAttribute('tabindex', String(value)); }
  get contentEditable() { const value = this.getAttribute('contenteditable'); return value === null ? 'inherit' : value; }
  set contentEditable(value) { this.setAttribute('contenteditable', value === true ? 'true' : String(value)); }
  get isContentEditable() {
    for (let node = this; node && node.nodeType === 1; node = node.parentElement) {
      const value = node.getAttribute('contenteditable');
      if (value === null) continue;
      if (value === 'false') return false;
      return true;
    }
    return false;
  }
  get textContent() {
    if (VOID_TAGS.has(this.localName)) return '';
    let output = '';
    for (const child of this.childNodes) output += child.nodeType === 3 ? child.data : child.textContent;
    return output;
  }
  set textContent(value) {
    for (const child of this.childNodes) child.parentNode = null;
    this.childNodes = [];
    if (VOID_TAGS.has(this.localName)) return;
    if (value !== undefined && value !== null && value !== '') this.appendChild(new TwinTextNode(this.ownerDocument, String(value)));
  }
  get innerText() { return this.textContent; }
  set innerText(value) { this.textContent = value; }
  get innerHTML() { return this.childNodes.map(child => (child.nodeType === 3 ? escapeText(child.data) : child.outerHTML)).join(''); }
  set innerHTML(value) {
    const fragment = parseHTMLFragment(String(value ?? ''), this.ownerDocument);
    this.replaceChildren(...fragment);
  }
  get outerHTML() { return serializeNode(this); }
  matches(selector) { return matchesSelector(this, selector); }
  closest(selector) {
    for (let node = this; node && node.nodeType === 1; node = node.parentElement) if (matchesSelector(node, selector)) return node;
    return null;
  }
  getElementsByTagName(tag) {
    const wanted = String(tag).toLowerCase();
    return TwinNodeList.from(this.querySelectorAll(wanted === '*' ? '*' : wanted));
  }
  getElementsByClassName(className) { return TwinNodeList.from(this.querySelectorAll(`.${className}`)); }
  attachShadow(init = {}) {
    if (this._shadowRoot) throw new Error('dom-twin: shadow root already attached');
    this._shadowRoot = new TwinShadowRoot(this, init.mode ?? 'open');
    return this._shadowRoot;
  }
  get shadowRoot() { return this._shadowRoot ?? null; }
  getBoundingClientRect() { return computedRect(this); }
  getClientRects() {
    const rect = this.getBoundingClientRect();
    return rect.width === 0 && rect.height === 0 ? [] : [rect];
  }
  get offsetWidth() { return this.getBoundingClientRect().width; }
  get offsetHeight() { return this.getBoundingClientRect().height; }
  get offsetParent() { return this.parentElement; }
  scrollIntoView() { return undefined; }
  focus() {
    const document = this.ownerDocument;
    if (document) document._activeElement = this;
    this.dispatchEvent(new TwinEvent('focus', { bubbles: false }));
    return undefined;
  }
  blur() {
    const document = this.ownerDocument;
    if (document && document._activeElement === this) document._activeElement = null;
    this.dispatchEvent(new TwinEvent('blur', { bubbles: false }));
    return undefined;
  }
  click() {
    const event = new TwinMouseEvent('click', { bubbles: true, cancelable: true, detail: 1 });
    this.dispatchEvent(event);
    if (!event.defaultPrevented) applyDefaultClick(this);
    return undefined;
  }
}

function applyDefaultClick(element) {
  if (element.localName === 'label') {
    const control = labelControl(element);
    if (control && control !== element._clickedControl) {
      element._clickedControl = control;
      try { control.click(); } finally { element._clickedControl = null; }
    }
    return;
  }
  if (element.localName === 'input') {
    const type = String(element.getAttribute('type') || 'text').toLowerCase();
    if (type === 'checkbox') {
      element.checked = !element.checked;
      fire(element, 'input');
      fire(element, 'change');
    } else if (type === 'radio') {
      if (!element.checked) {
        const document = element.ownerDocument;
        const name = element.getAttribute('name');
        if (document && name) for (const sibling of document.querySelectorAll('input')) if (sibling !== element && sibling.getAttribute('type') === 'radio' && sibling.getAttribute('name') === name) sibling.checked = false;
        element.checked = true;
        fire(element, 'input');
        fire(element, 'change');
      }
    }
  }
}

function labelControl(label) {
  const htmlFor = label.getAttribute('for');
  if (htmlFor && label.ownerDocument) {
    const target = label.ownerDocument.getElementById(htmlFor);
    if (target) return target;
  }
  const nested = label.querySelector('input, textarea, select, [role="combobox"]');
  return nested ?? null;
}

export class HTMLInputElement extends HTMLElement {
  constructor(ownerDocument = null) { super(ownerDocument, 'input'); }
  get type() { return String(this.getAttribute('type') || 'text').toLowerCase(); }
  set type(value) { this.setAttribute('type', value); }
  get value() {
    const type = this.type;
    if (type === 'checkbox' || type === 'radio') return this.getAttribute('value') ?? 'on';
    if (type === 'file') return this._value === undefined ? '' : String(this._value);
    return this._value !== undefined ? String(this._value) : (this.getAttribute('value') ?? '');
  }
  set value(next) { this._value = String(next ?? ''); }
  get defaultValue() { return this.getAttribute('value') ?? ''; }
  set defaultValue(value) { this.setAttribute('value', value); }
  get checked() { return this._checked !== undefined ? Boolean(this._checked) : this.hasAttribute('checked'); }
  set checked(value) { this._checked = Boolean(value); }
  get indeterminate() { return Boolean(this._indeterminate); }
  set indeterminate(value) { this._indeterminate = Boolean(value); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { this.toggleAttribute('disabled', Boolean(value)); }
  get readOnly() { return this.hasAttribute('readonly'); }
  set readOnly(value) { this.toggleAttribute('readonly', Boolean(value)); }
  get readonly() { return this.readOnly; }
  set readonly(value) { this.readOnly = value; }
  get required() { return this.hasAttribute('required'); }
  set required(value) { this.toggleAttribute('required', Boolean(value)); }
  get multiple() { return this.hasAttribute('multiple'); }
  set multiple(value) { this.toggleAttribute('multiple', Boolean(value)); }
  get name() { return this.getAttribute('name') ?? ''; }
  set name(value) { this.setAttribute('name', value); }
  get placeholder() { return this.getAttribute('placeholder') ?? ''; }
  set placeholder(value) { this.setAttribute('placeholder', value); }
  get autocomplete() { return this.getAttribute('autocomplete') ?? ''; }
  get labels() { return labelsFor(this); }
  get form() { return this.closest('form'); }
  get files() { return this._files ?? []; }
  set files(value) { this._files = value; }
  get valueAsNumber() { return Number(this.value); }
  select() { return undefined; }
  setSelectionRange() { return undefined; }
  setCustomValidity() { return undefined; }
  checkValidity() { return true; }
}

export class HTMLTextAreaElement extends HTMLElement {
  constructor(ownerDocument = null) { super(ownerDocument, 'textarea'); }
  get type() { return 'textarea'; }
  get value() { return this._value !== undefined ? String(this._value) : this.textContent; }
  set value(next) { this._value = String(next ?? ''); }
  get defaultValue() { return this.textContent; }
  set defaultValue(value) { this.textContent = value; }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { this.toggleAttribute('disabled', Boolean(value)); }
  get readOnly() { return this.hasAttribute('readonly'); }
  set readOnly(value) { this.toggleAttribute('readonly', Boolean(value)); }
  get readonly() { return this.readOnly; }
  set readonly(value) { this.readOnly = value; }
  get required() { return this.hasAttribute('required'); }
  set required(value) { this.toggleAttribute('required', Boolean(value)); }
  get name() { return this.getAttribute('name') ?? ''; }
  set name(value) { this.setAttribute('name', value); }
  get placeholder() { return this.getAttribute('placeholder') ?? ''; }
  set placeholder(value) { this.setAttribute('placeholder', value); }
  get labels() { return labelsFor(this); }
  get form() { return this.closest('form'); }
  select() { return undefined; }
}

export class HTMLSelectElement extends HTMLElement {
  constructor(ownerDocument = null) { super(ownerDocument, 'select'); }
  get type() { return this.multiple ? 'select-multiple' : 'select-one'; }
  get options() { return this.children.filter(child => child.localName === 'option'); }
  get multiple() { return this.hasAttribute('multiple'); }
  set multiple(value) { this.toggleAttribute('multiple', Boolean(value)); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { this.toggleAttribute('disabled', Boolean(value)); }
  get required() { return this.hasAttribute('required'); }
  set required(value) { this.toggleAttribute('required', Boolean(value)); }
  get name() { return this.getAttribute('name') ?? ''; }
  set name(value) { this.setAttribute('name', value); }
  get labels() { return labelsFor(this); }
  get form() { return this.closest('form'); }
  get selectedIndex() {
    const options = this.options;
    const index = options.findIndex(option => option.selected);
    if (index >= 0) return index;
    return options.length ? 0 : -1;
  }
  set selectedIndex(value) {
    const index = Number(value);
    this.options.forEach((option, optionIndex) => { option._selected = optionIndex === index; });
  }
  get selectedOptions() { return this.options.filter(option => option.selected); }
  get value() {
    const selected = this.options.find(option => option.selected) ?? this.options[0];
    return selected ? selected.value : '';
  }
  set value(next) {
    const wanted = String(next ?? '');
    const options = this.options;
    const found = options.find(option => option.value === wanted) ?? options.find(option => option.text === wanted);
    if (!found) { options.forEach(option => { option._selected = false; }); return; }
    options.forEach(option => { option._selected = option === found; });
  }
  add(option) { this.appendChild(option); }
}

export class HTMLOptionElement extends HTMLElement {
  constructor(ownerDocument = null) { super(ownerDocument, 'option'); }
  get value() { return this.getAttribute('value') ?? this.textContent.trim(); }
  set value(value) { this.setAttribute('value', value); }
  get text() { return this.textContent.trim(); }
  set text(value) { this.textContent = value; }
  get label() { return this.getAttribute('label') ?? this.text; }
  set label(value) { this.setAttribute('label', value); }
  get selected() { return this._selected !== undefined ? Boolean(this._selected) : this.hasAttribute('selected'); }
  set selected(value) { this._selected = Boolean(value); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { this.toggleAttribute('disabled', Boolean(value)); }
  get index() {
    const select = this.parentElement;
    if (!select || select.localName !== 'select') return -1;
    return select.options.indexOf(this);
  }
}

export class HTMLButtonElement extends HTMLElement {
  constructor(ownerDocument = null) { super(ownerDocument, 'button'); }
  get type() { return String(this.getAttribute('type') || 'submit').toLowerCase(); }
  set type(value) { this.setAttribute('type', value); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { this.toggleAttribute('disabled', Boolean(value)); }
  get name() { return this.getAttribute('name') ?? ''; }
  set name(value) { this.setAttribute('name', value); }
  get value() { return this.getAttribute('value') ?? ''; }
  set value(value) { this.setAttribute('value', value); }
  get labels() { return []; }
  get form() { return this.closest('form'); }
}

export class HTMLLabelElement extends HTMLElement {
  constructor(ownerDocument = null) { super(ownerDocument, 'label'); }
  get htmlFor() { return this.getAttribute('for') ?? ''; }
  set htmlFor(value) { this.setAttribute('for', value); }
  get control() { return labelControl(this); }
  get form() { return this.closest('form'); }
}

export class HTMLAnchorElement extends HTMLElement {
  constructor(ownerDocument = null) { super(ownerDocument, 'a'); }
  get href() { return this.getAttribute('href') ?? ''; }
  set href(value) { this.setAttribute('href', value); }
  get target() { return this.getAttribute('target') ?? ''; }
  set target(value) { this.setAttribute('target', value); }
}

export class HTMLFormElement extends HTMLElement {
  constructor(ownerDocument = null) { super(ownerDocument, 'form'); }
  get elements() { return this.querySelectorAll('input, textarea, select, button'); }
  submit() { return undefined; }
  reset() { return undefined; }
}

function labelsFor(element) {
  const document = element.ownerDocument;
  if (!document) return [];
  const id = element.id;
  const explicit = id ? document.querySelectorAll('label').filter(label => label.getAttribute('for') === id) : [];
  const wrapping = [];
  for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
    if (ancestor.localName === 'label') { wrapping.push(ancestor); break; }
  }
  const output = [...explicit];
  for (const label of wrapping) if (!output.includes(label)) output.push(label);
  return output;
}

const ELEMENT_CONSTRUCTORS = {
  input: HTMLInputElement,
  textarea: HTMLTextAreaElement,
  select: HTMLSelectElement,
  option: HTMLOptionElement,
  button: HTMLButtonElement,
  label: HTMLLabelElement,
  a: HTMLAnchorElement,
  form: HTMLFormElement
};

function createElementByTag(tag, ownerDocument) {
  const Constructor = ELEMENT_CONSTRUCTORS[tag] ?? HTMLElement;
  return new Constructor(ownerDocument, tag);
}

// ---------------------------------------------------------------------------
// Document / Window
// ---------------------------------------------------------------------------

function createLocation(input = {}) {
  const origin = input.origin ?? 'https://example.test';
  const pathname = input.pathname ?? '/form';
  const search = input.search ?? '';
  const hash = input.hash ?? '';
  const href = input.href ?? `${origin}${pathname}${search}${hash}`;
  let parsed;
  try { parsed = new URL(href); } catch { parsed = new URL('https://example.test/form'); }
  return {
    href,
    origin: input.origin ?? parsed.origin,
    pathname,
    search,
    hash,
    protocol: parsed.protocol,
    host: parsed.host,
    hostname: parsed.hostname,
    port: parsed.port,
    set href(_value) { /* 测试用页面不导航 */ },
    toString() { return this.href; }
  };
}

export class TwinWindow {
  constructor(document) {
    this.document = document;
    this.location = document.location;
    this.Event = TwinEvent;
    this.MouseEvent = TwinMouseEvent;
    this.CustomEvent = TwinCustomEvent;
    this.navigator = { userAgent: 'dom-twin' };
    this.innerWidth = 1280;
    this.innerHeight = 900;
    this._listeners = new Map();
  }
  getComputedStyle(element) { return getComputedStyle(element); }
  addEventListener(type, listener, options) { addListener(this, type, listener, options); }
  removeEventListener(type, listener, options) { removeListener(this, type, listener, options); }
  dispatchEvent(event) { return dispatchThroughTree(this, event); }
  setTimeout(handler, timeout, ...args) { return globalThis.setTimeout(handler, timeout, ...args); }
  clearTimeout(handle) { return globalThis.clearTimeout(handle); }
  requestAnimationFrame(callback) { return globalThis.setTimeout(() => callback(Date.now()), 0); }
  cancelAnimationFrame(handle) { return globalThis.clearTimeout(handle); }
}

export class TwinDocument extends TwinNode {
  constructor(options = {}) {
    super(null);
    this.nodeType = 9;
    this.readyState = 'complete';
    this.compatMode = 'CSS1Compat';
    this._title = options.title === undefined ? '' : String(options.title);
    this.location = createLocation(options.location || {});
    this.documentElement = createElementByTag('html', this);
    this.head = createElementByTag('head', this);
    this.body = createElementByTag('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.appendChild(this.documentElement);
    if (this._title) {
      const titleElement = createElementByTag('title', this);
      titleElement.appendChild(new TwinTextNode(this, this._title));
      this.head.appendChild(titleElement);
    }
    this._activeElement = this.body;
    this.defaultView = new TwinWindow(this);
    this.__submits = 0;
  }
  get nodeName() { return '#document'; }
  get ownerDocument() { return null; }
  set ownerDocument(_value) { /* document has no owner */ }
  get defaultView() { return this._defaultView ?? null; }
  set defaultView(value) { this._defaultView = value; }
  get title() { return this._title; }
  set title(value) {
    this._title = String(value ?? '');
    const titleElement = this.querySelector('title');
    if (titleElement) titleElement.textContent = this._title;
    else {
      const next = createElementByTag('title', this);
      next.appendChild(new TwinTextNode(this, this._title));
      this.head.appendChild(next);
    }
  }
  get URL() { return this.location.href; }
  get activeElement() { return this._activeElement ?? null; }
  createElement(tag) { return createElementByTag(String(tag).toLowerCase(), this); }
  createTextNode(data) { return new TwinTextNode(this, data); }
  createDocumentFragment() { return new TwinDocumentFragment(this); }
  getElementById(id) {
    const wanted = String(id);
    return collectDescendants(this, false).find(element => element.id === wanted) ?? null;
  }
  getElementsByTagName(tag) {
    const wanted = String(tag).toLowerCase();
    return TwinNodeList.from(collectDescendants(this, false).filter(element => wanted === '*' || element.localName === wanted));
  }
  getElementsByClassName(className) {
    return TwinNodeList.from(collectDescendants(this, false).filter(element => element.classList.contains(String(className))));
  }
  querySelector(selector) { return queryAllFrom(this, selector, false)[0] ?? null; }
  querySelectorAll(selector) { return TwinNodeList.from(queryAllFrom(this, selector, false)); }
  getRootNode() { return this; }
  get parentNode() { return null; }
  set parentNode(_value) { /* noop */ }
  get isConnected() { return true; }
}

// ---------------------------------------------------------------------------
// 构造 / 解析 API
// ---------------------------------------------------------------------------

const RESERVED_PROPS = new Set(['attrs', 'dataset', 'style', 'text', 'html', 'children', 'shadow', 'rect', 'on', 'props']);
const PROPERTY_KEYS = new Set(['value', 'checked', 'selected', 'selectedIndex', 'disabled', 'readOnly', 'readonly', 'multiple', 'required', 'indeterminate', 'files']);

function assignStyle(element, value) {
  if (value === undefined || value === null) return;
  if (typeof value === 'string') { element.setAttribute('style', value); return; }
  for (const [name, item] of Object.entries(value)) element.style.setProperty(toKebab(name), String(item));
}

function assignProperty(element, key, value) {
  try {
    if (key in element) { element[key] = value; return; }
  } catch { /* fall through to attribute */ }
  applyAttribute(element, key, value);
}

export function h(tag, props = {}, children) {
  if (Array.isArray(props)) { children = props; props = {}; }
  props = props || {};
  const element = createElementByTag(String(tag).toLowerCase(), null);
  if (props.attrs) for (const [name, value] of Object.entries(props.attrs)) applyAttribute(element, name, value);
  if (props.dataset) for (const [name, value] of Object.entries(props.dataset)) applyAttribute(element, `data-${toKebab(name)}`, value);
  if (props.style !== undefined) assignStyle(element, props.style);
  const nodeChildren = props.children !== undefined ? props.children : children;
  if (props.html !== undefined) appendNodes(element, parseHTMLFragment(String(props.html), null));
  if (nodeChildren !== undefined) appendNodes(element, nodeChildren);
  if (props.text !== undefined) appendNodes(element, String(props.text));
  if (props.on) for (const [type, listener] of Object.entries(props.on)) if (typeof listener === 'function') element.addEventListener(type, listener);
  for (const [key, value] of Object.entries(props)) {
    if (RESERVED_PROPS.has(key)) continue;
    if (key.length > 2 && key.startsWith('on') && typeof value === 'function') { element.addEventListener(key.slice(2).toLowerCase(), value); continue; }
    assignProperty(element, key, value);
  }
  if (props.props) for (const [key, value] of Object.entries(props.props)) assignProperty(element, key, value);
  if (props.rect) element.__rect = { width: props.rect.width, height: props.rect.height };
  if (props.shadow) {
    const root = element.attachShadow({ mode: 'open' });
    appendNodes(root, props.shadow);
  }
  return element;
}

export function parseHTMLFragment(html, document = null) {
  const holder = h('div');
  const stack = [holder];
  const tokenizer = /<!--[\s\S]*?-->|<\/([A-Za-z][\w:-]*)\s*>|<([A-Za-z][\w:-]*)((?:\s+[^\s=>/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let match;
  const appendText = textValue => {
    if (!textValue) return;
    const decoded = textValue.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    stack[stack.length - 1].appendChild(new TwinTextNode(document, decoded));
  };
  while ((match = tokenizer.exec(html))) {
    if (match[0].startsWith('<!--')) continue;
    if (match[1]) {
      const tag = match[1].toLowerCase();
      for (let index = stack.length - 1; index > 0; index -= 1) {
        if (stack[index].localName === tag) { stack.length = index; break; }
      }
      continue;
    }
    if (match[2]) {
      const tag = match[2].toLowerCase();
      const element = createElementByTag(tag, document);
      const attributeText = match[3] || '';
      const attributePattern = /([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+)))?/g;
      let attributeMatch;
      while ((attributeMatch = attributePattern.exec(attributeText))) {
        const name = attributeMatch[1].toLowerCase();
        const value = attributeMatch[2] ?? attributeMatch[3] ?? attributeMatch[4] ?? '';
        if (value === '') element.setAttribute(name, '');
        else element.setAttribute(name, value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
      }
      stack[stack.length - 1].appendChild(element);
      if (!match[4] && !VOID_TAGS.has(tag)) stack.push(element);
      continue;
    }
    if (match[5] !== undefined) appendText(match[5]);
  }
  const children = holder.childNodes.slice();
  for (const child of children) holder.removeChild(child);
  return children;
}

export function createDocument(options = {}) {
  const document = new TwinDocument(options);
  if (options.body) appendNodes(document.body, options.body);
  if (options.html) appendNodes(document.body, parseHTMLFragment(String(options.html), document));
  return document;
}

// ---------------------------------------------------------------------------
// 深查询 / 控制器辅助（与 page-inspector 的 queryAllDeep 完全同款）
// ---------------------------------------------------------------------------

export const CONTROL_SELECTOR = 'input, textarea, select, [role="combobox"], [contenteditable="true"]';
export const ACTION_SELECTOR = 'button, [role="button"], a';

export function queryAllDeep(root, selector) {
  const output = [...(root?.querySelectorAll?.(selector) || [])];
  for (const host of root?.querySelectorAll?.('*') || []) if (host.shadowRoot) output.push(...queryAllDeep(host.shadowRoot, selector));
  return output;
}

/** 原样返回深查询结果（含 file/hidden），顺序 = page-inspector 的 selectorToken 下标空间。 */
export function controlElements(document) {
  return queryAllDeep(document, CONTROL_SELECTOR);
}

/** 按契约 §3 / 执行器约定还原 selectorToken：'control-token-<n>' -> 过滤 file 后的深查询下标元素。 */
export function resolveSelectorToken(document, token) {
  const match = /^control-token-(\d+)$/.exec(String(token || ''));
  if (!match) return null;
  return controlElements(document).filter(element => String(element.type || '').toLowerCase() !== 'file')[Number(match[1])] ?? null;
}

export function isTwinElement(value) { return value instanceof HTMLElement; }

export function serializeNode(node) {
  if (!node) return '';
  if (node.nodeType === 3) return escapeText(node.data);
  if (node.nodeType === 9 || node.nodeType === 11) return [...node.childNodes].map(child => serializeNode(child)).join('');
  if (node.nodeType !== 1) return '';
  const attributes = [...node._attrs.entries()].map(([name, value]) => (value === '' ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`)).join('');
  if (VOID_TAGS.has(node.localName)) return `<${node.localName}${attributes}>`;
  return `<${node.localName}${attributes}>${[...node.childNodes].map(child => serializeNode(child)).join('')}</${node.localName}>`;
}

export function installDomGlobals() {
  const globals = {
    HTMLElement, HTMLInputElement, HTMLTextAreaElement, HTMLSelectElement,
    HTMLOptionElement, HTMLButtonElement, HTMLLabelElement, HTMLAnchorElement, HTMLFormElement,
    TwinEvent, TwinMouseEvent, TwinCustomEvent
  };
  for (const [name, value] of Object.entries(globals)) if (globalThis[name] === undefined) globalThis[name] = value;
  if (globalThis.getComputedStyle === undefined) globalThis.getComputedStyle = element => getComputedStyle(element);
}

// ---------------------------------------------------------------------------
// 「编辑简历」双胞胎页面（真实站点结构）
// ---------------------------------------------------------------------------
/**
 * createBytedanceTwin() 复刻真机页面：
 *   - 11 个模块：简历 / 基本信息 / 工作经历 / 教育经历 / 实习经历 / 项目经历 /
 *     作品 / 获奖 / 语言能力 / 自我评价 / 社交账号
 *   - 字段：.ud-formily-item[data-form-field-name=...][data-form-field-i18n-name=...]
 *     页面没有 id / name / label[for]（和真机一致）
 *   - 下拉：.ud__select > .ud__select__selector > input[role=combobox]，展示值在
 *     .ud__select__selector__selectItem；input.value 恒为空；点击后才生成
 *     .ud__select__dropdown 里的 .ud__select__list__item；关闭后弹层 display:none
 *   - 卡片：[class*="apply-form-array-card__"]，序号 = 同模块 DOM 顺序
 *   - 添加按钮 button[class*="apply-form-array-card-add"]，删除按钮 ...-delete
 *   - 底部 保存 .atsx-btn-primary / 取消 .atsx-btn-default（点击只计数）
 *
 * 注意：file 输入（简历模块的 attachment_resume）占 selectorToken 的原始下标，
 * 但 page-inspector 会把它放进 diagnostics；resolveSelectorToken 用原始下标。
 */

const MODULE_HASH = '__2JZaE';
const CARD_HASH = '__3QF2H';
const CARD_CONTENT_HASH = '__eZqzM';
const CARD_OPERATE_HASH = '__zskMQ';
const CARD_DELETE_HASH = '__1RIY6';
const CARD_ADD_HASH = '__r8KqP';

const CARD_SELECTOR = `[class*="apply-form-array-card${CARD_HASH}"]`;
const ADD_BUTTON_SELECTOR = 'button[class*="apply-form-array-card-add"]';
const DELETE_BUTTON_SELECTOR = 'button[class*="apply-form-array-card-delete"]';
const MODULE_SELECTOR = '[class*="applyFormModuleWrapper"]';
const MODULE_TITLE_SELECTOR = '[class*="applyFormModuleWrapper-title"] [class*="applyFormModuleWrapper-text"]';

/** 构造期上下文（同一时刻只服务一次 createBytedanceTwin 的同步构造）。 */
let activeContext = null;

const SELECT_OPTIONS = {
  area_code: ['+86', '+852', '+1', '+44', '+81'],
  degree: ['博士', 'MBA', '硕士', '本科', '大专', '高中', '专职', '初中', '小学'],
  language: ['英语', '普通话', '日语', '韩语', '法语', '德语'],
  proficiency: ['母语', '日常会话', '精通', '熟练', '良好', '一般'],
  sns_type: ['Github', 'QQ', '微信', '领英', '个人网站'],
  preferred_city_list: ['深圳', '北京', '上海', '杭州', '广州', '成都']
};

/** 模块标题 → sectionKey（契约词表；作品用 Lead 指定的 work_samples） */
export const BYTEDANCE_MODULE_KEYS = [
  { key: 'attachment', title: '简历' },
  { key: 'basic', title: '基本信息' },
  { key: 'work', title: '工作经历' },
  { key: 'education', title: '教育经历' },
  { key: 'internship', title: '实习经历' },
  { key: 'project', title: '项目经历' },
  { key: 'work_samples', title: '作品' },
  { key: 'award', title: '获奖' },
  { key: 'language', title: '语言能力' },
  { key: 'summary', title: '自我评价' },
  { key: 'sns', title: '社交账号' }
];

/** 某模块新增卡片时的字段（空模块第一次「添加」后出现，字段名与真机项目/工作经历同构） */
const CARD_FIELDS = {
  work: ({ index }) => [
    field('company', '公司名称', textInput({ value: index === 0 ? '' : '', placeholder: '请输入' })),
    field('title', '职位名称', textInput({ value: '', placeholder: '请输入' })),
    dateRange({ start: '', end: '' }),
    field('desc', '工作内容', textArea({ value: '' }))
  ],
  education: ({ index }) => [
    field('school', '学校名称', textInput({ value: index === 0 ? '云岭科技大学' : '' })),
    field('degree', '学历', udSelect({ field: 'degree', value: index === 0 ? '本科' : '' })),
    field('field_of_study', '专业', textInput({ value: index === 0 ? '人工智能与数据工程' : '' })),
    dateRange({ start: index === 0 ? '2023-09' : '', end: index === 0 ? '2027-07' : '' })
  ],
  internship: ({ index }) => [
    field('company', '公司名称', textInput({ value: '' })),
    field('title', '职位名称', textInput({ value: '' })),
    dateRange({ start: '', end: '' }),
    field('desc', '工作内容', textArea({ value: '' }))
  ],
  project: ({ index }) => [
    field('name', '项目名称', textInput({ value: `示例项目 ${index + 1}` })),
    field('role', '项目角色', textInput({ value: '开发' })),
    dateRange({ start: '2024-01', end: '至今' }),
    field('link', '项目链接', textInput({ value: `https://github.com/example/project-${index + 1}` })),
    field('desc', '项目描述', textArea({ value: `项目 ${index + 1} 的描述` }))
  ],
  work_samples: ({ index }) => [
    field('name', '作品名称', textInput({ value: '' })),
    field('link', '作品链接', textInput({ value: '' })),
    field('desc', '作品描述', textArea({ value: '' }))
  ],
  award: ({ index }) => [
    field('name', '获奖名称', textInput({ value: ['示例奖项名', '全国大学生数学建模竞赛省级三等奖', '校级优秀学生'][index] ?? '' })),
    field('date', '获奖时间', yearPicker({ value: ['2025', '2024', '2023'][index] ?? '' })),
    field('desc', '获奖描述', textArea({ value: '' }))
  ],
  language: ({ index }) => [
    field('language', '语言', udSelect({ field: 'language', value: index === 0 ? '英语' : '普通话' })),
    field('proficiency', '精通程度', udSelect({ field: 'proficiency', value: index === 0 ? '日常会话' : '母语' }))
  ],
  sns: ({ index }) => [
    field('sns_type', '社交平台', udSelect({ field: 'sns_type', value: ['Github', 'QQ', '微信'][index] ?? '' })),
    field('link', 'URL / ID', textInput({ value: ['https://github.com/example-org', '123456789', 'formpilot_wechat'][index] ?? '' }))
  ]
};

function field(fieldName, i18nName, control, { required = true } = {}) {
  return h('div', {
    class: 'ud-formily-item ud-formily-item-layout-vertical ud-formily-item-size-default',
    attrs: {
      'data-form-field-id': fieldName,
      'data-form-field-name': fieldName,
      'data-form-field-i18n-name': i18nName
    }
  }, [
    h('div', { class: 'ud-formily-item-label ud-formily-item-label-left ud-formily-item-label-align-left' }, [
      h('div', { class: 'ud-formily-item-label-content' }, [
        h('span', {}, [
          h('label', { text: i18nName }),
          required ? h('span', { class: 'ud-formily-item-asterisk', text: '*' }) : null
        ].filter(Boolean))
      ])
    ]),
    h('div', { class: 'ud-formily-item-control' }, [
      h('div', { class: 'ud-formily-item-control-content' }, [
        h('div', { class: 'ud-formily-item-control-content-component' }, [control])
      ])
    ])
  ]);
}

function textInput({ value = '', placeholder = '', readonly = false, type = 'text' }) {
  return h('div', { class: 'ud__input ud__input--size-lg' }, [
    h('label', { class: 'ud__input-input-wrap' }, [
      h('div', { class: 'ud__input-input__placeholder__wrapper' }, [
        h('input', {
          class: 'ud__native-input',
          attrs: {
            type,
            ...(placeholder ? { placeholder } : {}),
            ...(readonly ? { readonly: '' } : {}),
            ...(value !== '' ? { value } : {})
          },
          value
        })
      ])
    ])
  ]);
}

function textArea({ value = '', placeholder = '' }) {
  return h('textarea', {
    class: 'ud-scrollbar ud-typography-body-0 ud-textArea__2Gq',
    attrs: { ...(placeholder ? { placeholder } : {}) },
    text: value,
    value
  });
}

function yearPicker({ value = '' }) {
  return h('div', { class: 'ud__picker ud__picker--size-lg', style: 'width:100%' }, [
    h('div', { class: 'ud__picker-dateInput ud__picker-inputWrapper' }, [
      h('div', { class: 'ud__picker-inputWrapper-inner' }, [
        h('input', { class: 'ud__picker-input ud__native-input', attrs: { size: '12', placeholder: 'YYYY', ...(value !== '' ? { value } : {}) }, value })
      ])
    ])
  ]);
}

function dateRange({ start = '', end = '' }) {
  const single = value => h('div', { class: `throne-biz-date-range-picker-input${value ? ' throne-biz-date-range-picker-hasValue' : ''}` }, [
    h('div', { class: 'ud__input ud__input--size-lg' }, [
      h('label', { class: 'ud__input-input-wrap' }, [
        h('div', { class: 'ud__input-input__placeholder__wrapper' }, [
          h('input', { class: 'ud__native-input', attrs: { ...(value !== '' ? { value } : {}) }, value })
        ])
      ])
    ])
  ]);
  return field('start_end_time', '起止时间', h('div', { class: 'throne-biz-date-range-picker-wrapper' }, [
    single(start),
    h('div', { class: 'throne-biz-date-range-picker-rangeInput-seperator', text: '~' }),
    single(end)
  ]), { required: false });
}

function udSelect({ field: fieldName, value = '', options, multi = false, searchable = false }) {
  const list = options ?? SELECT_OPTIONS[fieldName] ?? [];
  const selectRoot = h('div', { class: 'ud__select select__1A5Um' });
  const contentChildren = [];
  if (multi) {
    for (const chip of Array.isArray(value) ? value : []) contentChildren.push(h('span', { class: 'ud__tag ud__select__selector__tag', text: chip }));
  } else if (value) {
    contentChildren.push(h('div', { class: 'ud__select__selector__selectItem ud__select__selector__selectItem-lg', text: value }));
  }
  const searchInput = h('input', {
    class: 'ud__select__selector__search__input ud__native-input',
    attrs: { role: 'combobox', type: 'search', ...(searchable ? {} : { readonly: '' }) },
    value: ''
  });
  const content = h('div', { class: 'ud__select__selector__content' }, [...contentChildren, h('div', { class: 'ud__select__selector__search' }, [searchInput])]);
  const selector = h('div', { class: 'ud__select__selector ud__select__selector-lg' }, [
    content,
    h('div', { class: 'ud__select__selector__arrow' }, [h('span', { class: 'universe-icon', text: '⌄' })])
  ]);
  selectRoot.appendChild(selector);
  const state = {
    field: fieldName,
    options: [...list],
    multi,
    searchable,
    selectRoot,
    selector,
    content,
    searchInput,
    selectItem: multi ? null : content.querySelector('.ud__select__selector__selectItem'),
    dropdown: null,
    value
  };
  activeContext.selectRegistry.set(selector, state);
  activeContext.selectByField.set(fieldName, [...(activeContext.selectByField.get(fieldName) ?? []), state]);
  return selectRoot;
}

function cardNode(children) {
  const card = h('div', { class: `apply-form-array-card${CARD_HASH}` }, [
    h('div', { class: `apply-form-array-card-content${CARD_CONTENT_HASH}` }, children),
    h('div', { class: `apply-form-array-card-operate${CARD_OPERATE_HASH}` }, [
      h('button', {
        class: `ud__button ud__button--text ud__button--size-md apply-form-array-card-delete${CARD_DELETE_HASH}`,
        attrs: { type: 'button' },
        on: {
          click: event => {
            event?.stopPropagation?.();
            card.remove();
          }
        }
      }, [h('span', { class: 'universe-icon', text: '🗑' })])
    ])
  ]);
  return card;
}

function noExperienceLabel(text) {
  return h('label', { class: 'ud__checkbox__wrapper applyFormModuleWrapper-no-experience' }, [
    h('span', { class: 'ud__checkbox ud__checkbox--size-md' }, [
      h('input', { class: 'ud__checkbox__input', attrs: { type: 'checkbox' }, checked: false })
    ]),
    h('span', { class: 'ud__checkbox__label', text })
  ]);
}

export function createBytedanceTwin() {
  const document = createDocument({
    title: '编辑简历 | 招聘站点',
    location: { origin: 'https://jobs.bytedance.com', pathname: '/experienced/resume/edit', search: '' }
  });

  const context = {
    selectRegistry: new WeakMap(),
    selectByField: new Map(),
    dropdownState: new WeakMap()
  };
  activeContext = context;
  const selectRegistry = context.selectRegistry;
  const selectByField = context.selectByField;
  const dropdownState = context.dropdownState;
  const modules = new Map();        // sectionKey -> module element
  const addButtons = new Map();     // sectionKey -> add button
  const cardBuilders = new Map();   // sectionKey -> (index) => card element

  // ---------- 下拉交互 ----------
  const findWrapper = () => document.querySelector('[class*="resumeEditForm-wrapper"]') ?? document.body;

  const closeSelect = state => {
    if (!state?.dropdown) return;
    state.dropdown.style.display = 'none';
    state.dropdown.classList.add('ud-slide-up-leave');
  };
  const closeAllSelects = () => { for (const list of selectByField.values()) for (const state of list) closeSelect(state); };

  const openSelect = state => {
    if (!state) return null;
    closeAllSelects();
    if (state.dropdown) state.dropdown.remove();
    const itemNodes = state.options.slice(0, 10).map(option => h('div', {}, [
      h('div', { class: 'ud__select__list__item' }, [
        h('div', { class: 'ud__select__list__item__content ud__textOverflow' }, [h('span', {}, [h('span', { text: option })])]),
        h('div', { class: 'ud__select__list__item__check' })
      ])
    ]));
    const dropdown = h('div', { class: 'ud__select__dropdown ud__select__dropdown-placement-bottomLeft' }, [
      h('div', {}, [
        h('div', { class: 'ud__select__list' }, [
          h('div', { class: 'ud__select__list__menu' }, [
            h('div', { class: 'rc-virtual-list' }, [
              h('div', { class: 'rc-virtual-list-holder', style: 'max-height:240px; overflow-y:hidden' }, [
                h('div', { style: `height:${state.options.length * 32}px` }, [
                  h('div', { class: 'rc-virtual-list-holder-inner', style: 'transform: translateY(0px)' }, itemNodes)
                ])
              ])
            ])
          ])
        ])
      ])
    ]);
    state.dropdown = dropdown;
    dropdownState.set(dropdown, state);
    findWrapper().appendChild(dropdown);
    return dropdown;
  };

  const chooseOption = (state, listItem) => {
    const option = String(listItem.textContent ?? '').trim();
    if (!option) return false;
    if (state.multi) {
      const existing = [...state.content.querySelectorAll('.ud__select__selector__tag')].find(tag => tag.textContent.trim() === option);
      if (existing) existing.remove();
      else state.content.insertBefore(h('span', { class: 'ud__tag ud__select__selector__tag', text: option }), state.content.firstChild);
    } else if (state.selectItem) {
      state.selectItem.textContent = option;
    }
    state.value = option;
    closeSelect(state);
    fire(state.searchInput, 'input');
    fire(state.searchInput, 'change');
    fire(state.selector, 'change');
    return true;
  };

  document.addEventListener('click', event => {
    const listItem = event.target.closest?.('.ud__select__list__item');
    if (listItem) {
      const dropdown = listItem.closest('[class*="ud__select__dropdown"]');
      const state = dropdown ? dropdownState.get(dropdown) : null;
      if (state) chooseOption(state, listItem);
      return;
    }
    const selector = event.target.closest?.('.ud__select__selector');
    if (selector) {
      event.preventDefault?.();
      const state = selectRegistry.get(selector);
      if (!state) return;
      const open = state.dropdown && state.dropdown.style.display !== 'none' && state.dropdown.isConnected;
      if (open) closeSelect(state); else openSelect(state);
      return;
    }
    const addButton = event.target.closest?.(ADD_BUTTON_SELECTOR);
    if (addButton) { addCardForButton(addButton); return; }
    const deleteButton = event.target.closest?.(DELETE_BUTTON_SELECTOR);
    if (deleteButton) { deleteButton.closest(CARD_SELECTOR)?.remove(); return; }
    const save = event.target.closest?.('button.atsx-btn-primary, button.atsx-btn-default');
    if (save) { document.__submits += 1; event.preventDefault?.(); return; }
    closeAllSelects();
  });

  // ---------- 模块与卡片 ----------
  const moduleNode = ({ title, empty = false, children = [], addLabel = null, noExperience = null }) => {
    const classNames = `applyFormModuleWrapper applyFormModuleWrapper__${MODULE_HASH.slice(2)}${empty ? ' applyFormModuleWrapper-empty applyFormModuleWrapper-placeholder' : ''}`;
    const module = h('div', { class: classNames }, [
      h('div', { class: 'applyFormModuleWrapper-title applyFormModuleWrapper-title__2jQ' }, [
        h('div', { class: 'applyFormModuleWrapper-text', text: title })
      ]),
      ...children
    ]);
    if (noExperience) module.appendChild(noExperienceLabel(noExperience));
    if (addLabel) {
      const addButton = h('button', { class: `ud__button ud__button--dashed apply-form-array-card-add${CARD_ADD_HASH}`, attrs: { type: 'button' }, text: addLabel });
      module.appendChild(addButton);
      addButtons.set(title, addButton);
    }
    return module;
  };

  const addCardForButton = button => {
    const module = button.closest(MODULE_SELECTOR);
    if (!module) return null;
    const title = module.querySelector(MODULE_TITLE_SELECTOR)?.textContent?.trim() ?? '';
    const definition = BYTEDANCE_MODULE_KEYS.find(item => item.title === title);
    const builder = definition ? cardBuilders.get(definition.key) : null;
    if (!builder) return null;
    const index = module.querySelectorAll(CARD_SELECTOR).length;
    const card = builder(index);
    module.insertBefore(card, button);
    module.classList.remove('applyFormModuleWrapper-empty', 'applyFormModuleWrapper-placeholder');
    return card;
  };

  // ---------- 基本信息 ----------
  const basicModule = moduleNode({
    title: '基本信息',
    children: [
      field('name', '姓名', textInput({ value: '林知远', placeholder: '请输入' })),
      field('mobile', '手机号码', h('div', { class: 'ud__formily-mobile' }, [
        udSelect({ field: 'mobile', value: '+86', options: SELECT_OPTIONS.area_code, searchable: true }),
        textInput({ value: '13800000000' })
      ])),
      field('email', '邮箱', textInput({ value: 'linzhiyuan@example.com' })),
      field('preferred_city_list', '期望工作地点', udSelect({ field: 'preferred_city_list', value: ['深圳'], multi: true, searchable: true }))
    ]
  });

  // ---------- 简历（附件，file 隐藏） ----------
  const attachmentModule = moduleNode({
    title: '简历',
    empty: true,
    children: [
      field('attachment_resume', '简历附件', h('div', { class: 'ud__upload', style: 'display:none' }, [
        h('input', { attrs: { type: 'file', accept: '.pdf,.doc,.docx' } })
      ]), { required: false })
    ]
  });

  // ---------- 可重复模块 ----------
  const createRepeatModule = ({ key, title, empty, initialCards, noExperience = null }) => {
    const builder = index => cardNode(CARD_FIELDS[key]({ index }));
    cardBuilders.set(key, builder);
    const cards = [];
    for (let index = 0; index < initialCards; index += 1) cards.push(builder(index));
    const module = moduleNode({ title, empty, children: cards, addLabel: '添加', noExperience });
    modules.set(key, module);
    return module;
  };

  const repeatModules = [
    createRepeatModule({ key: 'work', title: '工作经历', empty: true, initialCards: 0, noExperience: '没有工作经历' }),
    createRepeatModule({ key: 'education', title: '教育经历', empty: false, initialCards: 1 }),
    createRepeatModule({ key: 'internship', title: '实习经历', empty: true, initialCards: 0, noExperience: '没有实习经历' }),
    createRepeatModule({ key: 'project', title: '项目经历', empty: false, initialCards: 9 }),
    createRepeatModule({ key: 'work_samples', title: '作品', empty: true, initialCards: 0, noExperience: '没有作品' }),
    createRepeatModule({ key: 'award', title: '获奖', empty: false, initialCards: 3 }),
    createRepeatModule({ key: 'language', title: '语言能力', empty: false, initialCards: 2 })
  ];

  // ---------- 自我评价 ----------
  const summaryModule = moduleNode({
    title: '自我评价',
    children: [
      field('self_evaluation', '自我评价', textArea({ value: '本人做事注重逻辑性与工程质量，能够主动定位问题并持续优化。' }), { required: false })
    ]
  });

  // ---------- 社交账号（自我评价之后，与真机顺序一致） ----------
  const snsModule = createRepeatModule({ key: 'sns', title: '社交账号', empty: false, initialCards: 3 });

  const footer = h('div', { class: 'resumeEdit-footer resumePage-footer' }, [
    h('button', { class: 'atsx-btn atsx-btn-default atsx-btn-lg', attrs: { type: 'button' }, text: '取消' }),
    h('button', { class: 'atsx-btn atsx-btn-primary atsx-btn-lg', attrs: { type: 'button' }, text: '保存' })
  ]);

  const form = h('form', { class: 'resumeEditForm-form' }, [
    attachmentModule,
    basicModule,
    ...repeatModules,
    summaryModule,
    snsModule,
    footer
  ]);
  const wrapper = h('div', { class: 'resumeEditForm-wrapper resumeEditForm__2gJKU saasResumeEditForm__fI0s7' }, [
    h('h1', { class: 'resumeEditForm-title', text: '编辑简历' }),
    form
  ]);
  document.body.appendChild(wrapper);

  // 模块查找表（顺序 = 真机 DOM 顺序）
  modules.clear();
  modules.set('attachment', attachmentModule);
  modules.set('basic', basicModule);
  modules.set('work', repeatModules[0]);
  modules.set('education', repeatModules[1]);
  modules.set('internship', repeatModules[2]);
  modules.set('project', repeatModules[3]);
  modules.set('work_samples', repeatModules[4]);
  modules.set('award', repeatModules[5]);
  modules.set('language', repeatModules[6]);
  modules.set('summary', summaryModule);
  modules.set('sns', snsModule);

  const moduleTitle = sectionKey => BYTEDANCE_MODULE_KEYS.find(item => item.key === sectionKey)?.title ?? '';

  const selectFor = fieldName => (selectByField.get(fieldName) ?? [])[0] ?? null;

  return {
    document,
    window: document.defaultView,
    get submits() { return document.__submits; },
    submitCount() { return document.__submits; },
    rawControlElements() { return controlElements(document); },
    controlElements() { return controlElements(document).filter(element => String(element.type || '').toLowerCase() !== 'file'); },
    moduleTitles() { return Object.fromEntries(BYTEDANCE_MODULE_KEYS.map(item => [item.key, item.title])); },
    modules() { return [...modules.keys()]; },
    module(sectionKey) { return modules.get(sectionKey) ?? null; },
    cards(sectionKey) {
      const module = modules.get(sectionKey);
      return module ? [...module.querySelectorAll(CARD_SELECTOR)] : [];
    },
    addButton(sectionKey) { const title = moduleTitle(sectionKey); return addButtons.get(title) ?? null; },
    buildCard(sectionKey, index = 0) { const builder = cardBuilders.get(sectionKey); return builder ? builder(index) : null; },
    addCard(sectionKey, times = 1) {
      const button = this.addButton(sectionKey);
      if (!button) throw new Error(`dom-twin: module "${sectionKey}" has no add button`);
      let module = null;
      for (let index = 0; index < times; index += 1) { button.click(); module = button.closest(MODULE_SELECTOR); }
      return module;
    },
    /** 旧接口别名（默认 fixture 时代的 addItem 名字，等价 addCard）。 */
    addItem(sectionKey, times = 1) { return this.addCard(sectionKey, times); },
    select(fieldName) { return selectFor(fieldName); },
    openSelect(fieldName) {
      const state = selectFor(fieldName);
      if (!state) throw new Error(`dom-twin: no select for field "${fieldName}"`);
      const visible = state.dropdown && state.dropdown.isConnected && state.dropdown.style.display !== 'none';
      if (!visible) openSelect(state);
      return state;
    },
    options(fieldName) {
      const state = selectFor(fieldName);
      if (!state?.dropdown) return [];
      return [...state.dropdown.querySelectorAll('.ud__select__list__item')].map(item => item.textContent.trim());
    },
    chooseOption(fieldName, label) {
      const state = selectFor(fieldName);
      if (!state?.dropdown) throw new Error(`dom-twin: select "${fieldName}" is not open`);
      const item = [...state.dropdown.querySelectorAll('.ud__select__list__item')].find(node => node.textContent.trim() === String(label));
      if (!item) throw new Error(`dom-twin: option "${label}" not found for "${fieldName}"`);
      chooseOption(state, item);
      return item;
    },
    closeSelects: closeAllSelects,
    click(target) {
      const element = typeof target === 'string' ? document.querySelector(target) : target;
      if (!element) throw new Error(`dom-twin: target not found: ${String(target)}`);
      element.click();
      return element;
    }
  };
}
