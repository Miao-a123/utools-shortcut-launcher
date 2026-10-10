# 变更记录

> 倒序，最新在最上。
> 每条包含四要素：**问题 / 修复 / 理由（含被否决的替代方案）/ 验证**。
> 未经真机验证的改动会显式标注「未验证」。
>
> 插件内置的用户可见更新日志在 `js/dialogs.js` 的 `CHANGELOG` 常量里（设置 → 更新日志）。

---

## v1.5.0 — 上架前准备（2026-10-10，commit `3ba2564`）

### 问题

准备提交 uTools 插件应用市场，需要按官方规范做合规自查。核对 `u-tools.cn` 开发者文档后，发现本项目有 5 处会在审核时踩线：

1. `features[1]`（`launcher-add`）的两条 `files` 指令都写了 `"match": "/.+/"`。官方 plugin.json 文档明确「任意匹配的正则会被 uTools 忽视，例如 `/.*/`、`/(.)+/`、`/[\s\S]*/`」——也就是说这两条匹配规则实际上根本没生效。
2. `features[0].cmds` 里塞了 `launcher`、`shortcut`、`kl`。规范要求功能指令「简短、明确、唯一；禁止无意义、重复或模糊名称」，且中文指令本就自动支持拼音与首字母，`kl` 属于手配的无效缩写，`launcher`/`shortcut` 是通用英文词。
3. `features[2]` 的 regex `/^https?:\/\//` 前缀匹配过宽，没有 `maxLength`。
4. 官方 FAQ「发布时的资源清洁」要求发布目录不得含 `.git/`、`.gitignore`、`.vm/`、`*.map` 等；而本项目根目录同时是仓库目录，直接打包会全部带进去。
5. `js/mock.js` 是浏览器预览桩，内含示例个人路径（`C:\Users\imo\...`、`\\10.0.0.175\photo\DCIM`）。它被 `index.html` 引用，若整目录发布会把个人环境信息带进发布包。

另外还确认了两条硬约束：`tools/ps-bridge.ps1` 是运行时必需（`preload.js` 用 `path.join(__dirname, 'tools', 'ps-bridge.ps1')` 定位它），必须随包发布；`pluginSetting.height` 不能固定（不同屏幕缩放比下会显示异常，官方建议用 `utools.setExpendHeight` 动态设置）。

### 修复

- `plugin.json`：cmds 精简为 `["快捷方式", "快捷启动", "快捷面板"]`；`launcher-add` 改为单条 `files` 指令 + `minLength/maxLength`；`launcher-add-url` 的 regex 收紧为整体锚定的 `/^https?:\/\/[^\s]+$/i` 并加 `maxLength: 2000`；补 `homepage`；`description` 加入文件夹能力；`platform` 统一为 `win32`。
- `js/app.js`：`KEYWORDS` 与新关键词同步（该常量用于忽略"用户只是输入了关键词"的 payload）。
- 新增 `tools/release.js`：生成 `dist/` 发布目录（只复制插件真正需要的 12 个文件），并自动校验「禁止项 / 外部静态资源引用 / preload 是否被压缩或用了 ESM / `ps-bridge.ps1` 非 ASCII 字节 / `plugin.json` 的 `development` 与固定高度字段」。
- `js/mock.js` 不进发布包；`release.js` 会同时删掉 `dist/index.html` 里的对应 `<script>` 标签。
- 新增 `docs/使用手册.md`（官方要求"插件应用介绍中提供用户手册"）。
- 重新生成 `docs/screenshot-*.png` 共 6 张，替换 v1.0 时期的旧图。
- `.gitignore` 增加 `/dist/`。

### 理由

- **关键词精简**：被否决的方案是保留 `launcher`/`shortcut` 以便英文用户搜索。否决理由——uTools 用户以中文为主，且通用英文词在多插件环境下极易被判为"模糊名称"而拒审；中文关键词已自动覆盖拼音与首字母。另外 uTools 5.0 起安装时会把**第一个关键词**自动固定到超级面板，所以「快捷方式」必须置首。
- **`match:"/.+/"` 改成 `minLength/maxLength`**：被否决的方案是保留 `match` 只删掉 fileType。否决理由——`/.+/` 既然是官方明示会被忽视的"任意匹配"，留着只会让配置误导后来的维护者。同时把原本两条（file / directory）合并成一条不带 `fileType` 的 `files` 指令，因为两条都匹配全部内容会造成重复项。
- **`platform` 统一改成 `win32`**：被否决的方案是维持 `win32/darwin/linux` 以扩大曝光。否决理由——快捷方式解析、图标提取、应用扫描全部依赖 `tools/ps-bridge.ps1`（PowerShell），在 macOS / Linux 上插件实际上无法工作，声称跨平台是不诚实的。
- **不上 `docs/CHANGELOG.md` 之外的额外文档**：官方明确「切勿将整个项目的根目录打包成插件应用」，所以发布物料与发布产物必须分开，用 `dist/` 隔离。
- **不压缩 / 不打包 `preload.js`**：官方 preload 规范禁止压缩与混淆，本项目本来就无构建步骤，保持原样即可。

### 验证

