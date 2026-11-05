// 引擎 bundle 的入口：把纯逻辑模块挂到 window.__formPilotEngine。
// 这些模块都不依赖 chrome.*，只操作传入的 document，因此可以在真实页面里直接跑。
import { inspectPage } from '../extension/src/runtime/page-inspector.mjs';
import { createPageModel } from '../extension/src/core/page-model.mjs';
import { buildResumeIndex } from '../extension/src/core/resume-index.mjs';
import { planFill } from '../extension/src/core/matcher.mjs';
import { validatePlannedStep } from '../extension/src/runtime/action-guard.mjs';
import { executeStep, executeAction, undoLastFill } from '../extension/src/runtime/control-executor.mjs';
import { listCapabilities } from '../extension/src/adapters/capabilities.mjs';

globalThis.__formPilotEngine = {
  version: '2.0.0',
  inspectPage,
  createPageModel,
  buildResumeIndex,
  planFill,
  validatePlannedStep,
  executeStep,
  executeAction,
  undoLastFill,
  listCapabilities
};

globalThis.__formPilotEngineReady = true;
