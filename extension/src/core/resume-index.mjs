/**
 * FormPilot 简历索引（规划层入口）。
 *
 * 把「任意形状的简历 JSON」归一化成契约 v2 §1/§2 的 ResumeIndex：
 *   { schemaVersion, basics, intention, items, entries, coverage, missing }
 *
 * 纯函数：无 DOM、无 IO、无随机、无时间依赖；输入不合法抛 TypeError。
 * 只依赖顶层 section 别名 + 每 section 字段别名，未知 key 进 coverage.unknown（不报错）。
 */

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export const SCHEMA_VERSION = 1;

/** 契约 §1 的 10 个 canonical section key（顺序即 UI / 页面展示建议顺序）。 */
export const SECTION_KEYS = Object.freeze([
  'basic', 'intention', 'work', 'internship', 'education', 'project', 'award', 'language', 'summary', 'sns'
]);

/** 可重复条目（item）的 section；basic/intention/summary 是单例 section。 */
export const REPEATABLE_SECTION_KEYS = Object.freeze(['work', 'internship', 'education', 'project', 'award', 'language', 'sns']);

/** 契约 §1 字段表。 */
export const FIELD_KEYS = Object.freeze({
  basic: Object.freeze(['name', 'mobile', 'areaCode', 'email', 'idType', 'idNumber', 'city', 'gender', 'birthday', 'workStartDate', 'workYears']),
  intention: Object.freeze(['city', 'position', 'jobType', 'arrivalTime']),
  work: Object.freeze(['company', 'title', 'department', 'start', 'end', 'ongoing', 'desc']),
  internship: Object.freeze(['company', 'title', 'department', 'start', 'end', 'ongoing', 'desc']),
  education: Object.freeze(['school', 'degree', 'major', 'college', 'start', 'end', 'ongoing', 'trainingType', 'gpa']),
  project: Object.freeze(['name', 'role', 'link', 'start', 'end', 'ongoing', 'desc']),
  award: Object.freeze(['name', 'date', 'desc']),
  language: Object.freeze(['language', 'proficiency']),
  sns: Object.freeze(['platform', 'account']),
  summary: Object.freeze(['content'])
});

/** 页面常见必填的 basic 字段：简历缺失时进 ResumeIndex.missing。 */
export const REQUIRED_BASIC_FIELDS = Object.freeze(['name', 'mobile', 'email', 'idType', 'idNumber', 'city']);

const DATE_FIELDS = new Set(['birthday', 'workStartDate', 'start', 'end', 'date', 'ongoing']);
const LONG_FIELDS = new Set(['desc', 'content']);
const URL_FIELDS = new Set(['link']);
// 契约 §1：「保留原始文本（用于和页面选项做模糊匹配）」的字段。
const SELECT_FIELDS = new Set(['city', 'degree', 'language', 'proficiency', 'platform', 'idType', 'trainingType']);
const ONGOING_SECTIONS = new Set(['work', 'internship', 'education', 'project']);

const NO_INDEX = Symbol('no-index');

// ---------------------------------------------------------------------------
// key / label 归一化
// ---------------------------------------------------------------------------

