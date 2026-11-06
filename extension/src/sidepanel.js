import {
  initialPanelState,
  reducePanelState,
  resumeOverview,
  pageOverview,
  backupOverview,
  planOverview,
  matchRows,
  selectReadiness,
  summarizeResults,
  FILL_MODE
} from './core/panel-state.mjs';
import { createLogger } from './core/logger.mjs';

const log = createLogger('sidepanel');
const RESUME_KEY = 'resume';
const RESUME_FILE_KEY = 'resumeFileName';
const MODE_KEY = 'fillEmptyMode';

let state = initialPanelState;
let currentTabId = null;
let resumeFileName = '';

/* ------------------------------------------------------------------ i18n */

/*
 * The repo keeps message catalogs in `extension/locales/<locale>/messages.json`
 * (the build copies that directory as-is and manifest.json intentionally does
 * not declare `_locales`/`default_locale`), so chrome.i18n cannot serve them.
 * We load the matching catalog ourselves at runtime and fall back to the
 * hard-coded Chinese copy that is also written into sidepanel.html.
 */
const SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'ja-JP', 'ko-KR'];
const PREF_KEY = 'ui.prefs';
let messageCatalog = {};
let activeLocale = 'zh-CN';
let prefs = { locale: null, theme: 'system' };
let systemThemeQuery = null;

const pickLocale = () => {
  const raw = String(globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'zh-CN').replace(/_/g, '-').toLowerCase();
  if (raw.startsWith('zh')) return 'zh-CN';
  if (raw.startsWith('ja')) return 'ja-JP';
  if (raw.startsWith('ko')) return 'ko-KR';
  return 'en-US';
};

const resolveLocale = () => (SUPPORTED_LOCALES.includes(prefs.locale) ? prefs.locale : pickLocale());

const loadMessages = async (locale) => {
  activeLocale = SUPPORTED_LOCALES.includes(locale) ? locale : pickLocale();
  if (!SUPPORTED_LOCALES.includes(activeLocale)) activeLocale = 'en-US';
  try {
    const url = chrome.runtime.getURL(`locales/${activeLocale}/messages.json`);
    const response = await fetch(url);
    if (response.ok) {
      const catalog = await response.json();
      if (catalog && typeof catalog === 'object') messageCatalog = catalog;
    }
  } catch (error) {
    log.warn('locale-load-failed', { locale: activeLocale, error: String(error?.message || error) });
  }
  document.documentElement.lang = activeLocale;
};

/* Appearance: `prefs.theme` is one of system | light | dark; the resolved value
   is written to <html data-theme> so the stylesheet never needs a media query. */
const resolveTheme = () => {
  if (prefs.theme === 'light' || prefs.theme === 'dark') return prefs.theme;
  return systemThemeQuery?.matches ? 'dark' : 'light';
};
const applyTheme = () => { document.documentElement.dataset.theme = resolveTheme(); };
const watchSystemTheme = () => {
  if (systemThemeQuery || typeof globalThis.matchMedia !== 'function') return;
  systemThemeQuery = globalThis.matchMedia('(prefers-color-scheme: dark)');
  systemThemeQuery.addEventListener?.('change', () => { if (prefs.theme === 'system') applyTheme(); });
};

const persistPrefs = async () => {
  try { await chrome.storage.local.set({ [PREF_KEY]: prefs }); } catch (error) { log.warn('prefs-persist-failed', { error: String(error?.message || error) }); }
};

const markSegments = () => {
  for (const button of document.querySelectorAll('#locale-segmented button')) {
    const active = button.dataset.locale === activeLocale;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', String(active));
  }
  const themePref = prefs.theme ?? 'system';
  for (const button of document.querySelectorAll('#theme-segmented button')) {
    const active = button.dataset.themePref === themePref;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', String(active));
  }
};

const setLocale = async (locale) => {
  if (!SUPPORTED_LOCALES.includes(locale)) return;
  if (locale === activeLocale) { markSegments(); return; }
  prefs.locale = locale;
  await persistPrefs();
  await loadMessages(locale);
  applyStaticI18n();
  markSegments();
  render();
};

const setTheme = async (theme) => {
  if (!['system', 'light', 'dark'].includes(theme)) return;
  prefs.theme = theme;
  await persistPrefs();
  applyTheme();
  markSegments();
};

const rawI18n = (key) => {
  try {
    const message = globalThis.chrome?.i18n?.getMessage?.(key);
    if (typeof message === 'string' && message) return message;
  } catch { /* chrome.i18n is not configured for this build */ }
  const fallback = messageCatalog?.[key]?.message;
  return typeof fallback === 'string' && fallback ? fallback : '';
};

/** Resolve a message template and fill `{0}`-style placeholders ourselves. */
const t = (key, fallback = '', ...substitutions) => {
  const template = rawI18n(key) || fallback || key;
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const value = substitutions[Number(index)];
    return value === undefined || value === null || value === '' ? match : String(value);
  });
};

