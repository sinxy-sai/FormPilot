import { reducePanelState, initialPanelState } from './core/panel-state.mjs';
let state = initialPanelState;
const out = document.querySelector('#status');
const render = () => { out.textContent = JSON.stringify({ status: state.status, fields: state.task?.fields?.length ?? 0, results: state.results }, null, 2); };
const dispatch = action => { state = reducePanelState(state, action); render(); };
async function send(type, payload={}) { const response = await chrome.runtime.sendMessage({ type, ...payload }); if (response?.error) throw new Error(response.error); return response; }
document.querySelector('#resume').addEventListener('change', async event => { const file = event.target.files?.[0]; if (!file) return; dispatch({ type:'resume/load', resume: JSON.parse(await file.text()) }); });
document.querySelector('#inspect').addEventListener('click', async () => { try { const tabs = await chrome.tabs.query({ active:true, currentWindow:true }); const tab=tabs?.[0]; dispatch({type:'task/load', task: await send('task/inspect', { tabId:tab?.id, url:tab?.url })}); } catch (e) { out.textContent = e.message; } });
 document.querySelector('#approve').addEventListener('click', async () => { try { const t=state.task??{}; dispatch({type:'task/load', task: await send('task/approve', { plan: state.plan, tabId:t.tabId, url:t.url, frameId:t.frameId, documentId:t.documentId, pageFingerprint:t.pageFingerprint })}); } catch (e) { out.textContent = e.message; } });
 document.querySelector('#execute').addEventListener('click', async () => { try { const t=state.task??{}; dispatch({type:'execute/start'}); dispatch({type:'execute/result', results: await send('task/execute', { approvalToken:t.approvalToken, tabId:t.tabId, url:t.url, frameId:t.frameId, documentId:t.documentId, pageFingerprint:t.pageFingerprint })}); } catch (e) { out.textContent = e.message; } });
 document.querySelector('#undo').addEventListener('click', async () => { try { const t=state.task??{}; dispatch({type:'undo/result', results: await send('task/undo', { tabId:t.tabId, url:t.url, frameId:t.frameId, documentId:t.documentId, pageFingerprint:t.pageFingerprint })}); } catch (e) { out.textContent = e.message; } });
render();
