/**
 * page-inspector.mjs — 页面检查层（契约 §3 + §9 真机校准）
 * =====================================================================
 * inspectPage(document, { capabilities?, config?, includeScreenshot? })
 *   -> { pageModel, diagnostics }
 *
 * 设计要点（对齐 docs/recon/bytedance-resume-edit.md）：
 * 1. 控件：CONTROL_SELECTOR 深查询（含 shadow root），每个真实控件恰好一次。
 *    selectorToken = 'control-token-<下标>'，下标严格对应
 *    queryAllDeep(document, CONTROL_SELECTOR).filter(el => el.type !== 'file')
 *    的下标（与 control-executor 的 resolveElement 完全一致；file 不占下标）；
 *    file 进 diagnostics 不进 controls；hidden 保留 + visible=false。
 * 2. 字段名：优先 data-form-field-name（页面语义名：start_end_time /
 *    field_of_study / sns_type ...），其次 data-select（旧 fixture），
 *    再其次 name 属性路径（list[0].school -> school），最后 label 别名。
 * 3. 标签：优先 data-form-field-i18n-name（真机中文标签），其次 label[for] /
 *    包裹 label / .ud-formily-item-label-content label / [class*="fieldLabel"]，
 *    再次 aria-labelledby、附近 label 文本、aria-label、placeholder、name。
 *    labelSource: associated | aria | sibling | placeholder | name。
 * 4. 分区：真机 11 个模块 = [class*="applyFormModuleWrapper"]（标题在
 *    [class*="applyFormModuleWrapper-title"] [class*="applyFormModuleWrapper-text"]）；
 *    通用回退 <section>/<fieldset>/[role=group] + legend/h1..h6/aria-label。
 *    sectionKey 用契约词表（作品 -> work_samples，简历附件 -> attachment）。
 * 5. 可重复条目：真机 [class*="apply-form-array-card__"]，itemIndex = 同模块 DOM
 *    顺序；通用回退 [data-repeat-item]、id="career-0"。起止时间两个 input
 *    按 DOM 顺序给 itemRole start/end。
 * 6. 动作：只把「添加/新增」按钮放进 pageModel.actions（kind:'add-item'），
 *    删除/保存/取消/提交/预览类永不进 actions；action.selectorToken =
 *    'action-token-<queryAllDeep(document, ACTION_SELECTOR) 原始下标>'。
 * 7. 下拉不点击不展开：只在页面已经展开（可见）时从
 *    [class*="ud__select__dropdown"] / .ud__select__list__item 读 options。
 * 8. **绝不** 点击/修改页面。
 *
 * 所有平台特征都集中在 DEFAULT_INSPECTOR_CONFIG 里，可用
 * inspectPage(document, { config }) 覆盖（可配置、可复用）。
 */

import { createPageModel } from '../core/page-model.mjs';

// ---------------------------------------------------------------------------
// 配置（真机默认值 + 通用回退；可被 options.config 覆盖）
// ---------------------------------------------------------------------------

export const CONTROL_SELECTOR = 'input, textarea, select, [role="combobox"], [contenteditable="true"]';
export const ACTION_SELECTOR = 'button, [role="button"], a';

export const SECTION_KEY_ALIASES = {
  basic: ['基本信息', '个人信息', '基本资料', 'basic', 'basic info', '基本情報', '기본 정보'],
  work: ['工作经历', '工作经验', '职业经历', 'work experience', 'work', 'career', '職歴', '경력'],
  internship: ['实习经历', '实习经验', '实习', 'internship', 'インターンシップ', '인턴'],
  education: ['教育经历', '教育背景', 'education', '学歴', '학력'],
  project: ['项目经历', '项目经验', '项目', 'project', 'プロジェクト', '프로젝트'],
  work_samples: ['作品', '作品集', '作品展示', 'work samples', 'portfolio', 'ポートフォリオ', '포트폴리오'],
  award: ['获奖', '获奖经历', '奖项', '荣誉', 'award', 'honors', '受賞', '수상'],
  language: ['语言能力', '语言', '外语', 'language', '言語', '언어'],
  summary: ['自我评价', '自我介绍', '个人总结', '个人简介', 'summary', 'about', '自己PR', '자기소개'],
  sns: ['社交账号', '社交', 'sns', 'social', 'ソーシャル', '소셜'],
  intention: ['求职意向', '工作意向', 'intention', 'job intention'],
  attachment: ['简历', '附件', '简历附件', 'attachment', 'resume']
};

