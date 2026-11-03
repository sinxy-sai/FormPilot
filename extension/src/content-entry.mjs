import { inspectPage } from './runtime/page-inspector.mjs';
import { executeTool } from './runtime/control-executor.mjs';
import { verifyAction } from './runtime/result-verifier.mjs';
import { listCapabilities } from './adapters/capabilities.mjs';
import { createLogger } from './core/logger.mjs';

const log = createLogger('content');
const documentId = globalThis.__formPilotDocumentId || (globalThis.__formPilotDocumentId = `doc-${Date.now()}-${Math.random().toString(16).slice(2)}`);
if (typeof chrome !== 'undefined' && chrome.runtime && !globalThis.__formPilotContentLoaded) {
  globalThis.__formPilotContentLoaded = true;
  log.info('loaded', { url: location.href, documentId });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'inspect-page') { const result = { runtimeVersion: '0.4.0', documentId, ...inspectPage(document, { capabilities: listCapabilities() }) }; log.info('inspect-page', { controls: result.pageModel?.controls?.length ?? 0, fingerprint: result.pageModel?.fingerprint }); sendResponse(result); return true; }
    if (message?.type === 'execute-tool') { log.info('execute-tool', { tool: message.action?.tool, target: message.action?.target }); const inspected = inspectPage(document, { capabilities: listCapabilities() }); executeTool(document, message.action || {}, { pageModel: inspected.pageModel, pageFingerprint: message.pageFingerprint || inspected.pageModel.fingerprint }).then(result => { log.info('execute-result', result); sendResponse(result); }); return true; }
    if (message?.type === 'verify-action') { verifyAction(document, message.action || {}, message.result || {}, { pageFingerprint: message.pageFingerprint }).then(sendResponse); return true; }
    return undefined;
  });
}
export { inspectPage, executeTool, verifyAction };
