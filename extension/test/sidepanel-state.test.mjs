import test from 'node:test';
import assert from 'node:assert/strict';
import { reducePanelState, initialPanelState } from '../src/core/panel-state.mjs';
test('navigation invalidates approvals',()=>{ const next=reducePanelState({status:'review',plan:[{fieldId:'f1',status:'approved'}]}, {type:'invalidate',reason:'document-changed'}); assert.equal(next.status,'invalidated'); assert.equal(next.plan[0].status,'proposed'); });
test('panel carries resume, task and results',()=>{ let s=reducePanelState(initialPanelState,{type:'resume/load',resume:{name:'A'}}); s=reducePanelState(s,{type:'task/load',task:{plan:[{fieldId:'f'}],status:'pending-review'}}); s=reducePanelState(s,{type:'execute/result',results:[{status:'verified'}]}); assert.equal(s.resume.name,'A'); assert.equal(s.plan.length,1); assert.equal(s.results[0].status,'verified'); });
