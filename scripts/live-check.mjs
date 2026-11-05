// 真机只读验证：用 Edge 配置文件的副本（只复制 Cookie 相关文件）打开真实简历页，
// 注入引擎 bundle，跑 inspect -> plan（默认不写入任何字段），把结果打印出来。
//
// 运行：node scripts/live-check.mjs [--write]
//   --write   执行填写（overwrite 模式，会修改页面内容，不会点保存）；不加则纯只读
//
// 注意：本脚本启动的是独立浏览器实例 + 配置副本，不会影响你正在用的 Edge。
import { mkdir, rm, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { chromium } from 'playwright';

const root = resolve(import.meta.dirname, '..');
const live = process.argv.includes('--write');
const resumePath = process.env.FORMPILOT_RESUME ?? resolve(root, 'examples/bytedance-resume-backup.json');
const enginePath = resolve(root, 'dist/live/engine.js');
const url = 'https://jobs.bytedance.com/experienced/resume/edit';

if (!existsSync(enginePath)) { console.error('缺少 dist/live/engine.js，先运行 node scripts/build-engine-bundle.mjs'); process.exit(1); }

const edgeUserData = process.env.EDGE_USER_DATA ?? join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'User Data');
const profile = await mkdtemp(resolve(tmpdir(), 'formpilot-live-profile-'));
await mkdir(join(profile, 'Default', 'Network'), { recursive: true });
for (const file of [['Local State', 'Local State'], ['Default/Network/Cookies', 'Default/Network/Cookies'], ['Default/Preferences', 'Default/Preferences']]) {
  const source = join(edgeUserData, ...file[0].split('/'));
  if (!existsSync(source)) continue;
  try {
    // Edge 正在运行时 CopyFileW 会因共享锁失败；readFile/writeFile 通常可以读出来。
    await writeFile(join(profile, ...file[1].split('/')), await readFile(source));
  } catch (error) {
    console.warn(`跳过 ${file[0]}：${error?.code ?? error}`);
  }
}

const resume = JSON.parse(await readFile(resumePath, 'utf8'));
const context = await chromium.launchPersistentContext(profile, {
  headless: true,
  channel: 'chromium',
  args: ['--no-first-run', '--no-default-browser-check', '--disable-gpu']
});
try {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const currentUrl = page.url();
  const title = await page.title();
  const hasForm = await page.evaluate(() => Boolean(document.querySelector('form [data-form-field-name]'))).catch(() => false);
  console.log(JSON.stringify({ currentUrl, title, hasForm }));
  if (!hasForm) {
    console.log('未登录或页面没渲染出简历表单，无法继续（请确认 Edge 里已登录 jobs.bytedance.com）');
    process.exitCode = 2;
  } else {
    await page.addScriptTag({ path: enginePath });
    const report = await page.evaluate((payload) => {
      const engine = globalThis.__formPilotEngine;
      const { pageModel, diagnostics } = engine.inspectPage(document, { capabilities: engine.listCapabilities() });
      const resumeIndex = engine.buildResumeIndex(payload.resume);
      const plan = engine.planFill({ resumeIndex, pageModel, mode: payload.mode });
      return {
        sections: pageModel.sections.map(section => ({ key: section.key, label: section.label, items: section.itemCount, add: Boolean(section.addActionId) })),
        controlCount: pageModel.controls.length,
        actionCount: (pageModel.actions ?? []).length,
        diagnostics,
        resume: { sections: Object.entries(resumeIndex.items).map(([key, items]) => `${key}:${items.length}`), missing: resumeIndex.missing, unknown: resumeIndex.coverage?.unknown?.length ?? 0 },
        summary: plan.summary,
        steps: plan.steps.map(step => ({ id: step.stepId, kind: step.kind, status: step.status, section: step.sectionKey, item: step.itemIndex, field: step.fieldKey, source: (step.sourcePath ?? []).join('.'), value: typeof step.value === 'string' && step.value.length > 40 ? `${step.value.slice(0, 40)}…` : step.value, current: step.currentValue, reason: step.reason }))
      };
    }, { resume, mode: live ? 'overwrite' : 'fill-empty' });

    const { steps, ...summary } = report;
    console.log(JSON.stringify(summary, null, 2));
    console.log('--- 前 12 个步骤 ---');
    console.log(JSON.stringify(steps.slice(0, 12), null, 1));
    const ready = steps.filter(step => step.status === 'ready');
    console.log(`ready=${ready.length} conflict=${report.summary.conflicts} skipped=${report.summary.skipped} unsupported=${report.summary.unsupported}`);

    if (live) {
      const runs = await page.evaluate(async (payload) => {
        const engine = globalThis.__formPilotEngine;
        const log = [];
        for (let index = 0; index < 200; index += 1) {
          const { pageModel } = engine.inspectPage(document, { capabilities: engine.listCapabilities() });
          const resumeIndex = engine.buildResumeIndex(payload.resume);
          const plan = engine.planFill({ resumeIndex, pageModel, mode: 'overwrite' });
          const step = plan.steps.find(item => item.status === 'ready');
          if (!step) break;
          let result;
          if (step.kind === 'add-item') {
            const action = pageModel.actions.find(item => item.actionId === step.actionId);
            if (!action) { log.push({ step: step.stepId, status: 'failed', reason: 'action-missing' }); break; }
            result = await engine.executeAction(document, action, { pageModel, mode: 'overwrite' });
          } else {
            const gate = engine.validatePlannedStep(step, { pageModel, mode: 'overwrite' });
            if (!gate.allowed) { log.push({ step: step.stepId, status: 'blocked', reason: gate.reason }); break; }
            result = await engine.executeStep(document, step, { pageModel, mode: 'overwrite' });
          }
          log.push({ step: step.stepId, kind: step.kind, field: step.fieldKey, status: result?.status, reason: result?.reason ?? '' });
          if (!['verified', 'done', 'skipped'].includes(result?.status)) break;
        }
        return log;
      }, { resume });
      const ok = runs.filter(item => ['verified', 'done', 'skipped'].includes(item.status)).length;
      console.log(`--- 执行结果：${ok}/${runs.length} 成功 ---`);
      console.log(JSON.stringify(runs.slice(-8), null, 1));
    }
  }
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true });
}
