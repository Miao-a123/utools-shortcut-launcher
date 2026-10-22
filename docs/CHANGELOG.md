# 变更记录

> 倒序，最新在最上。
> 每条包含四要素：**问题 / 修复 / 理由（含被否决的替代方案）/ 验证**。
> 未经真机验证的改动会显式标注「未验证」。
>
> 插件内置的用户可见更新日志在 `js/dialogs.js` 的 `CHANGELOG` 常量里（设置 → 更新日志）。

---

## v1.8.2 — 安全加固：命令注入 / 数据被覆盖 / 任意文件读（2026-10-22）

本轮是对 `preload.js`（Node 侧）的一次安全与健壮性审计。**所有结论都做了实测复现**，
不是读代码推断出来的。PS 桥接层（`tools/ps-bridge.ps1`）经核实是干净的：
全程 `-LiteralPath` + JSON 反序列化，没有任何字符串拼接执行（`Invoke-Expression` / `iex` 零命中）。

### 1. `cmd.exe /c start` 回退 → 任意命令执行（🔴 安全）

**问题**：`openExternalViaShell()`（打开网址的兜底）和 `launch()` 里带 args 的 spawn 失败分支，
都写了：

```js
cp.spawn('cmd.exe', ['/c', 'start', '', target], { ... })
```

用数组传参只保证"参数不被 **Node** 拆分"，但 **cmd.exe 收到命令行后会自己再解析一遍**，
`& | < > ^` 在 cmd 里是元字符。只要 target 里没有空格，Node 就不会给它加引号，于是：

```
target = "C:\Windows\System32\whoami.exe&echo+PWNED>%TEMP%\x.txt"
        → 后半段被当作独立命令执行
```

**实测确认**（探针脚本，用完即删）：

| payload | 结果 |
| --- | --- |
| `cmd /c echo a&b` | 输出 `a` + 报错 `'b' 不是内部或外部命令` → 证实 cmd 重新解析了 `&` |
| `C:\nope.exe& echo PWNED > ...`（**含空格**） | 注入**未**生效 —— Node 给整段加了引号 |
| `C:\Windows\System32\whoami.exe&echo+PWNED>...`（**无空格**） | **注入生效，marker 文件被创建，内容 `PWNED`** |

**攻击面**：`target` 来自用户拖入的 `.url`/`.lnk`（`parseUrlFileRaw` 是纯文本解析、无校验）、
以及导入的 `data.json`（只校验 `Array.isArray(json.shortcuts)`）。单击图标即可触发。

**修法**：**删掉这两处 cmd 回退**。
- `openExternalViaShell()` 改为失败就返回 `false`。`utools.shellOpenExternal` 本身就是系统级
  `ShellExecute`，它失败说明协议没注册，cmd 也救不回来 —— 这个回退从来没有实际价值。
- `launch()` 里那个 `try/catch` 包 `cp.spawn` 是**死代码**：`spawn` 对不存在的 exe 不同步抛错，
  只异步 emit `'error'`。删掉后由既有的 `'error'` 处理器兜底到 `shellOpenPath`。

**被否决的方案**：保留 cmd 但做元字符转义（`^` 前置）。否决理由 —— cmd 的引号/转义规则
在 Windows 上有多套互相矛盾的解析器（CommandLineToArgvW 与 cmd 自己的），漏一个就是 RCE，
不值得为一条本来就没用的回退承担这个风险。

### 2. `data.json` 损坏 → 静默清空 → 真实数据被覆盖（🔴 数据丢失）

**问题**：`readData()` 在 `JSON.parse` 失败时**返回 null**，而 `store.load()` 拿到 null 就
`normalize(null)` 成完全空的 state —— 于是"**数据损坏**"和"**全新安装**"完全无法区分：

1. 界面变成空面板，**没有任何提示**（`loadData` 不抛错，`store.load()` 的 catch 不触发）；
2. 用户以为数据没了，随手加一个快捷方式；
3. `saveNow()` 把空 state 写回 → 磁盘上那份真实数据（本机实测 **2,241,932 字节**）被覆盖。

`.broken-<时间戳>` 备份其实一直有做，但用户不知道它存在，也没有任何恢复入口。

**实测确认**：造一个截断的 `data.json`（2545 / 完整 3857 字节）→ `readData()` 返回 `null` →
模拟"随手保存" → 文件变成 78 字节，原始内容只剩在 `.broken` 文件里。

**修法**：
- `readData()` 三态语义：**文件不存在/空文件 → `null`（全新安装，可写）**；
  **正常 → 对象**；**存在但解析不了 → 抛 `code='DATA_CORRUPT'` 的错**（带 `backupPath`）。
  同时去掉 `existsSync` + `readFileSync` 的两次 IO（中间被删会抛 ENOENT 走损坏分支，
  生成一个空的 `.broken`），改成一次 `readFileSync` 按 `err.code === 'ENOENT'` 判断。
- `store.js` 接住 `DATA_CORRUPT` → 置 `readOnly = true` → `saveNow()` **直接拒绝写入**并 toast
  告知备份位置。新增 `KL.store.readOnly` / `corruptBackup` 供 UI 使用。

### 3. `readImageAsDataUrl` 是任意文件读取原语（🔴 暴露面）

名字叫"读图片"，实际 `fs.readFileSync(p)` 后直接 base64 返回 —— 传 `id_rsa`、浏览器 `Login Data`
都会原样吐出，MIME 还被错标成 `image/png`。

**修法**：两道闸 —— 扩展名白名单（png/jpg/jpeg/gif/bmp/webp/ico/svg）+ **文件头魔数校验**
（不信任扩展名：改名的 `.exe` 的 `MZ` 头、`.txt` 伪装成 `.png` 都会被拒）。未知扩展名直接报错，
不再猜成 png。

### 4. `fetchFavicon` 可被页面牵着打内网（🟡 SSRF）

`parseIconLinks` 只做 `new URL(href, base)`、**不校验同源**，重定向也不校验，于是
"用户加一个外网网址"可以变成"本机替第三方去请求内网"（`169.254.169.254` 云元数据、
`127.0.0.1` 管理接口、路由器 GET 型 reboot 等）。

**修法**：新增 `isBlockedHost()`，在 `request()` 入口统一拦截（重定向递归调用的也是
`request()`，因此自动覆盖）：`localhost`/`*.local`/`*.internal`、`127/8`、`10/8`、`172.16/12`、
`192.168/16`、`169.254/16`、CGNAT `100.64/10`、`::1`、`fc00::/7`、`fe80::/10`；
协议只允许 http/https。
**不做 DNS 解析后再校验** —— 那会让每次抓图标多一次解析，且解析结果与实际连接用的可能不同。

### 5. 子进程：写入失败静默挂起 + 无退出清理（🟡）

- **stdin 写入不抛错**：向已退出的子进程 `write()` **不同步抛异常**，只返回 `false` 并把错误
  交给 callback（实测确认）。原来只有 `try/catch`，于是"进程刚死、`'exit'` 还没派发"窗口期
  进来的请求，JSON 根本没发出去，只能干等到超时（默认 180s、扫描 240s）—— 表现为"点了转圈好几分钟"。
  修法：`write` 传 callback 立刻失败，并给 `agent.stdin` 挂 `'error'` 监听。
- **`services.shutdown` 零调用方**：全项目搜索确认，插件关掉后常驻 PowerShell 可能还跑完 240s 的扫描。
  修法：`process.on('exit'/'SIGTERM'/'SIGINT', stopAgent)`。
  **注意不挂在 `onPluginOut` 上** —— 那是"失焦"不是"销毁"，每次切回来都重编译 C# 太亏。

### 6. 其它

- **日志轮转**：超 512KB 时原来 `writeFileSync(LOG_FILE, '')` **直接清空**，正好在最需要上下文的
  时候（刚崩过）把证据删了。改为 `rename` 成 `.1` 保留一份。
- **PS 失败被吞成"成功但零条"**：`resolvePaths` / `extractIcons` 在 PS 整体失败时返回
  `{ok:true, items:[]}`，界面显示"添加了 0 项"，用户不知道是失败了。改为返回 `ok:false`，
  `dialogs.ingestPaths` 补 `toast` 提示。
- **`ui.js` 菜单项的 `it.icon` 未转义**：目前没有调用方传这个字段（死路径），但将来加图标
  （尤其从 `data.json` 读的）就是 HTML 注入点。改为 `esc()`。
- **`writeData`**：`.tmp` 固定名 → 带 `pid + 时间戳`（两个窗口同时保存会互相覆盖）；
  补 `fsync`（rename 成功后内容可能还在 page cache，断电会得到"文件名对、内容空"的文件）。

