// 真浏览器端到端验收：在 Chromium 里加载打包后的扩展，对离线真机结构页
// (examples/bytedance-fixture.html) 跑 background → content → inspector/matcher/executor 全链路。
//
// 验证内容：
//   1. 扩展能被加载、content script 注入、sidepanel 页面能发消息
//   2. fill/run 在 overwrite 模式能完整回填（基本信息 / 教育 / 实习(新增卡片) / 项目 / 获奖 / 语言 / 自我评价 / 社交）
//   3. fill-empty 模式不覆盖页面已有内容
//   4. 填写过程从不点击「保存 / 取消 / 删除」
//   5. fill/undo 能撤销
//   6. 填写前自动生成备份
//
// 运行：node extension/test/browser-e2e.mjs
// 需要 dist/extension（先 node scripts/build-extension.mjs）与本机 Playwright 浏览器。

import { strict as assert } from 'node:assert';
import { createServer } from 'node:http';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const fixturePath = '/examples/bytedance-fixture.html';
const types = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function serve() {
  const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const target = resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(`${root}${sep}`)) { response.writeHead(403); response.end('forbidden'); return; }
    try {
      const body = await readFile(target);
      response.writeHead(200, { 'content-type': types[extname(target).toLowerCase()] ?? 'application/octet-stream' });
      response.end(body);
    } catch { response.writeHead(404); response.end('not found'); }
  });
  return new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', () => ok(server)); });
}

// 页面取值：按模块标题 + 卡片序号 + data-form-field-name 收集，和真机结构一致。
const collectPageState = () => {
  const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const readItem = holder => {
    const field = holder.getAttribute('data-form-field-name');
    // 下拉的搜索 input 也是 ud__native-input，但它 value 恒为空，展示值在 selectItem 里 —— 必须先排除
    const inputs = [...holder.querySelectorAll('input.ud__native-input:not([role="combobox"]), textarea')];
    if (inputs.length > 1) return [field, inputs.map(input => text(input.value))];
    if (inputs.length === 1) return [field, text(inputs[0].value)];
    const display = holder.querySelector('[class*="ud__select__selector__selectItem"]');
    if (display) return [field, text(display.textContent)];
    const tags = [...holder.querySelectorAll('.ud__select__selector__tag')];
    if (tags.length) return [field, tags.map(tag => text(tag.textContent))];
    return [field, null];
  };
  const modules = {};
  for (const module of document.querySelectorAll('[class*="applyFormModuleWrapper"]')) {
    if (module.parentElement?.closest?.('[class*="applyFormModuleWrapper"]')) continue;
    const title = text(module.querySelector('[class*="applyFormModuleWrapper-title"] [class*="applyFormModuleWrapper-text"]')?.textContent);
    const cards = [...module.querySelectorAll('[class*="apply-form-array-card__"]')];
    const collect = container => Object.fromEntries([...container.querySelectorAll('[data-form-field-name]')].map(readItem));
    modules[title] = cards.length ? cards.map(collect) : collect(module);
  }
  return { modules, submits: window.__fixtureSubmits ?? null, url: location.href };
};

const sampleResume = {
  基本信息: { 姓名: '张三', 电话区号: '+86', 手机号: '13900001111', 邮箱: 'zhangsan@example.com', 城市: '杭州' },
  教育经历: [{ 开始时间: '2018-09', 结束时间: '2022-06', 学校: '示例大学', 学历: '硕士', 专业: '软件工程' }],
  实习经历: [
    { 公司: '示例科技', 职位: '后端实习生', 开始时间: '2021-06', 结束时间: '2021-09', 描述: '实习一' },
    { 公司: '云上网络', 职位: '平台实习生', 开始时间: '2022-01', 结束时间: '2022-03', 描述: '实习二' }
  ],
  项目经历: [
    { 名称: '项目甲', 角色: '后端负责人', 开始时间: '2023-01', 结束时间: '2023-05', 链接: 'https://example.com/a', 描述: '甲描述' },
    { 名称: '项目乙', 角色: '全栈开发', 开始时间: '2023-06', 结束时间: '至今', 链接: 'https://example.com/b', 描述: '乙描述' }
  ],
  竞赛: [{ 名称: '示例竞赛一等奖', 描述: '竞赛描述一', 时间: '2023' }],
  语言能力: [{ 语言: '英语', 水平: '熟练' }],
  自我评价: { 内容: '这里是自我评价正文。' },
  社交账号: [{ 平台: 'Github', 账号: 'https://github.com/example' }]
};

