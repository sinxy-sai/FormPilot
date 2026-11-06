<div align="center">

# FormPilot

**Less repetition. More opportunity.**

<img src="docs/assets/formpilot-icon.svg" alt="FormPilot icon" width="112">

<p><a href="#installation">🚀 Get Started</a> · <a href="#usage">▶️ Use</a> · <a href="#tests">🧪 Test</a> · <a href="docs/ARCHITECTURE.md">📚 Documentation</a> · <a href="CONTRIBUTING.md">🤝 Contribute</a></p>

<a href="LICENSE"><img src="https://img.shields.io/badge/license-Apache--2.0-315BEA?style=flat-square" alt="Apache-2.0 License"></a>
<a href="https://developer.chrome.com/docs/extensions/develop/"><img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Manifest V3"></a>
<a href="https://developer.mozilla.org/docs/Web/JavaScript/Guide/Modules"><img src="https://img.shields.io/badge/JavaScript-ESM-F7DF1E?style=flat-square&logo=javascript&logoColor=111827" alt="JavaScript ESM"></a>
<a href="https://pnpm.io/workspaces"><img src="https://img.shields.io/badge/pnpm-workspace-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm workspace"></a>
<a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 20 or later"></a>

**简体中文** · English

</div>

> Turn one structured resume into a polished starting point for every application.

FormPilot reads the form that is already open in your browser, matches its fields against a local structured resume, lets you correct uncertain mappings, and fills the page only after review. It keeps the resume source independent from the PDF layout produced by your LaTeX workflow.

Built for the repetitive part of applying: bring your resume once, adapt it to the language and shape of each form, and stay in control before anything is written.

## ✨ Overview

FormPilot is designed for job applications where every recruiting site names and renders fields differently. The core data model is intentionally language-neutral: JSON keys can be Chinese, English, Japanese, Korean, or any Unicode text. The local runtime builds a page model, maps resume candidates, and plans constrained browser actions without site-specific compatibility code.

The browser extension does not submit applications, solve CAPTCHA, bypass authentication, or invent fields and options. It reads the controls provided by the current page, prepares a fill plan, and leaves the final review and submission to you.

<table><tr><td><strong>🧩 Interface</strong></td><td>Chrome and Edge Manifest V3 extension</td></tr><tr><td><strong>🗂 Resume source</strong></td><td>User-defined JSON; LaTeX/PDF remains the presentation source</td></tr><tr><td><strong>🌐 UI languages</strong></td><td>中文、English、日本語、한국어</td></tr><tr><td><strong>🎨 Themes</strong></td><td>Light, dark, and system</td></tr><tr><td><strong>🔒 Privacy</strong></td><td>Resume data stays in browser local storage unless you choose otherwise</td></tr><tr><td><strong>📄 License</strong></td><td><a href="LICENSE">Apache-2.0 License</a></td></tr></table>

> ⚠️ FormPilot is an independent learning and automation project. It is not affiliated with, sponsored by, or endorsed by any recruiting platform.

## 🚀 Features

- 🔍 Inspects fields already present on the active page, including custom design-system dropdowns and repeatable sections.
- 📝 Loads and edits a free-form JSON resume directly in the extension.
- 🌍 Matches user-defined Chinese, English, Japanese, Korean, or mixed-language keys.
- 🧭 Detects page sections and repeatable entries so records never cross-contaminate (education data cannot land in the project list).
- 🎛 Handles text inputs, textareas, checkbox toggles, custom dropdowns, and month/date text fields.
- ✅ Shows current value, target value, source path, status, and confidence for every proposed match.
- 🛡 Never overwrites an existing, different value unless you explicitly switch to overwrite mode.
- 💾 Backs up the page's current resume before the first write (last 5 kept) and can restore it.
- ↩️ Reverses the last fill operation.
- 🚫 Never clicks Save, Submit, Delete, or any button that writes to the server — finishing stays with you.
- 🌓 Supports light, dark, and system themes.
- 🗣 Supports Chinese, English, Japanese, and Korean UI text.
- 🧪 Ships with an offline fixture that mirrors a real recruiting form, a dependency-free DOM twin, and a real-Chromium end-to-end test.

## 🛠 Technology stack

| Layer | Technology |
| --- | --- |
| Browser extension | Chrome/Edge Manifest V3 |
| UI | Semantic HTML, CSS custom properties, vanilla JavaScript |
| Runtime | JavaScript ESM in the extension and Node.js 20+ for tests |
| Workspace | pnpm workspace |
| Resume data | Free-form JSON with Unicode keys |
| Planning | Local page model, constrained AI tools, verified strategy cache |
| DOM runtime | Content script with reversible fill operations |
| Verification | Node built-in test runner and syntax checks |
| Runtime extension model | Reusable control capabilities + validated strategy cache + local AI planning loop |

<a id="installation" name="installation"></a>

## 🔨 Installation

Build the extension, then load the generated directory as an unpacked extension.

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. From the repository root, run `pnpm build`.
4. Select **Load unpacked** and choose the repository's `dist/extension/` directory.
5. For local `file:///` fixtures, open the extension details and enable **Allow access to file URLs**.
6. Open the extension's **Side Panel** from the toolbar (or the extension details page) and refresh the test page after source changes.

For local-only development, keep the model setting disabled unless you have explicitly enabled a compatible local model and accepted its storage/download cost. This repository does not ship model weights, and the default configuration does not download them. When the local model is unavailable, FormPilot falls back to constrained rules and manual review; the primary planning path is the local AI runtime.

<a id="usage" name="usage"></a>