### 验证

- 新增 `tools/preload-test.js`（**40 条断言**，Node 跑），已接入 `run-all-tests.sh`。
  用两种手段：把 `preload.js` 里的纯函数（`readData` / `looksLikeImage` / `isBlockedHost`）
  用 `vm` 抽出来跑真实逻辑；对数据读写跑真实临时文件。
- **用 `git stash` 撤掉修复重跑 → 11 条变红**（cmd 回退 3 条、DATA_CORRUPT 相关 8 条），
  装回修复后 40 条全 PASS。
- 全量：**8 个浏览器测试 + 3 个 Node 测试全绿**
  （uitest 16 / dedup 16 / tip 22 / layout 35 / grid-layout 47 / data 15 / folder 74+75 /
  offline 12 / **preload 40** / release 全过）。

> 未在真机 uTools 里复验。`preload.js` 改动需要**完全重启 uTools** 才生效（项目硬约定）。
> 用户真实数据未被触碰：测试全部用 `os.tmpdir()` 下的临时目录。

### 仍然存在、但本轮未处理

- **`window.services = services` 在 contextBridge 之前无条件执行**。uTools 默认关闭
  `contextIsolation`，此时渲染进程拿到的是 preload 世界的**原始对象**，
  `window.services.log.constructor('return process')()` 可以拿到 Node 全权限。
  这是 uTools 插件生态的普遍情况，改动它需要先确认 uTools 各版本的行为，风险与收益要单独评估。
- **`launch(sc)` 仍接受渲染进程传入的任意 target/args**。彻底收口需要改成 `launch(shortcutId)`
  由 preload 自己查 target，属于接口变更，留待单独一轮。
- **UNC 网络路径无拦截**：拖入 `\\host\share\x.lnk` 会触发 SMB 连接（泄露 NTLM 哈希），
  目标不可达时还会阻塞到 SMB 超时。企业共享盘是合理场景，需要先定策略。
- **`data.json` 2.2MB 同步写**：图标以 base64 内联，每次保存都在渲染线程上同步写 2.2MB。
  根治要把图标拆成独立文件，属于存储层改造。
- **`ps-bridge.ps1` 的 `$ErrorActionPreference = 'Continue'`**：非终止错误不会被 catch，
  可能返回 `ok=true` 但数据残缺。建议 PS 侧收集 `$Error` 作为 `warnings` 返回。
- **`release.js` 只检查 `dist/` 里的 ps-bridge.ps1 编码，不检查源文件**。
  建议在 `run-all-tests.sh` 里也加一份源文件检查（当前手工核实是达标的：BOM 存在、正文 0 非 ASCII）。

---

## v1.8.1 — 目标丢失检测修好 + 合并导入不再丢文件夹内容（2026-10-22）

### 1. 目标丢失检测（红点）从来没生效过（修）

**问题**：README 一直写着「目标丢失检测（红点 + 一键清理）」，但 `js/grid.js` 的 `checkMissing()` 第一句是：

```js
if (sc.launch.kind !== 'file') continue
```

而 `launch.kind` 的取值只有 `path` / `url` / `appid`（见 `js/dialogs.js` 组装 launch 的三处）——
**`'file'` 这个值从 v1.0.0 起就不存在**。于是每一条记录都在第一句被 `continue` 掉，
红点检测一次都没跑过。

**实证**（不是靠读代码推断）：本机真实数据 `%APPDATA%\uTools\shortcut-launcher\data.json` 里
167 条快捷方式、149 条 `path`、126 个唯一本地目标，其中 **10 个目标已经不存在**，
而 `missing=true` 的记录数是 **0**。

**修法**：判断条件改成 `sc.launch.kind !== 'path'`。url 不是文件、appid 是
`shell:AppsFolder\...` 虚拟路径，都不能用 `fs.existsSync` 判断，所以只对 `path` 生效。

**顺带**：README 里「一键清理」是**从来没有实现过**的功能（全仓库搜不到任何批量清理入口），
已从 README 删除，改成如实描述「红点 + 点击时提示是否删除」。

### 2. 合并导入（「导入数据 → 合并」）后，文件夹里的图标全部消失（修）

**问题**：`js/store.js` 的 `importJSON(data, 'merge')` 给每条记录换了新 id（`ns.id = uid('sc')`），
但**只重映射了 `categoryId`，漏了 `parentId`**。于是文件夹内的图标 `parentId` 指向一个
不存在的旧 id —— `inCategory()` 用 `!s.parentId` 过滤主网格，这些记录**既不进主网格、
也不在任何文件夹里**，界面上彻底消失。数据还在磁盘上，但用户永远看不到、也点不到。

触发场景很常见：换电脑 / 重装后用「导入数据 → 合并」恢复备份，恰好就是这条路径。

**修法**：两趟处理 —— 第一趟换 id 并建立 `idMap[旧id] = 新id`，第二趟按 `idMap` 重挂 `parentId`
（不依赖记录在数组里的先后顺序）。注意第一趟要同时记 `srcOf[i]`：跳过重复项后
`added` 与 `data.shortcuts` 的下标会错位，直接按下标回查会挂错父级。

**被否决的方案**：保留原 id 不换。否决理由 —— 合并的目的是和已有数据共存，
保留原 id 一旦与库里已有 id 撞车（同一份备份导入两次就会），`getShortcut()` 会命中错误记录，
比丢父子关系更难排查。

### 3. `icons.js` 里同源的死代码（修）

`iconSourceOf()` 之后那段候选路径收集里也写着 `l.kind === 'file'`，同样永不成立 ——
也就是「目标本身作为图标来源」这条兜底路径一直没被走过。按 `path` 修正。

### 4. 注释与代码不一致（修）

`js/grid.js` 的 `innerMetrics()` 上方注释写「打分 `min(wFill, hFill) × (0.5 + 0.5·rowFill)`」，
但代码（以及 `docs/CHANGELOG.md` 的 v1.8.0 第 12 条）都是 **`rowFill²`**。注释是 v1.8.0
调参时留下的旧值，已改正。

### 验证

- 新增 `tools/data-test.html`（15 条断言），覆盖：目标不存在的 path 记录被标 missing /
  存在的没被误标 / 网址记录不参与文件存在性检查 / DOM 上红点出现与不出现 /
  合并导入后文件夹内仍是 2 项 / 内部项 parentId 指向新文件夹 / 无孤儿记录 /
  子项没跑到主网格上 / 覆盖导入（replace）同样完好。
- **用 `git stash` 撤掉修复重跑，5 条断言变红**（missing=false、无红点、
  `count=0`、内部项名称为空、孤儿 2 条），装回修复后 15 条全 PASS ——
  确认测试真的能抓住这两个 bug，不是摆设。
- `bash tools/run-all-tests.sh`：8 个浏览器测试 + 2 个 Node 测试全绿
  （uitest 16 / dedup 16 / tip 22 / layout 35 / grid-layout 47 / **data 15** / folder 74 + 75）。

> 未在真机 uTools 里复验（改动都在渲染层逻辑，不涉及 preload / PowerShell 桥）。
> 数据文件未被触碰：测试全部跑在 mock 模式的独立 `--user-data-dir` 里。

---

## v1.8.0 — 名称改到格子下方 + 大文件夹整页翻动（2026-10-16 / 17）

### 1. 图标名称与文件夹标题都改到**格子下方**

**旧逻辑**：名称画在格子**内部**。有字模式下要给两行文字腾地，所以图标被缩小（`iconSizeFor(sc, showLabels)` 里 `base - chrome - labelH`，92 的格子图标只剩 ~44px），名称和图标挤在一个格子里。

**新逻辑**：
- 名称改成 `position: absolute; top: calc(100% + 4px)`，画在**格子外面**；
- **图标和格子大小不再随「显示/隐藏名称」变化** —— `iconSizeFor(sc)` 去掉 `showLabels` 参数，统一 `min(格宽,格高) × 0.72`（92 的格子图标 66px）；
- **有字模式下把每一行之间的距离加大**，给名称腾出位置：`row-gap = GRID_GAP + LABEL_GAP(4) + LABEL_BOX(29) = 43`，无字模式收回 10。由 JS 算出写进 `--gap-y`（`rowGapY()`），保证 CSS 与 `tilePixelBox` / `cellFromPoint` / 拖拽落格用的是同一个值；
- 网格自己加 `padding-bottom: var(--label-pad)`（= 名称占的高度），否则**最后一行的名称会被 `.content` 的裁剪框切掉**；
- `.tile` 的 `overflow` 从 `hidden` 改成 `visible`（`.tile.folder` 也是），不然画到格子外的名称会被裁；内部图标的裁剪由 `.folder-inner` 自己负责。

