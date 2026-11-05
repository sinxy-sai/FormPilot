# 示例与测试夹具

这个目录只放**可以公开提交**的示例数据；带个人信息的真实简历/页面抓取已被 `.gitignore` 排除。

| 文件 | 用途 | 能否提交 |
| --- | --- | --- |
| `resume.json` | 完整的演示简历（虚构人物「林知远」，覆盖基本信息 / 求职意向 / 教育 / 实习 / 项目 / 竞赛 / 语言 / 自我评价 / 社交账号）。字段写法见 [`docs/RESUME-SCHEMA.md`](../docs/RESUME-SCHEMA.md)。 | ✅ 可以 |
| `bytedance-fixture.html` | 按真实「字节跳动 编辑简历」页面结构复刻的**离线**测试页：11 个模块、可重复卡片、`ud__select` 自定义下拉、日期区间、年份选择器、添加/删除、底部保存/取消（只计数不提交、不联网）。`pnpm test:browser` 与页面结构测试都用它。 | ✅ 可以 |
| `form-fixture.html` | 早期通用表单夹具（原生 select、自定义 combobox、重复分区等），保留给通用回归用。 | ✅ 可以 |
| `bytedance-resume-backup.json` | 从本人真实简历页面导出的数据，**含个人隐私**，仅本地使用。 | ❌ 已被 `.gitignore` 排除 |

## 隐私约定

- `examples/*bytedance*` 默认被忽略，只放行手写的 `bytedance-fixture.html`；
- 抓取到的真实页面数据、真实简历都不要提交；仓库里的 fixture 一律使用虚构数据；
- 提交前可自查：`git status --short` 里不应出现 `*-backup.json` 之类的文件。

## 本地查看 fixture

```powershell
node scripts/serve.mjs 8123
# 然后打开 http://127.0.0.1:8123/examples/bytedance-fixture.html
```

## 在真实站点上做只读体检

1. 打开简历编辑页 → `F12` 控制台 → 粘贴 `scripts/export-page-model.js`，导出控件/分区结构（输入值只保留前 4 个字符）；
2. 或在页面地址后加 `#formpilot-selfcheck`，扩展会把识别结果打印到控制台并写到 `<html data-formpilot-selfcheck>` 上（只读，不写入）。
