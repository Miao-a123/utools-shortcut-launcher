/* 文档-代码一致性自检。
 *
 * 为什么需要：这个项目的文档（README / CHANGELOG / 使用手册）写得非常详细，
 * 但详细文档最容易和代码漂移。历史上已经出现过多次：
 *   · 手册写的版本号停在旧版
 *   · README 写"三态勾选"，代码只有两态
 *   · README 与 release.js 都宣称检查 *.map，但 FORBIDDEN 里没这条规则
 *   · CHANGELOG 说删掉了角标，代码里小文件夹还在用
 *   · 手册里提到"清空图标缓存"这种根本不存在的按钮
 * 这些都不是逻辑 bug，却会直接影响审核（手册是提交 uTools 的物料）。
 * 所以把能自动判的部分固化成断言。
 *
 * 跑法：node tools/doc-test.js
 */
'use strict'
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8')

const manual = read('docs/使用手册.md')
const readme = read('README.md')
const changelog = read('docs/CHANGELOG.md')
const pluginJson = JSON.parse(read('plugin.json'))
const dialogs = read('js/dialogs.js')
const grid = read('js/grid.js')
const app = read('js/app.js')
const indexHtml = read('index.html')
const releaseJs = read('tools/release.js')

let pass = 0
let fail = 0
function ok (name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

/* ---------------- 1. 版本号四处一致 ---------------- */
console.log('\n== 版本号 ==')
const vPlugin = pluginJson.version
const mV = /const VERSION = '([^']+)'/.exec(dialogs)
const vDialogs = mV ? mV[1] : ''
const mCL = /const CHANGELOG = \[\s*\{\s*v: '([^']+)'/.exec(dialogs)
const vBuiltin = mCL ? mCL[1] : ''
const mDoc = /^## (v[0-9.]+)/m.exec(changelog)
const vDoc = mDoc ? mDoc[1].replace(/^v/, '') : ''
const mManual = /- 版本：([0-9.]+)/.exec(manual)
const vManual = mManual ? mManual[1] : ''

ok('plugin.json 有版本号', !!vPlugin, vPlugin)
ok('dialogs.js VERSION 与 plugin.json 一致', vDialogs === vPlugin, vDialogs + ' vs ' + vPlugin)
ok('内置 CHANGELOG 首条与 plugin.json 一致', vBuiltin === vPlugin, vBuiltin + ' vs ' + vPlugin)
ok('docs/CHANGELOG 首章与 plugin.json 一致', vDoc === vPlugin, vDoc + ' vs ' + vPlugin)
ok('使用手册版本号与 plugin.json 一致', vManual === vPlugin, vManual + ' vs ' + vPlugin)

/* ---------------- 2. 使用手册的 Markdown 结构 ---------------- */
console.log('\n== 使用手册结构 ==')
{
  const lines = manual.split(/\r?\n/)
  /* GFM 表格遇到空行就结束。若"表格行 → 空行 → 引用块 → 表格行"这种交替出现，
     后面的表格行会被当成普通段落，页面上显示成带竖线的文字。
     判据：出现过表格行之后，若又出现"以 | 开头"的行、而它与上一个表格行之间夹了空行，
     且中间没有别的标题/代码块，就认为表格被切断了。 */
  let broken = []
  let lastTable = -1
  for (let i = 0; i < lines.length; i++) {
    const isTable = /^\s*\|/.test(lines[i])
    if (!isTable) continue
    if (lastTable >= 0 && i > lastTable + 1) {
      // 中间隔了东西：只要中间没有标题行/分隔线，就说明表格被硬切断
      const between = lines.slice(lastTable + 1, i)
      const hasHeading = between.some(l => /^#{1,6}\s/.test(l))
      const hasHr = between.some(l => /^---+$/.test(l.trim()))
      if (!hasHeading && !hasHr) broken.push('第 ' + (i + 1) + ' 行')
    }
    lastTable = i
  }
  ok('没有被打断的表格（引用块/空行插在表格中间）', broken.length === 0, broken.slice(0, 3).join(', '))
}

/* ---------------- 3. 手册里提到的按钮/菜单必须在代码里存在 ---------------- */
console.log('\n== 手册提到的功能确实存在 ==')
const allCode = dialogs + grid + app + indexHtml
function mentions (text, label) {
  ok('手册提到的「' + label + '」在代码里存在', text.indexOf(label) >= 0)
}
mentions(allCode, '重建全部图标')
mentions(allCode, '查看日志')
mentions(allCode, '清空日志')
mentions(allCode, '更新日志')
mentions(allCode, '第三方图标服务')
/* 反向：手册不该提到不存在的东西 */
ok('手册没有提"清空图标缓存"（该功能不存在）', manual.indexOf('清空图标缓存') < 0)

/* ---------------- 4. 底部批量条 vs 右键批量菜单 ---------------- */
console.log('\n== 批量操作入口 ==')
{
  const selbarIds = (indexHtml.match(/id="sel[A-Za-z]+"/g) || []).join(',')
  ok('底部批量条有「装进文件夹」按钮', /id="selFolder"/.test(indexHtml), selbarIds)
  const batchMenu = /function batchMenu[\s\S]*?\n  \}/.exec(dialogs)
  const bm = batchMenu ? batchMenu[0] : ''
  ok('右键批量菜单里没有「装进文件夹」', bm.length > 0 && bm.indexOf('装进文件夹') < 0)
  ok('手册已说明「装进文件夹」只在底部批量条',
    /装进文件夹.*只在这个批量条|只在这个批量条/.test(manual))
}