**由此带来的一串连带改动**（纵向步长不再等于横向步长）：
- `gridMetrics()` 返回 `gapX` / `gapY`；
- `cellFromPoint()` 的横纵分别用 `cell + gapX` / `cell + gapY`；
- `tilePixelBox()` 的高度用 `rowGapY()`（多行图标的实际像素高 = `row × cell + (row-1) × gapY`）；
- 两个 `attachResize` 的步长拆成 `stepX` / `stepY`。

### 2. 文件夹的标题并入同一套逻辑

文件夹标题不再是格子内的独立标题栏，而是和图标名称**完全同一个东西**：`<div class="label">` 挂在 tile 上（也就是格子下方），同样受「显示/隐藏名称」开关控制、无字模式下同样靠悬浮气泡（`attachNameTip(tile, sc.name)`），只是里面多一个 `.label-count` 显示数量。

- `innerMetrics()` 的 `headH` 从 20 改成 **0** —— 标题不再占文件夹内部空间，内部全给图标；
- 删掉 `.tile .folder-head` / `.folder-name` / `.folder-count` 那套样式与右上角数量角标分支；
- 点名称依然能打开文件夹（label 是 tile 的子元素，点击自然冒泡到 tile 的"空白处 = 打开"逻辑）。

> 这里推翻了上一轮"文件夹标题常驻显示"的做法 —— 那时标题在格子**里面**、和图标抢地方，藏了就认不出是哪个文件夹；现在它在格子下面、不占图标空间，所以统一成跟图标名称一样的显隐逻辑更一致。

### 3. 大文件夹内容**整页翻动**（并且没有任何页标）

先做过一版 `overflow-y: auto` 连续滚动（图标行滚到一半会被裁掉半截），又试过一版**按行吸附的滚动**（滚轮挪一整行、永远停在整行边界，但内容总高不是容器高整数倍时，底部必然露半行）。最终回到**分页**：

- `folderPage` / `folderPageCount` / `renderFolderPage`：每页 `rows × cols` 个，**只渲染整行**，所以永远不会出现"某一行被裁掉半截"，也不会有半行露在底部；
- `refreshFolderInner()`：翻页只重绘这个文件夹的内部，不整屏 render；
- `attachFolderPaging()`：滚轮翻页，到第一页 / 最后一页就把事件**放行**给外层页面；沿用"累积 delta"（`MIN_STEP = 24`）以同时适配鼠标滚轮与触控板；
- **没有任何页标 / 页码 UI**。曾经那版悬浮在右下角的「‹ 1/2 ›」芯片在某些尺寸下会压到图标 —— 只要它悬浮在图标区上就一定会占地方，所以不是调位置能解决的，直接删掉（`buildFolderPager` / `.folder-pager` / `.pg-btn` / `.pg-num` 全部移除）。

### 4. 大文件夹内部不显示图标名称

文件夹内部空间小，名称会盖住图标，也让行高白占近四分之一。内部图标的名称只靠光标气泡（`attachNameTip(node, name, true)`，不受开关影响）。

### 5. 拉长的格子（1×n / n×1）：图标贴上 / 左，格子里再常驻一份名称

格子被拉长成竖条或横条之后，把图标居中会在两边留下大片空白。现在：

| 形状 | 图标 | 格子**内**名称 | 格子**下方**名称 |
| --- | --- | --- | --- |
| **1×n**（竖条） | 按 1×1 大小**贴顶** | 写在图标**下方**的空白里，**常驻** | 和所有图标一样（受开关控制） |
| **n×1**（横条） | 按 1×1 大小**贴左** | 写在图标**右侧**的空白里，**常驻** | 同上 |
| 1×1 / 2×2 / 3×2 … | 居中（不变） | 不显示 | 同上 |

**关键：这里有两份名称，分工不同，别搞混**

- `.tile-name-fill` —— 格子**里面**那份，只给拉长的格子用（普通格子里 `display:none`），
  **永远显示，不受「显示/隐藏名称」开关影响** —— 它本来就是给无字模式准备的：
  格子拉这么大却不知道叫什么，只能靠悬浮气泡太别扭；
- `.label` —— 格子**下方**那份，所有图标一视同仁，**仍然受开关控制**
  （所以 `applyElongatedClass` 完全不去动 `.label` 的定位，它还在 `top: calc(100% + 4px)`）。

其它细节：
- `applyElongatedClass(node, col, row)` 给 tile 打 `.tall` / `.wide`；
  `buildTile` 里按形状打标记，`attachResize` 的 `applyVisual` 里也同步调用
  （拖动过程中就切换，不会等松手才跳一下）；
- css：`.grid .tile.tall` → `justify-content: flex-start`（图标贴顶）；
  `.grid .tile.wide` → `flex-direction: row` + `justify-content: flex-start`（图标贴左）。
  选择器写成 `.grid .tile.tall`（三个 class）而不是 `.tile.tall`，是为了盖过
  `.grid.hide-labels .tile { gap: 0 }` —— 拉长的格子里有"图标 + 名称"两段内容，
  关掉名称时也要保住间距；
- **图标尺寸不用改**：`iconSizeFor` 取的是 `min(格宽, 格高) × 0.72`，拉长之后短边仍是
  一个格子，所以天然就是 1×1 大小（92 的格子 → 66px）；
- 拉长的格子上**不再挂悬浮气泡**（`!isElongated(...)` 才 `attachNameTip`）——
  名称已经常驻可见，再弹一次就是重复；
- **文件夹不参与**：它的格子里装的是内部图标，没有"空白处"可用，标题仍然画在格子下方。

### 6. 点大文件夹任意空白处即可打开

内部图标、拉伸手柄各自 `stopPropagation`，所以**能冒泡到文件夹本身的点击就是空白处** —— 一律打开弹层。抽出 `openFolderView(id)` 统一收口。

### 7. 每个大文件夹可单独设「图标显示 / 列表显示」

大文件夹内部多了一个**逐文件夹**的开关（右键文件夹 →「内部显示方式」）：

| 模式 | 布局 | 名称 |
| --- | --- | --- |
| **图标**（默认） | 小图标平铺成多列（原来的样子） | 不显示，靠光标气泡 |
| **列表** | **一行一个**，图标缩到网格图标的 55% 贴左 | 名称写在图标右边，常驻显示 |

- 存在 `sc.folderView`（`'grid'` / `'list'`），`innerMetrics` 按它分两套度量：
  列表模式 `cols = 1`、`rowH = 图标 + 10`，所以行与行之间更紧凑；
- 页容量沿用同一套分页逻辑（`folderPageCount` 用 `cols × rows`，列表就是 1 × 行数），
  超过一页照样滚轮翻页、照样**没有页标**；
- 列表模式下忽略子项自己的 `col / row`（一行就是一个），所以以前在主网格里被拉大过的
  图标塞进文件夹也不会撑坏列表；
- 列表里名称已经可见，所以**不再挂悬浮气泡**（`buildInnerTile` 里 `if (!m.list) attachNameTip`）；
- 1×1 的小文件夹不展示内部，菜单里就不出现这一项。

### 8. 大文件夹内部的格子也带上「格子背景 / 描边 / 圆角」

`.inner-tile` 原来写死 `border-radius: 8px; border: 1px solid transparent`，和主网格的两套外观
设置无关。现在改成和 `.tile` 用**同一批 CSS 变量**：

```css
border-radius: var(--tile-radius);
border: var(--tile-border-w, 1px) solid var(--tile-border-color, transparent);
background: var(--tile-bg, transparent);
```

默认值都是透明的，所以不改设置时看不出差别；一旦在设置里调了「图标格子背景 / 描边 / 圆角」，
文件夹内部的图标也会跟着变 —— 测试直接比对同一个 `.inner-tile` 和 `.tile` 的
`borderRadius` / `borderTopWidth` / `borderTopColor` / `backgroundColor` 是否完全一致。

### 9. 内部图标与格子的比例失衡（修）

**问题**：大文件夹里的图标几乎把格子占满（图标占格子边长约 **86%~90%**），看起来"格子箍着图标"。
内部格子原来是这样挤出来的：`unit = 图标 + INNER_CHROME(8)`，而图标又取 `min(iconMax, 可用宽度)`
—— 两头都往"占满"算，最后内边距只剩 2~4px。主网格那边是 `min(格宽,格高) × 0.72`，
有 14% 的内边距。上一版给内部格子加上描边之后，这个失衡就特别扎眼了。

