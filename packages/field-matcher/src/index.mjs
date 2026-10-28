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
    .toLowerCase()
    .replace(/[：:]/g, ' ')
    .replace(/[_-]+/g, ' ')
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
  const aliasPath = LABEL_ALIASES.get(normalized);
  if (aliasPath) {
    const value = getPathValue(resume, aliasPath);
    if (value !== undefined) return { field, path: aliasPath, value, confidence: 0.9, source: 'rule' };
  }
  const matches = findKeyMatches(resume, normalized);
  if (matches.length === 1) return { field, path: matches[0].path, value: matches[0].value, confidence: 0.85, source: 'json-key' };
  if (matches.length > 1) return { field, path: null, value: null, confidence: 0, source: 'ambiguous' };
  return { field, path: null, value: null, confidence: 0, source: 'unmatched' };
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