export const DEFAULT_INSPECTOR_CONFIG = {
  controlSelector: CONTROL_SELECTOR,
  actionSelector: ACTION_SELECTOR,
  // 字段容器（页面语义字段名）
  fieldItemSelector: '[data-form-field-name]',
  fieldNameAttr: 'data-form-field-name',
  fieldLabelAttr: 'data-form-field-i18n-name',
  // 标签文本所在
  labelTextSelectors: [
    '[class*="formily-item-label-content"] label',
    'label',
    '[class*="fieldLabel"]',
    '[class*="field-label"]',
    '[class*="formLabel"]',
    '[class*="form-label"]',
    '[class*="itemLabel"]',
    '[class*="item-label"]',
    '[class*="labelText"]'
  ],
  // 分区：真机模块（class 带构建哈希，用前缀匹配）
  moduleSelector: '[class*="applyFormModuleWrapper"]',
  moduleTitleSelector: '[class*="applyFormModuleWrapper-title"] [class*="applyFormModuleWrapper-text"]',
  // 分区：通用回退
  genericSectionSelectors: ['section', 'fieldset', '[role="group"]'],
  genericSectionHeadingSelector: 'legend, h1, h2, h3, h4, h5, h6',
  // 可重复条目
  repeatCardSelector: '[class*="apply-form-array-card__"]',
  repeatItemSelector: '[data-repeat-item], [data-repeat-index]',
  // 添加/删除按钮
  addButtonHintSelector: '[class*="apply-form-array-card-add"]',
  deleteButtonHintSelector: '[class*="apply-form-array-card-delete"]',
  addButtonTextPattern: /^(添加|新增|追加|add\b|新規|추가)/i,
  dangerTextPattern: /保存|取消|提交|投递|预览|删除|移除|save|cancel|submit|apply|preview|delete|remove/i,
  // 自定义下拉（真机 ud__select 方言）
  selectRootSelector: '.ud__select',
  comboboxTriggerSelector: '.ud__select__selector',
  selectItemSelector: '.ud__select__selector__selectItem',
  selectTagSelector: '.ud__select__selector__tag',
  dropdownSelector: '[class*="ud__select__dropdown"]',
  optionSelector: '.ud__select__list__item',
  optionTextSelector: '[class*="ud__select__list__item__content"]',
  // 旧 fixture 方言（可选兜底）
  optionRoleSelector: '[role="option"]',
  selectValueSelector: '.selectValue, [class*="selectValue"]',
  // 日期形态
  yearPlaceholderPattern: /YYYY/i,
  dateFormatForTimeRange: 'YYYY-MM',
  dateFormatForYear: 'YYYY',
  sectionKeyAliases: SECTION_KEY_ALIASES
};

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
/** 只读属性（绝不回退到 DOM property —— 兼容旧实现的 hidden bug 就是这么来的）。 */
const attr = (element, name) => {
  if (!element?.getAttribute) return null;
  const value = element.getAttribute(name);
  return value === null || value === undefined ? null : String(value);
};
const tag = element => String(element?.tagName ?? '').toLowerCase();
const toSelector = value => (Array.isArray(value) ? value.join(',') : String(value || '')).trim();

function queryAllDeep(root, selector) {
  if (!root || !selector) return [];
  const output = [...(root.querySelectorAll?.(selector) || [])];
  for (const host of root.querySelectorAll?.('*') || []) if (host.shadowRoot) output.push(...queryAllDeep(host.shadowRoot, selector));
  return output;
}

function mergeConfig(overrides) {
  if (!overrides || typeof overrides !== 'object') return { ...DEFAULT_INSPECTOR_CONFIG };
  const merged = { ...DEFAULT_INSPECTOR_CONFIG, ...overrides };
  merged.sectionKeyAliases = { ...SECTION_KEY_ALIASES, ...(overrides.sectionKeyAliases || {}) };
  return merged;
}

function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// 可见性（契约硬性要求：hasAttribute('hidden')，不是 element.hidden）
// ---------------------------------------------------------------------------

