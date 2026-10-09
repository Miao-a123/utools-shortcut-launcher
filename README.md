# 快捷方式面板 (Shortcut Launcher)

一个 uTools 插件：把常用的文件、文件夹、网址和本机应用收进一个可分类、可自由调整尺寸的宫格面板，从 uTools 搜索框直达。

![主界面](docs/screenshot-main.png)

## 功能

- **三种添加方式**：把文件 / 文件夹 / 网址直接拖进窗口；手动填写地址；从剪贴板添加。拖入 `.lnk`、`.url` 会自动解析出真实目标。
- **图标自动获取**
  - 本地文件与快捷方式：通过 PowerShell + C# 调用系统 `SHGetImageList(SHIL_JUMBO)` 提取 **256×256 高清位图**（带透明通道）。
  - 网址：自动抓取站点图标（`<link rel=icon>` 按尺寸/类型排序 → 退回 `/favicon.ico` → 可选第三方图标服务）。
  - 手动：文字图标（字符 + 底色 + 字色）、内置字形图标（12 种 + 18 色）、任意图片。
- **侧边栏分类**：新建 / 重命名 / 换色 / 删除；把图标拖到分类上即完成归类，侧边栏显示每个分类的数量。
- **宫格自由布局**：每个图标可占 1×1 ～ 4×4 任意格，右下角拖拽实时缩放；排列顺序支持手动、名称、创建时间、最近使用；显示/隐藏图标文字。
- **一键扫描本机应用**：四个来源勾选扫描 —— 开始菜单快捷方式、系统应用列表（含 UWP，从 AppxManifest 取真实 logo）、桌面快捷方式、已安装程序注册表（App Paths 与 Uninstall 键），带搜索、图标预览、多选批量导入。
- **导入浏览器收藏夹**：支持 Chrome / Edge / Brave / Vivaldi / Chromium / 360 极速 / QQ 浏览器，自动探测多 Profile，文件夹树形三态勾选，导入后后台并发拉取图标。
- **批量操作**：多选后统一移动分类、改尺寸、刷新图标、删除。
- **其他**：全局搜索（`Ctrl+F`）、右键菜单、目标丢失检测（红点 + 一键清理）、数据导入/导出、深/浅色跟随 uTools 主题、缩略图大小与圆角可调、单击/双击打开、启动参数与工作目录。

## 安装与调试

本项目**无需构建步骤**（纯原生 JS + 一个 preload 脚本 + 一个 PowerShell 桥），直接用 uTools 开发者模式加载即可。

1. 打开 uTools → 偏好设置 / 开发者工具 → 新建项目。
2. 项目目录指向本仓库根目录（`plugin.json` 所在目录）。
3. 保存后，在 uTools 搜索框输入「快捷方式」即可唤起主面板。

> 浏览器预览：直接双击 `index.html` 打开也能看界面，此时自动进入 `mock` 模式（数据存于 `localStorage`，不触碰真实数据，方便快速预览样式与交互）。控制台执行 `localStorage.removeItem("kl-mock-data")` 可重置示例数据。

## 使用说明

| 操作 | 方式 |
|---|---|
| 添加本机文件 / 快捷方式 | 从资源管理器把文件/文件夹/`.lnk` 拖进窗口，或点工具栏「添加」→ 选择文件 |
| 添加网址 | 工具栏「添加」→ 手动新建，粘贴网址；或复制网址后「从剪贴板添加」 |
| 归类 | 选中图标拖到左侧分类；或多选后点工具栏批量移动 |
| 改尺寸 | 右键菜单选尺寸，或拖动图标右下角实时缩放，或在编辑器里调 |
| 编辑图标 / 名称 / 启动参数 | 点图标上的编辑按钮或双击图标的“更多” |
| 扫描本机应用 | 工具栏「添加」→ 扫描本机应用，勾选来源后扫描、搜索、批量导入 |
| 导入收藏夹 | 工具栏「添加」→ 导入浏览器收藏夹，选浏览器与 Profile，树形勾选目录 |

## 技术架构

```
utools-shortcut-launcher/
├── plugin.json            # 入口声明（关键词、features、文件拖入唤起）
├── logo.png               # 插件图标（tools/make-logo.py 生成）
├── index.html             # 主界面外壳
├── preload.js             # uTools preload：暴露 window.services（数据/图标/启动/扫描）
├── css/style.css          # 主题变量 + 宫格与弹窗样式
├── js/
│   ├── store.js           # 数据模型（分类/快捷方式/设置）、持久化、排序、增删改
│   ├── icons.js           # 图标引擎：图像归一化、文字/字形图标、favicon 抓取
│   ├── grid.js            # 宫格视图、拖拽（外部/排序/归类/缩放）、右键菜单
│   ├── dialogs.js         # 编辑器 / 扫描导入 / 收藏夹导入 / 设置面板
│   ├── ui.js              # 通用 UI（弹窗、菜单、进度、Toast）
│   ├── app.js             # 启动流程、工具栏、侧边栏、搜索、主题
│   └── mock.js            # 浏览器预览模式的示例数据与 window.services 桩
├── tools/
│   ├── ps-bridge.ps1      # 常驻 PowerShell 桥：图标提取 / lnk 解析 / 应用扫描
│   ├── selftest.js        # 桥接层自测（图标/lnk/应用扫描）
│   ├── smoke.js           # 渲染冒烟校验
│   └── make-logo.py       # logo 生成脚本
└── docs/                  # README 用截图
```

**PowerShell 桥接进程**：`preload.js` 启动一个常驻 `powershell.exe` 子进程，通过 stdin/stdout 单行 JSON 协议通信（进程挂掉时自动降级为一次性调用）。实测：图标提取冷启动约 1.9s（含 C# 编译），热调用约 17–28ms；`.lnk` 解析约 130ms；应用扫描约 2–4s 返回 200–500 项。

## 已知边界

- **拖拽取路径**依赖 Electron 的 `webUtils`/`File.path`。若运行环境拿不到真实路径，兜底方案：把文件拖到 uTools 搜索框（已在 `plugin.json` 注册 `files` 类型唤起），或用「添加」按钮选择。
- **Firefox 收藏夹**为 `places.sqlite`（需解 sqlite），暂未支持；Chromium 系全支持。
- favicon 走直连抓取，被墙或不提供图标的站点会退回字形图标，可在设置里配置第三方图标服务模板。

## 自测

```bash
# 桥接层自测（需 Windows + PowerShell）
node tools/selftest.js

# 渲染冒烟校验（需 Chrome 可用，检查 DOM 结构）
node tools/smoke.js <dump-dom-输出文件>
```

## 许可

MIT