const SECTION_FALLBACK = {
  basic: '基本信息',
  intention: '求职意向',
  work: '工作经历',
  internship: '实习经历',
  education: '教育经历',
  project: '项目经历',
  award: '荣誉奖项',
  language: '语言能力',
  summary: '个人总结',
  sns: '社交主页'
};
const FIELD_FALLBACK = {
  name: '姓名', mobile: '手机号', areaCode: '国际区号', email: '邮箱', idType: '证件类型', idNumber: '证件号码',
  city: '城市', gender: '性别', birthday: '生日', workStartDate: '参加工作日期', position: '职位', jobType: '工作类型',
  arrivalTime: '到岗时间', company: '公司', title: '职位', department: '部门', start: '开始时间', end: '结束时间',
  ongoing: '至今', desc: '描述', school: '学校', degree: '学历', major: '专业', college: '学院', trainingType: '培养方式',
  gpa: 'GPA', role: '角色', link: '链接', date: '日期', language: '语言', proficiency: '熟练度', platform: '平台',
  account: '账号', content: '内容'
};
const STATUS_FALLBACK = {
  ready: '待填', conflict: '冲突', skipped: '跳过', unsupported: '不支持', done: '成功', failed: '失败', manual: '需手动'
};
const REASON_SPECS = {
  'resume-missing': ['reasonResumeMissing', '请先加载简历 JSON'],
  'page-missing': ['reasonPageMissing', '请先检查当前页面'],
  'page-invalidated': ['reasonPageInvalidated', '页面已切换或刷新，请重新检查'],
  'nothing-to-fill': ['reasonNothingToFill', '没有可填写的字段（可能页面已是目标值）'],
  busy: ['reasonBusy', '正在处理中，请稍候'],
  'already-correct': ['reasonAlreadyCorrect', '页面已是目标值'],
  conflict: ['reasonConflict', '页面已有内容，不覆盖'],
  'page-changed': ['reasonPageChanged', '页面已变化，请重新检查'],
  'target-missing': ['reasonTargetMissing', '目标控件已消失'],
  'target-disappeared': ['reasonTargetMissing', '目标控件已消失'],
  'verification-failed': ['reasonVerificationFailed', '读回校验失败'],
  'option-not-found': ['reasonOptionNotFound', '未找到匹配选项'],
  'multi-select-manual': ['reasonMultiSelectManual', '多选控件（期望工作地点）需手动选择'],
  'item-identity-conflict': ['reasonItemIdentityConflict', '该条目与简历不是同一条记录，已跳过避免串味'],
  'sensitive-control': ['reasonForbidden', '已拦截：不允许操作保存/提交类按钮'],
  'forbidden-action': ['reasonForbidden', '已拦截：不允许操作保存/提交类按钮'],
  'add-item-failed': ['reasonAddItemFailed', '新增条目失败'],
  'manual-date': ['reasonManualDate', '日期控件需手动填写'],
  'unsupported-control': ['reasonUnsupported', '暂不支持该控件'],
  'low-confidence': ['reasonLowConfidence', '匹配置信度过低']
};
const MESSAGE_SPECS = {
  resumeLoaded: ['resumeLoadedMsg', '已加载简历：{0}', data => [data.fileName || `${data.entries ?? 0} 条记录`]],
  resumeInvalid: ['resumeInvalidMsg', '简历 JSON 解析失败：{0}', data => [data.detail || '']],
  resumeCleared: ['resumeClearedMsg', '简历已清空', () => []],
  inspectOk: ['inspectOkMsg', '已读取 {0} 个可填写控件', data => [data.controls ?? 0]],
  inspectFailed: ['inspectFailedMsg', '无法读取页面：{0}', data => [data.detail || '']],
  inspectStale: ['inspectStaleMsg', '页面可能已变化，请重新检查', () => []],
  pageInvalidated: ['pageInvalidatedMsg', '页面已切换或刷新（{0}），请重新检查', data => [data.reason || 'navigation']],
  backupSaved: ['backupSavedMsg', '已备份 {0} 个控件', data => [data.controls ?? 0]],
  backupFailed: ['backupFailedMsg', '备份失败，已阻止填写：{0}', data => [data.detail || '']],
  restoreDone: ['restoreDoneMsg', '已恢复 {0} 个控件', data => [data.restored ?? 0]],
  restorePartial: ['restorePartialMsg', '已恢复 {0} 个控件，{1} 个失败', data => [data.restored ?? 0, data.failed ?? 0]],
  restoreFailed: ['restoreFailedMsg', '恢复失败：{0}', data => [data.detail || '']],
  restoreNothing: ['restoreNothingMsg', '没有可用的备份', () => []],
  planReady: ['planReadyMsg', '可填 {0} 项，冲突 {1} 项，跳过 {2} 项', data => [data.ready ?? 0, data.conflicts ?? 0, data.skipped ?? 0]],
  planEmpty: ['planEmptyMsg', '没有可填写的字段', () => []],
  planFailed: ['planFailedMsg', '无法生成匹配计划：{0}', data => [data.detail || '']],
  fillDone: ['fillDoneMsg', '填写完成：成功 {0}，冲突 {1}，跳过 {2}，需手动 {3}', data => [data.ok ?? 0, data.conflict ?? 0, data.skipped ?? 0, data.manual ?? 0]],
  fillPartial: ['fillPartialMsg', '填写结束：成功 {0}，冲突 {1}，失败 {2}', data => [data.ok ?? 0, data.conflict ?? 0, data.failed ?? 0]],
  fillFailed: ['fillFailedMsg', '填写失败：{0}', data => [data.detail || '']],
  undoDone: ['undoDoneMsg', '已撤销 {0} 个控件', data => [data.undone ?? 0]],
  undoNothing: ['undoNothingMsg', '没有可撤销的填写', () => []],
  undoFailed: ['undoFailedMsg', '撤销失败：{0}', data => [data.detail || '']],
  actionFailed: ['actionFailedMsg', '无法完成操作：{0}', data => [data.detail || '']],
  inspectUnsupported: ['inspectUnsupportedMsg', '当前页面不支持检查（浏览器内置页面）', () => []],
  notReady: ['notReadyMsg', '暂时不能填写：{0}', data => [data.reason || '']]
};