function isVisible(element, document) {
  if (!element) return false;
  const view = document?.defaultView;
  for (let current = element; current; current = current.parentElement) {
    if (current.hasAttribute?.('hidden')) return false;
    if (current.getAttribute?.('aria-hidden') === 'true') return false;
    const computed = view?.getComputedStyle?.(current);
    if (computed && (computed.display === 'none' || computed.visibility === 'hidden')) return false;
  }
  const rects = element.getClientRects?.();
  if (rects && rects.length > 0) {
    const rect = element.getBoundingClientRect?.();
    return !rect || (rect.width > 0 && rect.height > 0);
  }
  // Content script 的 isolated world 可能拿到空的 DOMRectList，但 CSS 可见性
  // 已经由上面的 computed style 兜底，这里按可见处理（与旧实现注释一致）。
  return true;
}

// ---------------------------------------------------------------------------
// 控件形态
// ---------------------------------------------------------------------------

function controlTypeFor(element) {
  const name = tag(element);
  const role = text(attr(element, 'role')).toLowerCase();
  const type = text(attr(element, 'type') || element?.type).toLowerCase();
  if (name === 'select') return 'native-select';
  if (name === 'textarea') return 'textarea';
  if (role === 'combobox') return 'combobox';
  if (type === 'checkbox' || role === 'checkbox' || role === 'switch') return 'checkbox';
  if (type === 'radio' || role === 'radio') return 'radio';
  if (type === 'file') return 'file';
  if (type === 'hidden') return 'hidden';
  if (name !== 'input' && (element?.isContentEditable || attr(element, 'contenteditable') === 'true')) return 'textarea';
  if (type === 'date' || type === 'month' || type === 'week') return 'date';
  if (type === 'number') return 'number';
  if (type === 'email') return 'email';
  if (type === 'tel') return 'tel';
  if (type === 'url') return 'url';
  if (role === 'textbox') return 'text';
  return 'text';
}

function roleFor(element, controlType) {
  const explicit = text(attr(element, 'role'));
  if (explicit) return explicit;
  if (controlType === 'checkbox' || controlType === 'radio') return controlType;
  if (controlType === 'native-select' || controlType === 'combobox') return 'combobox';
  return 'textbox';
}

function isTextLike(element, controlType) {
  return !['checkbox', 'radio', 'file', 'hidden', 'native-select', 'combobox'].includes(controlType);
}

// ---------------------------------------------------------------------------
// 分区 & 可重复条目
// ---------------------------------------------------------------------------

function isModuleNode(element, config) {
  if (!element?.matches?.(config.moduleSelector)) return false;
  return Boolean(element.querySelector?.(config.moduleTitleSelector));
}

function moduleTitleText(element, config) {
  return text(element.querySelector?.(config.moduleTitleSelector)?.textContent);
}

function sectionKeyFromLabel(label, config) {
  const normalized = text(label).toLowerCase();
  if (!normalized) return undefined;
  const aliases = config.sectionKeyAliases || {};
  // 先精确相等，再包含（按别名长度从长到短，避免「工作经历」被「工作」误吞）。
  const entries = [];
  for (const [key, list] of Object.entries(aliases)) for (const alias of list) entries.push({ key, alias: text(alias).toLowerCase() });
  entries.sort((a, b) => b.alias.length - a.alias.length);
  for (const entry of entries) if (normalized === entry.alias) return entry.key;
  for (const entry of entries) if (entry.alias.length >= 2 && normalized.includes(entry.alias)) return entry.key;
  return undefined;
}

function discoverSections(document, config) {
  const records = [];
  const candidates = queryAllDeep(document, config.moduleSelector).filter(element => isModuleNode(element, config));
  // 去掉嵌套的候选（只保留最外层模块）
  const modules = candidates.filter(element => {
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (isModuleNode(ancestor, config)) return false;
    }
    return true;
  });
  for (const element of modules) {
    const label = moduleTitleText(element, config);
    records.push({ element, label, key: sectionKeyFromLabel(label, config), addActionId: undefined, repeatable: false, itemCount: 0 });
  }
  if (records.length) return records;

  // 通用回退：<section>/<fieldset>/[role=group]，标题取 legend/h1..h6 或 aria-label
  const generic = queryAllDeep(document, toSelector(config.genericSectionSelectors));
  for (const element of generic) {
    const heading = text(element.querySelector?.(config.genericSectionHeadingSelector)?.textContent);
    const label = heading || text(attr(element, 'aria-label'));
    if (!label) continue;
    records.push({ element, label, key: sectionKeyFromLabel(label, config), addActionId: undefined, repeatable: false, itemCount: 0 });
  }
  return records;
}