**修法**：把比例抽成一个共用常量 `ICON_RATIO = 0.72`，`iconSizeFor`（主网格）和
`innerIconSize`（文件夹内部）都用它：

```js
// 主网格
iconSizeFor:        min(box.w, box.h) × ICON_RATIO
// 文件夹内部：格子边长（含跨格与 gap）乘同一个比例
innerIconSize:      min(unit × c + gap × (c-1), rowH × r + gap × (r-1)) × ICON_RATIO
```

注意内部这边是拿**格子边长**去乘比例的，不再是"先用图标挤出格子、再让图标填满格子"。
格子尺寸（`unit` / `rowH`）不变 ⇒ **每页能放的图标数量完全不变**，只是图标在格子里退了一点点、
四周留出了正常的呼吸空间。

**连带的一个好处**：把「文件夹内图标大小」设成「与主格一致」时，内部格子 = 92、图标 = 66，
和主网格**一模一样** —— 测试直接断言了这两个相等。

**代价（如实说明）**：同一档位下内部图标会比之前小约 15%（比如「中」：61px → 49px；
这次的演示文件夹小一些：50px → 42px）。想要更大就把「文件夹内图标大小」往上调一档，
但那一档的格子也会变大、每行能放的图标会变少。

### 10. 重新进入插件后，大文件夹从「列表」掉回「图标」（修）

**现象**：把某个大文件夹切成列表显示后，当次使用正常；**重新进入插件就又变回图标形态**。

**根因**：`store.normalizeShortcut()` 是**白名单**式重建 —— 它一项一项挑字段拼出新对象。
`updateShortcut()` 把 `folderView` 写进了内存（所以当次生效），`save()` 也把它写进了磁盘，
但下次启动 `load() → normalize()` 时，**`folderView` 不在白名单里，直接被丢掉**。

**修法**：把 `folderView` 加进白名单（只对 `kind === 'folder'` 生效，其它记录不带这个键）：

```js
...(kind === 'folder' ? { folderView: s.folderView === 'list' ? 'list' : 'grid' } : {}),
```

顺手在函数上加了注释：**这是个白名单，任何新增的快捷方式字段都必须加进来**，
否则就会出现"本次生效、重进即失效"这种很难一眼看出来的 bug。

**回归测试**（`tools/folder-test.html` 新增 5 条，验证过"撤掉修复会红"）：
- 切列表 → `saveNow()` → `load()`（模拟重新进入）→ `重新加载后仍是列表形态` /
  `重新加载后 folderView 仍是 list` / `重新加载后内部仍是单列 + 每行带名称`
- 反向：切回图标 → 落盘 → 重新加载 → `切回图标后重新加载仍是图标形态`
- `非文件夹记录不带 folderView 键`

### 11. 一键跑全部回归测试

新增 `tools/run-all-tests.sh`：7 个浏览器测试 + 2 个 Node 测试一次跑完，输出紧凑汇总。
之前批量命令是临时写在 TEMP 里的，**被系统清掉后很容易误以为"已经跑过了"**（实际什么都没跑），
所以放进仓库。

（脚本自己也踩了两个坑，都已修：① `python - <<EOF` 的 heredoc 会占掉 stdin，
不能同时用管道把 title 喂进去，改成用 argv 传；② 有的测试用 `' ; '` 分隔断言、有的用两个空格，
解析前统一。③ 每次的 `--user-data-dir` 带随机数，即使清理失败也绝不会复用上次的 localStorage。）

### 12. 大文件夹内部"要么空一大条、要么图标被裁"（修）

**现象**（用户截图）：某些文件夹尺寸 / 图标数量下，内部图标没有充分利用空间 —— 要么四周空得太多、
末行只剩一两个图标下面拖一大条空白，要么图标边缘被切掉；左右上下留白也不对称。

**根因**：`innerMetrics()` 只做**单向**计算 ——

```js
// 旧：先按宽度死命塞满列数（icon ≥ 档位 80% 里挑占宽最大的）
for (let c = 1; c <= 16; c++) { … if (ic >= iconMin && used > bestUsed) … }
// 再让行数 = 底部能塞几行就几行
const rows = Math.floor((innerH + gap) / (rowH + gap))
```

三个问题都从这儿来：

1. **只看宽度**。高度方向的富余完全没参与决策，所以宽高比不合适的文件夹会出现"横向顶满、
   纵向空一大截"；
2. **行数按"最多能塞"取**。`total` 个图标如果正好卡在行边界外侧一点点，末行就只有 1~2 个，
   下面全是空的 —— 这就是用户说的"破坏了对称和谐的美感"；
3. **`unit` 是"图标 + 固定内衬"倒推出来的**，档位只是个上限提示。一旦 `innerW` 偏小，
   格子会被挤到比档位值还小；反之某些分支又会算出**比容器还大**的格子，
   而 `.folder-inner` 是 `overflow: hidden`，超出部分直接被裁 —— 图标边缘就是这么没的。

**修法**（`js/grid.js` 的 `innerMetrics` 网格模式重写为"搜索最优摆法"）：

1. **档位比例直接作用在格子边长上**（不再是图标），`FOLDER_SCALES` 从
   `{ 0.5, 0.66, 0.82, 1 }` 调成 `{ 0.55, 0.75, 0.95, 1 }`（按"看起来和以前差不多大"标定）。
   图标再按共用的 `ICON_RATIO = 0.72` 从格子边长算 —— 内外彻底同源；
2. 枚举所有可能的 `(列数, 行数)`，对每个候选算三个指标：
   - `wFill = 横向占用 / 内部宽`、`hFill = 纵向占用 / 内部高`
   - `rowFill = 末行图标数 / 列数`（越小说明末行越瘪）
   - 打分 `min(wFill, hFill) × rowFill²`，取最高；
3. 比较顺序是**先比格子大、再比匀称分**（"充分利用空间"最直接的体现就是图标更大）。
   两个坑都是实测撞出来的：
   - 一开始用 `fill = 面积 / 可用面积`，结果 **2×3 的文件夹里 5 个图标被排成一列**
     （竖向 100%、横向 37%，面积分反而更高）—— 面积分不出"铺满但形状怪"，
     改成 `min(wFill, hFill)` 就不给这种窄条高分了；
   - `rowFill` 的系数先是线性的 `0.5 + 0.5·rowFill`（太温柔），4 个图标会被排成 3+1、
     第二行孤零零挂一个；改成**平方**后 1/3 的末行系数掉到 0.11，这种排法自然落选；
4. 候选被三道闸门卡住：`size ≤ cellMax`（档位上限）、`size ≥ cellMax × 0.78`
   （缩太多就变成"格子箍着图标"了）、`size ≤ 该组合下实际宽高`（**绝不越界**，从根上消除裁剪）；
5. `innerIconSize()` 再夹一道 `min(格边长 × 0.72, 格边长 - INNER_PAD(6))` —— 双保险，
   任何尺寸下图标都进不了格子的 padding / border 区域；
6. `.tile .folder-inner` 从 `justify-content: start` 改成 **`center`**：格子边长受档位封顶，
   装得下时必然有富余，居中摊到四周是"留白"，贴左上就是"空了一大条"。列表模式仍贴左上；
7. 新增 `centerLastRow()`：**末行不满时让它居中**。像 3 列装 7 个必然排成 3+3+1，
   网格默认把最后那一个丢在第一列，看着像"贴着左边掉下来了"。
   - 能整格挪就整格挪（`gridColumnStart`）；
   - 只缺一个时要挪**半格**，而格子轨道是固定像素挪不了半列，改用 `transform: translateX`
     （不能用 `margin-left` —— 那会把格子挤窄）。半格偏移取整，不会糊；
   - 子项里有跨格（`col/row > 1`）时不动：行内位置由网格自动排布决定，硬塞会挤歪。

**被否决的方案**：

- 把格子边长算到"刚好铺满"（不做档位封顶）。留白确实变 0，但同一档位下不同文件夹的
  图标大小会各不相同，来回切换时看着跳，反而更乱，档位也失去了意义；
- 内部改成 `flex-wrap` + `justify-content: center`（末行天然的居中）。会直接废掉
  「子项可以跨格」这个能力，而且分页容量要靠 `grid-template-columns` 反推，改动面太大。