const KEY_STRIP = /[\s\u3000\-_./\\|:：·・,，、;；()（）[\]【】{}"'`*#&+~～]/g;
const REQUIRED_MARKERS = /必填|选填|required|optional|需要|可选|必須|선택/g;

/** 归一化任意 key / label：小写、去空白与常见标点。用于别名全等比较。 */
export function normalizeKey(value) {
  return String(value ?? '').trim().toLowerCase().replace(KEY_STRIP, '');
}

/** 归一化页面 label：在 normalizeKey 基础上去掉「必填/选填/required」等标记。 */
export function normalizeLabel(value) {
  return normalizeKey(String(value ?? '').toLowerCase().replace(REQUIRED_MARKERS, ''));
}

const aliasMap = source => {
  const map = new Map();
  for (const [field, aliases] of Object.entries(source)) {
    map.set(normalizeKey(field), field);
    for (const alias of aliases) {
      const key = normalizeKey(alias);
      if (key && !map.has(key)) map.set(key, field); // 先注册者优先：canonical 别名稳定
    }
  }
  return map;
};

// ---------------------------------------------------------------------------
// 顶层 section 别名（中 / 英 / 日 / 韩，另含常见繁中写法）
// ---------------------------------------------------------------------------

const SECTION_ALIAS_SOURCE = {
  basic: [
    '基本信息', '基本资料', '基本資訊', '个人信息', '个人资料', '个人基本信息', '基础信息',
    'basics', 'basic', 'basic info', 'basic information', 'personal info', 'personal information', 'profile',
    '基本情報', 'プロフィール', '기본정보', '기본 정보', '프로필'
  ],
  intention: [
    '求职意向', '求职期望', '求职目标', '求职意愿', '意向', '求職意向', '期望工作',
    'intention', 'job intention', 'job objective', 'career objective', 'objective', 'preferences',
    '希望職種', '希望条件', '희망직무', '희망 직무', '구직희망'
  ],
  work: [
    '工作经历', '工作经验', '工作履历', '职业经历', '工作經歷', '職場經歷',
    'work', 'work experience', 'work history', 'career', 'employment', 'employment history', 'experience',
    '職歴', '職務経歴', '경력', '경력사항', '직장경력'
  ],
  internship: [
    '实习经历', '实习经验', '实习履历', '实习', '實習經歷',
    'internship', 'internships', 'internship experience', 'trainee experience',
    'インターンシップ', 'インターン', '인턴', '인턴십', '인턴경력'
  ],
  education: [
    '教育经历', '教育背景', '学历教育', '教育履历', '教育經歷', '學歷',
    'education', 'education experience', 'education background', 'academic background', 'academics',
    '学歴', '学歴・職歴', '학력', '학력사항', '교육'
  ],
  project: [
    '项目经历', '项目经验', '项目履历', '项目', '項目經歷', '專案經歷',
    'project', 'projects', 'project experience', 'project history', 'portfolio',
    'プロジェクト', 'プロジェクト経験', '프로젝트', '프로젝트경험'
  ],
  award: [
    '竞赛', '获奖', '获奖经历', '竞赛经历', '竞赛获奖', '奖励', '荣誉', '競賽', '獲獎', '獲獎經歷', '榮譽',
    'award', 'awards', 'competition', 'competitions', 'honor', 'honors', 'honour', 'achievements',
    '受賞', '受賞歴', 'コンテスト', '수상', '수상경력', '공모전'
  ],
  language: [
    '语言能力', '语言', '外语能力', '語文能力', '語言能力', '語言',
    'language', 'languages', 'language skills', 'linguistic skills',
    '語学', '語学力', '言語', '언어', '언어능력', '외국어'
  ],
  summary: [
    '自我评价', '自我介绍', '个人评价', '自我描述', '个人简介', '自我介紹', '個人簡介',
    'summary', 'self evaluation', 'self-evaluation', 'self introduction', 'self-introduction', 'about me', 'profile summary',
    '自己PR', '自己紹介', '자기소개', '자기소개서'
  ],
  sns: [
    '社交账号', '社交帐号', '社交网络', '社交平台', '社交媒體', '社群帳號',
    'sns', 'social', 'social accounts', 'social media', 'social links', 'social network',
    'ソーシャルアカウント', 'SNSアカウント', '소셜', '소셜미디어', 'SNS'
  ]
};

const SECTION_ALIASES = new Map();
for (const [sectionKey, aliases] of Object.entries(SECTION_ALIAS_SOURCE)) {
  SECTION_ALIASES.set(normalizeKey(sectionKey), sectionKey);
  for (const alias of aliases) {
    const key = normalizeKey(alias);
    if (key && !SECTION_ALIASES.has(key)) SECTION_ALIASES.set(key, sectionKey);
  }
}

// ---------------------------------------------------------------------------
// 字段别名
// ---------------------------------------------------------------------------

const SHARED_START = [
  '开始时间', '开始日期', '起始时间', '起始日期', '开始', '开始时间(年月)', '入学时间', '入学日期', '入职时间', '入职日期',
  'start', 'start date', 'start time', 'from', 'since', 'begin', 'begin date',
  '開始', '開始日', '入学', '入社', '시작', '시작일', '입사일'
];
const SHARED_END = [
  '结束时间', '结束日期', '截止时间', '截止日期', '结束', '离职时间', '离职日期', '毕业时间', '毕业日期',
  'end', 'end date', 'end time', 'to', 'until', 'finish', 'graduation date',
  '終了', '終了日', '卒業', '退社', '종료', '종료일', '졸업일'
];
const SHARED_ONGOING = [
  '至今', '是否至今', '到现在', '现在', '目前', '仍在职', '是否在职', '正在进行',
  'ongoing', 'current', 'present', 'still working', 'is current', 'now',
  '在職', '在職中', '現在', '재직', '재직중', '현재'
];
const SHARED_DESC = [
  '描述', '内容', '详情', '详细描述', '说明', '备注',
  'description', 'desc', 'details', 'detail', 'content',
  '説明', '内容詳細', '내용', '설명'
];

const FIELD_ALIAS_SOURCE = {
  basic: {
    name: ['姓名', '名字', '真实姓名', '中文姓名', '申请人姓名', 'name', 'full name', 'fullname', 'applicant name', '氏名', '名前', '이름', '성명'],
    mobile: ['手机号', '手机号码', '手机', '电话', '联系电话', '电话号码', '联系方式', '移动电话', 'mobile', 'phone', 'phone number', 'telephone', 'tel', 'cellphone', '携帯電話', '電話番号', '휴대폰', '전화번호', '핸드폰'],
    areaCode: ['电话区号', '区号', '手机区号', '国际区号', '国家区号', 'area code', 'country code', 'dial code', '市外局番', '국가번호'],
    email: ['邮箱', '电子邮箱', '电子邮件', '邮件', '邮箱地址', 'email', 'e-mail', 'mail', 'email address', 'メール', 'メールアドレス', '이메일'],
    idType: ['证件类型', '证件种类', '证件类别', '身份证件类型', 'id type', 'document type', 'identity type', '証明書種類', '신분증종류'],
    idNumber: ['证件号', '证件号码', '证件编号', '身份证号', '身份证号码', '身份证件号', 'id number', 'id no', 'document number', 'identity number', '証明書番号', '신분증번호'],
    city: ['城市', '现居城市', '所在城市', '所在地', '居住地', '当前城市', '现居住地', 'city', 'current city', 'location', 'residence', 'residence city', '居住都市', '거주지', '도시'],
    gender: ['性别', 'gender', 'sex', '性別', '성별'],
    birthday: ['生日', '出生日期', '出生年月', '出生时间', '出生年月日', 'birthday', 'birth date', 'date of birth', 'dob', '生年月日', '생년월일'],
    workStartDate: ['工作起始时间', '开始工作时间', '工作开始时间', '参加工作年份', '参加工作时间', '首次工作时间', 'work start date', 'work start', 'career start', '職歴開始', '경력시작']
  },
  intention: {
    city: ['期望城市', '期望工作城市', '期望工作地点', '意向城市', '期望地点', '意向地点', '目标城市', '工作城市', '城市', 'expected city', 'preferred city', 'target city', 'desired city', '希望勤務地', '희망근무지'],
    position: ['期望职位', '期望岗位', '意向岗位', '求职岗位', '期望职业', '目标职位', '意向职位', '期望工作', 'position', 'expected position', 'desired position', 'job title', 'target position', '希望職種', '희망직무', '희망직종'],
    jobType: ['工作性质', '求职类型', '工作类型', '职位类型', 'job type', 'employment type', 'job category', 'work type', '雇用形態', '고용형태', '직무형태'],
    arrivalTime: ['到岗时间', '可到岗时间', '入职时间', '到岗日期', '可入职时间', 'arrival time', 'available date', 'availability', 'start date', '入社可能日', '입사가능일']
  },
  work: {
    company: ['公司', '公司名称', '单位', '单位名称', '企业', '企业名称', '工作单位', 'company', 'company name', 'employer', 'organization', 'organisation', '勤務先', '会社名', '회사명', '회사'],
    title: ['职位', '岗位', '职位名称', '岗位名称', '职务', '担任职位', 'title', 'position', 'job title', 'role', '役職', '職位', '직책', '직위'],
    department: ['部门', '所在部门', '部门名称', '所属部门', 'department', 'dept', 'team', 'division', '部署', '부서'],
    start: SHARED_START,
    end: SHARED_END,
    ongoing: SHARED_ONGOING,
    desc: [...SHARED_DESC, '工作内容', '工作描述', '工作职责', '主要职责', '主要工作', '职责描述', 'job description', 'responsibilities', 'work content', '業務内容', '담당업무']
  },
  education: {
    school: ['学校', '学校名称', '毕业院校', '院校', '院校名称', '就读学校', '学校名', 'school', 'school name', 'university', 'college name', 'institution', '出身校', '학교명', '학교'],
    degree: ['学历', '学位', '最高学历', '学历层次', 'degree', 'education level', 'qualification', 'academic degree', '学歴', '学位', '학력', '학위'],
    major: ['专业', '专业名称', '所学专业', '主修专业', 'major', 'field of study', 'subject', 'specialization', '専攻', '전공'],
    college: ['学院', '院系', '所在学院', '学院名称', '系', 'college', 'faculty', 'school of', 'department', '学部', '학부', '단과대학'],
    start: [...SHARED_START, '入学时间', '入学日期'],
    end: [...SHARED_END, '毕业时间', '毕业日期'],
    ongoing: SHARED_ONGOING,
    trainingType: ['培养方式', '学习形式', '培养类型', '学习方式', 'training type', 'study mode', 'education type', 'attendance type', '課程', '수업형태'],
    gpa: ['绩点', 'gpa', '平均绩点', '平均分', '成绩', 'grade', 'average score', '成績', '학점']
  },
  project: {
    name: ['名称', '项目名称', '项目', '项目名', 'name', 'project name', 'project', 'project title', 'タイトル', '프로젝트명', '프로젝트'],
    role: ['角色', '项目角色', '担任角色', '担任职务', '项目职责', 'role', 'project role', 'position', '担当', '역할'],
    link: ['链接', '项目链接', '网址', '项目地址', '项目网址', 'link', 'url', 'website', 'project url', 'project link', 'リンク', '링크'],
    start: SHARED_START,
    end: SHARED_END,
    ongoing: SHARED_ONGOING,
    desc: [...SHARED_DESC, '项目描述', '项目介绍', '项目内容', '项目职责', 'project description', 'project detail', 'プロジェクト概要', '프로젝트설명']
  },
  award: {
    name: ['名称', '奖项名称', '竞赛名称', '获奖名称', '比赛名称', '奖项', '荣誉名称', '赛事名称', 'name', 'award name', 'competition name', 'award', 'title', '賞名', '수상명', '대회명'],
    date: ['时间', '日期', '获奖时间', '获奖日期', '比赛时间', '获得时间', 'date', 'award date', 'time', '受賞日', '수상일'],
    desc: [...SHARED_DESC, '获奖描述', '获奖情况', '奖项描述', 'award description', '受賞内容', '수상내용']
  },
  language: {
    language: ['语言', '语种', '外语', '语言名称', 'language', 'languages', 'foreign language', '語学', '言語', '언어', '외국어'],
    proficiency: ['水平', '熟练程度', '精通程度', '掌握程度', '语言水平', '等级', 'proficiency', 'level', 'fluency', 'skill level', '語学レベル', '수준', '능력']
  },
  sns: {
    platform: ['平台', '社交媒体', '平台名称', '社交平台', '账号类型', 'platform', 'sns', 'social', 'media type', 'ソーシャル', '플랫폼'],
    account: ['账号', '帐号', '账户', '账号名称', '用户名', '账号id', 'account', 'username', 'user name', 'handle', 'アカウント', '계정', '아이디']
  },
  summary: {
    content: ['内容', '自我评价', '自我介绍', '个人评价', '自我描述', '个人简介', 'content', 'summary', 'self evaluation', 'self introduction', 'about me', '自己PR', '자기소개']
  }
};
FIELD_ALIAS_SOURCE.internship = FIELD_ALIAS_SOURCE.work;
// 常见但页面不一定有的字段：识别后不再进 coverage.unknown（匹配层没有对应控件时会自然忽略）。
FIELD_ALIAS_SOURCE.basic.workYears = ['工作年限', '工作年限要求', '工作年资', 'years of experience', 'work years', 'experience years'];

const FIELD_ALIAS_MAPS = Object.freeze(Object.fromEntries(
  Object.entries(FIELD_ALIAS_SOURCE).map(([sectionKey, source]) => [sectionKey, aliasMap(source)])
));

const FIELD_ALIAS_REVERSE = new Map(); // normalized alias -> Set('section.field')
for (const [sectionKey, aliases] of Object.entries(FIELD_ALIAS_SOURCE)) {
  for (const [field, list] of Object.entries(aliases)) {
    const keys = [field, ...list].map(normalizeLabel).filter(Boolean);
    for (const key of keys) {
      if (!FIELD_ALIAS_REVERSE.has(key)) FIELD_ALIAS_REVERSE.set(key, new Set());
      FIELD_ALIAS_REVERSE.get(key).add(`${sectionKey}.${field}`);
    }
  }
}

/** 把页面/简历文本解析成 canonical section key；无法识别返回 null。 */
export function matchSectionKey(label) {
  const key = normalizeLabel(label);
  if (!key) return null;
  return SECTION_ALIASES.get(key) ?? null;
}

/** 在给定 section 内把 label / key 文本解析成 canonical field key；无法识别返回 null。 */
export function matchFieldKey(sectionKey, label) {
  if (!SECTION_KEYS.includes(sectionKey)) return null;
  const key = normalizeLabel(label);
  if (!key) return null;
  return FIELD_ALIAS_MAPS[sectionKey]?.get(key) ?? null;
}

export function isSectionKey(value) {
  return typeof value === 'string' && SECTION_KEYS.includes(value);
}

export function isRepeatableSection(sectionKey) {
  return REPEATABLE_SECTION_KEYS.includes(sectionKey);
}

export function isFieldKey(sectionKey, value) {
  return typeof value === 'string' && Array.isArray(FIELD_KEYS[sectionKey]) && FIELD_KEYS[sectionKey].includes(value);
}

/**
 * 在没有页面分区信息时，用 label 反查唯一的 (section, field)。
 * 命中多个 section（有歧义）时返回 null —— 绝不跨分区猜。
 */
export function matchUniqueFieldByLabel(label) {
  const key = normalizeLabel(label);
  if (!key) return null;
  const hits = FIELD_ALIAS_REVERSE.get(key);
  if (!hits || hits.size !== 1) return null;
  const [sectionKey, field] = [...hits][0].split('.');
  return { sectionKey, field };
}

/** 字段同一性推断：fieldKey 只属于一个 section 时返回该 section，否则 null。 */
export function uniqueSectionForFieldKey(fieldKey) {
  if (typeof fieldKey !== 'string' || !fieldKey) return null;
  const sections = SECTION_KEYS.filter(sectionKey => FIELD_KEYS[sectionKey].includes(fieldKey));
  // work / internship 共享字段、basic / intention 共享 city：都是歧义，绝不猜。
  return sections.length === 1 ? sections[0] : null;
}

// ---------------------------------------------------------------------------
// 值归一化（契约 §1）
// ---------------------------------------------------------------------------

const MONTH_NAMES = new Map([
  ['jan', 1], ['january', 1], ['feb', 2], ['february', 2], ['mar', 3], ['march', 3],
  ['apr', 4], ['april', 4], ['may', 5], ['jun', 6], ['june', 6], ['jul', 7], ['july', 7],
  ['aug', 8], ['august', 8], ['sep', 9], ['sept', 9], ['september', 9], ['oct', 10], ['october', 10],
  ['nov', 11], ['november', 11], ['dec', 12], ['december', 12]
]);
const ONGOING_EXACT = /^(至今|今|现在|現在|目前|仍在|在职|在職|在職中|在职中|present|now|current|ongoing|today|stillworking|현재|재직|재직중)$/i;
const ONGOING_TEXT = /至今|现在|目前|仍在|在职|在職|present|current|ongoing/i;
const YEAR_PATTERN = /(?:19|20)\d{2}/;
const MONTH_AFTER_YEAR = /(?:^|[\s\-_./年.])(0?[1-9]|1[0-2])(?=$|[\s\-_./月.])/;
const MONTH_BEFORE_YEAR = /(0?[1-9]|1[0-2])\s*[\/\-.]\s*$/;

function ongoingValue(ongoing) {
  return { text: ongoing ? '至今' : '', year: null, month: null, ongoing: ongoing === true };
}

function parseOngoing(rawValue) {
  if (typeof rawValue === 'boolean') return ongoingValue(rawValue);
  const text = String(rawValue ?? '').trim();
  if (!text) return undefined;
  const compact = text.replace(/[\s.。]/g, '').toLowerCase();
  if (ONGOING_EXACT.test(compact)) return ongoingValue(true);
  if (/^(否|无|不是|没有|false|no|n|0)$/i.test(compact)) return ongoingValue(false);
  if (/^(是|有|对|true|yes|y|1)$/i.test(compact)) return ongoingValue(true);
  return undefined;
}

/**
 * 日期/至今归一化：{ text:'YYYY-MM'|'YYYY'|'至今', year, month, ongoing }。
 * 支持 '至今'/'今'/'present'/'now'、'2023-09'、'2023.09'、'2023/9'、'2023年9月'、'Sep 2023'。
 */
export function normalizeDate(rawValue) {
  if (rawValue === null || rawValue === undefined) return undefined;
  if (typeof rawValue === 'boolean') return ongoingValue(rawValue);
  if (typeof rawValue === 'number') {
    return Number.isInteger(rawValue) && rawValue >= 1900 && rawValue <= 2100
      ? { text: String(rawValue), year: rawValue, month: null, ongoing: false }
      : undefined;
  }
  if (typeof rawValue !== 'string') return undefined;
  const raw = rawValue.trim();
  if (!raw) return undefined;
  const compact = raw.replace(/[\s.。]/g, '').toLowerCase();
  if (ONGOING_EXACT.test(compact)) return ongoingValue(true);
  if (!/\d/.test(raw) && ONGOING_TEXT.test(raw)) return ongoingValue(true);

  const yearMatch = raw.match(YEAR_PATTERN);
  const year = yearMatch ? Number(yearMatch[0]) : null;
  const monthName = raw.toLowerCase().match(/\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/);
  let month = monthName ? MONTH_NAMES.get(monthName[1]) : null;
  if (month === null && yearMatch) {
    const rest = raw.slice(yearMatch.index + yearMatch[0].length);
    const after = rest.match(MONTH_AFTER_YEAR);
    if (after) month = Number(after[1]);
    else {
      const before = raw.slice(0, yearMatch.index);
      const previous = before.match(MONTH_BEFORE_YEAR);
      if (previous) month = Number(previous[1]);
    }
  }
  if (year === null && month === null) return { text: raw, year: null, month: null, ongoing: false };
  if (year === null) return { text: raw, year: null, month, ongoing: false };
  const text = month === null ? String(year) : `${year}-${String(month).padStart(2, '0')}`;
  return { text, year, month, ongoing: false };
}

function normalizeFieldValue(fieldKey, rawValue) {
  if (rawValue === null || rawValue === undefined) return undefined;
  let value = rawValue;
  if (Array.isArray(value)) value = value.find(item => item !== null && item !== undefined && typeof item !== 'object');
  if (value === null || value === undefined || typeof value === 'object') return undefined;
  if (fieldKey === 'ongoing') return parseOngoing(value);
  if (DATE_FIELDS.has(fieldKey)) return normalizeDate(value);
  if (typeof value === 'boolean') return { text: value ? '是' : '否' };
  if (typeof value === 'number' && !Number.isFinite(value)) return undefined;
  const text = String(value).trim();
  if (!text) return undefined;
  return { text };
}

export function entryType(fieldKey) {
  if (DATE_FIELDS.has(fieldKey)) return 'date';
  if (LONG_FIELDS.has(fieldKey)) return 'longtext';
  if (URL_FIELDS.has(fieldKey)) return 'url';
  if (SELECT_FIELDS.has(fieldKey)) return 'select';
  return 'text';
}

// ---------------------------------------------------------------------------
// resume -> ResumeIndex
// ---------------------------------------------------------------------------

const PRIMITIVE_ITEM_FIELD = { language: 'language', sns: 'account', award: 'name' };
const clone = value => (typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value)));