function sectionFor(element, records) {
  for (let current = element.parentElement; current; current = current.parentElement) {
    const record = records.find(item => item.element === current);
    if (record) return record;
  }
  return null;
}

/** 可重复条目的序号：真机卡片优先，其次通用 data-repeat-item / id="career-0"。 */
function itemIndexFor(element, sectionRecord, config) {
  const card = element.closest?.(config.repeatCardSelector);
  if (card) {
    const container = sectionRecord?.element ?? card.parentElement;
    if (container) {
      const cards = [...(container.querySelectorAll?.(config.repeatCardSelector) || [])];
      const index = cards.indexOf(card);
      if (index >= 0) return index;
    }
  }
  const repeatItem = element.closest?.(config.repeatItemSelector);
  if (repeatItem) {
    const marker = attr(repeatItem, 'data-repeat-item') ?? attr(repeatItem, 'data-repeat-index') ?? '';
    const siblings = [...(repeatItem.parentElement?.children || [])].filter(node => (attr(node, 'data-repeat-item') ?? attr(node, 'data-repeat-index') ?? '') === marker);
    const index = siblings.indexOf(repeatItem);
    if (index >= 0) return index;
  }
  // id="career-0" / "career_0" 这类通用形态
  for (let current = element.parentElement; current; current = current.parentElement) {
    const id = current.id || attr(current, 'id') || '';
    const match = /(?:^|[-_ ])(\d+)$/.exec(id);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function countRepeatItems(record, config) {
  const cards = record.element.querySelectorAll?.(config.repeatCardSelector) ?? [];
  if (cards.length) return cards.length;
  const repeatItems = [...(record.element.querySelectorAll?.(config.repeatItemSelector) ?? [])];
  if (!repeatItems.length) return 0;
  // 只数最外层的条目标记，避免嵌套容器重复计数
  return repeatItems.filter(item => !repeatItems.some(other => other !== item && other.contains?.(item))).length;
}

// ---------------------------------------------------------------------------
// label / fieldKey / itemRole / value / options
// ---------------------------------------------------------------------------

function labelTextOf(element) {
  // 克隆会丢掉事件/引用，这里直接读 textContent；label 内嵌套控件不会贡献文本。
  const content = text(element?.textContent);
  return content.replace(/\s*\*\s*$/, '');
}

function associatedLabel(element) {
  const labels = element?.labels;
  if (labels && labels.length) for (const label of labels) {
    const value = labelTextOf(label);
    if (value) return value;
  }
  const wrapping = element?.closest?.('label');
  if (wrapping) {
    const clone = wrapping.cloneNode?.(true);
    if (clone) {
      for (const control of clone.querySelectorAll?.('input, textarea, select, [role="combobox"], [contenteditable="true"]') || []) control.remove();
      const value = text(clone.textContent);
      if (value) return value;
    }
  }
  return '';
}

function labelledByText(element, document) {
  const ids = text(attr(element, 'aria-labelledby'));
  if (!ids) return '';
  return ids.split(/\s+/).map(id => text(document?.getElementById?.(id)?.textContent)).filter(Boolean).join(' ');
}

function labelInFieldContainer(element, config) {
  const container = element.closest?.(config.fieldItemSelector) ?? null;
  if (!container) return null;
  for (const selector of config.labelTextSelectors) {
    for (const candidate of container.querySelectorAll?.(selector) || []) {
      if (candidate === element || candidate.contains?.(element)) continue;
      const value = labelTextOf(candidate);
      if (value && value.length <= 80) return { label: value, labelSource: 'associated' };
    }
  }
  return null;
}

function siblingLabel(element, config) {
  let scope = element.parentElement;
  for (let depth = 0; scope && depth < 4; depth += 1, scope = scope.parentElement) {
    const controlCount = scope.querySelectorAll?.(config.controlSelector)?.length ?? 0;
    if (controlCount > 4) break;
    for (const selector of config.labelTextSelectors) {
      for (const candidate of scope.querySelectorAll?.(selector) || []) {
        if (candidate === element || candidate.contains?.(element) || element.contains?.(candidate)) continue;
        if (candidate.closest?.(config.controlSelector) && candidate.closest?.(config.controlSelector) !== candidate) continue;
        const value = labelTextOf(candidate);
        if (value && value.length <= 80) return value;
      }
    }
  }
  return '';
}

function resolveLabel(element, config, document, sectionKey) {
  // 1) 页面自带的 i18n 标签（真机最可靠）
  const i18nHost = element.closest?.(`[${config.fieldLabelAttr}]`);
  if (i18nHost) {
    const value = text(attr(i18nHost, config.fieldLabelAttr));
    if (value) return { label: value, labelSource: 'associated' };
  }
  // 2) <label for> / 包裹 label
  const associated = associatedLabel(element);
  if (associated) return { label: associated, labelSource: 'associated' };
  // 3) aria-labelledby
  const labelled = labelledByText(element, document);
  if (labelled) return { label: labelled, labelSource: 'aria' };
  // 4) 字段容器内的 label 文本（.ud-formily-item-label-content label / [class*=fieldLabel]）
  const inContainer = labelInFieldContainer(element, config);
  if (inContainer) return inContainer;
  // 5) 附近 label 文本
  const sibling = siblingLabel(element, config);
  if (sibling) return { label: sibling, labelSource: 'sibling' };
  // 6) aria-label
  const ariaLabel = text(attr(element, 'aria-label'));
  if (ariaLabel) return { label: ariaLabel, labelSource: 'aria' };
  // 7) placeholder（只标记来源，不冒充正式标签）
  const placeholder = text(attr(element, 'placeholder'));
  if (placeholder) return { label: placeholder, labelSource: 'placeholder' };
  // 8) name / id
  const name = text(attr(element, 'name') || attr(element, 'id') || attr(element, 'data-form-field-id'));
  if (name) return { label: name, labelSource: 'name' };
  return { label: '', labelSource: sectionKey ? 'name' : 'name' };
}

const LABEL_FIELD_ALIASES = [
  // 通用（中英日韩）
  [/姓名|名字|name/i, 'name'],
  [/手机号码|手机号|手机|phone|mobile/i, 'mobile'],
  [/区号|国家代码|area.?code|country.?code/i, 'areaCode'],
  [/邮箱|电子邮件|e-?mail/i, 'email'],
  [/期望工作地点|期望城市|期望地点|工作地点|意向城市|preferred.?city|city/i, 'preferred_city_list'],
  [/公司名称|公司|company/i, 'company'],
  [/职位名称|职位|title|position/i, 'title'],
  [/部门|department/i, 'department'],
  [/学校名称|学校|院校|school/i, 'school'],
  [/学历|学位|degree/i, 'degree'],
  [/专业|field.?of.?study|major/i, 'field_of_study'],
  [/开始时间|开始日期|start/i, 'start'],
  [/结束时间|结束日期|end/i, 'end'],
  [/起止时间|时间范围|date.?range/i, 'start_end_time'],
  [/项目名称|项目名|project.?name/i, 'name'],
  [/项目角色|角色|role/i, 'role'],
  [/项目链接|链接|网址|url|link/i, 'link'],
  [/项目描述|描述|描\s*述|内容|description|desc/i, 'desc'],
  [/奖项名称|获奖名称|奖项|获奖|award/i, 'name'],
  [/获奖时间|获奖日期|date/i, 'date'],
  [/语言能力|语言|language/i, 'language'],
  [/精通程度|熟练程度|proficiency/i, 'proficiency'],
  [/社交平台|平台|sns/i, 'sns_type'],
  [/社交账号|账号|account/i, 'link'],
  [/自我评价|自我介绍|个人总结|summary/i, 'self_evaluation'],
  [/作品名称|作品链接|作品/gi, 'name']
];

function parseNamePath(name) {
  const value = text(name);
  if (!value) return undefined;
  const bracket = /(?:^|\.)([A-Za-z_$][\w$]*)\[\d+\](?:\.([A-Za-z_$][\w$]*))?$/.exec(value);
  if (bracket) return bracket[2] || bracket[1];
  const dotted = /(?:^|\.)([A-Za-z_$][\w$]*)$/.exec(value);
  if (dotted) return dotted[1];
  return value;
}

function fieldKeyFromLabel(label, sectionKey) {
  const value = text(label);
  if (!value) return undefined;
  for (const [pattern, key] of LABEL_FIELD_ALIASES) {
    if (pattern.test(value)) {
      if (key === 'name' && sectionKey && ['award', 'project', 'work_samples'].includes(sectionKey)) return 'name';
      return key;
    }
  }
  return undefined;
}

function resolveFieldKey(element, config, sectionKey, label) {
  // 1) 控件自身 / 最近字段容器的 data-form-field-name（真机页面语义名）
  const own = text(attr(element, config.fieldNameAttr));
  if (own) return own;
  const container = element.closest?.(config.fieldItemSelector);
  const fromContainer = text(attr(container, config.fieldNameAttr));
  if (fromContainer) return fromContainer;
  // 2) 旧 fixture 的 data-select
  const dataSelect = text(attr(element, 'data-select'));
  if (dataSelect) {
    const map = { area_code: 'mobile', city: 'preferred_city_list', sns_type: 'sns_type' };
    return map[dataSelect] ?? dataSelect;
  }
  // 3) name 属性路径 education_list[0].school -> school
  const name = text(attr(element, 'name'));
  if (name) {
    const parsed = parseNamePath(name);
    if (parsed) return parsed;
  }
  // 4) label 别名（回退到简历词表字段名）
  return fieldKeyFromLabel(label, sectionKey);
}

function itemRoleFor(element, config, fieldKey, label) {
  // 只有明确的起止时间字段才带 itemRole；其它字段（自我评价/描述等）必须为 undefined，
  // 否则下游按 role 分组会误判（例如「自我评价」曾因含「自」被误标成 start）。
  if (fieldKey === 'start') return 'start';
  if (fieldKey === 'end') return 'end';
  if (fieldKey !== 'start_end_time') return undefined;
  const container = element.closest?.(config.fieldItemSelector) ?? element.closest?.(`[${config.fieldNameAttr}="start_end_time"]`) ?? null;
  if (!container) return undefined;
  const inputs = queryAllDeep(container, config.controlSelector).filter(candidate => isTextLike(candidate, controlTypeFor(candidate)));
  const index = inputs.indexOf(element);
  if (index === 0) return 'start';
  if (index === 1) return 'end';
  return undefined;
}

function dateFormatFor(element, config, fieldKey, fieldName) {
  const placeholder = text(attr(element, 'placeholder'));
  if (placeholder && config.yearPlaceholderPattern.test(placeholder)) return config.dateFormatForYear;
  const semantic = fieldName || fieldKey;
  if (semantic === 'start_end_time' || semantic === 'start' || semantic === 'end') return config.dateFormatForTimeRange;
  if (semantic === 'date') return config.dateFormatForYear;
  const inputType = text(attr(element, 'type'));
  if (inputType === 'month') return 'YYYY-MM';
  if (inputType === 'date') return 'YYYY-MM-DD';
  return undefined;
}

function displayTextFor(element, config) {
  const root = element.closest?.(config.selectRootSelector) ?? element.closest?.(config.comboboxTriggerSelector) ?? null;
  if (!root) return '';
  const selectItem = root.querySelector?.(config.selectItemSelector);
  if (selectItem) {
    const value = text(selectItem.textContent);
    if (value) return value;
  }
  const tags = [...(root.querySelectorAll?.(config.selectTagSelector) || [])].map(node => text(node.textContent)).filter(Boolean);
  if (tags.length) return tags.join(',');
  const valueText = text(attr(element, 'aria-valuetext'));
  return valueText;
}

function valueFor(element, controlType, config) {
  if (controlType === 'checkbox' || controlType === 'radio') return Boolean(element.checked);
  if (controlType === 'native-select') return String(element.value ?? '');
  if (controlType === 'combobox') {
    const display = displayTextFor(element, config);
    if (display) return display;
    const fallback = text(attr(element, 'aria-valuetext') || element.value || '');
    return fallback;
  }
  if (controlType === 'textarea' && element.isContentEditable) return text(element.textContent);
  const raw = element.value ?? attr(element, 'aria-valuetext') ?? '';
  return String(raw ?? '');
}

function optionsFor(element, controlType, config, document) {
  if (controlType === 'native-select') {
    const values = [];
    for (const option of element.options || element.querySelectorAll?.('option') || []) {
      const optionValue = text(option.textContent || option.label || option.value);
      const value = text(option.value);
      for (const candidate of [optionValue, value]) if (candidate && !values.includes(candidate)) values.push(candidate);
    }
    return values.length ? values : undefined;
  }
  if (controlType !== 'combobox') return undefined;
  const selectRoot = element.closest?.(config.selectRootSelector) ?? element.closest?.(config.comboboxTriggerSelector)?.parentElement ?? null;
  const dropdowns = queryAllDeep(document, config.dropdownSelector).filter(node => isVisible(node, document));
  let dropdown = null;
  if (selectRoot) dropdown = dropdowns.find(node => selectRoot.contains?.(node)) ?? null;
  if (!dropdown && dropdowns.length === 1) dropdown = dropdowns[0];
  if (!dropdown) return undefined;
  const values = [];
  for (const option of queryAllDeep(dropdown, config.optionSelector)) {
    if (!isVisible(option, document)) continue;
    const content = option.querySelector?.(config.optionTextSelector);
    const value = text(content?.textContent ?? option.textContent);
    if (value && !values.includes(value)) values.push(value);
  }
  // 旧 fixture 的 [role="option"] 兜底
  if (!values.length) {
    for (const option of queryAllDeep(dropdown, config.optionRoleSelector)) {
      const value = text(option.textContent || attr(option, 'aria-label'));
      if (value && !values.includes(value)) values.push(value);
    }
  }
  return values.length ? values : undefined;
}

// ---------------------------------------------------------------------------
// 动作（只收添加按钮）
// ---------------------------------------------------------------------------

function visibleTextOf(element) {
  return text(element.textContent || attr(element, 'aria-label') || attr(element, 'title'));
}

function isAddButton(element, config) {
  if (!element?.matches) return false;
  if (element.matches?.(config.deleteButtonHintSelector)) return false;
  const value = visibleTextOf(element);
  if (value && config.dangerTextPattern.test(value)) return false;
  if (element.matches?.(config.addButtonHintSelector)) return true;
  return config.addButtonTextPattern.test(value);
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

export function inspectPage(document, { capabilities = null, config = null, includeScreenshot = false } = {}) {
  if (!document) throw new TypeError('inspectPage requires a document');
  const inspectorConfig = mergeConfig(config);
  const diagnostics = [];

  const elements = queryAllDeep(document, inspectorConfig.controlSelector);
  const sectionRecords = discoverSections(document, inspectorConfig);
  const sectionByElement = new Map(sectionRecords.map(record => [record.element, record]));
  const sectionIds = new Set();
  for (const record of sectionRecords) {
    // 稳定 id：优先 sectionKey，其次 label 的 ascii slug，最后序号
    const base = record.key ? `section-${record.key}` : `section-${slugify(record.label) || 'form'}`;
    let id = base;
    let suffix = 2;
    while (sectionIds.has(id)) { id = `${base}-${suffix}`; suffix += 1; }
    sectionIds.add(id);
    record.id = id;
  }

  const controls = [];
  const actionElements = queryAllDeep(document, inspectorConfig.actionSelector);
  const actions = [];

  elements.forEach((element) => {
    const controlType = controlTypeFor(element);
    // 执行器按 queryAllDeep(...).filter(type !== 'file') 的下标解析 token，
    // 所以 file 元素不占用 control token 下标（与 control-executor 完全对齐）。
    const selectorToken = `control-token-${controls.length}`;
    const section = sectionFor(element, sectionRecords);
    const sectionKey = section?.key;
    const labelInfo = resolveLabel(element, inspectorConfig, document, sectionKey);
    const fieldKey = resolveFieldKey(element, inspectorConfig, sectionKey, labelInfo.label);
    const fieldName = text(attr(element.closest?.(inspectorConfig.fieldItemSelector), inspectorConfig.fieldNameAttr)) || fieldKey;
    const itemIndex = itemIndexFor(element, section, inspectorConfig);
    const itemRole = itemRoleFor(element, inspectorConfig, fieldKey, labelInfo.label);
    const displayText = controlType === 'combobox' ? displayTextFor(element, inspectorConfig) : undefined;
    const options = optionsFor(element, controlType, inspectorConfig, document);
    const dateFormat = dateFormatFor(element, inspectorConfig, fieldKey, fieldName);
    const visible = controlType === 'hidden' ? false : isVisible(element, document);
    const isCombobox = controlType === 'combobox';
    const readonlyAttr = attr(element, 'readonly') !== null;
    // combobox 的“可操作性”在触发元素上，内部 input 常带 readonly；不把 readonly 传给 matcher。
    const readonly = isCombobox
      ? false
      : Boolean(element.readOnly ?? element.readonly ?? readonlyAttr) || attr(element, 'aria-readonly') === 'true';
    const disabled = Boolean(element.disabled) || attr(element, 'aria-disabled') === 'true';

    if (controlType === 'file') {
      diagnostics.push({
        code: 'control-skipped',
        controlType: 'file',
        reason: 'file-input-not-fillable',
        ...(labelInfo.label ? { label: labelInfo.label } : {}),
        ...(section ? { sectionId: section.id } : {})
      });
      return;
    }

    const control = {
      controlId: `control-${controls.length}`,
      selectorToken,
      label: labelInfo.label,
      labelSource: labelInfo.labelSource,
      role: roleFor(element, controlType),
      controlType,
      value: valueFor(element, controlType, inspectorConfig),
      visible,
      disabled,
      readonly,
      ...(options ? { options } : {}),
      ...(section ? { sectionId: section.id } : {}),
      ...(sectionKey ? { sectionKey } : {}),
      ...(itemIndex === undefined ? {} : { itemIndex }),
      ...(fieldKey ? { fieldKey } : {}),
      ...(itemRole ? { itemRole } : {}),
      ...(displayText ? { displayText } : {}),
      ...(text(attr(element, 'placeholder')) ? { placeholder: text(attr(element, 'placeholder')) } : {}),
      ...(dateFormat ? { dateFormat } : {}),
      element
    };
    controls.push(control);
  });

  // 动作：只收添加按钮；同时回填 section.addActionId
  actionElements.forEach((element, rawIndex) => {
    if (!isAddButton(element, inspectorConfig)) return;
    const section = sectionFor(element, sectionRecords);
    const label = visibleTextOf(element) || '添加';
    const sectionKeyValue = section?.key ?? '';
    const actionId = `add-item:${sectionKeyValue || slugify(label) || String(actions.length)}`;
    actions.push({
      actionId,
      kind: 'add-item',
      sectionId: section?.id ?? '',
      ...(sectionKeyValue ? { sectionKey: sectionKeyValue } : {}),
      label,
      // 与 control-executor 对齐：action-token-<n> 的 n 是
      // queryAllDeep(document, ACTION_SELECTOR) 的原始下标（禁止按钮也占下标）。
      selectorToken: `action-token-${rawIndex}`
    });
    if (section && !section.addActionId) section.addActionId = actionId;
  });

  // 分区收尾：itemCount / repeatable
  for (const record of sectionRecords) {
    record.itemCount = countRepeatItems(record, inspectorConfig);
    record.repeatable = record.itemCount > 0 || Boolean(record.addActionId);
  }

  const location = document?.location || globalThis.location;
  const pageModel = createPageModel({
    pageIdentity: {
      origin: String(location?.origin || ''),
      route: `${location?.pathname || ''}${location?.search || ''}`,
      title: String(document?.title || '')
    },
    sections: sectionRecords.map(record => ({
      id: record.id,
      label: record.label,
      ...(record.key ? { key: record.key } : {}),
      repeatable: record.repeatable,
      itemCount: record.itemCount,
      ...(record.addActionId ? { addActionId: record.addActionId } : {})
    })),
    controls: controls.map(({ element, ...rest }) => rest),
    actions,
    dialogs: queryAllDeep(document, 'dialog, [role="dialog"]').map((dialog, index) => ({
      id: dialog.id || `dialog-${index}`,
      label: text(attr(dialog, 'aria-label')) || text(dialog.textContent).slice(0, 120),
      open: dialog.hasAttribute?.('hidden') !== true && isVisible(dialog, document)
    })),
    capturedAt: new Date().toISOString()
  });

  diagnostics.push({ code: 'controls-inspected', count: pageModel.controls.length });
  if (capabilities !== null && capabilities !== undefined) {
    // 能力注册表是可选的：page-inspector 自身已覆盖契约 §9 的所有控件形态。
    // 这里只记录，不做有副作用的探测，避免与 B 的执行层能力定义强耦合。
    if (!Array.isArray(capabilities)) diagnostics.push({ code: 'capabilities-ignored', reason: 'not-an-array' });
  }
  if (includeScreenshot) diagnostics.push({ code: 'screenshot-unavailable', message: 'Screenshot capture is not available in the content runtime' });
  return { pageModel, diagnostics };
}

export default inspectPage;
