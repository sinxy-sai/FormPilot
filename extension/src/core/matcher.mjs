/**
 * FormPilot 填写计划匹配器（规划层）。
 *
 * planFill({ resumeIndex, pageModel, mode, limit }) -> FillPlan（契约 v2 §4 + §9 真机校准）
 *
 * 硬性约束：
 *  - 严格作用域：只有 control.sectionKey === entry.section 且 itemIndex 可对齐时才匹配，
 *    绝不跨模块、绝不按「出现次数」把第 N 个同名 label 对到第 N 条简历数据。
 *  - 页面 fieldKey 是**页面语义名**（`start_end_time` / `field_of_study` / `sns_type` …），
 *    必须经 FIELD_MAP 映射成简历词表字段后才可匹配（同名不同模块是致命点）。
 *  - 默认 fill-empty：页面已有非空且与目标不同 => status:'conflict'，不写；mode:'overwrite' 才 ready。
 *  - 已与目标相同 => status:'skipped'（幂等）。
 *  - 页面条目数 < 简历条目数 => 先生成 add-item 步骤；页面条目更多 => 不填不删，只报告 summary.pageExtra。
 *  - 纯函数：无 DOM、无 IO、无随机/时间，同输入必然同输出（步骤顺序稳定）。
 */

import {
  buildResumeIndex,
  isFieldKey,
  isRepeatableSection,
  isSectionKey,
  matchFieldKey,
  matchSectionKey,
  matchUniqueFieldByLabel,
  normalizeDate,
  normalizeLabel,
  REPEATABLE_SECTION_KEYS,
  SCHEMA_VERSION
} from './resume-index.mjs';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