- `node tools/release.js` —— 6 项合规检查全部通过（无禁止项 / 无外部静态资源 / preload 单行最长 224 字符且无 ESM / `ps-bridge.ps1` 正文非 ASCII 字节为 0（仅保留刻意添加的 UTF-8 BOM）/ `plugin.json` 无 `development` 与固定高度）。
- 产出 `dist/` 12 个文件 254.2 KB；`md5sum` 确认 `tools/ps-bridge.ps1` 与 `preload.js` 在 `dist/` 中与源文件**逐字节一致**；`diff index.html dist/index.html` 仅差被删掉的 mock.js 那一行。
- 无头 Chrome 加载 `dist/index.html`：侧边栏（含设置入口）、工具栏、grid、批量条均正常渲染，`mock.js` 引用数 0 —— 确认剥离预览桩后不会白屏。
- `node tools/smoke.js`：20 个 tile / 8 个分类项 / 23 张 data: 图标 / 侧边栏计数 `28 8 12 4 4`，无 missing 红点。
- `node tools/selftest.js`（PowerShell 桥）：ping / 图标提取（256×256，冷启 1944ms、热调用 17ms）/ `.lnk` 解析 / 应用扫描 296 项 / UWP logo 命中 30 个 —— 全部 PASS。
- 截图逐像素校验：设置面板在 1280×760 窗口下精确占据 y=184..745（底部留 14px），**未被窗口裁切**；面板下方 y≥746 为页面背景色，确认遮罩透明。

### 未验证 / 待确认

- 插件运行时会 `spawn powershell.exe` 子进程。这不违反官方明文规则，但审核时可能被追问，属相对敏感点。
- 运行时抓取 favicon 会发起网络请求（`preload.js` 的 `fetchFavicon()`）。官方"不允许请求网络资源"一条主要针对 UI 静态资源（翻译 / 图床类插件普遍会在运行时取数据），但仍存在被质疑的可能。默认 `faviconService` 为空，只尝试站点自身的图标。
- 数据存在 `utools.getPath('userData')` 下的 JSON 文件而非 `utools.db`，因此不随 uTools 账号跨设备同步。属体验问题，不违规。
- 审核结果本身需提交后才能确认。

---

## v1.5.0 — 格子背景透明度 + 设置面板左下角弹出（2026-10-10，commit `cdf2ec1`）

### 问题

用户提出两项需求：① 图标格子背景色需要能调透明度；② 设置面板居中弹出且遮罩压暗，挡住了图标页。

### 修复

- 新增 `tileBgOpacity`（0–100，默认 100）。`js/app.js` 增加 `hexToRgba()` 与 `tileBgValue()`，把十六进制色与百分比合成为 `rgba()` 后写入 `--tile-bg`；颜色留空时返回 `transparent`。
- 设置面板「图标格子背景」在色板下方增加不透明度滑块，拖动实时刷新 CSS 变量（无需重渲染）。
- `js/ui.js` 的 `modal()` 增加通用 `placement` 选项；设置面板改用 `placement: 'bottom-left'`。
- CSS 新增 `.mask.bottom-left`（`align-items:flex-end` + `background: transparent`）与 `.modal.anchored`（宽 400px、限高 74vh、从底部弹入动画）。
- 顺带修掉窄面板下 `.stat` 标签（如 `92 px`）换行的问题。

### 理由

- **合成 `rgba()` 而不是改用 `opacity` 属性**：被否决的方案是给 `.tile` 加 `opacity`。否决理由——那会连同图标和文字一起变透明，而需求只是背景半透明。
- **遮罩改全透明而不是调淡遮罩色**：被否决的方案是把 `rgba(0,0,0,.42)` 调到 `.1`。否决理由——只要还有压暗层就仍然"遮挡"，改全透明才是真正不遮挡；保留 `pointer-events` 仍可点击面板外部关闭。
- **扩展 `modal()` 而不是给设置单独写一套弹层**：否决理由是重复实现关闭 / Esc / 焦点逻辑，且其他弹窗将来也可能需要锚定形态。

### 验证

- 无头 Chrome 探针页 16 条断言全 PASS：`--tile-bg` 在 0% / 50% / 100% / 空色下的取值分别为 `rgba(83,74,183,0)` / `rgba(83,74,183,0.5)` / `rgba(83,74,183,1)` / `transparent`；tile 的 computed 背景色同步；mask 带 `bottom-left`、modal 带 `anchored`；mask 背景为 `rgba(0,0,0,0)`；面板 `left=14`、宽 392、贴底；滑块初值 60 且拖动后变量实时更新为 `rgba(15,110,86,0.25)`。
  - 注：探针测得 `bottomGap=4` 而非预期的 14，原因是弹入动画的 `translateY(10px)` 尚未播完。**测几何位置时要么等动画结束，要么把 transform 计入**，这不是布局 bug（后续逐像素复核确认为 14px）。
- 逐像素复核截图确认面板占 y=184..745、底部留白 14px、无裁切。

---

## 早期版本

| 版本 | commit | 内容 |
|---|---|---|
| v1.4.0 | `5ac06c3` | 文件夹内图标大小改为只由设置决定；文件夹内滚轮滚动；点标题栏打开文件夹；格子背景色与描边设置 |
| v1.3.0 | `55e0981` | 文件夹 / 大文件夹（同一容器两种形态）、橡皮筋框选批量操作 |
| v1.2.3 | `53b22fc` | 修复一行/两行名称混排时图标上下不对齐 |
| v1.2.2 | `706352e` | 修复大量图标空白——`.lnk` IconLocation 的 `"x.exe,0"` 中 0 是图标资源序号，被误当 shell 索引 |
| v1.2.1 | `91a6cfe` | 修复重建图标后全部空白——`SHGetImageList` 的 shell 索引 0 是"空白文件"占位图，默认必须为 -1 |
| v1.2.0 | `07b43f2` | 修复图标提取失败/过小、长名称裁切；新增侧边栏宽度与直接键入搜索 |
| v1.1.0 | `39a9a7e` | 修复图标大小不一（透明边距）、网址快捷方式拖入、右键删除、微信小程序自定义协议；新增设置入口 |
| v1.0.0 | `b714756` | 首个版本 |
