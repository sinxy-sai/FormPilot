# Local test fixtures

Open `form-fixture.html` directly in a browser or serve the repository with a local static server. It intentionally models common hiring-form obstacles:

- content hidden behind an Edit button;
- save/cancel interactions;
- native `<select>` controls with a value different from visible text;
- multiple sections and a textarea;
- no personal data or login state.

The saved BOSS page and its downloaded resources are kept only as local reference material. A saved authenticated page is not a reliable fixture: it depends on cookies, API responses, client-side routing, and private data. A `file://` copy can therefore redirect, render blank, or return to a homepage.

The fixture is intentionally separate from BOSS implementation and does not depend on cookies, API responses, private data, or production selectors.

## 验证“个人优势”改成“个人评价”

当前示例 JSON 故意使用 `custom.personalAdvantages`，测试页使用“个人评价”，所以第一次检查时该字段会显示为未匹配。

在插件 Popup 中：

1. 点击 `1. Load resume.json`，选择本目录的 `resume.json`。
2. 在 `Resume JSON` 文本框中把：

   ```json
   "personalAdvantages": "善于协作，能够快速学习新技术并持续改进工具。"
   ```

   改成：

   ```json
   "personalEvaluation": "善于协作，能够快速学习新技术并持续改进工具。"
   ```

3. 点击“应用 JSON 修改”。
4. 点击 `2. Inspect form`，这时“个人评价”会自动匹配到 `custom.personalEvaluation`。
5. 检查字段后点击 `3. Fill reviewed fields`。

如果只想改某一个网页字段，不改 JSON，也可以直接在匹配结果中编辑 `resume path` 和最终 `value`。

## 如果 Edge 提示插件无法读取本地文件

打开 `edge://extensions`，找到 FormPilot，点击“详细信息”，打开“允许访问文件 URL”。然后刷新 `form-fixture.html`。也可以在 `examples/` 目录启动静态服务器后访问 `http://localhost:8000/form-fixture.html`。
