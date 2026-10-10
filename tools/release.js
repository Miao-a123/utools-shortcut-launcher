/*
 * 生成 uTools 发布目录 dist/
 *
 * 用法：node tools/release.js
 *
 * 只把「插件应用真正需要」的文件复制到 dist/，刻意排除：
 *   - .git/ .gitignore .gitattributes .vscode/ 等   → 官方 FAQ 明列要求排除
 *   - docs/ README.md tools/selftest.js tools/smoke.js tools/make-logo.py
 *                                                   → 与运行无关，且带个人路径信息
 *   - js/mock.js                                    → 仅供浏览器预览，内含个人路径样本
 *
 * 必须保留：
 *   - tools/ps-bridge.ps1   因为 preload.js 用 path.join(__dirname, 'tools', 'ps-bridge.ps1')
 *                           定位它，缺了这个文件图标提取 / .lnk 解析会全部失效
 */

const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const OUT = path.join(ROOT, 'dist')

// [源相对路径, 是否必须]
const FILES = [
  ['plugin.json', true],
  ['logo.png', true],
  ['index.html', true],
  ['preload.js', true],
  ['css/style.css', true],
  ['js/ui.js', true],
  ['js/store.js', true],
  ['js/icons.js', true],
  ['js/grid.js', true],
  ['js/dialogs.js', true],
  ['js/app.js', true],
  ['tools/ps-bridge.ps1', true]
]

// 发布目录里绝不允许出现的东西
const FORBIDDEN = [
  '.git', '.gitignore', '.gitmodules', '.github', '.vscode',
  'js/mock.js', 'node_modules', 'dist'
]

function rmrf (p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
}

function copy (rel) {
  const src = path.join(ROOT, rel)
  const dst = path.join(OUT, rel)
  if (!fs.existsSync(src)) return { rel, ok: false, error: '源文件不存在' }
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  return { rel, ok: true, size: fs.statSync(dst).size }
}

function walk (dir, base) {
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    const rel = base ? base + '/' + name : name
    if (fs.statSync(full).isDirectory()) out.push.apply(out, walk(full, rel))
    else out.push(rel)
  }
  return out
}

const errors = []
const results = []

rmrf(OUT)
fs.mkdirSync(OUT, { recursive: true })

for (const [rel, required] of FILES) {
  const r = copy(rel)
  if (!r.ok && required) errors.push(rel + ' — ' + r.error)
  results.push(r)
}

// 剔除 index.html 里的浏览器预览脚本（预览用的 mock 数据含个人路径，不入发布包）
const htmlPath = path.join(OUT, 'index.html')
if (fs.existsSync(htmlPath)) {
  let html = fs.readFileSync(htmlPath, 'utf8')
  const before = html.length
  html = html.replace(/^\s*<script src="js\/mock\.js"><\/script>\s*$/gm, '')
  fs.writeFileSync(htmlPath, html, 'utf8')
  if (html.length !== before && !/mock\.js/.test(html)) {
    console.log('· index.html 已移除浏览器预览脚本 js/mock.js')
  } else if (/mock\.js/.test(html)) {
    errors.push('index.html 里仍残留 js/mock.js 引用')
  }
}

// 合规检查
console.log('\n—— 发布目录合规检查 ——')
const present = walk(OUT, '')
const bad = present.filter(function (p) {
  return FORBIDDEN.some(function (f) { return p === f || p.indexOf(f + '/') === 0 })
})
if (bad.length) {
  errors.push('发布目录含禁止项：' + bad.join(', '))
  console.log('✗ 含禁止项：' + bad.join(', '))
} else {
  console.log('✓ 无 .git / .gitignore / .vscode / *.map / mock.js / node_modules')
}

// 外部静态资源检查（http/https 的 script/link/img）
let external = []
for (const p of present) {
  if (!/\.(html|css|js)$/.test(p)) continue
  const txt = fs.readFileSync(path.join(OUT, p), 'utf8')
  const hits = txt.match(/(?:src|href)\s*=\s*["']https?:\/\/[^"']+["']/g)
  if (hits) external = external.concat(hits.map(function (h) { return p + ' → ' + h }))
}
if (external.length) {
  errors.push('index.html/css 引用了外部静态资源：\n    ' + external.join('\n    '))
  console.log('✗ 存在外部静态资源引用：')
  for (const e of external) console.log('    ' + e)
} else {
  console.log('✓ 页面未引用任何 http(s) 静态资源（css / js / img 全在包内）')
}

// preload 压缩/混淆粗检：最长行 & 是否出现 import/export 语法
const pre = fs.readFileSync(path.join(OUT, 'preload.js'), 'utf8')
const longest = pre.split(/\r?\n/).reduce(function (m, l) { return Math.max(m, l.length) }, 0)
const esm = /^\s*(import\s+[\w{*]|export\s+(default|const|function|class))/m.test(pre)
console.log((longest > 600 ? '✗' : '✓') + ' preload.js 单行最长 ' + longest + ' 字符（>600 才像被压缩）')
console.log((esm ? '✗' : '✓') + ' preload.js 未使用 ESM 语法（import/export）')
if (esm) errors.push('preload.js 使用了 ESM 语法，规范要求 CommonJS')

// PS 桥脚本必须保持纯 ASCII（非 ASCII 会被 PowerShell 5.1 按 ANSI 解码出错）
// 开头的 UTF-8 BOM(EF BB BF) 是刻意加的（让 PS 5.1 按 UTF-8 解码），不算违规
const ps = path.join(OUT, 'tools', 'ps-bridge.ps1')
if (fs.existsSync(ps)) {
  const buf = fs.readFileSync(ps)
  const hasBOM = buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF
  const start = hasBOM ? 3 : 0
  let nonAscii = 0
  for (let i = start; i < buf.length; i++) if (buf[i] > 127) nonAscii++
  console.log((nonAscii ? '✗' : '✓') + ' ps-bridge.ps1 正文非 ASCII 字节 ' + nonAscii +
    (hasBOM ? '（含刻意保留的 UTF-8 BOM）' : ''))
  if (nonAscii) errors.push('ps-bridge.ps1 正文含 ' + nonAscii + ' 个非 ASCII 字节')
}

// plugin.json 校验
const pj = JSON.parse(fs.readFileSync(path.join(OUT, 'plugin.json'), 'utf8'))
const req = ['main', 'logo']
for (const k of req) if (!pj[k]) errors.push('plugin.json 缺少必填字段 ' + k)
if (!Array.isArray(pj.features) || !pj.features.length) errors.push('plugin.json features 为空')
if (pj.development) errors.push('plugin.json 仍保留 development 字段（发布版必须删除）')
if (pj.pluginSetting && pj.pluginSetting.height) errors.push('plugin.json 设置了固定 pluginSetting.height（不同屏幕会显示异常）')
console.log('✓ plugin.json 版本 ' + pj.version + '，' + pj.features.length + ' 个功能，无 development / 固定高度字段')

// 汇总
let total = 0
for (const p of present) total += fs.statSync(path.join(OUT, p)).size
console.log('\n—— dist/ 内容（' + present.length + ' 个文件，共 ' + (total / 1024).toFixed(1) + ' KB）——')
for (const p of present.sort()) {
  console.log('  ' + p.padEnd(26) + (fs.statSync(path.join(OUT, p)).size / 1024).toFixed(1) + ' KB')
}

if (errors.length) {
  console.log('\n!! ' + errors.length + ' 个问题：')
  for (const e of errors) console.log('   - ' + e)
  process.exitCode = 1
} else {
  console.log('\n全部通过，dist/ 可以直接在「uTools 开发者工具 → 新建项目」里指向并发布。')
}