function isResumeIndex(value) {
  return record(value) && value.schemaVersion === SCHEMA_VERSION && Array.isArray(value.entries) &&
    record(value.basics) && record(value.items) && record(value.coverage);
}

function sectionError(basePath) {
  return new TypeError(`resume section "${basePath.join('.')}" must be an object or an array of objects`);
}

function pathText(path) {
  return path.join('.');
}

function collectFlatSection({ sectionKey, rawValue, basePath, target, entries, unknown }) {
  let source = rawValue;
  if (Array.isArray(source)) source = source.find(record);
  if (!record(source)) throw sectionError(basePath);
  for (const [rawField, rawValueOfField] of Object.entries(source)) {
    const fieldKey = matchFieldKey(sectionKey, rawField);
    if (!fieldKey) {
      unknown.push({ path: pathText([...basePath, rawField]), key: rawField });
      continue;
    }
    const normalized = normalizeFieldValue(fieldKey, rawValueOfField);
    if (!normalized) {
      unknown.push({ path: pathText([...basePath, rawField]), key: rawField });
      continue;
    }
    target[fieldKey] = normalized;
    entries.push({ section: sectionKey, itemIndex: 0, field: fieldKey, key: rawField, path: [...basePath, rawField], value: normalized.text, type: entryType(fieldKey) });
  }
}

