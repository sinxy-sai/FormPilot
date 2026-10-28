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
  const path = saved?.resumePath || LABEL_ALIASES.get(normalized);
  if (!path) return { field, path: null, value: null, confidence: 0, source: 'unmatched' };
  const value = getPathValue(resume, path);
  return { field, path, value: value ?? '', confidence: saved ? 1 : 0.9, source: saved ? 'user' : 'rule' };
}

export function createFillPlan(fields, resume, mappings = []) {
  return fields.map((field) => matchField(field, resume, mappings));
}