**量化验证**：写了扫描页（12 种文件夹尺寸 × 20 种图标数量 = 240 组合，混搭 grid/list、
有字/无字），逐项量左右上下留白、末行、越界与裁剪。中途几版算法的对比：
`面积×rowFill` → 单列怪排法；`min-fill×线性 rowFill` → 3+1 孤行；最终
`size 优先 + min-fill×rowFill² + 末行居中` → **80 组抽查 0 越界、0 不对称**，
剩下 2 组"末行只有 1 个"（3 列装 7 / 10 个）是结构性无解，已经靠居中处理得体。
（扫描页在 `%TEMP%`，不进仓库，逻辑已固化进下面的回归断言。）

**回归测试**（`tools/folder-test.html` 新增 3 条，跑 11 种尺寸×数量组合）：
- `各种尺寸下留白左右/上下都对称`（|左-右| ≤ 3px、|上-下| ≤ 3px）
- `各种尺寸下末行要么排满、要么居中`（末行相对内部的左右留白之差 ≤ 3px）
- `各种尺寸下格子/图标都没有越界被裁`（所有 `.inner-tile` 和里面的 `.icon-box` 都在 `.folder-inner` 内）

> 这条断言被真实 FAIL 抓到过一次：`3x2x7 末行1/3`。当时的实现只会整块居中，
> 那个孤零零的图标仍然贴在块内左边 —— 于是补了 `centerLastRow()`。

### 验证

新增 `tools/grid-layout-test.html`（**47 项全 PASS**）专门盯"图标 / 格子 / 名称的尺寸与位置"：
- `格子高度 = cell（名称不再占格子内部）[92 vs 92]`
- `有字模式图标尺寸 = min(格宽,格高)×0.72[66 vs 66]`
- `名称在格子下方[label.top=298 tile.bottom=295]`、`名称不压住格子[overlap=0]`、`名称留了两行高度[29]`
- `有字模式行距 = 基础间距 + 名称高度[43 vs 43]`、`上一行的名称不压到下一行格子`、`列间距没被改（仍是基础间距）`
- `最后一行的名称在网格框内（没被裁）`
- `无字模式名称隐藏` / `无字模式格子大小不变[92×92 vs 92×92]` / **`无字模式图标大小不变（不再为文字让位）`** / `无字模式行距收回基础间距[10 vs 10]`
- `大文件夹的标题也是 .tile > .label` / `文件夹标题在文件夹格子下方` / `标题里是文件夹名称` / `标题里带数量[5]` / `标题不占文件夹内部空间（inner 高度 ≈ 格子高 - 12）`
- 拉长格子那一组（共 21 条）：`普通 1×1 图标不显示格子内名称`；`4×1 打上 wide 标记` / `图标贴左边[7]`（= 6px 内边距）/ `图标仍是 1×1 大小[66 vs 66]` / `格子内显示常驻名称[KiCad]` / `格子内名称在图标右侧` / `格子内名称在格子内部` / **`底部名称回到格子下方（原有逻辑）`**；`1×4 打上 tall 标记` / `图标贴顶边[7]` / `图标仍是 1×1 大小` / `格子内显示常驻名称` / `格子内名称在图标下方` / `格子内名称在格子内部` / `格子内名称横向铺满格子` / **`底部名称回到格子下方（原有逻辑）`**；`无字模式：格子内名称仍然显示（不受开关影响）[flow-root]` / `无字模式：格子下方名称隐藏[none]` / `无字模式：图标仍然贴顶`；拉回 1×1 后 `1×1 不带拉长标记` / `1×1 收起格子内名称` / `1×1 名称仍在格子下方`

`tools/folder-test.html` 改回分页断言并补了显示方式 / 内部外观 / 菜单 / 比例 / 持久化六组（**74 项有字 / 75 项无字全 PASS**）：`每页容量 > 0 且确实需要多页[pageCap=12 pages=4]`、`第一页只渲染一页的量[12/12]`、`只渲染整行（每行都是完整的）`、`第一页/翻页后/最后一页没有图标被裁[clipped=0]`、`滚轮向下翻一页`、`滚轮向上翻回上一页`、`第一页再向上滚 → 放行给外层`、`能翻到最后一页`、`到最后一页后再滚内容不变`、`最后一页数量正确`、`能翻回第一页`、`只有一页时全部渲染、且滚轮不被消费`，以及 `不渲染分页器` / `收尾时也没有分页器`。

新增的断言：
- 内部格子外观：`内部格子与主网格同一圆角 / 同一描边宽度 / 同一描边颜色 / 同一背景色`，
  以及真值检查 `内部格子真的用上了设置的背景[rgba(255,136,0,1)]` / `…描边[3px / rgb(34,255,68)]` /
  `…圆角[20px]`，最后 `还原后内部格子与主网格依然一致`。
  （踩坑：`setSetting` 会触发重渲染，旧的 tile 引用变成游离节点、`getComputedStyle` 读出来全是空串 ——
  所以设置改完必须重新 `querySelector`；另外这几项外观是设置面板直接写 CSS 变量的，
  `setSetting` 本身不更新变量，测试里补了一次 `KL.app.applyVars()`。）
- 列表模式：`内部单列[1fr]` / `文件夹带 folder-list 标记` / `内部项打上 list-row` /
  `每行显示名称[Git Bash]` / `行高比网格行矮（图标缩到 55%）[44 < 68]` / `图标贴左边[7]` /
  `名称在图标右侧` / `名称在行内部` / `行铺满内部宽度`；切回后 `列模板恢复` / `不再有 list-row` / `行高恢复`。
- 菜单：`大文件夹右键菜单有「内部显示方式」` / `菜单里有「列表」选项` / `菜单已关闭` /
  `小文件夹菜单里没有「内部显示方式」`。
- 比例：`主网格图标与格子是 72%[72% (66/92)]` / `内部图标与格子的比例也是 72%[72% (42/58)]` /
  `内部图标没有被格子箍满（留出内边距）` / `「与主格一致」时内部格子 = 主网格格子[92 vs 92]` /
  `「与主格一致」时内部图标 = 主网格图标[66 vs 66]`。

`tools/layout-test.html`（35）跟着改横纵步长后仍全 PASS；`tip-test`（22）、`uitest`（16）、`dedup-test`（16）、`offline-test`（12）全 PASS；`release.js` 与 `smoke.js` 通过。

截图实测（拉长格子）：①显名 `4×1 图标66px 贴左7px / 格子内名称=显示（图标右侧 在格子内=true）/ 格子下方名称=显示（在格子下方=true）`、`1×4` 同理；②隐名 `格子内名称=显示`、`格子下方名称=隐藏`。

截图实测（名称位置）：两栏同数据同格子 —— ①显名 `格子 92×92 图标 66 行距 43 名称在下方(3px) 文件夹标题在格子下方=true 页标=0`；②隐名 `格子 92×92 图标 66 行距 10 名称隐藏 文件夹标题隐藏 页标=0`。

## v1.7.0 — 批量摆放 + 联网开关 + 日志噪音（2026-10-12）

### 1. 新增：批量摆放（多选整组平移）

**需求**：多选图标原来只能批量改分类，不能批量挪位置。希望多选后能整体拖到别处，并且**保留各图标之间的相对位置**（自由摆放模式）；自动对齐时则维持原来的"往上挤紧"。

**问题**：`dropFree()` 是逐个 `nearestFree()` 找空位的 —— 一组图标被丢到落点附近时会被打散成一堆，谁在谁旁边、中间隔几格全丢了。

**修复**（`js/grid.js`）：
- `dragHint` 增加 `grabbed`：记下**被抓住的那个图标**（多选时 `ids` 是整个选区，顺序是 Set 的插入序，不一定是被抓的那个）。
- `groupItems(ids, grabbed)`：以 grabbed 为原点，算出组内每个图标的相对偏移 `(dx, dy)` 与跨度。**只要有成员没有格子坐标就返回 null**（例如刚从大文件夹里拖出来的内部图标，进文件夹时坐标已被清空）。
- `groupFits(p, items, ox, oy, cols)`：整组能否落在该原点 —— 不越界、不压别的图标、**组内也不自压**（用 `seen` 集合，防止组内成员本来就重叠的情况）。
- `groupOrigin(p, items, cx, cy, cols)`：先把整组左上角夹回 `[-minDx, cols - maxRight]`（保证不横着跑出列数），再从落点按曼哈顿距离找最近一个"整组放得下"的位置；**找不到就返回 null**（组比窗口还宽），调用方退化成逐个找空位并提示一句。
- 落点虚框改成**一组**：`ghostEls` 数组，每个成员一个 `.drop-cell`，按选区形状铺开 —— 用户能提前看到整组会落在哪，而不是只有一个方块。
- 多选工具条加提示「拖动可整体摆放」（自由摆放 + 选中 >1 项时才出现），否则没人知道有这个能力。

