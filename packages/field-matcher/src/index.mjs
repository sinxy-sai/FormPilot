const LABEL_ALIASES = new Map([
  ['full name', 'basics.name'],
  ['name', 'basics.name'],
  ['email', 'basics.email'],
  ['email address', 'basics.email'],
  ['phone', 'basics.phone'],
  ['phone number', 'basics.phone'],
  ['university', 'education[0].school'],
  ['university name', 'education[0].school'],
  ['school', 'education[0].school'],
  ['major', 'education[0].major'],
  ['field of study', 'education[0].major'],
  ['degree', 'education[0].degree'],
  ['姓名', 'basics.name'],
  ['邮箱', 'basics.email'],
  ['电话', 'basics.phone'],
  ['手机号', 'basics.phone'],
  ['学校', 'education[0].school'],
  ['专业', 'education[0].major'],
  ['学位', 'education[0].degree'],
  ['项目名称', 'projects[0].name'],
  ['项目描述', 'projects[0].bullets[0]'],
  ['个人优势', 'custom.personalAdvantages'],
  ['个人评价', 'custom.personalEvaluation'],
  ['personal evaluation', 'customFields.personalEvaluation'],
  ['personal advantages', 'customFields.personalAdvantages'],
]);

export function normalizeLabel(label) {
  return String(label ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{P}\p{S}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getPathValue(document, path) {
  return path.split('.').reduce((value, segment) => {
    const match = segment.match(/^([^[]+)(?:\[(\d+)\])?$/);
    if (!match || value == null) return undefined;
    const next = value[match[1]];
    return match[2] == null ? next : next?.[Number(match[2])];
  }, document);
}

export function matchField(field, resume, mappings = []) {
  const normalized = normalizeLabel(field.label || field.name || field.placeholder);
  const saved = mappings.find((mapping) => normalizeLabel(mapping.label) === normalized);
  if (saved) {
    const value = getPathValue(resume, saved.resumePath);
    return value === undefined ? { field, path: saved.resumePath, value: '', confidence: 0, source: 'missing-path' } : { field, path: saved.resumePath, value, confidence: 1, source: 'user' };
  }
  const matches = findKeyMatches(resume, normalized);
  if (matches.length === 1) return { field, path: matches[0].path, value: matches[0].value, confidence: 0.85, source: 'json-key' };
  if (matches.length > 1) return { field, path: null, value: null, confidence: 0, source: 'ambiguous' };
  const structured = matchStructuredField(field, resume);
  if (structured) return { field, ...structured };
  const aliasPath = LABEL_ALIASES.get(normalized);
  if (aliasPath) {
    const value = getPathValue(resume, aliasPath);
    if (value !== undefined) return { field, path: aliasPath, value, confidence: 0.9, source: 'rule' };
  }
  return { field, path: null, value: null, confidence: 0, source: 'unmatched' };
}

const SECTION_KEYS = {
  basics: ['basics', '基本信息', '基本资料', '基本情報', '기본 정보'], education: ['education', '教育经历', '教育背景', '学歴', '교육'], projects: ['projects', '项目经历', '项目经验', 'プロジェクト', '프로젝트'], competitions: ['competitions', 'competition', '竞赛', 'コンテスト', '대회'], languages: ['languages', 'language', '语言能力', '語学', '언어'], sns: ['sns', 'social', '社交账号', 'ソーシャル', '소셜'], custom: ['custom', 'customFields', '自定义字段', '自我评价', 'カスタム', '사용자 정의'],
};
const FIELD_KEYS = {
  name: ['name', 'fullName', '姓名', '名称', '氏名', '이름'], mobile: ['phone', 'mobile', 'phoneNumber', '手机号', '手机号码', '电话', '電話', '전화번호'], email: ['email', 'emailAddress', '邮箱', 'メール', '이메일'], school: ['school', 'university', 'institution', '学校', '学校名称', '大学', '学校名', '학교'], major: ['major', 'fieldOfStudy', 'field_of_study', '专业', '専攻', '전공'], degree: ['degree', '学历', '学位', '学歴', '학위'], role: ['role', 'projectRole', '角色', '役割', '역할'], link: ['link', 'url', '链接', '项目链接', 'URL', 'リンク', '링크'], desc: ['desc', 'description', 'summary', '描述', '内容', '説明', '설명'], language: ['language', '语言', '言語', '언어'], proficiency: ['proficiency', 'level', '水平', '精通程度', 'レベル', '수준'], city: ['city', 'location', '城市', '期望工作地点', '勤務地', '희망 근무지'], personalEvaluation: ['personalEvaluation', 'personalSummary', '个人评价', '自我评价', '自己PR', '자기소개'], start: ['start', 'startDate', '开始时间', '開始日', '시작일'], end: ['end', 'endDate', '结束时间', '終了日', '종료일'],
};
function keyEquals(key, candidates) { const normalized = normalizeLabel(key); return candidates.some((candidate) => normalizeLabel(candidate) === normalized); }
function firstKey(object, candidates) { return Object.keys(object || {}).find((key) => keyEquals(key, candidates)); }
function valueAtKey(object, candidates) { const key = firstKey(object, candidates); return key == null ? undefined : object[key]; }
function sectionValue(resume, section) { const key = SECTION_KEYS[section]?.find((candidate) => Object.prototype.hasOwnProperty.call(resume || {}, candidate)); return key == null ? undefined : resume[key]; }
function targetField(field) {
  const direct = normalizeLabel(field.fieldKey);
  if (direct) {
    const exact = Object.entries(FIELD_KEYS).find(([, candidates]) => candidates.some((candidate) => normalizeLabel(candidate) === direct));
    if (exact) return exact[0];
  }
  const normalized = normalizeLabel(field.label || field.name || field.placeholder);
  return Object.entries(FIELD_KEYS)
    .map(([kind, candidates]) => ({ kind, candidates: [...candidates].sort((a, b) => normalizeLabel(b).length - normalizeLabel(a).length) }))
    .find(({ candidates }) => candidates.some((candidate) => normalized === normalizeLabel(candidate) || normalized.includes(normalizeLabel(candidate))))?.kind || null;
}
function structuredPath(root, fieldKey, index) { const key = firstKey(root, FIELD_KEYS[fieldKey] || [fieldKey]); return key == null ? null : { key, value: root[key], suffix: '' }; }
function matchStructuredField(field, resume) {
  const kind = targetField(field); if (!kind) return null;
  const collection = field.collectionKey || ''; const index = Number.isInteger(field.repeatIndex) && field.repeatIndex >= 0 ? field.repeatIndex : 0;
  const sectionText = normalizeLabel(field.section || collection);
  const collectionSection = collection.includes('project') ? 'projects' : collection.includes('competition') ? 'competitions' : collection.includes('language') ? 'languages' : collection.includes('sns') ? 'sns' : null;
  let section = collectionSection || Object.entries(SECTION_KEYS).find(([, candidates]) => candidates.some((candidate) => sectionText === normalizeLabel(candidate) || sectionText.includes(normalizeLabel(candidate))))?.[0];
  if (!section) {
    const candidates = Object.keys(SECTION_KEYS).filter((candidate) => { const source = sectionValue(resume, candidate); const entry = Array.isArray(source) ? source[index] : source; return entry && structuredPath(entry, kind, index)?.value != null; });
    if (candidates.length === 1) section = candidates[0];
  }
  if (section) {
    const source = sectionValue(resume, section); if (source == null) return null;
    const entry = Array.isArray(source) ? source[index] : source;
    if (!entry) return null;
    const result = structuredPath(entry, kind, index); if (!result || typeof result.value === 'object') return null;
    const pathRoot = firstKey(resume, SECTION_KEYS[section]);
    const path = Array.isArray(source) ? `${pathRoot}[${index}].${result.key}` : `${pathRoot}.${result.key}`;
    return { path, value: result.value, confidence: 0.95, source: 'structured-rule' };
  }
  return null;
}

export function createFillPlan(fields, resume, mappings = []) {
  return fields.map((field) => matchField(field, resume, mappings));
}

function findKeyMatches(value, wantedKey, path = '') {
  if (value == null || typeof value !== 'object') return [];
  const matches = [];
  for (const [key, child] of Object.entries(value)) {
    const childPath = Array.isArray(value) ? `${path}[${key}]` : path ? `${path}.${key}` : key;
    if (normalizeLabel(key) === wantedKey && (typeof child !== 'object' || child === null)) matches.push({ path: childPath, value: child });
    if (child && typeof child === 'object') matches.push(...findKeyMatches(child, wantedKey, childPath));
  }
  return matches;
}
