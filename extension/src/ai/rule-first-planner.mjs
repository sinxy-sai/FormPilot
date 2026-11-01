import { matchField } from '../field-matcher.mjs';
import { buildModelInput, validateModelProposal, pathSegmentsExist, readPathSegments } from './schema.mjs';
import { unavailableProvider } from './provider.mjs';
const leafCandidates = (value, segments = [], out = []) => {
  if (value === null || typeof value !== 'object') { if (segments.length) out.push({ candidateId:`candidate-${out.length+1}`, pathSegments:segments, displayPath:segments.map((s,i)=>typeof s==='number'?`[${s}]`:(i && typeof segments[i-1]==='number'?`.${s}`:String(s))).join(''), valueType: typeof value }); return out; }
  Object.keys(value).forEach(k => { if (k === '__proto__' || k === 'prototype' || k === 'constructor') return; leafCandidates(value[k], [...segments, k], out); });
  return out;
};
const pathToSegments = path => { const a=[]; if(typeof path!=='string') return a; const re=/([^.[\]]+)|\[(\d+)\]/g; let m; while((m=re.exec(path))) a.push(m[2]===undefined?m[1]:Number(m[2])); return a; };
export async function rankCandidates(field, candidates, embed) {
  if (typeof embed !== 'function') throw new TypeError('embed required');
  const texts = [String(field?.label ?? field?.name ?? ''), ...candidates.map(c => String(c.displayPath ?? c.path ?? c.label ?? ''))];
  const vectors = await embed(texts); if (!Array.isArray(vectors) || vectors.length !== texts.length || !vectors.every(v=>Array.isArray(v))) throw new TypeError('embedding dimensions');
  const dim = vectors[0]?.length; if (!dim || vectors.some(v=>v.length !== dim || v.some(x=>typeof x !== 'number' || !Number.isFinite(x)))) throw new TypeError('embedding dimensions');
  const norm = v => Math.sqrt(v.reduce((s,x)=>s+x*x,0)); const n0=norm(vectors[0]); if (!Number.isFinite(n0)||n0===0) throw new TypeError('zero-vector');
  return candidates.map((c,i)=>{ const n=norm(vectors[i+1]); if(!Number.isFinite(n)||n===0) throw new TypeError('zero-vector'); const score=vectors[0].reduce((s,x,j)=>s+x*vectors[i+1][j],0)/(n0*n); return {candidateId:c.candidateId ?? c.id, score}; }).sort((a,b)=>b.score-a.score);
}
export async function createEnhancedPlan(fields, profile, options = {}) {
  const provider = options.provider ?? unavailableProvider; const matcher = options.matcher ?? ((f,p)=>matchField(f,p,options.mappings ?? [])); const allCandidates = leafCandidates(profile); const plans=[];
  for (const field of fields || []) {
    const rule = await matcher(field, profile);
    const section = String(field.section ?? field.collectionKey ?? '').toLowerCase();
    const sectionKind = /project|项目|プロジェクト/.test(section) ? 'project' : /education|教育|学歴/.test(section) ? 'education' : /intern|实习/.test(section) ? 'intern' : section;
    const repeatedSection = Object.entries(profile || {}).some(([key, value]) => Array.isArray(value) && value.length > 1 && ((sectionKind === 'project' && /project|项目|プロジェクト/i.test(key)) || (sectionKind === 'education' && /education|教育|学歴/i.test(key)) || (sectionKind === 'intern' && /intern|实习/i.test(key)) || section.includes(String(key).toLowerCase())));
    if (repeatedSection && !Number.isInteger(field.repeatIndex)) { plans.push({ fieldId:field.id, status:'manual', reason:'ambiguous' }); continue; }
    if ((rule?.path || rule?.pathSegments) && rule.confidence >= 0.9) {
      const pathSegments = Array.isArray(rule.pathSegments) ? rule.pathSegments : pathToSegments(rule.path);
      if (!Array.isArray(rule.pathSegments) && typeof rule.path === 'string' && /[.\[\]]/.test(rule.path) && !pathSegmentsExist(profile, pathSegments)) { plans.push({ fieldId:field.id, status:'manual', reason:'ambiguous-path' }); continue; }
      if (!pathSegmentsExist(profile, pathSegments)) { plans.push({ fieldId:field.id, status:'manual', reason:'path-not-found' }); continue; }
      plans.push({ fieldId:field.id, path:rule.path ?? pathSegments.join('.'), pathSegments, value:readPathSegments(profile,pathSegments), confidence:rule.confidence, source:rule.source ?? 'rule', status:'proposed' }); continue;
    }
    const scoped = allCandidates.filter(c => !section || c.displayPath.toLowerCase().includes(section)).filter(c => !Number.isInteger(field.repeatIndex) || c.pathSegments.some((s,i)=>typeof s==='number' && s===field.repeatIndex));
    if (Number.isInteger(field.repeatIndex) && scoped.length === 0) { plans.push({ fieldId:field.id, status:'manual', reason:'repeat-index-not-found' }); continue; }
    const candidates = scoped.length ? scoped : allCandidates;
    if (rule?.source === 'ambiguous' || (!Number.isInteger(field.repeatIndex) && /project|项目|education|教育|intern|实习/i.test(section) && candidates.filter(c=>c.displayPath.toLowerCase().endsWith('.name')||c.displayPath.toLowerCase().endsWith('.school')).length > 1)) { plans.push({ fieldId:field.id, status:'manual', reason:'ambiguous' }); continue; }
    const inputCandidates = candidates.map((c,i)=>({...c,candidateId:c.candidateId ?? `candidate-${i+1}`}));
    let proposal; try { proposal = await provider.generate(buildModelInput(field,inputCandidates)); } catch { proposal = { status:'abstain' }; }
    const checked = validateModelProposal(proposal, { fieldId:field.id, candidates:inputCandidates, options:field.options ?? [] });
    if (checked.status !== 'proposed') { plans.push({fieldId:field.id,status:'manual',reason:checked.reason ?? (checked.status === 'abstain' ? 'abstain' : 'abstain')}); continue; }
    const candidate = inputCandidates.find(c=>c.candidateId===checked.candidateId);
    if (!candidate || !pathSegmentsExist(profile,candidate.pathSegments)) { plans.push({fieldId:field.id,status:'manual',reason:'path-not-found'}); continue; }
    plans.push({ fieldId:field.id, path:candidate.displayPath, pathSegments:candidate.pathSegments, value:readPathSegments(profile,candidate.pathSegments), confidence:checked.confidence, source:'model', status:'proposed', ...(checked.option===undefined?{}:{option:checked.option}), ...(checked.reason===undefined?{}:{reason:checked.reason}) });
  }
  return plans;
}