### 2. 新增设置项「浏览器图标」：联网获取 / 仅本地

`fetchFavicon()` 开头加一道闸门：`online === false` 时**一个请求都不发**，直接返回 `{ ok: false, offline: true }`。抓网站图标是这个插件里唯一会联网的功能，关掉之后完全离线；网址图标退回快捷方式自带的 `.ico`（`iconLocation`），再不行就是字形图标。

- `js/store.js` 新增 `faviconOnline`（默认 `true`）。
- `js/icons.js` 与图标选择器里的「从图标地址拉取」都把设置传进去。
- 图标选择器那个手动拉取按钮在「仅本地」下会给出明确提示而不是静默失败。
- 设置项放在「第三方图标服务」上面（先决定要不要联网，再决定用哪家服务），并在离线时把服务输入框置灰。

### 3. 修复：`plugin.log` 里的重复噪音

`preload.js` 末尾无条件 `log('contextBridge expose skipped', e.message)` —— 但 uTools 默认关闭 `contextIsolation`，这时 `contextBridge` 本来就不可用，`window.services` 已经挂好了，功能完全正常。结果是**每次进入插件都往 `plugin.log` 写一行看起来像报错的记录**（用户机器上累积了 60 多条）。现在只在"`contextIsolation` 开着却依然失败"时才记录 —— 那才是真问题。

同时新增 `services.clearLog()` 并在「设置 → 其他」加了「清空日志」按钮 —— 之前攒了一堆日志只能去数据目录手动删。**注意：改的是 `preload.js`，需要完全重启 uTools 才生效**（只重载插件页面不够）。

### 验证

- `tools/layout-test.html` 扩到 **35 条断言全 PASS**，其中新增的批量摆放部分是**真实 DragEvent 全链路**（`dragstart → dragover → drop`，用 `new DataTransfer()` 构造）：
  - `multi-select-built`：ctrl+click 造出的多选是 3/3
  - `synthetic-drag-accepted`：`DataTransfer` 确实挂上了事件（不是靠直接调内部函数绕过去）
  - `ghost-one-cell-per-item`：落点虚框数量 == 组内图标数（3/3）
  - `group-keeps-relative-offsets`：`0,0 3,0 3,1 → 0,0 3,0 3,1`（含中间空列也原样保留）
  - `group-lands-where-dropped`、`group-drop-does-not-move-others`、`ghost-cleared-after-drop`
  - `clamped-group-keeps-shape` + `clamped-group-stays-in-columns`：贴右缘落点被夹回来后形状不变、不越界
- 新增 `tools/offline-test.js`：**12 项全 PASS**。把 `fetchFavicon` 的**真实源码**从 `preload.js` 里抽出来，用桩 `request` 注入后跑：
  - `offline-blocks-all-requests`（连第三方图标服务模板也一个请求都不发）
  - `online-does-request` / `default-is-online` / `missing-options-is-online`（老数据没有这个设置项时不能突然变哑巴）
  - 静态守卫：catch 块里有 `contextIsolation` 判断且不是无条件 `log(`
  
  为什么不直接 `require('../preload.js')`：它顶层会碰 `window`/`electron`/`utools`，而且失败分支会往用户真实数据目录写日志 —— 抽源码跑更干净。
- 像素复核截图：`#`/`.` 占用图显示批量拖拽后第 3 行出现 `# # # #`（GitHub 1 格 + ESP-IDF 文档 2 格 + 哔哩哔哩 1 格，中间空列也被正确保留），未参与拖拽的「知乎」留在原处第 1 行第 5 列；`ghosts=0` 说明落点虚框已清理。
- `uitest`（16）、`dedup-test`（16）、`tip-test`（20）全 PASS；`release.js`（12 文件 / 260 KB）与 `smoke.js` 通过。

### 已知边界

- 组内**有成员没有格子坐标**时（例如刚从大文件夹里拖出来的内部图标），退化成逐个找空位并提示一句 —— 这种组没有相对位置可言。
- 组比窗口还宽时（列数不够）同样退化，形状无法保留。

---

## v1.6.0 — 新增「自动对齐 / 自由摆放」开关（2026-10-12）

### 需求

新增设置项「自动对齐」，默认开启：开启时移动图标会自动补齐空位（= 现有行为）；关闭后不自动补齐，图标按格子自由摆放。

### 做了什么

原来的布局模型里**没有坐标** —— 每个快捷方式只有 `col` / `row`（**跨度**，1~4），位置完全交给 CSS `grid-auto-flow: row dense` 按 DOM 顺序算出来。所以"自动补齐空位"不是一段逻辑，而是 CSS 的行为；要做到"不补齐、按格子自由摆放"，必须给每个图标真正的格子坐标。

- **数据模型**（`js/store.js`）：新增 `x` / `y`（0 起的格子坐标，可空）。新增设置项 `autoAlign`（默认 `true`）。新增 `setPositions(map, silent)` / `setPosition(id, x, y)` / `clearPositions(ids)`。
- **布局引擎**（`js/grid.js`）：
  - `gridMetrics()`：列数不靠算术猜，直接读 `getComputedStyle(gridEl).gridTemplateColumns` 数 track 个数 —— `repeat(auto-fill, var(--cell))` 会按容器宽度解析成实际列表，最准。
  - `makePacker(cols)`：占位登记 + `fits()` / `mark()` / `firstFree()` / `nearestFree()`。
  - `layoutFree(list, m, existing)`：算出这一屏每个图标的落格。
  - `cellFromPoint()`：鼠标坐标 → 格子号。
  - `dropFree(ids, x, y)`：自由摆放下的落子。
  - `repack()`：清掉位置让图标按当前顺序重新密排（供切换排序时用）。
- **渲染**（`render()`）：自由摆放时给每个 tile 写 `gridColumn: (x+1) / span col`、`gridRow: (y+1) / span row`；自动对齐时行为与改动前完全一致。
- **拖拽落点虚框**：新增 `.drop-cell` 元素。它本身就是 `.grid` 的子元素，所以直接给它 `grid-column` / `grid-row` 就能精确压在目标格上，不用把格子换算成像素。拖到大文件夹上时隐藏（那是"移入文件夹"的既有行为）。
- **设置界面**（`js/dialogs.js`）：在「排列顺序」下面加了一行「自动对齐」，两个档：自动补齐 / 自由摆放。

### 理由

- **为什么必须引入真正的坐标，而不是只把 `dense` 去掉**：`grid-auto-flow: row`（不带 dense）只是不再让后面的小图标回填前面的空洞，图标仍然严格按 DOM 顺序流式排布 —— 做不到"把图标放到任意空格"。用户的诉求是后者。
- **没有坐标的图标统一用"从 y=0 逐行扫的第一个空位"补位**：这正是 CSS `dense` 的算法。所以**从自动对齐切到自由摆放时画面完全不动**（回归测试里用像素矩形逐项比对过）—— 切换无感，用户不会觉得"开了个开关图标全乱了"。
- **渲染时把没有坐标的图标就地钉住（`setPositions(pin, true)`，silent）**：这是开发过程中发现的关键坑。第一版只在拖拽时写坐标，其他图标仍是无坐标状态 —— 于是每次渲染都按当时的顺序给它们重新补位，**任何一个图标挪了格子，后面所有无坐标的图标都会跟着跳**（回归测试直接抓到：`collision-drop-does-not-move-others` 报出三个图标同时移位）。改成"渲染时把这一屏全部钉住"之后布局就是稳定的。
  - `silent` 参数是必需的：`render()` 正跑到一半，如果 `setPositions` 抛出 `shortcuts` 事件，会重入 `render()` 把刚建好的节点冲掉。
- **坐标只算不写回、窗口变窄时用夹取而不是改写数据**：用户把窗口拖窄时列数会变少，如果这时把"挤压后的位置"写回数据，把窗口拉宽也回不来了。现在的做法是渲染时临时夹取 / 下移，数据保持原样 —— 窗口变宽即复原（回归测试 `positions-survive-toggle`）。
- **落子规则：落点格空着就精确落格；被占就找最近的空位**（按曼哈顿距离，再比 y 小、x 小）。否决了"和占用者交换位置"——多选拖拽、跨度不同的情况下交换的定义会变得很绕，而且"交换"意味着另一个图标也被动移动，违背"我只想挪这一个"。
- **拖到大文件夹上仍然是"移入文件夹"**，不做落格。这是已经建立的交互，改掉反而危险；想放到文件夹旁边就拖到它周围的空格。
- **`setParent` 进入文件夹时清掉 x/y**：文件夹内部的图标由文件夹自己的网格排布，留着旧坐标没有意义；移出来时重新找一个空位。
- **切换「排列顺序」时重新密排**：自由摆放下位置是写死的，不重排的话按名称/时间排序完全看不出变化。用户按下排序键的意图就是"重排"，所以清掉坐标按新顺序重新密排。

