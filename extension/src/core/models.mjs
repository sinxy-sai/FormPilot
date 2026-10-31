const FORBIDDEN = new Set(['__proto__', 'prototype']);
const EXECUTABLE = new Set(['script', 'javascript', 'selector', 'selectors', 'click', 'submit', 'action', 'code', 'handler', 'onclick']);
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
export function normalizeResumeInput(input) {
  if (!record(input)) throw new TypeError('resume input must be an object');
  const hasSchemaVersion = Object.prototype.hasOwnProperty.call(input, 'schemaVersion');
  const hasProfile = Object.prototype.hasOwnProperty.call(input, 'profile');
  if (hasSchemaVersion && !hasProfile) throw new TypeError('profile is required');
  if (hasSchemaVersion && hasProfile) {
    if (!record(input.profile)) throw new TypeError('profile must be an object');
    const schemaVersion = input.schemaVersion ?? 1;
    if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new TypeError('schemaVersion must be a positive integer');
    return { schemaVersion, profile: input.profile };
  }
  return { schemaVersion: 1, profile: input };
}
function parsePath(path) {
  if (Array.isArray(path)) return path;
  if (typeof path !== 'string' || !path) return null;
  const parts = []; const re = /([^.[\]]+)|\[(\d+)\]/g; let m; let end = 0;
  while ((m = re.exec(path))) { if (path.slice(end, m.index) && path.slice(end, m.index) !== '.') return null; parts.push(m[2] === undefined ? m[1] : Number(m[2])); end = re.lastIndex; }
  return end === path.length ? parts : null;
}
export function getPathValue(profile, path) {
  const parts = parsePath(path); if (!parts || !record(profile)) return undefined; let current = profile;
  for (const part of parts) { if (typeof part === 'string' && FORBIDDEN.has(part)) return undefined; if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return undefined; current = current[part]; }
  return current;
}
function exists(profile, path) { const parts = parsePath(path); if (!parts?.length || !record(profile)) return false; let current = profile; for (const part of parts) { if (typeof part === 'string' && FORBIDDEN.has(part)) return false; if (current === null || typeof current !== 'object' || !Object.prototype.hasOwnProperty.call(current, part)) return false; current = current[part]; } return true; }
export function isValidMatchProposal(proposal, profile, field = {}) {
  if (!record(proposal) || !record(profile)) return { valid: false, reason: 'invalid-input' };
  if (Object.keys(proposal).some(k => EXECUTABLE.has(k))) return { valid: false, reason: 'executable-field' };
  const path = proposal.pathSegments ?? proposal.path ?? proposal.resumePath ?? proposal.candidatePath;
  if (!exists(profile, path)) return { valid: false, reason: 'path-not-found' };
  if (field.path !== undefined && JSON.stringify(parsePath(field.path)) !== JSON.stringify(parsePath(path))) return { valid: false, reason: 'field-path-mismatch' };
  if ('value' in proposal && !Object.is(proposal.value, getPathValue(profile, path))) return { valid: false, reason: 'value-mismatch' };
  return { valid: true };
}
function fp(value) { const text = JSON.stringify(value); let h = 2166136261; for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return `fp-${(h >>> 0).toString(16)}`; }
export function createTaskSnapshot({ tabId, frameId, documentId, url, pageFingerprint, fields = [], plan = [], status = 'pending-review', resumeRevision, id } = {}) {
  if (!Number.isInteger(tabId)) throw new TypeError('tabId must be an integer'); if (typeof url !== 'string') throw new TypeError('url must be a string');
  return { id: id ?? `tab-${tabId}`, tabId, ...(frameId === undefined ? {} : { frameId }), ...(documentId === undefined ? {} : { documentId }), url, pageFingerprint: pageFingerprint ?? fp({ url, fields }), ...(resumeRevision === undefined ? {} : { resumeRevision }), fields, plan, status, updatedAt: new Date().toISOString() };
}



