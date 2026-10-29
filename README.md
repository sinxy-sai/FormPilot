<div align="center">

# FormPilot

**Language-neutral, review-first autofill for job application forms.**

<img src="docs/assets/formpilot-icon.svg" alt="FormPilot icon" width="112">

<p><a href="#installation">🚀 Get Started</a> · <a href="#usage">▶️ Use</a> · <a href="#tests">🧪 Test</a> · <a href="docs/ARCHITECTURE.md">📚 Documentation</a> · <a href="CONTRIBUTING.md">🤝 Contribute</a></p>

<a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-315BEA?style=flat-square" alt="MIT License"></a>
<a href="https://developer.chrome.com/docs/extensions/develop/"><img src="https://img.shields.io/badge/Manifest-V3-4285F4?style=flat-square&logo=googlechrome&logoColor=white" alt="Manifest V3"></a>
<a href="https://developer.mozilla.org/docs/Web/JavaScript/Guide/Modules"><img src="https://img.shields.io/badge/JavaScript-ESM-F7DF1E?style=flat-square&logo=javascript&logoColor=111827" alt="JavaScript ESM"></a>
<a href="https://pnpm.io/workspaces"><img src="https://img.shields.io/badge/pnpm-workspace-F69220?style=flat-square&logo=pnpm&logoColor=white" alt="pnpm workspace"></a>
<a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=flat-square&logo=nodedotjs&logoColor=white" alt="Node.js 20 or later"></a>

**简体中文** · English

</div>

> One resume JSON in, one reviewable form draft out.

FormPilot reads the form that is already open in your browser, matches its fields against a local structured resume, lets you correct uncertain mappings, and fills the page only after review. It keeps the resume source independent from the PDF layout produced by your LaTeX workflow.

## ✨ Overview

FormPilot is designed for job applications where every recruiting site names and renders fields differently. The core data model is intentionally language-neutral: JSON keys can be Chinese, English, Japanese, Korean, or any Unicode text. The matcher first looks for keys that actually exist in the loaded JSON, then falls back to compatibility aliases for older resume formats.

The browser extension does not submit applications, solve CAPTCHA, bypass authentication, or invent fields and options. It reads the controls provided by the current page, prepares a fill plan, and leaves the final review and submission to you.

<table><tr><td><strong>🧩 Interface</strong></td><td>Chrome and Edge Manifest V3 extension</td></tr><tr><td><strong>🗂 Resume source</strong></td><td>User-defined JSON; LaTeX/PDF remains the presentation source</td></tr><tr><td><strong>🌐 UI languages</strong></td><td>中文、English、日本語、한국어</td></tr><tr><td><strong>🎨 Themes</strong></td><td>Light, dark, and system</td></tr><tr><td><strong>🔒 Privacy</strong></td><td>Resume data stays in browser local storage unless you choose otherwise</td></tr><tr><td><strong>📄 License</strong></td><td><a href="LICENSE">MIT License</a></td></tr></table>

> ⚠️ FormPilot is an independent learning and automation project. It is not affiliated with, sponsored by, or endorsed by any recruiting platform.

## 🚀 Features

- 🔍 Inspects fields already present on the active page.
- 📝 Loads and edits a free-form JSON resume directly in the extension.
- 🌍 Matches user-defined Chinese, English, Japanese, Korean, or mixed-language keys.
- 🧭 Opens nearby Edit sections before reading dynamic fields.
- 🎛 Handles text inputs, textareas, and native select options by value or visible text.
- ✅ Shows confidence and source for each proposed match.
- ↩️ Reverses the last fill operation.
- 🌓 Supports light, dark, and system themes.
- 🗣 Supports Chinese, English, Japanese, and Korean UI text.
- 🧪 Ships with local fixtures for hidden editors, select controls, and review flows.

## 🛠 Technology stack

| Layer | Technology |
| --- | --- |
| Browser extension | Chrome/Edge Manifest V3 |
| UI | Semantic HTML, CSS custom properties, vanilla JavaScript |
| Runtime | JavaScript ESM in the extension and Node.js 20+ for tests |
| Workspace | pnpm workspace |
| Resume data | Free-form JSON with Unicode keys |
| Matching | Deterministic key matching, saved mappings, compatibility aliases |
| DOM runtime | Content script with reversible fill operations |
| Verification | Node built-in test runner and syntax checks |
| Future adapter layer | Site-specific interaction adapters for custom dropdowns and dynamic widgets |

## 🔨 Installation

FormPilot is currently distributed as an unpacked development extension.

1. Open `edge://extensions` or `chrome://extensions`.
2. Enable **Developer mode**.
3. Select **Load unpacked**.
4. Choose the repository's `extension/` directory.
5. For local `file:///` fixtures, open the extension details and enable **Allow access to file URLs**.
6. Reload the extension and refresh the test page after source changes.

## ▶️ Usage

Open a form page, click the FormPilot toolbar icon, then follow the three cards:

1. **Resume data** — load `examples/resume.json` or paste your own JSON. Edit keys and values directly, then choose **Apply and rematch**.
2. **Current page** — choose **Inspect form**. FormPilot reads the page's existing controls and attempts to open nearby Edit sections.
3. **Review matches** — verify the JSON path and final value. Correct uncertain fields before choosing **Fill reviewed fields**.

The extension never clicks the website's final Submit button. For a custom widget that cannot be filled, the result reports the skipped reason so you can select it manually or add a site adapter.

## 🧪 Tests

Run the complete test suite from the repository root:

```powershell
node --test packages/*/test/*.test.mjs extension/test/*.test.mjs
```

Check JavaScript syntax:

```powershell
node --check extension/popup.js
node --check extension/src/content.js
```

Open the local fixture for a manual browser check: `examples/form-fixture.html`.

The fixture contains intentionally fake data and models hidden Edit sections, native selects, textareas, and a personal evaluation field. It does not reproduce a logged-in recruiting site.

## 📁 Project structure

```text
.
├── extension/                  # Manifest V3 extension and popup
├── packages/field-matcher/     # Language-neutral JSON key matching
├── packages/form-runtime/      # Reversible DOM fill operations
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
- [Field mappings](docs/FIELD-MAPPINGS.md)
- [Roadmap](docs/ROADMAP.md)
- [Security and privacy](SECURITY.md)
- [Contributing](CONTRIBUTING.md)
- [Support](SUPPORT.md)
- [Changelog](CHANGELOG.md)

## 🤝 Community

Bug reports, fixture improvements, translations, and site-adapter ideas are welcome. Remove personal resumes, cookies, tokens, and private recruiting data before opening an issue or pull request.

## 📄 License

FormPilot is licensed under the [MIT License](LICENSE).


<!-- Community files: CODE_OF_CONDUCT.md, GOVERNANCE.md, SUPPORT.md -->