### 验证

新增 `tools/layout-test.html`（iframe 加载真实 `index.html`，**26 条断言全 PASS**）：

| 断言 | 说明 |
|---|---|
| `switch-to-free-keeps-layout` | 切到自由摆放后，20 个图标的像素矩形**逐个**与自动模式一致（不跳） |
| `free-mode-uses-explicit-positions` / `free-mode-no-overlap` | 20/20 都有显式坐标；33 格占用无重叠 |
| `drop-lands-on-target-cell` / `old-cell-left-empty` | 拖到空位精确落格；**原位置留空**（核心需求） |
| `drop-does-not-move-others` / `collision-drop-does-not-move-others` / `multi-drop-does-not-move-others` | 三种落子（空位 / 被占 / 多选）都不影响其他图标 |
| `drop-on-occupied-goes-somewhere-free` | 落点被占时挪到空位，且没压住占用者 |
| `back-to-auto-restores-dense-layout` | 打开自动对齐后回到改变前的密排 |
| `positions-survive-toggle` / `moved-tile-still-where-it-was-put` | 关掉再打开，摆好的位置原样回来 |
| `sort-change-repacks-layout` / `repack-follows-name-order` / `repack-starts-at-origin` / `repack-is-dense` | 换排序会重排、顺序对、从左上角起排、无重叠 |
| `position-cleared-when-into-folder` | 拖进文件夹后坐标清空 |

另外用像素复核了截图：`#`/`.` 占用图显示自动模式 5 个图标全在第 1 行，自由摆放模式第 1 行第 5 列留空、被拖走的那一个停在第 3 行第 4 列。

`uitest`（16）、`dedup-test`（16）、`tip-test`（20）全 PASS；`release.js`（12 文件 / 259 KB）与 `smoke.js`（20 tiles / 25 resize handles，与改动前一致）通过。

### 已知边界

- **自由摆放只在主网格生效**：大文件夹内部的图标、文件夹弹层（`.fv-grid`）仍按各自的网格自动排布。
- **"全部"分类下近似**：坐标是「每个快捷方式一份」，而"全部"视图把各分类的图标混在一起显示，不同分类里摆到同一格的图标在"全部"视图中会被临时挤开（不写回数据，各自分类视图里位置不变）。
- 窗口变窄时被临时挤开的图标，回到宽窗口会复原 —— 这是刻意的，但意味着**窄窗口下看到的排布不是真实排布**。

---

## v1.5.3 — 无字模式下光标悬浮显示图标名称（2026-10-11）

### 问题

开启「无字模式」（`showLabels: false`）后图标不显示标题，纯靠图形认不出来是哪个，尤其是几个图标配色相近或者自己刚换过图标的时候。

### 修复

新增「光标名称气泡」：无字模式下光标停在图标上，就在光标处弹出一个小气泡显示名称。

- `js/ui.js` 新增 `KL.ui.tip`，三个方法：
  - `hover(text, x, y)`：进入某个带名称的元素时调用。**首次弹出有 120ms 延迟**；已经在显示时直接换字（在同一排图标上划过时不会一闪一闪）。`text` 为空则收起。
  - `move(x, y)`：在元素内移动时调用，气泡跟着光标走。
  - `hide()`：收起。
  - 位置：贴在光标右下（+14 / +18），右边放不下就左移夹进视口，下边放不下就翻到光标<b>上方</b>，始终留 6px 视口边距。
- `css/style.css` 新增 `.tip`：`position: fixed`、`z-index: 85`、`max-width: min(340px, calc(100vw - 16px))`、`word-break: break-all`，底色用 `var(--text)`、字色用 `var(--bg)`（两个主题下都是高对比的"反色小胶囊"）。**`pointer-events: none` 是必须的**——否则鼠标从图标移进气泡会触发图标的 `mouseleave`，气泡就会闪。
- `js/grid.js` 新增 `attachNameTip(node, name)` 并接到三处：`buildTile`（普通图标）、`buildFolderTile` 的 `folder-mini` 分支（小文件夹的标题同样被无字模式隐藏）、`buildInnerTile`（大文件夹内部的图标）。
- 收起时机（`mouseleave` 不一定会来的情况统一兜底）：`mouseleave` 离开图标、`render()` 重渲染、`KL.ui.menu()` / `KL.ui.modal()` 打开、`dragstart`、窗口 `blur`、任意元素滚动（capture 监听）、鼠标移出窗口。

### 理由

- **按 `!showLabels` 判断而不是看 DOM 上有没有 `.label`**：文件夹视图（`.fv-name`）的名称不受无字模式影响、始终可见，用设置项判断语义最清楚。
- **大文件夹（m×n）自己不弹**：它的 `.folder-name` 名称条一直可见，再弹一个同名气泡是噪音。内部的 `.inner-tile` 标题是被隐藏的，所以内部图标照弹。
- **`mouseenter` / `mouseleave` 不冒泡正好合适**：大文件夹内部的图标悬停不会触发外层文件夹的逻辑，反之亦然，不需要额外 stopPropagation。
- **用 `e.buttons` 判断"鼠标是否按着"，而不是自己维护状态**：橡皮筋框选、拖拽排序、拉大小都会让光标从图标上划过，用状态机的话鼠标在窗口外松开收不到 `mouseup` 会卡死，`e.buttons` 是天然自愈的。
- **被否决的方案**：给 `.tile` 加 `title` 属性用系统原生 tooltip。理由——原生 tooltip 出现位置由系统决定（通常钉在元素边缘），不跟着光标走，也夹不进自定义样式，和「在光标处弹出」的要求不符。原有的 `label.title` 保留着，只是无字模式下 label 被 `display:none`，不会触发。

### 验证

- 新增 `tools/tip-test.html`：iframe 加载真实 `index.html?theme=dark&labels=0`，派发真实鼠标事件，**20 条断言全 PASS**：
  - 无字模式悬浮 → 弹出且文字与图标名一致；`pointer-events` 为 `none`
  - 位置贴着光标（`+14/+18`）；`mousemove` 后跟着走（`334,278`）
  - 贴到窗口右下角（`vw-4, vh-4`）时气泡被夹在 `711,480 → 776,508`，全在 `782×524` 内
  - 小文件夹 `常用小工具` 会弹；大文件夹自己不弹；大文件夹内的 `Git Bash` 会弹
  - 移出图标 / 按住鼠标（`buttons: 1`）/ 右键菜单弹出 / 重渲染 → 都收起
  - 显示标题时不弹；长名称不溢出（`scrollWidth === clientWidth`）；`.tip` 元素始终只有一个
- 无头截图复核：`.tip` 的 `getBoundingClientRect()` 实测 `VS Code@616,285`、`Git Bash@251,139`，并在截图里按像素确认了高亮胶囊的存在。
- 顺带给预览桩加了 `?labels=0` 开关（直接进无字模式），截图与手工验证都用得上。
- `uitest` 16 条、`dedup-test` 16 条全 PASS；`release.js`（12 文件 / 258 KB）与 `smoke.js` 通过。

---

## v1.5.2 — 修复 PWA 快捷方式添加不进去（2026-10-11）

### 问题

浏览器「将网页安装为应用」生成的快捷方式拖进来添加失败。用户报的实例是桌面上的 `D:\WinDesktop\AI\豆包网页.lnk`，提示「没有可添加的项目（1 个重复或无效）」。

用项目自带的 `ps-bridge.ps1` 解析这个快捷方式，拿到的是：

```
target = C:\Program Files\Google\Chrome\Application\chrome_proxy.exe
args   =  --profile-directory=Default --app-id=nfjhphkhjelhenadmhihghlkccjdpdkk
```

`chrome_proxy.exe` 是 Chrome 给**所有** PWA 共用的壳，每个 PWA 之间只靠 `--app-id=` 区分。而 `ingestPaths()` 里的判重只有一句：

```js
if (r.target && store.findByTarget(r.target)) { skipped++; continue }
```

`store.findByTarget()` 只比 `launch.target`，不看 `launch.args`。用户面板里已经有 `chrome-元宝`（`chrome_proxy.exe --app-id=bdhfnopb…`），于是：