## ▶️ Usage

Open a form page, click the FormPilot toolbar icon to open the Side Panel, then follow the three cards:

1. **简历数据 / Resume data** — load a JSON file (see [docs/RESUME-SCHEMA.md](docs/RESUME-SCHEMA.md)) or paste it. The panel shows which sections and how many entries were recognized, plus the common required fields your JSON is missing.
2. **当前页面 / Current page** — shows the page fingerprint, control count, and every detected section with its repeatable item count. **备份当前简历 / Back up this resume** stores the current page values before anything is written; **恢复上一次备份 / Restore last backup** writes them back.
3. **匹配结果 / Review matches** — a row per field: page label, resume source path, current value, target value, status (`ready` / `conflict` / `skipped` / `unsupported` / `manual`) and confidence. Conflicts (page already has different content) are never overwritten while **只填空白 / Fill empty fields only** is on. **开始填写 / Fill** then **撤销本轮 / Undo**.

Safety rules that are enforced in code, not by convention:

- The final **Save / Submit / Delete** buttons are never clicked — finishing the application stays your job.
- Every write is read back and verified; a failed field stays explicitly `failed` / `manual` with a reason instead of being silently skipped.
- A page snapshot is taken automatically before the first write (last 5 kept per page) and can be restored.
- Matching is scoped by section **and** repeatable item, so education data can never land in the project list. This boundary was calibrated against a real recruiting site's resume editor.

Text inputs, textareas, custom dropdowns (including design-system comboboxes such as `ud__select`-style widgets), month/date text fields, and checkboxes are the reliable first-stage boundary. Unknown select options, read-only pickers, file uploads, and structural toggles like「没有工作经历」remain manual on purpose.

<a id="tests" name="tests"></a>

## 🧪 Tests

```powershell
pnpm test                 # 单元 + 集成测试（node:test，不需要浏览器）
pnpm build                # 生成 dist/extension
pnpm test:browser         # 在真实 Chromium 里加载打包后的扩展跑端到端（需要本机 Playwright）
pnpm validate:locales
```

`pnpm test:browser` 会启动一个带扩展的 Chromium，对 `examples/bytedance-fixture.html`（按真实页面结构复刻的离线页）跑完整链路：备份 → 检查 → 规划 → 填写 → 撤销，并断言保存/取消/删除按钮从未被点击。

浏览器行为无法在本机沙箱里模拟时，`extension/test/support/dom-twin.mjs` 提供了一套零依赖的 DOM 替身（含 `.ud__select` 自定义下拉、虚拟列表、可重复卡片、年份选择器），单元测试与集成测试都基于它运行。

Open the local fixture for a manual browser check:

```powershell
node scripts/serve.mjs 8123    # http://127.0.0.1:8123/examples/bytedance-fixture.html
```

在真实招聘网站上验证时，先用只读方式导出页面结构，核对识别结果后再决定是否真正填写：

- `scripts/export-page-model.js`：在 `DevTools → Console` 里粘贴，导出控件标签/类型/选项/分区结构（输入值默认只保留前 4 个字符）。
- `scripts/build-engine-bundle.mjs` + `scripts/live-check.mjs`：把引擎打成自包含 bundle，在真实页面里只读跑 `inspect → plan`，核对匹配质量后再决定是否真正填写。



Cross-origin iframe controls are only inspected when the page grants the required extension frame access; closed shadow roots and browser-restricted widgets remain manual boundaries. Reusable control capabilities cover native selects, custom comboboxes, repeatable sections, and other interaction patterns. A validated strategy cache can provide locating hints without storing sensitive field values; navigation, refresh, or a structure fingerprint change invalidates stale plans.

The optional local AI loop is limited to page understanding and read-only suggestions. It is **not** on the critical path: deterministic section/item matching, capability handlers, and the review table are enough to complete the safe fields. Final submission, CAPTCHA, login restrictions, and actions without an observable result never have an automatic path.

## 📁 Project structure

```text
.
├── extension/                  # Manifest V3 extension with Side Panel and local runtime
├── packages/latex-parser/      # LaTeX synchronization boundary
├── packages/resume-schema/     # Open JSON schema contract
├── examples/                   # Local fixtures and sample resume JSON
├── docs/                       # Architecture, mappings, roadmap, assets
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── GOVERNANCE.md
├── SECURITY.md
├── SUPPORT.md
├── CHANGELOG.md
└── LICENSE
```

## 📚 Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Resume JSON format](docs/RESUME-SCHEMA.md)
- [Security and privacy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Changelog](CHANGELOG.md)

### Localization assets

Side Panel copy lives in `extension/locales/<locale>/messages.json`, with English (`en-US`) as the fallback locale. Each message keeps a human-readable `description` beside its translated `message`, following the same contributor-friendly principle used by large localized products such as [VS Code Loc](https://github.com/microsoft/vscode-loc).

To add or update a translation:

1. Copy the key set from `extension/locales/en-US/messages.json`.
2. Translate only the `message` values; keep placeholders such as `{0}` unchanged.
3. Run `pnpm validate:locales` before opening a pull request.
4. Add a note to `CHANGELOG.md` when the translation changes user-visible wording.

## 🤝 Community

Bug reports, fixture improvements, translations, and control capability ideas are welcome. Remove personal resumes, cookies, tokens, and private recruiting data before opening an issue or pull request.

## 📄 License

FormPilot is licensed under the [Apache License 2.0](LICENSE).


<!-- Community files: CODE_OF_CONDUCT.md, GOVERNANCE.md, SUPPORT.md -->