const sectionLabel = (key) => (key ? t(`section_${key}`, SECTION_FALLBACK[key] ?? String(key)) : '');
const fieldLabel = (sectionKey, fieldKey) => {
  const field = fieldKey ? t(`field_${fieldKey}`, FIELD_FALLBACK[fieldKey] ?? String(fieldKey)) : '';
  const section = sectionLabel(sectionKey);
  return [section, field].filter(Boolean).join(' · ');
};
const statusLabel = (status) => t(`status_${status}`, STATUS_FALLBACK[status] ?? String(status ?? ''));
const reasonLabel = (reason) => {
  if (!reason) return '';
  const spec = REASON_SPECS[reason];
  if (spec) return t(spec[0], spec[1]);
  const fallback = '原因：{0}';
  return t('reasonLabel', fallback, String(reason));
};
const reasonText = (code) => {
  const spec = MESSAGE_SPECS[code];
  return spec ? t(spec[0], spec[1], ...(spec[2] ? spec[2](state.message?.params ?? {}) : [])) : String(code ?? '');
};
const SENSITIVE_FIELDS = new Set(['idNumber', 'mobile', 'areaCode']);
/** Mask government IDs / phone numbers so the review table never leaks them. */
const maskSensitive = (text, fieldKey) => {
  const value = String(text ?? '');
  if (!value) return '—';
  if (!SENSITIVE_FIELDS.has(fieldKey)) return value;
  if (fieldKey === 'mobile' || fieldKey === 'areaCode') {
    const clean = value.replace(/[\s-]+/g, '');
    if (clean.length <= 6) return '****';
    return `${clean.slice(0, 3)}****${clean.slice(-4)}`;
  }
  if (value.length <= 6) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(Math.max(1, value.length - 8))}${value.slice(-4)}`;
};
const displayValue = (value, fieldKey) => {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? t('yes', '是') : t('no', '否');
  return maskSensitive(value, fieldKey);
};
const formatTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(date);
  } catch {
    return date.toLocaleString();
  }
};

/* ------------------------------------------------------------- dom helpers */

const $ = (selector) => document.querySelector(selector);
const node = (tag, props = {}, children = []) => {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = value;
    else if (key === 'text') element.textContent = String(value);
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else element.setAttribute(key, String(value));
  }
  for (const child of [].concat(children)) {
    if (child === undefined || child === null || child === false || child === '') continue;
    element.append(child instanceof globalThis.Node ? child : document.createTextNode(String(child)));
  }
  return element;
};
const clear = (element) => { if (element) while (element.firstChild) element.removeChild(element.firstChild); };
const setText = (element, text) => { if (element) element.textContent = text ?? ''; };

const applyStaticI18n = () => {
  for (const element of document.querySelectorAll('[data-i18n]')) {
    const message = rawI18n(element.dataset.i18n);
    if (message) element.textContent = message;
  }
  for (const element of document.querySelectorAll('[data-i18n-placeholder]')) {
    const message = rawI18n(element.dataset.i18nPlaceholder);
    if (message) element.placeholder = message;
  }
};

/* ------------------------------------------------------------------ render */

const renderStatus = () => {
  const line = $('#global-status');
  if (!line) return;
  line.textContent = state.message ? reasonText(state.message.code) : t('ready', '准备就绪。加载简历后开始。');
  line.dataset.kind = state.message?.kind ?? 'info';
};

const renderResume = () => {
  const badge = $('#resume-badge');
  const stats = $('#resume-stats');
  const missingBox = $('#resume-missing');
  const unknownBox = $('#resume-unknown');
  const fileName = $('#resume-file-name');
  if (!badge || !stats) return;
  setText(fileName, resumeFileName || '');
  if (!state.resume) {
    setText(badge, t('notLoaded', '未加载'));
    badge.dataset.tone = '';
    clear(stats);
    stats.append(node('p', { class: 'muted', text: t('resumeStatsEmpty', '尚未加载简历 JSON') }));
    if (missingBox) missingBox.hidden = true;
    if (unknownBox) unknownBox.hidden = true;
    return;
  }
  setText(badge, t('loaded', '已加载'));
  badge.dataset.tone = 'ok';
  const overview = resumeOverview(state.resume.index);
  clear(stats);
  if (!state.resume.index) {
    stats.append(node('p', { class: 'muted', text: t('resumeIndexFailed', '无法识别简历结构，请检查 JSON 格式') }));
  } else {
    if (overview.sections.length) {
      for (const section of overview.sections) {
        stats.append(node('div', { class: 'stat-line' }, [
          node('span', { text: sectionLabel(section.sectionKey) }),
          node('span', { class: 'stat-value', text: t('itemCount', '{0} 条', section.count) })
        ]));
      }
    } else {
      stats.append(node('p', { class: 'muted', text: t('resumeSectionEmpty', '未识别到分区与条目') }));
    }
    stats.append(node('p', { class: 'muted', text: t('entriesTotal', '共识别 {0} 条记录', overview.entryCount) }));
  }
  if (missingBox) {
    clear(missingBox);
    const missing = overview.missing;
    if (state.resume.index) {
      missingBox.hidden = false;
      if (missing.length) {
        missingBox.append(node('p', { class: 'muted', text: t('missingFieldsTitle', '缺少的常见必填项') }));
        const chips = node('div', { class: 'chips' });
        for (const key of missing) {
          chips.append(node('span', { class: 'chip conflict', text: fieldLabel('basic', key) || String(key) }));
        }
        missingBox.append(chips);
      } else {
        // 没有缺失时不再显示「缺少的常见必填项」标题，只给一句结论。
        missingBox.append(node('p', { class: 'muted', text: t('missingFieldsNone', '常见必填项齐全') }));
      }
    } else {
      missingBox.hidden = true;
    }
  }
  if (unknownBox) {
    clear(unknownBox);
    const unknown = overview.unknown;
    if (state.resume.index && unknown.length) {
      unknownBox.hidden = false;
      unknownBox.append(node('p', { class: 'muted', text: t('unknownFieldsTitle', '未识别的字段（已忽略）') }));
      const chips = node('div', { class: 'chips' });
      for (const entry of unknown.slice(0, 12)) {
        const label = [entry?.path, entry?.key].filter(Boolean).join(' · ');
        chips.append(node('span', { class: 'chip', text: label || '—' }));
      }
      unknownBox.append(chips);
    } else {
      unknownBox.hidden = true;
    }
  }
};

const renderPage = () => {
  const badge = $('#page-badge');
  const page = pageOverview(state);
  if (badge) {
    if (!page.inspected) {
      setText(badge, t('pageNotInspected', '尚未检查页面'));
      badge.dataset.tone = '';
    } else if (page.stale || state.status === 'invalidated') {
      setText(badge, t('pageStale', '页面已变化，请重新检查'));
      badge.dataset.tone = 'warn';
    } else {
      setText(badge, t('inspected', '已检查'));
      badge.dataset.tone = 'ok';
    }
  }
  setText($('#page-fingerprint'), page.inspected ? page.fingerprint || '—' : '—');
  const controls = $('#page-controls');
  if (controls) {
    setText(controls, page.inspected ? String(page.controls) : '—');
    controls.title = page.inspected ? t('controlsVisible', '可见 {0} / 共 {1}', page.visibleControls, page.controls) : '';
  }
  const pageStats = $('#page-stats');
  if (pageStats) setText(pageStats, page.inspected ? t('pageStatsMsg', '检测到 {0} 个分区、{1} 个控件', page.sections.length, page.controls) : '');
  const sectionList = $('#page-sections');
  if (sectionList) {
    clear(sectionList);
    if (!page.inspected) {
      sectionList.append(node('p', { class: 'muted', text: t('pageSectionsEmpty', '未识别到分区') }));
    } else if (!page.sections.length) {
      sectionList.append(node('p', { class: 'muted', text: t('pageSectionsEmpty', '未识别到分区') }));
    } else {
      for (const section of page.sections) {
        const label = sectionLabel(section.key) || section.label || section.id;
        sectionList.append(node('div', { class: 'section-line' }, [
          node('span', { text: label }),
          node('span', { class: 'section-count', text: t('sectionItems', '{0} 条 · {1} 个控件', section.itemCount, section.controlCount) })
        ]));
      }
    }
  }
  const backup = backupOverview(state);
  const backupStatus = $('#backup-status');
  if (backupStatus) {
    setText(backupStatus, backup.available
      ? t('backupLastMsg', '最近备份：{0}（共 {1} 份，{2} 个控件）', formatTime(backup.lastCapturedAt), backup.count, backup.controlsCount)
      : t('backupNone', '暂无备份'));
  }
  const invalidated = $('#page-invalidated');
  if (invalidated) {
    const reason = state.page?.invalidatedReason || (state.status === 'invalidated' ? 'navigation' : '');
    invalidated.hidden = !reason;
    setText(invalidated, reason ? t('invalidatedNote', '页面已切换或刷新，请重新检查页面后再填写。') : '');
  }
};

const renderReview = () => {
  const badge = $('#review-badge');
  const summaryBox = $('#summary');
  const conflictHint = $('#conflict-hint');
  const plan = planOverview(state.plan);
  if (badge) {
    if (state.summary) {
      setText(badge, t('badgeResult', '成功 {0}/{1}', state.summary.ok ?? 0, state.summary.total ?? 0));
      badge.dataset.tone = (state.summary.failed ?? 0) > 0 ? 'danger' : 'ok';
    } else if (state.plan) {
      setText(badge, t('badgeReady', '待填 {0}', plan.actionable));
      badge.dataset.tone = plan.conflicts > 0 ? 'warn' : plan.actionable > 0 ? 'ok' : '';
    } else {
      setText(badge, '—');
      badge.dataset.tone = '';
    }
  }
  const saveReminder = $('#save-reminder');
  if (saveReminder) saveReminder.hidden = !state.summary;
  if (summaryBox) {
    clear(summaryBox);
    const chips = [];
    if (state.summary) {
      chips.push(node('span', { class: 'summary-item ok', text: t('summaryOk', '成功 {0}', state.summary.ok ?? 0) }));
      if ((state.summary.conflict ?? 0) > 0) chips.push(node('span', { class: 'summary-item conflict', text: t('summaryConflict', '冲突 {0}', state.summary.conflict) }));
      if ((state.summary.failed ?? 0) > 0) chips.push(node('span', { class: 'summary-item failed', text: t('summaryFailed', '失败 {0}', state.summary.failed) }));
      chips.push(node('span', { class: 'summary-item', text: t('summarySkipped', '跳过 {0}', state.summary.skipped ?? 0) }));
      if ((state.summary.manual ?? 0) > 0) chips.push(node('span', { class: 'summary-item manual', text: t('summaryManual', '需手动 {0}', state.summary.manual) }));
    } else if (state.plan) {
      chips.push(node('span', { class: 'summary-item ok', text: t('summaryReady', '可填 {0}', plan.ready) }));
      chips.push(node('span', { class: 'summary-item conflict', text: t('summaryConflict', '冲突 {0}', plan.conflicts) }));
      chips.push(node('span', { class: 'summary-item', text: t('summarySkipped', '跳过 {0}', plan.skipped) }));
      if (plan.unsupported > 0) chips.push(node('span', { class: 'summary-item', text: t('summaryUnsupported', '未支持 {0}', plan.unsupported) }));
      if (plan.addItems > 0) chips.push(node('span', { class: 'summary-item', text: t('summaryAddItems', '新增条目 {0}', plan.addItems) }));
    }
    summaryBox.hidden = chips.length === 0;
    for (const chip of chips) summaryBox.append(chip);
  }
  const rows = matchRows(state);
  const body = $('#match-rows');
  if (body) {
    clear(body);
    if (!rows.length) {
      body.append(node('tr', {}, node('td', { colspan: '7', class: 'empty', text: t('noMatches', '加载简历并检查页面后显示匹配结果') })));
    } else {
      for (const row of rows) {
        const statusTone = ['conflict', 'skipped', 'done', 'failed', 'manual'].includes(row.status) ? `row-${row.status}` : '';
        const statusCell = node('td', {}, [
          node('span', { class: 'status-pill', dataset: { status: row.status }, text: statusLabel(row.status) }),
          row.reason ? node('span', { class: 'reason', text: reasonLabel(row.reason) }) : null
        ]);
        body.append(node('tr', { class: statusTone }, [
          node('td', { dataset: { label: t('tableField', '字段') }, text: row.kind === 'add-item' ? `${sectionLabel(row.sectionKey) || ''} ${t('addItem', '新增条目')}`.trim() || String(row.stepId) : fieldLabel(row.sectionKey, row.fieldKey) || String(row.stepId) }),
          node('td', { dataset: { label: t('tablePageLabel', '页面标签') }, text: row.pageLabel || '—' }),
          node('td', { dataset: { label: t('tableSource', '来源路径') }, text: row.sourcePath || '—' }),
          node('td', { dataset: { label: t('tableCurrent', '当前值') }, text: displayValue(row.currentValue, row.fieldKey) }),
          node('td', { dataset: { label: t('tableTarget', '目标值') }, text: row.kind === 'add-item' ? '—' : displayValue(row.targetValue, row.fieldKey) }),
          statusCell,
          node('td', { dataset: { label: t('tableConfidence', '置信度') }, text: row.confidence === null ? '—' : `${Math.round(row.confidence * 100)}%` })
        ]));
      }
    }
  }
  if (conflictHint) conflictHint.hidden = plan.conflicts === 0;
};

const renderProgress = () => {
  const progress = $('#fill-progress');
  if (!progress) return;
  const filling = state.status === 'filling';
  const inspecting = state.status === 'inspecting';
  const restoring = state.status === 'restoring';
  progress.hidden = !state.busy;
  if (!state.busy) return;
  setText(progress, filling
    ? t('fillRunning', '正在填写…')
    : inspecting
      ? t('inspectRunning', '正在检查页面…')
      : restoring
        ? t('restoring', '正在恢复…')
        : t('working', '处理中…'));
};

const renderButtons = () => {
  const readiness = selectReadiness(state);
  const inspect = $('#page-inspect');
  const backupCreate = $('#backup-create');
  const backupRestore = $('#backup-restore');
  const fill = $('#fill-start');
  const undo = $('#fill-undo');
  if (inspect) inspect.disabled = !readiness.canInspect;
  if (backupCreate) backupCreate.disabled = !readiness.canBackup;
  if (backupRestore) backupRestore.disabled = !readiness.canRestore;
  if (fill) {
    fill.disabled = !readiness.canFill;
    setText(fill, state.status === 'filling' ? t('fillRunning', '正在填写…') : t('fillStart', '开始填写'));
  }
  if (undo) undo.disabled = !readiness.canUndo;
  const modeLabel = $('#mode-label');
  if (modeLabel) setText(modeLabel, state.mode === FILL_MODE.overwrite
    ? t('modeOverwriteLabel', '覆盖已有内容')
    : t('modeLabel', '只填空白（推荐）'));
};

const render = () => {
  renderStatus();
  renderResume();
  renderPage();
  renderReview();
  renderProgress();
  renderButtons();
};

const dispatch = (action) => {
  state = reducePanelState(state, action);
  render();
};

/* -------------------------------------------------------------- background */

const getActiveTab = async () => {
  try {
    let [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab) [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab ?? null;
  } catch (error) {
    log.warn('query-tab-failed', { error: String(error?.message || error) });
    return null;
  }
};

const syncTab = async () => {
  const tab = await getActiveTab();
  const nextId = Number.isInteger(tab?.id) ? tab.id : null;
  if (nextId !== null && currentTabId !== null && nextId !== currentTabId) {
    currentTabId = nextId;
    dispatch({ type: 'page/invalidated', reason: 'tab-changed' });
    return false;
  }
  if (nextId !== null) currentTabId = nextId;
  return true;
};

const TABLESS_MESSAGES = new Set(['resume/analyze']);
const send = async (type, payload = {}) => {
  const tabId = Number.isInteger(payload.tabId) ? payload.tabId : currentTabId;
  if (!TABLESS_MESSAGES.has(type) && !Number.isInteger(tabId)) throw new Error('no-active-tab');
  const response = await chrome.runtime.sendMessage({ ...payload, ...(Number.isInteger(tabId) ? { tabId } : {}), type });
  if (!response) throw new Error('empty-response');
  if (response.error) throw new Error(String(response.error));
  return response;
};

const analyzeResume = async (resume) => {
  const response = await send('resume/analyze', { resume });
  return response?.index ?? null;
};

const refreshPlan = async () => {
  if (!state.resume?.raw || !state.page?.pageModel || state.status === 'invalidated') return;
  try {
    const response = await send('plan/refresh', { resume: state.resume.raw, mode: state.mode });
    dispatch({ type: 'plan/set', plan: response?.plan ?? null });
  } catch (error) {
    dispatch({ type: 'plan/fail', message: String(error?.message || error) });
  }
};

const loadResume = async (resume, fileName, { refresh = true } = {}) => {
  let index = null;
  try {
    index = await analyzeResume(resume);
  } catch (error) {
    log.warn('resume-analyze-failed', { error: String(error?.message || error) });
  }
  resumeFileName = fileName ?? '';
  dispatch({ type: 'resume/load', resume, index, fileName: resumeFileName });
  try {
    await chrome.storage.local.set({ [RESUME_KEY]: resume, [RESUME_FILE_KEY]: resumeFileName });
  } catch (error) {
    log.warn('resume-persist-failed', { error: String(error?.message || error) });
  }
  if (refresh) await refreshPlan();
};

const resumeFromText = async (text, fileName) => {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    dispatch({ type: 'resume/error', message: String(error?.message || error) });
    return false;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    dispatch({ type: 'resume/error', message: 'resume-json-must-be-object' });
    return false;
  }
  await loadResume(parsed, fileName);
  return true;
};

// 把后台的稳定错误码 / Chrome 的英文连接错误翻译成用户能照着做的中文提示。
const describePageError = (error) => {
  const detail = String(error?.message || error || '');
  if (/unsupported-page/.test(detail)) return t('pageUnsupportedHint', '当前标签页不是网页（可能是扩展管理页或新标签页），请切换到简历页面后重试');
  if (/content-unavailable|Receiving end does not exist|Could not establish connection/i.test(detail)) {
    return t('pageScriptMissingHint', '页面脚本未就绪：请刷新简历页面（F5）后重试；如果刚重载过扩展，必须刷新页面');
  }
  if (/no-active-tab/.test(detail)) return t('pageNoActiveTabHint', '没有找到可操作的标签页，请先打开简历页面');
  return detail;
};

const inspectPage = async () => {
  const sameTab = await syncTab();
  if (!sameTab) return;
  dispatch({ type: 'page/inspect-start' });
  try {
    const response = await send('page/inspect');
    dispatch({ type: 'page/inspected', pageModel: response?.pageModel ?? null, diagnostics: response?.diagnostics ?? [] });
    if (Array.isArray(response?.backups)) dispatch({ type: 'backup/list', backups: response.backups });
    await refreshPlan();
  } catch (error) {
    log.warn('inspect-failed', { error: String(error?.message || error) });
    dispatch({ type: 'page/inspect-fail', message: describePageError(error) });
  }
};

const runFill = async () => {
  const readiness = selectReadiness(state);
  if (!readiness.canFill) {
    dispatch({ type: 'message/set', kind: 'warn', code: 'notReady', params: { reason: readiness.reasons.map((reason) => reasonLabel(reason)).join(', ') } });
    return;
  }
  const sameTab = await syncTab();
  if (!sameTab) return;
  dispatch({ type: 'fill/start' });
  try {
    const response = await send('fill/run', { resume: state.resume.raw, mode: state.mode, maxPasses: 3 });
    if (Array.isArray(response?.backups)) dispatch({ type: 'backup/list', backups: response.backups });
    dispatch({
      type: 'fill/result',
      results: Array.isArray(response?.results) ? response.results : [],
      plan: response?.plan ?? state.plan,
      summary: response?.summary ?? summarizeResults(response?.results ?? [])
    });
  } catch (error) {
    dispatch({ type: 'fill/fail', message: String(error?.message || error) });
  }
};

const undoFill = async () => {
  const sameTab = await syncTab();
  if (!sameTab) return;
  try {
    const response = await send('fill/undo');
    dispatch({ type: 'undo/result', undone: response?.undone ?? 0 });
  } catch (error) {
    dispatch({ type: 'undo/fail', message: String(error?.message || error) });
  }
};

const createBackup = async () => {
  const sameTab = await syncTab();
  if (!sameTab) return;
  try {
    const response = await send('backup/create', { reason: 'manual' });
    dispatch({ type: 'backup/saved', backup: response?.backup ?? null, backups: response?.backups ?? [] });
  } catch (error) {
    dispatch({ type: 'backup/failed', message: String(error?.message || error) });
  }
};

const restoreBackup = async () => {
  const overview = backupOverview(state);
  if (!overview.available) {
    dispatch({ type: 'message/set', kind: 'info', code: 'restoreNothing' });
    return;
  }
  if (!window.confirm(t('restoreConfirm', '将把当前页面控件恢复为备份中的值，确定继续？'))) return;
  const sameTab = await syncTab();
  if (!sameTab) return;
  dispatch({ type: 'backup/restore-start' });
  try {
    const response = await send('backup/restore');
    dispatch({ type: 'backup/restored', restored: response?.restored ?? 0, failed: response?.failed ?? 0 });
  } catch (error) {
    dispatch({ type: 'backup/restore-fail', message: String(error?.message || error) });
  }
};

/* ------------------------------------------------------------------ events */

const bind = () => {
  // Help and settings are mutually exclusive expanding sheets in the header.
  const panels = [
    { toggle: $('#help-toggle'), panel: $('#help-panel') },
    { toggle: $('#settings-toggle'), panel: $('#settings-panel') }
  ].filter(entry => entry.toggle && entry.panel);
  const setPanelOpen = (entry, open) => {
    entry.panel.hidden = !open;
    entry.toggle.setAttribute('aria-expanded', String(open));
  };
  const closePanels = (except) => {
    for (const entry of panels) if (entry !== except) setPanelOpen(entry, false);
  };
  for (const entry of panels) {
    entry.toggle.addEventListener('click', () => {
      const open = entry.panel.hidden;
      closePanels(entry);
      setPanelOpen(entry, open);
    });
  }
  document.addEventListener('click', (event) => {
    for (const entry of panels) {
      if (entry.panel.hidden) continue;
      if (entry.panel.contains(event.target) || entry.toggle.contains(event.target)) continue;
      setPanelOpen(entry, false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    for (const entry of panels) {
      if (entry.panel.hidden) continue;
      setPanelOpen(entry, false);
      entry.toggle.focus();
    }
  });
  for (const button of document.querySelectorAll('#locale-segmented button')) {
    button.addEventListener('click', () => { setLocale(button.dataset.locale); });
  }
  for (const button of document.querySelectorAll('#theme-segmented button')) {
    button.addEventListener('click', () => { setTheme(button.dataset.themePref); });
  }

  $('#resume-file')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const textarea = $('#resume-json');
      if (textarea) textarea.value = text;
      await resumeFromText(text, file.name);
    } catch (error) {
      dispatch({ type: 'resume/error', message: String(error?.message || error) });
    }
    event.target.value = '';
  });
  $('#resume-apply')?.addEventListener('click', () => {
    const text = $('#resume-json')?.value ?? '';
    if (!text.trim()) {
      dispatch({ type: 'resume/error', message: 'empty-json' });
      return;
    }
    resumeFromText(text, resumeFileName);
  });
  $('#resume-clear')?.addEventListener('click', async () => {
    resumeFileName = '';
    const textarea = $('#resume-json');
    if (textarea) textarea.value = '';
    try { await chrome.storage.local.remove([RESUME_KEY, RESUME_FILE_KEY]); } catch (error) { log.warn('resume-remove-failed', { error: String(error?.message || error) }); }
    dispatch({ type: 'resume/clear' });
  });
  $('#page-inspect')?.addEventListener('click', () => { inspectPage(); });
  $('#backup-create')?.addEventListener('click', () => { createBackup(); });
  $('#backup-restore')?.addEventListener('click', () => { restoreBackup(); });
  $('#fill-start')?.addEventListener('click', () => { runFill(); });
  $('#fill-undo')?.addEventListener('click', () => { undoFill(); });
  $('#fill-empty')?.addEventListener('change', async (event) => {
    const fillEmpty = event.target.checked === true;
    dispatch({ type: 'mode/set', mode: fillEmpty ? FILL_MODE.fillEmpty : FILL_MODE.overwrite });
    try { await chrome.storage.local.set({ [MODE_KEY]: fillEmpty }); } catch (error) { log.warn('mode-persist-failed', { error: String(error?.message || error) }); }
    await refreshPlan();
  });
};

const listenForInvalidation = () => {
  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== 'page/invalidated') return false;
      if (Number.isInteger(message.tabId) && Number.isInteger(currentTabId) && message.tabId !== currentTabId) return false;
      dispatch({ type: 'page/invalidated', reason: message.reason ?? 'navigation' });
      return false;
    });
  } catch (error) {
    log.warn('listener-failed', { error: String(error?.message || error) });
  }
};

/* -------------------------------------------------------------------- init */

const init = async () => {
  watchSystemTheme();
  try {
    const storedPrefs = await chrome.storage.local.get([PREF_KEY]);
    const saved = storedPrefs?.[PREF_KEY];
    if (saved && typeof saved === 'object') prefs = { ...prefs, ...saved };
  } catch (error) {
    log.warn('prefs-read-failed', { error: String(error?.message || error) });
  }
  applyTheme();
  await loadMessages(resolveLocale());
  applyStaticI18n();
  markSegments();
  bind();
  listenForInvalidation();
  let saved = {};
  try {
    saved = await chrome.storage.local.get([RESUME_KEY, RESUME_FILE_KEY, MODE_KEY]);
  } catch (error) {
    log.warn('storage-read-failed', { error: String(error?.message || error) });
  }
  const fillEmpty = saved?.[MODE_KEY] !== false;
  const toggle = $('#fill-empty');
  if (toggle) toggle.checked = fillEmpty;
  dispatch({ type: 'mode/set', mode: fillEmpty ? FILL_MODE.fillEmpty : FILL_MODE.overwrite });
  const tab = await getActiveTab();
  currentTabId = Number.isInteger(tab?.id) ? tab.id : null;
  const savedResume = saved?.[RESUME_KEY];
  if (savedResume && typeof savedResume === 'object') {
    const textarea = $('#resume-json');
    if (textarea) textarea.value = JSON.stringify(savedResume, null, 2);
    await loadResume(savedResume, saved?.[RESUME_FILE_KEY] ?? '', { refresh: false });
  }
  render();
  if (currentTabId === null) {
    dispatch({ type: 'message/set', kind: 'warn', code: 'inspectFailed', params: { detail: 'no-active-tab' } });
    return;
  }
  if (/^(chrome|edge|about|devtools|chrome-extension):/i.test(tab?.url ?? '')) {
    dispatch({ type: 'message/set', kind: 'warn', code: 'inspectUnsupported' });
    return;
  }
  await inspectPage();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { init().catch((error) => log.error('init-failed', { error: String(error?.stack || error) })); }, { once: true });
} else {
  init().catch((error) => log.error('init-failed', { error: String(error?.stack || error) }));
}