| | 旧逻辑 `findByTarget` | 新逻辑 `findByLaunch` |
|---|---|---|
| 拖入 `豆包网页.lnk`（`chrome_proxy.exe --app-id=nfjhphk…`） | 命中 `chrome-元宝` → 判为重复跳过 | 不命中 → 正常添加 |

也就是说 **Chrome 的所有 PWA 里，只有第一个能加进来，之后每一个都会被判成重复**。Edge 的 `msedge_proxy.exe` 同理。

### 修复

- `js/store.js` 新增 `normArgs(a)` 与 `findByLaunch(launch)`：
  - `normArgs`：去首尾空白、把连续空白压成一个空格、统一小写。
  - `findByLaunch` 按 **kind + target + args** 三者一起判重：
    - `url` → 按 URL 比（并限定必须是 `url` 类型的条目）；
    - `appid` → 按 `appId` 比（UWP 的身份是 AppID，不是 `shell:AppsFolder\` 那层壳）；
    - 其余（`path`）→ 比 `target` + 归一化后的 `args`。
- `js/dialogs.js` 的 `ingestPaths()` 改用 `store.findByLaunch(launch)`，替掉原来的 `findByTarget` + `findByUrl` 两句。
- 顺带改掉含糊的提示：被跳过的项现在会**点名**，例如
  「没有新增：『豆包网页』已在面板中」，而不是「没有可添加的项目（1 个重复或无效）」。原提示把「重复」和「解析失败」混成一个数字，用户完全没法自查——这次要不是自己翻 `ps-bridge` 输出，光看提示确实会以为图标解析挂了。
- 清掉 `ingestPaths()` 里只写不读的 `names` 变量。

### 理由

- **不改成「按 .lnk 原始路径判重」**：原始路径确实天然唯一，但同一份快捷方式从桌面拖一次、之后再从开始菜单拖一次，路径不同却该算同一个；而且用户把 .lnk 删掉重装后路径也会变。按「实际会执行什么」判重更贴合语义。
- **不把 args 精确串比就直接忽略**：`WScript.Shell` 返回的 args 带前导空格（`" --profile-directory=…"`），Chrome 不同版本对 `--profile-directory=Default` 的大小写也可能不一致，所以先归一化再比。
- **`findByUrl` 保持不变**：它在「添加网址」等处被用到，那里的宽松匹配（不比 kind）没有坏处，不动它以免引入别的行为差异。
- **`ingestApps()`（应用扫描）暂不动**：扫描来源里开始菜单项的 `target` 存的是 **.lnk 自己的路径**（不是解析后的 exe），天然每个 PWA 都不同，不会撞；改它反而会改变既有行为。留了注释说明。

### 验证

- 真实数据复现：读取用户实际的 `%APPDATA%\uTools\shortcut-launcher\data.json`（147 条），对 `豆包网页.lnk` 解析出的 target+args 跑新旧两套判重 —— 旧逻辑命中 `chrome-元宝`，新逻辑不命中。根因确认。
- 真实图标提取：`ps-bridge.ps1 -Mode icons` 对 `豆包网页.lnk` / `元宝.lnk` 均返回 256×256 PNG（119 KB / 95 KB），所以「添加失败」与图标无关。
- 新增 `tools/dedup-test.html`：iframe 加载真实 `index.html`，用假 `resolvePaths` 喂 7 行给真实的 `ingestPaths()`，**16 条断言全 PASS**：
  - 两个 PWA（target 相同、`--app-id` 不同）都能加进去，且落库后 target 确实相同
  - target + args 全同的副本被跳过；同 exe 且都无参数的也被跳过
  - 同 exe 参数不同（`--new-window`）能各自添加，args 原样保存
  - `findByLaunch` 能区分参数、能归一化参数（前导/多余空格 + 大小写）、不跨 kind 误命中
  - 同样输入再跑一次，`added = 0`（幂等）
- `tools/uitest.html` 16 条断言复跑全 PASS；`node tools/release.js` 通过（12 文件 / 257 KB，`dist/plugin.json` 也是 1.5.2）；`node tools/smoke.js` 通过。

---

## v1.5.1 — 修复二级菜单越界被裁（2026-10-11）

### 问题

右键菜单里的二级菜单（「图标尺寸」「移动到分类」「放进已有文件夹」等）一旦靠近插件窗口边缘就整个跑到窗口外：既看不见，也点不到。uTools 插件窗口很窄（默认约 800×620），这类菜单很容易触发。

用户截图复现：主菜单在右侧，悬停「图标尺寸」后展开的尺寸列表只露出 `1 ×`、`2 ×` 的半截，其余全在窗口外。

### 修复

- `js/ui.js` 新增 `placeSub(row, sub)`，在**每次悬停**时重新计算二级菜单位置：
  - 水平：默认贴父项右侧；右侧放不下且左侧放得下就翻到**左侧**展开；两侧都放不下则夹进视口。
  - 垂直：默认与父项顶部对齐向下展开；下方放不下就改为**向上展开**（底边对齐父项底边）；子菜单比整个窗口还高时退回贴顶。
  - 与父项横向/纵向都保持 4~5px 重叠，鼠标从父项移进子菜单不会中途丢失 hover。
- `css/style.css`：`.ctx .sub` 由 `position:absolute; left:100%`（完全无视边界）改为 `position:fixed`，位置交给 `placeSub()`；同时给 `.ctx` 与 `.ctx .sub` 加 `max-height: calc(100vh - 12px)` + `overflow-y:auto` + `overscroll-behavior:contain`，作为超高菜单的兜底。

### 理由

- **改成 `position: fixed` 而不是继续用相对定位 + transform 夹取**：被否决的方案是保留 `.sub` 相对 `.item` 的 `position:absolute`，用 `transform: translate()` 把溢出的部分拉回来。否决理由——父项自身的 left 本来就可能是被 `menu()` 夹过之后的非预期值，相对坐标推导要多绕一层，且 `transform` 会让 `.sub` 成为新的包含块，嵌套三级菜单会连锁出错。`position:fixed` 直接用视口坐标，夹取逻辑最直观。
- **垂直用"向上展开"而不是"整体上移到窗口内"**：第一版实现是 `top = vh - M - height`（把子菜单贴到窗口下缘）。实测在 782×524 下，父项在 y≈413、子菜单高 252，子菜单被推到 y=266 —— 与父项完全没有纵向重叠，鼠标从父项横移过去的瞬间 hover 就断了，等于换个方式点不到。改成底边对齐父项底边后，任何情况下两者都有整整一行（30px）的重叠。
- **保留 4~5px 重叠而不是留间隙**：留间隙同样会打断 hover。
- **`max-height` + 滚动而不是无限夹取**：子菜单可能比窗口还高（40 个分类），夹取解决不了，必须让它自己滚。

### 验证

- 新增 `tools/uitest.html`：**用 iframe 加载真实的 `index.html`**（782×524 模拟 uTools 窄窗口），不再复制页面结构，避免测试与页面脱节。16 条断言全 PASS：
  - 左侧正常位置仍朝右展开（防回归，`dir=right`）
  - 靠近右缘 / 右下角 / 贴最右下角 / 很窄 四种位置，子菜单均在视口内且与父项纵向重叠 30px
  - 40 项的超高子菜单被夹在 `6..518`（正好是 `100vh-12`），`scrollHeight=1210 > clientHeight=510`，滚动兜底生效
  - 端到端跑真实链路的 `KL.grid.showTileMenu()`，子菜单 `432,167 → 582,419` 全在视口内、与父项重叠 30px
- 无头 Chrome 截图肉眼复核：二级菜单翻到主菜单左侧、底边与「图标尺寸」一行齐平，完整可见。
- `node tools/release.js` 与 `node tools/smoke.js` 复跑通过（发布目录 12 文件 / 257 KB，20 个 tile 正常渲染）。
- 为此加了截图/回归用的预览钩子 `?dlg=menu&x=660&y=120&expand=图标尺寸`（`js/mock.js`）：无头截图里没法触发 `:hover`，钩子会派发 `mouseenter` 并兜底 `display:block`，把指定二级菜单展开后出图，便于人工复核。
- 顺手补掉测试自身的一个坑：`tools/uitest.html` 在 `file://` 下若缺 `--allow-file-access-from-files`，原来会直接抛 `Blocked a frame with origin "null" from accessing a cross-origin frame` 这种没法自查的原始错误；现在会把这句原话连同一行修复建议一起打进结果。

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
- 修正 `docs/使用手册.md` 中数据目录说明的错误：日志文件名写成了 `app.log`，实际是
  `plugin.log`（`preload.js` 的 `LOG_FILE`）；同时补上 `tmp/` 临时目录。

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