function collectSummarySection({ rawValue, basePath, entries, unknown }) {
  let content;
  if (typeof rawValue === 'string') content = rawValue;
  else if (Array.isArray(rawValue)) content = rawValue.every(item => typeof item === 'string') ? rawValue.join('\n\n') : undefined;
  else if (record(rawValue)) {
    collectFlatSection({ sectionKey: 'summary', rawValue, basePath, target: {}, entries, unknown });
    return;
  }
  if (content === undefined) throw sectionError(basePath);
  const text = content.trim();
  if (!text) return;
  entries.push({ section: 'summary', itemIndex: 0, field: 'content', key: 'content', path: [...basePath, 'content'], value: text, type: entryType('content') });
}

function collectItemSection({ sectionKey, rawValue, basePath, items, entries, unknown }) {
  const elements = Array.isArray(rawValue) ? rawValue : [rawValue];
  const primitiveField = PRIMITIVE_ITEM_FIELD[sectionKey];
  for (const element of elements) {
    if (element === null || element === undefined) continue;
    const itemIndex = items[sectionKey].length;
    let itemRecord;
    if (record(element)) itemRecord = element;
    else if (primitiveField && (typeof element === 'string' || typeof element === 'number')) itemRecord = { [primitiveField]: element };
    else throw sectionError(basePath);

    const itemPath = Array.isArray(rawValue) ? [...basePath, itemIndex] : [...basePath];
    const fields = {};
    for (const [rawField, rawFieldValue] of Object.entries(itemRecord)) {
      const fieldKey = matchFieldKey(sectionKey, rawField);
      if (!fieldKey) {
        unknown.push({ path: pathText([...itemPath, rawField]), key: rawField });
        continue;
      }
      const normalized = normalizeFieldValue(fieldKey, rawFieldValue);
      if (!normalized) {
        unknown.push({ path: pathText([...itemPath, rawField]), key: rawField });
        continue;
      }
      fields[fieldKey] = normalized;
      entries.push({ section: sectionKey, itemIndex, field: fieldKey, key: rawField, path: [...itemPath, rawField], value: normalized.text, type: entryType(fieldKey) });
    }
    // 「结束时间: 至今」同时生成合成的 ongoing 字段，供页面「至今」check 使用。
    if (ONGOING_SECTIONS.has(sectionKey) && !fields.ongoing && fields.end?.ongoing === true) {
      fields.ongoing = ongoingValue(true);
      entries.push({ section: sectionKey, itemIndex, field: 'ongoing', key: 'ongoing', path: [...itemPath, 'ongoing'], value: '至今', type: entryType('ongoing') });
    }
    // 没有任何可识别明细（如「有实习经历: 是」开关型）不产生 item，只留在 coverage.
    if (Object.keys(fields).length === 0) continue;
    items[sectionKey].push({ itemIndex, path: itemPath, fields });
  }
}