const compareText = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const normalizeOption = value => String(value ?? '').toLowerCase().replace(/[\s\u3000\-_./\\|:：·・,，、;；()（）[\]【】{}"'`*#&+~～]/g, '');

export const FILL_MODES = Object.freeze(['fill-empty', 'overwrite']);
export const DEFAULT_LIMIT = 200;

// ---------------------------------------------------------------------------
// §9 真机常量：页面分区、页面字段名映射、下拉选项别名（全部显式，供测试与 UI 复核）
// ---------------------------------------------------------------------------

/** 页面 11 个模块（顺序固定）+ 简历分区常见的可识别别名。resume/work_samples 无简历数据，跳过。 */
export const SECTION_ALIASES = Object.freeze({
  resume: ['简历', '附件简历', 'resume', 'cv', 'attachments'],
  basic: ['基本信息', '个人信息', 'basic', 'basic info', 'basic information', '基本情報', '기본정보'],
  work: ['工作经历', '工作经验', 'work', 'work experience', '職歴', '경력'],
  education: ['教育经历', '教育背景', 'education', '学歴', '학력'],
  internship: ['实习经历', '实习', 'internship', 'インターンシップ', '인턴'],
  project: ['项目经历', '项目经验', 'project', 'projects', 'プロジェクト', '프로젝트'],
  work_samples: ['作品', '作品集', 'work samples', 'works', 'portfolio'],
  award: ['获奖', '竞赛', '获奖经历', '竞赛经历', 'award', 'awards', 'competition', '受賞', '수상'],
  language: ['语言能力', '语言', 'language', 'languages', '語学', '언어'],
  summary: ['自我评价', '自我介绍', 'summary', 'self evaluation', '自己PR', '자기소개'],
  sns: ['社交账号', '社交网络', 'sns', 'social', 'social accounts', 'ソーシャルアカウント', '소셜']
});

/** 页面模块中不参与填写的分区（简历 PDF 附件、作品）。 */
export const PAGE_SKIP_SECTIONS = Object.freeze(['resume', 'work_samples']);

const RANGE_MARKER = '@range-start-end';
const MOBILE_MARKER = '@mobile-area-code-or-number';
const PREFERRED_CITY_MARKER = '@preferred-city';

/**
 * data-form-field-name（页面语义名）→ 简历词表字段（契约 §9 权威映射表）。
 * 特殊标记：@range-start-end（起止两个输入）、@mobile-…（区号下拉/手机号文本共用 mobile）、
 *           @preferred-city（基本信息模块的期望工作地点，优先 intention.city，回退 basic.city）。
 */
const WORK_FIELD_MAP = Object.freeze({
  company: 'company',
  name: 'company',
  company_name: 'company',
  title: 'title',
  position: 'title',
  department: 'department',
  start_end_time: RANGE_MARKER,
  start_time: 'start',
  end_time: 'end',
  desc: 'desc',
  description: 'desc'
});

export const FIELD_MAP = Object.freeze({
  // 基本信息模块
  basic: Object.freeze({
    name: 'name',
    email: 'email',
    mobile: MOBILE_MARKER,
    preferred_city_list: PREFERRED_CITY_MARKER,
    area_code: 'areaCode',
    areacode: 'areaCode',
    id_type: 'idType',
    id_number: 'idNumber',
    city: 'city',
    gender: 'gender',
    birthday: 'birthday',
    work_start_date: 'workStartDate'
  }),
  // 求职意向（部分站点会独立成模块；字节把「期望工作地点」放在基本信息里）
  intention: Object.freeze({
    preferred_city_list: 'city',
    city: 'city',
    position: 'position',
    job_type: 'jobType',
    arrival_time: 'arrivalTime'
  }),
  // 工作经历 / 实习经历（空模块卡片字段名按项目经历同构估计）
  work: WORK_FIELD_MAP,
  internship: WORK_FIELD_MAP,
  // 教育经历
  education: Object.freeze({
    school: 'school',
    school_name: 'school',
    degree: 'degree',
    field_of_study: 'major',
    major: 'major',
    college: 'college',
    start_end_time: RANGE_MARKER,
    start_time: 'start',
    end_time: 'end',
    training_type: 'trainingType',
    gpa: 'gpa'
  }),
  // 项目经历
  project: Object.freeze({
    name: 'name',
    project_name: 'name',
    role: 'role',
    link: 'link',
    url: 'link',
    start_end_time: RANGE_MARKER,
    start_time: 'start',
    end_time: 'end',
    desc: 'desc',
    description: 'desc'
  }),
  // 获奖（含简历里的「竞赛」）
  award: Object.freeze({
    name: 'name',
    award_name: 'name',
    date: 'date',
    year: 'date',
    desc: 'desc',
    description: 'desc'
  }),
  // 语言能力
  language: Object.freeze({
    language: 'language',
    proficiency: 'proficiency'
  }),
  // 社交账号
  sns: Object.freeze({
    sns_type: 'platform',
    platform: 'platform',
    link: 'account',
    url: 'account',
    account: 'account',
    username: 'account'
  }),
  // 自我评价
  summary: Object.freeze({
    self_evaluation: 'content',
    content: 'content',
    summary: 'content'
  })
});

/**
 * 下拉选项别名（大小写/空白不敏感，先精确再去别名再包含）。
 * 只登记「语义等价」的组合；页面上没有等价项时必须 option-not-found，不许猜。
 */
export const OPTION_ALIASES = Object.freeze({
  degree: Object.freeze({
    本科: ['本科', '学士', '本科学历', 'bachelor', 'bachelors', 'undergraduate'],
    硕士: ['硕士', '研究生', '硕士学位', 'master', 'masters', 'master degree'],
    博士: ['博士', '博士研究生', 'phd', 'doctor', 'doctorate'],
    大专: ['大专', '专科', 'associate', 'associate degree'],
    MBA: ['mba', '工商管理硕士'],
    高中: ['高中', '高中及以下', 'high school', 'highschool']
  }),
  language: Object.freeze({
    英语: ['英语', '英文', 'english', 'eng'],
    普通话: ['普通话', '中文', '汉语', 'mandarin', 'chinese'],
    日语: ['日语', '日文', 'japanese', '日本語'],
    韩语: ['韩语', '韩文', 'korean', '한국어']
  }),
  proficiency: Object.freeze({
    母语: ['母语', '母语水平', 'native', 'mother tongue'],
    日常会话: ['日常会话', '日常沟通', '日常交流', 'conversational', 'daily conversation'],
    熟练: ['熟练', '较为熟练', 'proficient', 'fluent'],
    精通: ['精通', '精通水平', 'expert', 'mastery'],
    良好: ['良好', 'good'],
    一般: ['一般', 'basic', 'beginner']
  }),
  platform: Object.freeze({
    github: ['github', 'git hub', 'gh'],
    微信: ['微信', 'wechat', 'weixin', 'we chat'],
    QQ: ['qq'],
    微博: ['微博', 'weibo'],
    知乎: ['知乎', 'zhihu'],
    领英: ['领英', 'linkedin'],
    个人网站: ['个人网站', '个人主页', 'website', 'homepage', 'blog', '博客']
  })
});

const SECTION_ALIAS_LOOKUP = new Map();
for (const [sectionKey, aliases] of Object.entries(SECTION_ALIASES)) {
  for (const alias of [sectionKey, ...aliases]) {
    const normalized = normalizeLabel(alias);
    if (normalized && !SECTION_ALIAS_LOOKUP.has(normalized)) SECTION_ALIAS_LOOKUP.set(normalized, sectionKey);
  }
}

const OPTION_ALIAS_INDEX = new Map();
for (const [fieldKey, groups] of Object.entries(OPTION_ALIASES)) {
  const index = new Map();
  for (const [canonical, aliases] of Object.entries(groups)) {
    const members = new Set([canonical, ...aliases].map(value => normalizeOption(value)).filter(Boolean));
    for (const member of members) index.set(member, members);
  }
  OPTION_ALIAS_INDEX.set(fieldKey, index);
}

/** 页面 label / sectionKey / 模块标题 -> canonical section key（含 resume/work_samples 页面专有分区）。 */
export function matchPageSectionKey(label) {
  const normalized = normalizeLabel(label);
  if (!normalized) return null;
  return SECTION_ALIAS_LOOKUP.get(normalized) ?? matchSectionKey(label) ?? null;
}

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function optionAliasesFor(fieldKey, target) {
  const needle = normalizeOption(target);
  const index = OPTION_ALIAS_INDEX.get(fieldKey);
  const members = index?.get(needle);
  return members ?? new Set(needle ? [needle] : []);
}

/**
 * 下拉选项模糊匹配：精确 → 去空白/大小写 → 别名组 → 包含。
 * @returns {string|null} 命中时返回页面上的原始选项文本
 */
export function matchSelectOption(options, target, fieldKey) {
  const list = (Array.isArray(options) ? options : []).map(String).filter(Boolean);
  const exactTarget = String(target ?? '');
  if (list.includes(exactTarget)) return exactTarget;
  const needle = normalizeOption(target);
  if (!needle) return null;
  const same = list.find(option => normalizeOption(option) === needle);
  if (same) return same;
  const aliases = optionAliasesFor(fieldKey, target);
  const aliasHit = list.find(option => aliases.has(normalizeOption(option)));
  if (aliasHit) return aliasHit;
  const contains = list.find(option => {
    const normalized = normalizeOption(option);
    return normalized.includes(needle) || needle.includes(normalized);
  });
  if (contains) return contains;
  return list.find(option => {
    const normalized = normalizeOption(option);
    return [...aliases].some(alias => alias && (normalized.includes(alias) || alias.includes(normalized)));
  }) ?? null;
}

/** 下拉当前展示值是否已等于目标值（含别名/包含等价，避免把语义相同的选项误判为 conflict）。 */
export function selectValuesEqual(current, target, fieldKey) {
  const a = normalizeOption(current);
  const b = normalizeOption(target);
  if (!a || !b) return false;
  if (a === b) return true;
  const aliases = optionAliasesFor(fieldKey, target);
  if (aliases.has(a)) return true;
  if (a.length >= 2 && b.length >= 2 && (a.includes(b) || b.includes(a))) return true;
  return false;
}

function booleanFromText(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (!value) return false;
  if (value === '至今') return true;
  if (['true', '1', '是', '有', '对', 'yes', 'y', 'on', 'current', 'ongoing', '在職', '재직'].includes(value)) return true;
  if (['false', '0', '否', '无', '没有', '不是', 'no', 'n', 'off'].includes(value)) return false;
  return null;
}

function isEmptyValue(controlValue) {
  if (controlValue === undefined || controlValue === null) return true;
  if (typeof controlValue === 'boolean') return controlValue === false;
  if (Array.isArray(controlValue)) return controlValue.length === 0;
  return String(controlValue).trim() === '';
}

function controlTypeOf(control) {
  return String(control?.controlType ?? control?.type ?? 'text').toLowerCase();
}

const SELECT_CONTROL_TYPES = new Set(['combobox', 'native-select', 'custom-select', 'select', 'dropdown']);
const CHECK_CONTROL_TYPES = new Set(['checkbox']);
const SKIP_CONTROL_TYPES = new Set(['hidden', 'file']);

function kindForControlType(controlType) {
  if (SELECT_CONTROL_TYPES.has(controlType)) return 'select';
  if (CHECK_CONTROL_TYPES.has(controlType)) return 'check';
  if (controlType === 'radio') return 'unsupported';
  return 'fill';
}

function isEligibleControl(control) {
  if (!record(control) || typeof control.controlId !== 'string' || !control.controlId) return false;
  if (control.visible === false || control.disabled === true || control.readonly === true || control.readOnly === true) return false;
  if (SKIP_CONTROL_TYPES.has(controlTypeOf(control))) return false;
  if (!control.label && !control.fieldKey) return false;
  return true;
}

/** 日期等值比较：都解析成功时按年月（或「至今」）比较，否则按文本。 */
function dateValuesEqual(controlValue, entryValue) {
  const current = normalizeDate(controlValue);
  const target = normalizeDate(entryValue);
  if (current && target) {
    if (current.ongoing || target.ongoing) return current.ongoing === target.ongoing && current.text === target.text;
    if (current.year !== null && target.year !== null) return current.year === target.year && current.month === target.month;
  }
  return compareText(controlValue) === compareText(entryValue);
}

function isResumeIndexLike(value) {
  return record(value) && value.schemaVersion === SCHEMA_VERSION && Array.isArray(value.entries) && record(value.items);
}

const emptySummary = () => ({
  total: 0,
  ready: 0,
  conflicts: 0,
  skipped: 0,
  unsupported: 0,
  missingFields: [],
  outOfRangeItems: [],
  pageExtra: [],
  truncated: false,
  dropped: 0,
  plannedTotal: 0
});

// ---------------------------------------------------------------------------
// planFill
// ---------------------------------------------------------------------------

/**
 * @param {{ resumeIndex: object, pageModel: object, mode?: 'fill-empty'|'overwrite', limit?: number }} input
 * @returns {{ mode: string, steps: object[], summary: object }}
 */
export function planFill({ resumeIndex, pageModel, mode = 'fill-empty', limit = DEFAULT_LIMIT } = {}) {
  if (!record(resumeIndex)) throw new TypeError('planFill requires a resumeIndex object');
  if (!record(pageModel)) throw new TypeError('planFill requires a pageModel object');
  if (!FILL_MODES.includes(mode)) throw new TypeError(`planFill: unsupported mode "${mode}"`);
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError('planFill: limit must be a positive integer');

  const index = isResumeIndexLike(resumeIndex) ? resumeIndex : buildResumeIndex(resumeIndex);
  const resolvedMode = mode;

  // ---- 简历索引查找表：section -> itemIndex -> field -> entry
  const entryIndex = new Map();
  for (const entry of Array.isArray(index.entries) ? index.entries : []) {
    if (!record(entry) || !isSectionKey(entry.section) || typeof entry.field !== 'string') continue;
    if (!Number.isInteger(entry.itemIndex)) continue;
    if (!entryIndex.has(entry.section)) entryIndex.set(entry.section, new Map());
    const byItem = entryIndex.get(entry.section);
    if (!byItem.has(entry.itemIndex)) byItem.set(entry.itemIndex, new Map());
    const byField = byItem.get(entry.itemIndex);
    if (!byField.has(entry.field)) byField.set(entry.field, entry); // 重复字段先到先得，稳定
  }
  const entriesOf = (sectionKey, itemIndex, fieldKey) => entryIndex.get(sectionKey)?.get(itemIndex)?.get(fieldKey) ?? null;
  const resumeItems = sectionKey => (Array.isArray(index.items?.[sectionKey]) ? index.items[sectionKey] : []);

  // ---- 页面模型查找表
  const controls = (Array.isArray(pageModel.controls) ? pageModel.controls : []).filter(record);
  const sections = (Array.isArray(pageModel.sections) ? pageModel.sections : []).filter(record);
  const actions = (Array.isArray(pageModel.actions) ? pageModel.actions : []).filter(record);

  const sectionById = new Map();
  for (const section of sections) {
    const id = String(section.id ?? section.sectionId ?? '');
    if (id) sectionById.set(id, section);
  }
  const sectionKeyCache = new Map();
  const resolveSectionKey = section => {
    if (!record(section)) return null;
    const cacheKey = String(section.id ?? section.sectionId ?? section.label ?? '');
    if (sectionKeyCache.has(cacheKey)) return sectionKeyCache.get(cacheKey);
    let key = matchPageSectionKey(section.key) ?? matchPageSectionKey(section.label) ?? matchPageSectionKey(cacheKey);
    sectionKeyCache.set(cacheKey, key);
    return key;
  };

  const pageSectionByKey = new Map();
  for (const section of sections) {
    const key = resolveSectionKey(section);
    if (key && !pageSectionByKey.has(key)) pageSectionByKey.set(key, section);
  }
  const addActionBySectionId = new Map();
  for (const action of actions) {
    if (String(action.kind ?? '') !== 'add-item') continue;
    const sectionId = String(action.sectionId ?? '');
    if (sectionId && !addActionBySectionId.has(sectionId)) addActionBySectionId.set(sectionId, action);
  }

  // 控件所属 section（仅来自页面模型，不做「按出现次数」猜测）
  const controlSection = new Map();
  for (const control of controls) {
    const key = matchPageSectionKey(control.sectionKey) ?? (control.sectionId !== undefined && control.sectionId !== null
      ? resolveSectionKey(sectionById.get(String(control.sectionId)))
      : null);
    controlSection.set(control, key);
  }

  const resolveItemIndex = (sectionKey, control) => {
    if (!isRepeatableSection(sectionKey)) return 0;
    if (Number.isInteger(control.itemIndex) && control.itemIndex >= 0) return control.itemIndex;
    const section = control.sectionId !== undefined && control.sectionId !== null
      ? sectionById.get(String(control.sectionId))
      : pageSectionByKey.get(sectionKey);
    // 单条目分区（itemCount ≤ 1）或明确非重复分区：itemIndex 只能且必然是 0
    if (section && (section.repeatable === false || section.itemCount === 0 || section.itemCount === 1)) return 0;
    return null; // 可重复分区但页面没给条目下标：不猜，绝不按出现次数对齐
  };

  // 起止时间：优先 control.itemRole，其次按同 section+item 中出现顺序（第一个 start，第二个 end）
  const rangeCounters = new Map();
  const nextRangeOrdinal = (sectionKey, itemIndex) => {
    const key = `${sectionKey}.${itemIndex}`;
    const ordinal = rangeCounters.get(key) ?? 0;
    rangeCounters.set(key, ordinal + 1);
    return ordinal;
  };

  const mobileFieldFor = control => {
    const kind = kindForControlType(controlTypeOf(control));
    const label = normalizeLabel(control.label);
    if (kind === 'select' || /区号|areacode|countrycode|dialcode|code/.test(label)) return 'areaCode';
    return 'mobile';
  };

  const resolveFieldKey = (sectionKey, control, itemIndex) => {
    const raw = typeof control.fieldKey === 'string' ? control.fieldKey.trim() : '';
    if (raw) {
      const table = FIELD_MAP[sectionKey];
      const lowered = raw.toLowerCase();
      let mapped = table ? (table[raw] ?? table[lowered] ?? table[lowered.replace(/-/g, '_')]) : undefined;
      if (mapped === undefined && isFieldKey(sectionKey, raw)) mapped = raw;
      if (mapped !== undefined) {
        if (mapped === RANGE_MARKER) {
          const role = String(control.itemRole ?? '').toLowerCase();
          const ordinal = nextRangeOrdinal(sectionKey, itemIndex);
          const fieldKey = role === 'start' || role === 'end' ? role : (ordinal === 0 ? 'start' : 'end');
          return { fieldKey, confidence: 0.95, reason: 'page-field-map-range' };
        }
        if (mapped === MOBILE_MARKER) return { fieldKey: mobileFieldFor(control), confidence: 0.95, reason: 'page-field-map-mobile' };
        if (mapped === PREFERRED_CITY_MARKER) return { fieldKey: 'city', confidence: 0.85, reason: 'page-field-map-preferred-city', preferredCity: true };
        return { fieldKey: mapped, confidence: 0.95, reason: 'page-field-map' };
      }
    }
    if (control.label) {
      const byLabel = matchFieldKey(sectionKey, control.label);
      if (byLabel) return { fieldKey: byLabel, confidence: 0.85, reason: 'label-alias' };
    }
    return null;
  };

  /** 页面没有分区信息时，用页面 fieldKey / label 反推唯一的 (section, field)。 */
  const inferScopeFromControl = control => {
    const raw = typeof control.fieldKey === 'string' ? control.fieldKey.trim() : '';
    if (raw) {
      const candidates = [];
      for (const sectionKey of Object.keys(FIELD_MAP)) {
        const table = FIELD_MAP[sectionKey];
        const lowered = raw.toLowerCase();
        let mapped = table?.[raw] ?? table?.[lowered] ?? table?.[lowered.replace(/-/g, '_')];
        if (mapped === undefined && isFieldKey(sectionKey, raw)) mapped = raw;
        if (mapped === undefined) continue;
        if (mapped === RANGE_MARKER) {
          const role = String(control.itemRole ?? '').toLowerCase();
          if (role === 'start' || role === 'end') candidates.push({ sectionKey, fieldKey: role });
          else candidates.push({ sectionKey, fieldKey: 'start' }, { sectionKey, fieldKey: 'end' });
        } else if (mapped === MOBILE_MARKER) {
          candidates.push({ sectionKey, fieldKey: mobileFieldFor(control) });
        } else if (mapped === PREFERRED_CITY_MARKER) {
          candidates.push({ sectionKey: 'intention', fieldKey: 'city' }, { sectionKey: 'basic', fieldKey: 'city' });
        } else candidates.push({ sectionKey, fieldKey: mapped });
      }
      const unique = new Map(candidates.map(candidate => [`${candidate.sectionKey}.${candidate.fieldKey}`, candidate]));
      if (unique.size === 1) return [...unique.values()][0];
    }
    if (control.label) {
      const byLabel = matchUniqueFieldByLabel(control.label);
      if (byLabel) return { sectionKey: byLabel.sectionKey, fieldKey: byLabel.field };
      const byPageLabel = (() => {
        const candidates = [];
        for (const sectionKey of Object.keys(FIELD_MAP)) {
          const fieldKey = matchFieldKey(sectionKey, control.label);
          if (fieldKey) candidates.push({ sectionKey, fieldKey });
        }
        const unique = new Map(candidates.map(candidate => [`${candidate.sectionKey}.${candidate.fieldKey}`, candidate]));
        return unique.size === 1 ? [...unique.values()][0] : null;
      })();
      if (byPageLabel) return byPageLabel;
    }
    return null;
  };

  const missingFields = new Set();
  const steps = [];
  const pushStep = step => {
    steps.push(step);
    return step;
  };

  // 无分区页面里，同一 (section, field) 出现多次 => 可能对应多个条目，无法确定 itemIndex，标为歧义
  const inferredScopeCounts = new Map();
  for (const control of controls) {
    if (!isEligibleControl(control) || controlSection.get(control)) continue;
    const inferred = inferScopeFromControl(control);
    if (!inferred) continue;
    const scopeKey = `${inferred.sectionKey}.${inferred.fieldKey}`;
    inferredScopeCounts.set(scopeKey, (inferredScopeCounts.get(scopeKey) ?? 0) + 1);
  }

  // ---- 1) add-item：页面条目数 < 简历条目数时，先补条目
  const outOfRangeItems = [];
  const pageExtra = [];
  for (const sectionKey of REPEATABLE_SECTION_KEYS) {
    const items = resumeItems(sectionKey);
    const pageSection = pageSectionByKey.get(sectionKey);
    if (!pageSection) continue; // 页面上没有该分区，不凭空生成步骤
    let pageCount;
    if (Number.isInteger(pageSection.itemCount) && pageSection.itemCount >= 0) pageCount = pageSection.itemCount;
    else {
      const seen = new Set();
      for (const control of controls) {
        if (controlSection.get(control) !== sectionKey) continue;
        if (Number.isInteger(control.itemIndex) && control.itemIndex >= 0) seen.add(control.itemIndex);
      }
      pageCount = seen.size;
    }
    if (pageCount > items.length && pageCount > 0) {
      pageExtra.push({ section: sectionKey, resumeCount: items.length, pageCount });
      continue;
    }
    if (!items.length || pageCount >= items.length) continue;
    outOfRangeItems.push({ section: sectionKey, resumeCount: items.length, pageCount });
    const sectionId = String(pageSection.id ?? pageSection.sectionId ?? '');
    const actionId = pageSection.addActionId ?? addActionBySectionId.get(sectionId)?.actionId;
    for (let itemIndex = pageCount; itemIndex < items.length; itemIndex += 1) {
      const item = items[itemIndex];
      pushStep({
        stepId: `add-item:${sectionKey}:${itemIndex}`,
        kind: 'add-item',
        ...(actionId ? { actionId: String(actionId) } : {}),
        value: true,
        sourcePath: Array.isArray(item?.path) ? item.path.slice() : [sectionKey, itemIndex],
        fieldKey: 'add-item',
        sectionKey,
        itemIndex,
        confidence: 0.9,
        status: actionId ? 'ready' : 'unsupported',
        ...(actionId ? {} : { reason: 'no-add-action' })
      });
    }
  }

  // ---- 1.5) 条目身份冲突：可重复分区里，若某条目的「身份字段」页面已有内容且与简历不同，
  // 说明这一格对应的可能不是同一条记录（历史填写错位、用户手工改过）。此时只填空白模式
  // 若继续往这一格里写描述/链接/时间，会把两个不同记录拼在一起 —— 所以整条条目都跳过，
  // 交给人工核对（overwrite 模式不受影响，因为它会连身份字段一起改写）。
  const IDENTITY_RESUME_FIELD = Object.freeze({
    work: 'company', internship: 'company', education: 'school', project: 'name', award: 'name', language: 'language', sns: 'platform'
  });
  // 用「页面语义字段名」直接识别身份字段：不要在这里调用 resolveFieldKey，
  // 它对 start_end_time 这类同名字段是有状态的（会吃掉顺序分配），预先调用会把 start/end 弄反。
  const IDENTITY_PAGE_FIELD = Object.freeze({
    work: 'company', internship: 'company', education: 'school', project: 'name', award: 'name', language: 'language', sns: 'sns_type'
  });
  const identityConflicts = new Set();
  for (const control of controls) {
    if (!isEligibleControl(control)) continue;
    const sectionKey = controlSection.get(control);
    if (!sectionKey || !IDENTITY_PAGE_FIELD[sectionKey]) continue;
    if (!isRepeatableSection(sectionKey)) continue;
    if (control.fieldKey !== IDENTITY_PAGE_FIELD[sectionKey]) continue;
    const itemIndex = Number.isInteger(control.itemIndex) && control.itemIndex >= 0 ? control.itemIndex : 0;
    const identityField = IDENTITY_RESUME_FIELD[sectionKey];
    const entry = entriesOf(sectionKey, itemIndex, identityField);
    if (!entry) continue;
    const current = control.value;
    if (isEmptyValue(current)) continue;
    const kind = kindForControlType(controlTypeOf(control));
    const target = String(entry.value ?? '');
    const equal = kind === 'select' ? selectValuesEqual(current, target, identityField) : compareText(current) === compareText(entry.value);
    if (!equal) identityConflicts.add(`${sectionKey}:${itemIndex}`);
  }

  // ---- 2) 字段步骤：严格 section + item 作用域
  for (const control of controls) {
    if (!isEligibleControl(control)) continue;
    const controlType = controlTypeOf(control);
    let sectionKey = controlSection.get(control) ?? null;
    let itemIndex;
    let fieldResolution = null;
    let scopeConfidence = 0.95;

    if (sectionKey) {
      if (PAGE_SKIP_SECTIONS.includes(sectionKey)) continue;
      itemIndex = resolveItemIndex(sectionKey, control);
      if (itemIndex === null) continue;
      fieldResolution = resolveFieldKey(sectionKey, control, itemIndex);
      if (!fieldResolution) continue;
    } else {
      // 页面没有分区信息：只有「页面字段名 / label 强匹配且唯一归属」才允许 0.7，绝不猜
      const inferred = inferScopeFromControl(control);
      if (!inferred) continue;
      sectionKey = inferred.sectionKey;
      if (PAGE_SKIP_SECTIONS.includes(sectionKey)) continue;
      // 无分区页面无法判断条目下标：单条目板块假定 0；可重复板块里同字段出现多次 => 歧义，不猜
      if (isRepeatableSection(sectionKey) && !Number.isInteger(control.itemIndex) &&
        (inferredScopeCounts.get(`${sectionKey}.${inferred.fieldKey}`) ?? 0) > 1) continue;
      itemIndex = Number.isInteger(control.itemIndex) && control.itemIndex >= 0 ? control.itemIndex : 0;
      fieldResolution = { fieldKey: inferred.fieldKey, confidence: 0.7, reason: 'section-inferred' };
      scopeConfidence = 0.7;
    }

    const { fieldKey, preferredCity } = fieldResolution;
    // 该条目身份字段已经「对不上」：只填空白模式下整条跳过，避免把两条记录的字段拼在一起。
    const identityLocked = resolvedMode !== 'overwrite' && identityConflicts.has(`${sectionKey}:${itemIndex}`);

    // 可重复分区里页面条目比简历多：多余页面条目不填、不报缺失
    if (isRepeatableSection(sectionKey) && itemIndex >= resumeItems(sectionKey).length) continue;

    // 期望工作地点（基本信息模块的 preferred_city_list）：优先 intention.city，回退 basic.city
    let entry = null;
    if (preferredCity) {
      entry = entriesOf('intention', 0, 'city') ?? entriesOf('basic', 0, 'city');
    } else {
      entry = entriesOf(sectionKey, itemIndex, fieldKey);
    }
    if (!entry) {
      missingFields.add(preferredCity ? 'intention.city' : `${sectionKey}.${fieldKey}`);
      continue;
    }

    const kind = kindForControlType(controlType);
    const confidence = Math.min(fieldResolution.confidence, scopeConfidence);
    const base = {
      stepId: `${kind === 'unsupported' ? 'unsupported' : kind}:${control.controlId}`,
      kind,
      controlId: String(control.controlId),
      sourcePath: Array.isArray(entry.path) ? entry.path.slice() : [String(entry.key ?? fieldKey)],
      fieldKey,
      sectionKey,
      itemIndex,
      confidence,
      status: 'ready'
    };

    if (kind === 'unsupported') {
      pushStep({ ...base, value: String(entry.value ?? ''), status: 'unsupported', reason: 'radio-control-unsupported' });
      continue;
    }

    // 目标值（获奖 date 页面只收年份：截取 4 位年份）
    const yearOnly = sectionKey === 'award' && fieldKey === 'date';
    let target;
    if (kind === 'check') {
      const bool = booleanFromText(entry.value);
      if (bool === null) {
        pushStep({ ...base, value: String(entry.value ?? ''), status: 'unsupported', reason: 'value-not-boolean' });
        continue;
      }
      target = bool;
    } else if (yearOnly) {
      const parsed = normalizeDate(entry.value);
      target = parsed?.year === null || parsed?.year === undefined ? String(entry.value ?? '').trim() : String(parsed.year);
      if (!target) continue;
    } else {
      target = String(entry.value ?? '');
      if (!target) continue; // 没有可写内容
    }

    // 页面现值比较
    // 「期望工作地点」这类多选 chip 组件：实测（真机）用合成 mousedown/click/键盘事件都打不开弹层，
    // 只有可信（真人）点击才行；扩展无法产生可信事件。因此一律交给人工，不生成会失败的写入步骤。
    if (preferredCity && kind === 'select') {
      const currentValue = control.value;
      const alreadyEqual = !isEmptyValue(currentValue) && selectValuesEqual(currentValue, target, fieldKey);
      pushStep({
        ...base,
        value: target,
        status: alreadyEqual ? 'skipped' : 'unsupported',
        ...(alreadyEqual ? { reason: 'already-correct' } : { reason: 'multi-select-manual' }),
        ...(isEmptyValue(currentValue) ? {} : { currentValue: String(currentValue) })
      });
      continue;
    }

    const current = control.value;
    if (isEmptyValue(current)) {
      // 条目身份字段对不上（历史错位/手工改过）：不往这一格里写任何内容。
      if (identityLocked) {
        pushStep({ ...base, value: target, status: 'conflict', reason: 'item-identity-conflict' });
        continue;
      }
      if (kind === 'select' && Array.isArray(control.options) && control.options.length) {
        const option = matchSelectOption(control.options, target, fieldKey);
        if (option === null) {
          pushStep({
            ...base,
            value: target,
            status: 'unsupported',
            reason: 'option-not-found',
            availableOptions: control.options.map(String).slice(0, 50)
          });
          continue;
        }
      }
      pushStep({ ...base, value: target });
      continue;
    }

    let equal = false;
    if (kind === 'check') {
      const currentBoolean = typeof current === 'boolean' ? current : booleanFromText(current);
      equal = currentBoolean === target;
    } else if (yearOnly) {
      const currentYear = normalizeDate(current)?.year;
      equal = currentYear !== null && currentYear !== undefined && String(currentYear) === target;
    } else if (kind === 'select') {
      equal = selectValuesEqual(current, target, fieldKey);
    } else if (entry.type === 'date') {
      equal = dateValuesEqual(current, entry.value);
    } else {
      equal = compareText(current) === compareText(entry.value);
    }

    if (equal) {
      pushStep({ ...base, value: target, status: 'skipped', reason: 'already-correct', currentValue: String(current) });
      continue;
    }

    if (resolvedMode === 'overwrite') {
      pushStep({ ...base, value: target, status: 'ready', overwrite: true, currentValue: String(current), reason: 'overwrite' });
    } else {
      pushStep({ ...base, value: target, status: 'conflict', currentValue: String(current), reason: 'page-value-differs' });
    }
  }

  // ---- 3) 截断 + summary
  const plannedTotal = steps.length;
  const truncated = plannedTotal > limit;
  const visibleSteps = truncated ? steps.slice(0, limit) : steps;
  const summary = emptySummary();
  summary.plannedTotal = plannedTotal;
  summary.truncated = truncated;
  summary.dropped = truncated ? plannedTotal - limit : 0;
  summary.total = visibleSteps.length;
  summary.missingFields = [...missingFields];
  for (const field of Array.isArray(index.missing) ? index.missing : []) {
    const dotted = `basic.${field}`;
    if (!summary.missingFields.includes(dotted)) summary.missingFields.push(dotted);
  }
  summary.outOfRangeItems = outOfRangeItems;
  summary.pageExtra = pageExtra;
  for (const step of visibleSteps) {
    if (step.status === 'ready') summary.ready += 1;
    else if (step.status === 'conflict') summary.conflicts += 1;
    else if (step.status === 'skipped') summary.skipped += 1;
    else if (step.status === 'unsupported') summary.unsupported += 1;
  }

  return { mode: resolvedMode, steps: visibleSteps, summary };
}

export default planFill;
