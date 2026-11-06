# Changelog

## 0.3.0 — 2026-11-06

首个公开发布版本。扩展侧边栏可完成「备份 → 检查 → 规划 → 填写 → 撤销」全链路，默认只填空白、永不点击保存/提交。

### Fill engine v2 — 针对真实招聘页（字节跳动「编辑简历」）重写

- **分区 + 可重复条目匹配**：检查器识别 11 个模块与卡片式条目（`itemIndex`），匹配严格限制在「分区 + 条目」作用域内，教育/竞赛数据不会再串进项目经历；字段优先取页面自带的 `data-form-field-name`。
- **自定义下拉真正可用**：展示值改从 `.ud__select__selector__selectItem` 读取（`input.value` 恒为空，旧实现因此全部判为失败），选项按 `.ud__select__list__item` 文本匹配，关闭状态按可见性判断。
- **日期控件**：起止时间是两个普通 text input，直接写 `YYYY-MM`（结束可写「至今」）；获奖年份截成 4 位年份。
- **安全性**：填写前自动备份页面快照（保留 5 份）并可一键恢复；默认为「只填空白」，页面已有不同内容的字段标记为冲突且不覆盖；双层动作守卫保证永不点击 保存/提交/取消/删除；每次写入都读回校验；步骤带分区/条目/指纹交叉校验，避免编号位移写错控件。
- **侧边栏审核 UI**：三张中文卡片（简历数据 / 当前页面 / 匹配结果），匹配表含来源路径、当前值、目标值、状态与置信度，冲突高亮，敏感值掩码。
- **修复 MV3 限制导致的静默失败**：background 里的 `import('./core/resume-index.mjs')` 在 service worker 中被规范禁止（`import() is disallowed on ServiceWorkerGlobalScope`），导致 `resume/analyze` 永远返回空、侧边栏显示「无法识别简历结构」。改为顶层静态 import，并在构建脚本里加了「禁止动态 import / 校验相对 import 都已打包」的守护。
- **真机勘察与验证**：新增 `docs/recon/bytedance-resume-edit.md`（真实 DOM 结构、字段清单、下拉/日期/添加按钮实测）与 `docs/specs/2026-11-05-fill-engine-v2.md`（引擎契约）；在真实 Chromium 里加载扩展跑通「备份 → 检查 → 规划 → 填写 → 撤销 → 恢复备份」全链路，并断言从未点击保存。
- **修复「重载扩展后侧边栏连不上页面」**：扩展重载会让已打开标签页里的 content script 失效，`chrome.tabs.sendMessage` 报 `Receiving end does not exist`。现在后台会先判断标签页能否注入、再自动补注入并重试一次，仍失败时返回稳定错误码（`unsupported-page` / `content-unavailable`），侧边栏把它翻译成可操作的中文提示（切换页面 / 按 F5 刷新），不再直接抛英文原文。
- **content script 版本标记 + 只读自检**：`<html data-formpilot-runtime="2.0.0">` 可确认页面里跑的是哪个构建；URL 加 `#formpilot-selfcheck` 会在控制台打印识别结果（分区/控件/字段/动作/匹配摘要），不写入任何字段。
- **简历字段补全**：`工作年限` 现在识别为 `basic.workYears`，不再出现在「未识别字段」里；「缺少的常见必填项」标题只在真的有缺失时显示。
- 新增 `examples/bytedance-fixture.html`（按真机结构复刻的离线测试页）、`extension/test/support/dom-twin.mjs`（零依赖 DOM 替身）、`extension/test/fill-e2e.test.mjs`（inspect→plan→execute 集成测试）与 `extension/test/browser-e2e.mjs`（真实浏览器端到端）。
- 新增 `docs/RESUME-SCHEMA.md`、`docs/ACCEPTANCE.md`、`scripts/export-page-model.js`（只读采集页面结构）、`scripts/build-engine-bundle.mjs` + `scripts/live-check.mjs`（引擎 bundle 与真机只读体检）、`scripts/serve.mjs`（本地 fixture 服务器）。
- 删除过时的 `extension/test/browser-smoke.mjs` 与 `extension/test/fixture-structure.mjs`（由新的端到端测试取代）。

### 早期改动（一并纳入本次发布）

- Added browser regression coverage for a generic text field, a custom combobox, validation failures, dynamic structure changes, refresh invalidation, undo, and the no-submit guarantee.
- Expanded the local fixture with repeatable sections, validation errors, and structure-change controls.
- Documented the local AI boundary, reusable control capabilities, validated strategy cache, and safe fallback path when a local model is unavailable.
- Added an isolated Playwright browser smoke workflow for the local fixture: scan, review, fill, verify, and undo.
- Added deterministic unavailable reporting when Playwright or Chromium is not installed.
- Clarified Side Panel use, local model fallback, confidence/manual states, and iframe, Shadow DOM, and complex multiselect boundaries.

- Switched the project license from MIT to Apache License 2.0.
- Added a review-first popup redesign with Chinese, English, Japanese, and Korean UI text.
- Added light, dark, and system theme settings.
- Added a language-neutral free-form JSON resume model.
- Added local fixtures for editor sections, native select controls, and reversible fills.

## 0.1.0

- Initial Manifest V3 extension scaffold.
- Deterministic field matching and saved user mappings.
- Reversible fill runtime and local test coverage.