/**
 * 构建契约 §2 的 ResumeIndex。
 * @param {object} resume 自由格式简历（中/英/日/韩 key 均可）
 * @returns {object} ResumeIndex
 */
export function buildResumeIndex(resume) {
  if (!record(resume)) throw new TypeError('buildResumeIndex expects a plain resume object');
  if (isResumeIndex(resume)) return clone(resume);

  const basics = {};
  const intention = {};
  const items = Object.fromEntries(REPEATABLE_SECTION_KEYS.map(sectionKey => [sectionKey, []]));
  const entries = [];
  const known = [];
  const unknown = [];

  for (const [rawKey, rawValue] of Object.entries(resume)) {
    const sectionKey = matchSectionKey(rawKey);
    if (!sectionKey) {
      unknown.push({ path: rawKey, key: rawKey });
      continue;
    }
    known.push(rawKey);
    if (sectionKey === 'basic' || sectionKey === 'intention') {
      collectFlatSection({ sectionKey, rawValue, basePath: [rawKey], target: sectionKey === 'basic' ? basics : intention, entries, unknown });
    } else if (sectionKey === 'summary') {
      collectSummarySection({ rawValue, basePath: [rawKey], entries, unknown });
    } else {
      collectItemSection({ sectionKey, rawValue, basePath: [rawKey], items, entries, unknown });
    }
  }

  const missing = REQUIRED_BASIC_FIELDS.filter(field => !basics[field]);
  return { schemaVersion: SCHEMA_VERSION, basics, intention, items, entries, coverage: { known, unknown }, missing };
}

export default buildResumeIndex;