async function main() {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch (error) { console.log(`SKIP (playwright unavailable: ${error.message})`); return; }
  const server = await serve();
  const base = `http://127.0.0.1:${server.address().port}`;
  const extension = await mkdtemp(resolve(tmpdir(), 'formpilot-e2e-'));
  let context;
  try {
    await cp(resolve(root, 'dist/extension'), extension, { recursive: true });
    const manifest = JSON.parse(await readFile(resolve(extension, 'manifest.json'), 'utf8'));
    manifest.host_permissions = ['http://127.0.0.1/*'];
    await writeFile(resolve(extension, 'manifest.json'), JSON.stringify(manifest));

    context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, ignoreDefaultArgs: ['--disable-extensions'], args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15000 }));
    const extensionId = new URL(worker.url()).host;

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(String(error?.message ?? error)));
    await page.goto(`${base}${fixturePath}`, { waitUntil: 'load' });
    await page.waitForFunction(() => typeof window.__fixtureSubmits === 'number');
    // content script 会把运行时版本写到 DOM 上，便于确认「页面里跑的是哪个构建」
    await page.waitForFunction(() => document.documentElement.getAttribute('data-formpilot-runtime') !== null, null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-formpilot-runtime')), '2.0.0');

    // 只读自检钩子：URL 带 #formpilot-selfcheck 时把识别结果打到控制台（不写页面）
    const selfCheckPage = await context.newPage();
    const selfCheckLogs = [];
    selfCheckPage.on('console', message => { if (/self-check/.test(message.text())) selfCheckLogs.push(message.text()); });
    await selfCheckPage.goto(`${base}${fixturePath}#formpilot-selfcheck`, { waitUntil: 'load' });
    const selfCheckDeadline = Date.now() + 20000;
    while (Date.now() < selfCheckDeadline && !selfCheckLogs.length) await new Promise(resolve => setTimeout(resolve, 200));
    assert.ok(selfCheckLogs.length > 0, '带 #formpilot-selfcheck 时应在控制台输出识别结果');
    await selfCheckPage.close();
    const initial = await page.evaluate(collectPageState);
    assert.equal(initial.submits, 0, 'fixture 初始不应有点击保存');

    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
    const tabId = await panel.evaluate(async url => {
      const tabs = await chrome.tabs.query({});
      return tabs.find(tab => tab.url === url)?.id ?? null;
    }, `${base}${fixturePath}`);
    assert.ok(Number.isInteger(tabId), '找不到 fixture 对应的 tabId');

    const send = (message) => panel.evaluate(payload => chrome.runtime.sendMessage(payload), message);

    // ---------- 1. fill-empty：不覆盖已有内容 ----------
    const emptyRun = await send({ type: 'fill/run', tabId, resume: sampleResume, mode: 'fill-empty' });
    assert.ok(Array.isArray(emptyRun?.results), `fill/run(fill-empty) 返回异常：${JSON.stringify(emptyRun)?.slice(0, 300)}`);
    assert.ok(emptyRun.results.length > 0, 'fill-empty 应该至少执行一些步骤');
    const afterEmpty = await page.evaluate(collectPageState);
    assert.equal(afterEmpty.modules['基本信息'].name, initial.modules['基本信息'].name, 'fill-empty 不允许覆盖姓名');
    assert.equal(afterEmpty.modules['基本信息'].email, initial.modules['基本信息'].email, 'fill-empty 不允许覆盖邮箱');

    // ---------- 2. overwrite：完整回填 ----------
    const run = await send({ type: 'fill/run', tabId, resume: sampleResume, mode: 'overwrite' });
    assert.ok(Array.isArray(run?.results), `fill/run 返回异常：${JSON.stringify(run)?.slice(0, 300)}`);
    assert.ok(run.summary?.ok >= 10, `成功步骤过少：${JSON.stringify(run.summary)}`);
    assert.ok(run.backup, '填写前必须生成备份');
    assert.ok(run.backups.length >= 1, '备份应被持久化');

    const after = await page.evaluate(collectPageState);
    assert.equal(after.submits, 0, '绝不能点击保存/取消/删除');
    assert.equal(after.modules['基本信息'].name, '张三');
    assert.equal(after.modules['基本信息'].email, 'zhangsan@example.com');
    assert.equal(after.modules['基本信息'].mobile, '13900001111');
    assert.deepEqual(after.modules['教育经历'][0].start_end_time, ['2018-09', '2022-06']);
    assert.equal(after.modules['教育经历'][0].school, '示例大学');
    assert.equal(after.modules['教育经历'][0].degree, '硕士');
    assert.equal(after.modules['教育经历'][0].field_of_study, '软件工程');
    assert.equal(after.modules['项目经历'][0].name, '项目甲');
    assert.equal(after.modules['项目经历'][0].link, 'https://example.com/a');
    assert.equal(after.modules['项目经历'][0].desc, '甲描述');
    assert.deepEqual(after.modules['项目经历'][1].start_end_time, ['2023-06', '至今']);
    assert.equal(after.modules['获奖'][0].date, '2023');
    assert.equal(after.modules['获奖'][0].name, '示例竞赛一等奖');
    assert.equal(after.modules['语言能力'][0].language, '英语');
    assert.equal(after.modules['语言能力'][0].proficiency, '熟练');
    assert.equal(after.modules['自我评价'].self_evaluation, '这里是自我评价正文。');
    assert.equal(after.modules['社交账号'][0].sns_type, 'Github');
    // add-item：页面原本没有实习经历卡片
    assert.equal(after.modules['实习经历'].length, 2, `实习经历卡片数应为 2，实际 ${after.modules['实习经历']?.length}`);
    assert.equal(after.modules['实习经历'][0].desc, '实习一');

    // ---------- 3. 撤销 ----------
    const undone = await send({ type: 'fill/undo', tabId });
    assert.ok(undone && typeof undone === 'object', 'fill/undo 返回异常');
    const afterUndo = await page.evaluate(collectPageState);
    assert.equal(afterUndo.submits, 0, '撤销也不能点保存');
    assert.equal(afterUndo.modules['基本信息'].name, initial.modules['基本信息'].name, '撤销后姓名应恢复原值');

    // ---------- 4. 侧边栏 UI：渲染 + 用 UI 自己的按钮完成一次填写 ----------
    // 这一步覆盖「面板 → background → content」的真实消息链路，以及
    // resume/analyze（MV3 service worker 禁止动态 import，必须用静态 import）。
    const panelErrors = [];
    panel.on('pageerror', error => panelErrors.push(String(error?.message ?? error)));
    panel.on('console', message => { if (message.type() === 'error') panelErrors.push(`console: ${message.text()}`); });

    const analyze = await panel.evaluate(payload => chrome.runtime.sendMessage(payload), { type: 'resume/analyze', resume: sampleResume });
    assert.ok(analyze?.index, `resume/analyze 必须返回简历索引（MV3 service worker 不能用动态 import）：${JSON.stringify(analyze)?.slice(0, 200)}`);
    assert.ok(Array.isArray(analyze.index.items?.project) && analyze.index.items.project.length === 2, 'resume/analyze 应识别出 2 条项目经历');

    // 让 fixture 成为窗口 active tab，再重载面板 —— 面板初始化会自己取当前 tab
    await page.bringToFront();
    await panel.reload();
    // 扩展页面的 CSP 是 `script-src 'self'`，Playwright 的 waitForFunction 会用 eval 轮询而被拒绝，
    // 所以这里自己轮询（panel.evaluate 走 CDP，不受 CSP 限制）。
    const panelWaitFor = async (predicate, timeout = 30000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        if (await panel.evaluate(predicate)) return true;
        await new Promise(resolve => setTimeout(resolve, 200));
      }
      return false;
    };
    assert.ok(await panelWaitFor(() => Boolean(document.querySelector('#page-card'))), '侧边栏页面应完成渲染');
    assert.ok(await panelWaitFor(() => /\d/.test(String(document.querySelector('#page-controls')?.textContent || ''))), '侧边栏应自动读取到页面控件');

    const uiState = () => panel.evaluate(() => {
      const textOf = selector => { const node = document.querySelector(selector); return node ? String(node.textContent || '').replace(/\s+/g, ' ').trim() : null; };
      return {
        cards: ['#resume-card', '#page-card', '#review-card'].filter(selector => document.querySelector(selector)).length,
        pageControls: textOf('#page-controls'),
        pageStats: textOf('#page-stats'),
        resumeStats: textOf('#resume-stats'),
        matchRows: document.querySelectorAll('#match-rows tr').length,
        fillEmptyChecked: Boolean(document.querySelector('#fill-empty')?.checked),
        firstRow: [...(document.querySelector('#match-rows tr')?.children ?? [])].map(cell => String(cell.textContent).replace(/\s+/g, ' ').trim().slice(0, 20)),
        i18nLeaks: [...document.querySelectorAll('[data-i18n]')].filter(node => /^[a-zA-Z]+$/.test(String(node.textContent || '').trim())).length
      };
    });

    const beforeUi = await uiState();
    assert.equal(beforeUi.cards, 3, '三张卡片都要渲染');
    assert.ok(/^\d+$/.test(String(beforeUi.pageControls)), `控件数应已读取：${beforeUi.pageControls}`);
    assert.match(String(beforeUi.pageStats), /检测到 11 个分区/, `分区统计异常：${beforeUi.pageStats}`);
    assert.equal(beforeUi.fillEmptyChecked, true, '「只填空白」默认必须开启');
    assert.equal(beforeUi.i18nLeaks, 0, 'UI 不应出现未翻译的 i18n key');

    // 用 UI 载入简历 → 应用 → 切到覆盖模式 → 开始填写
    const uiResume = { ...sampleResume, 基本信息: { ...sampleResume.基本信息, 姓名: '李四', 邮箱: 'lisi@example.com' } };
    await page.bringToFront();
    await panel.evaluate(json => {
      const area = document.querySelector('#resume-json');
      area.value = json;
      area.dispatchEvent(new Event('input', { bubbles: true }));
    }, JSON.stringify(uiResume, null, 2));
    await panel.click('#resume-apply');
    assert.ok(await panelWaitFor(() => document.querySelectorAll('#match-rows tr').length > 10, 25000), '应用简历后应渲染匹配表');

    const afterApply = await uiState();
    assert.ok(afterApply.matchRows > 10, `匹配表应有数据行，实际 ${afterApply.matchRows}`);
    assert.match(String(afterApply.resumeStats), /项目经历/, `简历卡片应显示识别结果：${afterApply.resumeStats}`);
    assert.ok(afterApply.firstRow.length === 7, `匹配表应有 7 列，实际 ${afterApply.firstRow.length}`);

    await panel.click('#fill-empty');                       // 切到覆盖模式
    await page.bringToFront();
    await panel.click('#fill-start');
    // 注意：计划阶段的 #summary 也会显示「可填 N …」，必须等真正的执行结果（含「成功」）且进度条收起。
    assert.ok(await panelWaitFor(() => {
      const summary = String(document.querySelector('#summary')?.textContent || '');
      const progress = document.querySelector('#fill-progress');
      const running = Boolean(progress && !progress.hidden && /正在填写/.test(String(progress.textContent || '')));
      const fillButton = String(document.querySelector('#fill-start')?.textContent || '');
      return !running && /成功/.test(summary) && !/正在填写/.test(fillButton);
    }, 90000), '点击「开始填写」后应出现执行结果汇总');

    const uiAfterRun = await panel.evaluate(() => ({
      backupStatus: String(document.querySelector('#backup-status')?.textContent || '').replace(/\s+/g, ' ').trim(),
      saveReminder: String(document.querySelector('.save-reminder')?.textContent || '').replace(/\s+/g, ' ').trim(),
      reviewBadge: String(document.querySelector('#review-badge')?.textContent || '').trim()
    }));
    assert.match(uiAfterRun.backupStatus, /最近备份/, `填写后应显示自动备份：${uiAfterRun.backupStatus}`);
    assert.ok(/保存/.test(uiAfterRun.saveReminder), 'UI 必须提示用户自己点保存');
    assert.match(uiAfterRun.reviewBadge, /成功 \d+\/\d+/, `结果徽标应显示成功计数：${uiAfterRun.reviewBadge}`);

    const afterUiFill = await page.evaluate(collectPageState);
    const uiRunDebug = await panel.evaluate(() => ({
      summary: String(document.querySelector('#summary')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300),
      progress: String(document.querySelector('#fill-progress')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      globalStatus: String(document.querySelector('#global-status')?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200),
      reviewBadge: String(document.querySelector('#review-badge')?.textContent || '').trim(),
      modeChecked: Boolean(document.querySelector('#fill-empty')?.checked),
      errors: []
    }));
    if (process.env.FORMPILOT_DEBUG) console.log('UI run debug:', JSON.stringify(uiRunDebug, null, 1));
    assert.equal(afterUiFill.submits, 0, '通过 UI 填写也绝不能点保存/取消');
    assert.equal(afterUiFill.modules['基本信息'].name, '李四', `UI 填写应把姓名写成简历里的值（摘要：${uiRunDebug.summary}｜进度：${uiRunDebug.progress}｜状态：${uiRunDebug.globalStatus}）`);
    assert.equal(afterUiFill.modules['基本信息'].email, 'lisi@example.com');
    assert.equal(afterUiFill.modules['项目经历'][0].name, '项目甲');
    assert.deepEqual(panelErrors, [], `侧边栏脚本报错：${panelErrors.join(' | ')}`);

    // ---------- 5. 恢复备份：把 UI 填写前的值写回去 ----------
    // 面板用 window.confirm 二次确认；Playwright 默认会自动 dismiss，这里显式接受。
    panel.on('dialog', dialog => dialog.accept());
    await page.bringToFront();
    await panel.click('#backup-restore');
    assert.ok(await panelWaitFor(() => {
      const progress = document.querySelector('#fill-progress');
      const globalStatus = String(document.querySelector('#global-status')?.textContent || '');
      return Boolean(progress?.hidden) && /恢复/.test(globalStatus);
    }, 30000), '恢复备份后进度条应收起并给出「已恢复」提示');
    const restored = await page.evaluate(collectPageState);
    assert.equal(restored.submits, 0, '恢复备份也不能点保存');
    assert.equal(restored.modules['基本信息'].name, initial.modules['基本信息'].name, '恢复备份应把姓名写回填写前的值');

    assert.deepEqual(pageErrors, [], `页面脚本报错：${pageErrors.join(' | ')}`);
    console.log('PASS browser-e2e: 扩展加载 / fill-empty 不覆盖 / overwrite 全回填 / add-item / 撤销 / 从未点保存 / 侧边栏 UI 全链路');
  } finally {
    await context?.close();
    await new Promise(ok => server.close(ok));
    await rm(extension, { recursive: true, force: true });
  }
}

try { await main(); } catch (error) { console.log(`FAIL (browser-e2e): ${error?.stack ?? error}`); process.exitCode = 1; }
