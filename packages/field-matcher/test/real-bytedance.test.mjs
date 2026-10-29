import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFillPlan } from '../src/index.mjs';
const resume = JSON.parse(readFileSync(new URL('../../../examples/resume.json', import.meta.url), 'utf8'));
test('maps real visible labels with field keys',()=>{const fields=[{label:'起止时间',fieldKey:'start'},{label:'起止时间',fieldKey:'end'},{label:'学历类型',fieldKey:'education_type'},{label:'学校名称',fieldKey:'school'},{label:'学历',fieldKey:'degree'},{label:'专业',fieldKey:'field_of_study'},{label:'项目名称',fieldKey:'name',collectionKey:'project_list',repeatIndex:0},{label:'项目角色',fieldKey:'role',collectionKey:'project_list',repeatIndex:0},{label:'竞赛名称',fieldKey:'name',collectionKey:'competition_list',repeatIndex:0},{label:'语言',fieldKey:'language',collectionKey:'language_list',repeatIndex:0}];const p=createFillPlan(fields,resume);assert.deepEqual(p.slice(0,6).map(x=>x.value),[resume.教育经历.开始时间,resume.教育经历.结束时间,resume.教育经历.培养方式,resume.教育经历.学校,resume.教育经历.学历,resume.教育经历.专业]);assert.equal(p[6].path,'项目经历[0].名称');assert.equal(p[8].path,'竞赛[0].名称');assert.equal(p[9].path,'语言能力[0].语言');});
test('maps no-internship checkbox to boolean',()=>{const p=createFillPlan([{label:'没有实习经历',fieldKey:'no_internship',section:'实习经历'}],{实习经历:{有实习经历:'否'}});assert.equal(p[0].value,true);});
test('ignores a whole-form section string when resolving repeated fields',()=>{const p=createFillPlan([{label:'项目名称',fieldKey:'name',section:'基本信息 教育经历 实习经历 项目经历 竞赛 语言能力 自我评价 社交账号'}],resume);assert.equal(p[0].path,'项目经历[0].名称');});