/* ---------------- 5. 侧边栏 + 的位置 ---------------- */
console.log('\n== 侧边栏 ==')
{
  /* 侧边栏是 顶部 side-title（含 +）→ 分类列表 → 底部 side-foot（设置）。
     手册不该说"边栏底部新建分类"。 */
  const headHasPlus = /side-title[\s\S]{0,400}?addBtn/.test(app) || /side-title[\s\S]{0,300}?'\+'/.test(app)
  ok('代码里「+」在侧边栏顶部（side-title 内）', headHasPlus)
  ok('手册没有说「边栏底部」是分类列表/新建分类',
    !/边栏底部是分类列表|侧边栏底部是分类列表/.test(manual))
  ok('手册提到「+」在顶部', /顶部.*\+/.test(manual))
}

/* ---------------- 6. 「添加」菜单里的批量入口 ---------------- */
console.log('\n== 扫描/收藏夹入口位置 ==')
{
  const addMenu = /btnAdd'\)\.addEventListener[\s\S]*?\]\s*,\s*\{ x: r\.left/.exec(app)
  const am = addMenu ? addMenu[0] : ''
  ok('「添加」菜单里有「扫描本机应用」', am.indexOf('扫描本机应用') >= 0)
  ok('「添加」菜单里有「导入浏览器收藏夹」', am.indexOf('导入浏览器收藏夹') >= 0)
  ok('手册说的是「添加」菜单而不是「底部」', /「添加」菜单里.*批量入口/.test(manual))
}

/* ---------------- 7. 收藏夹勾选三态 ---------------- */
console.log('\n== 收藏夹三态勾选 ==')
{
  const css = read('css/style.css')
  ok('代码里有半选 class（.part）', /\.check\.part/.test(css))
  ok('JS 里给勾选框加了 part', /classList\.toggle\('part'/.test(dialogs))
  ok('README 声称的「三态勾选」现在成立', /三态/.test(readme) && /\.check\.part/.test(css))
}

/* ---------------- 8. *.map 检查真的实现了 ---------------- */
console.log('\n== release.js 的 *.map 检查 ==')
{
  ok('release.js 里有 *.map 的实际判定', /\\\.map\$/.test(releaseJs) || /\.map\$/i.test(releaseJs))
  ok('README 提到 *.map 检查', readme.indexOf('*.map') >= 0)
}

/* ---------------- 9. CHANGELOG 里的设计描述与代码一致 ---------------- */
console.log('\n== CHANGELOG 与代码 ==')
{
  ok('小文件夹仍有数量角标（代码）', /folder-badge/.test(grid))
  ok('CHANGELOG 已说明小文件夹保留角标', /小文件夹仍保留右上角数量角标|1×1 小文件夹仍保留/.test(changelog))
  ok('CHANGELOG 不再把 folder-head 说成已全删',
    !/删掉 `\.tile \.folder-head`[\s\S]{0,40}那套样式与右上角数量角标分支；\s*\n\s*\n### /.test(changelog) ||
    changelog.indexOf('1×1 小文件夹仍保留') > 0)
  ok('CHANGELOG 里没有过时的 .folder-name 引用',
    !/它的 `\.folder-name` 名称条/.test(changelog))
  /* 打分公式：代码是 rowFill²，注释和文档都要一致 */
  ok('grid.js 注释写的是 rowFill²', /× rowFill²/.test(grid))
  ok('grid.js 代码用的是 rowFill * rowFill', /rowFill \* rowFill/.test(grid))
  ok('手册不再说"比较占用面积"', manual.indexOf('比较占用面积') < 0)
}

/* ---------------- 10. 菜单项文案一致 ---------------- */
console.log('\n== 菜单文案 ==')
{
  ok('代码里的菜单项是「文件夹尺寸」', /label: '文件夹尺寸'/.test(grid))
  ok('代码里的菜单项是「背景颜色」', /label: '背景颜色'/.test(grid))
  ok('代码里的菜单项是「自定义图标…」', /label: '自定义图标…'/.test(grid))
  ok('手册用的是「文件夹尺寸」', manual.indexOf('「文件夹尺寸」') >= 0)
  ok('手册用的是「背景颜色」', manual.indexOf('「背景颜色」') >= 0)
  ok('手册用的是「自定义图标…」', manual.indexOf('「自定义图标…」') >= 0)
  ok('手册不再提「更换图标」（不存在）', manual.indexOf('更换图标') < 0)
}

/* ---------------- 11. 数据目录路径 ---------------- */
console.log('\n== 数据目录 ==')
{
  const preload = read('preload.js')
  ok('preload 用 utools.getPath(userData) + shortcut-launcher',
    /safeGetPath\('userData'[\s\S]{0,80}'shortcut-launcher'/.test(preload))
  ok('手册写的是 %APPDATA%\\uTools\\shortcut-launcher', /%APPDATA%\\uTools\\shortcut-launcher/.test(manual))
  ok('手册列了 data.json', manual.indexOf('data.json') >= 0)
  ok('手册列了 plugin.log', manual.indexOf('plugin.log') >= 0)
  ok('preload 的日志文件名就是 plugin.log', /LOG_FILE = path\.join\(BASE_DIR, 'plugin\.log'\)/.test(preload))
}

/* ---------------- 汇总 ---------------- */
console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED ' + fail) + '  (' + pass + ' 项通过, ' + fail + ' 项失败)')
process.exit(fail === 0 ? 0 : 1)
