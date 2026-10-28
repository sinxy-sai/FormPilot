# 本地测试夹具

测试页：`form-fixture.html`

## 简历语言

- 中文简历：`resume.zh-CN.json`（`resume.json` 也是中文版本）
- English resume: `resume.en-US.json`

中文简历使用中文字段名，英文简历使用英文字段名。插件会先根据网页标签查找 JSON 中实际存在的同名键，再使用内置兼容别名。

## 测试中文字段重命名

1. 打开 `form-fixture.html`。
2. 加载 `resume.json`。
3. 在 Popup 的 JSON 编辑器中把 `自定义字段.个人优势` 改成 `自定义字段.个人评价`。
4. 点击“应用 JSON 修改”。
5. 点击“检查网页表单”。
6. “个人评价”应匹配到 `自定义字段.个人评价`。
7. 点击“填充审核后的字段”。

## 测试英文简历

加载 `resume.en-US.json`。英文页面字段应使用 English labels，例如 `Full Name`、`Email`、`Personal Evaluation`。

## 本地文件权限

打开 `edge://extensions`，找到 FormPilot，点击“详细信息”，打开“允许访问文件 URL”，然后刷新测试页。保存的 BOSS 页面不适合作为 fixture，因为它依赖登录 Cookie、接口数据和前端路由。
