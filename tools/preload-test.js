/* preload 层自测：验证 v1.8.2 修掉的安全/健壮性问题。
 *
 * 为什么不用浏览器测：这些问题全在 preload（Node 侧），iframe 跑的是 mock 桩，
 * 根本触不到。这里用两种手段：
 *   1) 把 preload.js 里的纯函数源码抽出来，用 vm 跑（照 offline-test.js 的做法）；
 *   2) 对读写数据那段，复制同一套逻辑跑真实文件（照 offline-test.js 的思路）。
 *
 * 跑法：node tools/preload-test.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const os = require('os')
const vm = require('vm')

const ROOT = path.join(__dirname, '..')
const SRC = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8')

let pass = 0
let fail = 0
function ok (name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

/* 从 preload.js 里抽出某个函数的源码（按顶层 function 名匹配，配平大括号） */
function extractFn (name) {
  const re = new RegExp('(^|\\n)function\\s+' + name + '\\s*\\(', 'm')
  const m = re.exec(SRC)
  if (!m) throw new Error('找不到函数 ' + name)
  const start = m.index + (m[1] ? 1 : 0)
  let i = SRC.indexOf('{', start)
  let depth = 0
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1) }
  }
  throw new Error('括号不配平 ' + name)
}

/* ---------------- 1. 命令注入：cmd.exe 回退必须已被删除 ---------------- */
console.log('\n== 命令注入 ==')
/* 注意：注释里会提到 cmd.exe（解释为什么不能用），所以断言只针对**代码**——
   先把注释剥掉再匹配，否则会把说明文字误判成"还在用 cmd"。 */
function stripComments (s) {
  return s
    .replace(/\/\*[\s\S]*?\*\//g, '')     // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1') // 行注释（避开 http:// 里的 //）
}
const CODE = stripComments(SRC)
ok('openExternalViaShell 的代码里不再 spawn cmd.exe',
  !/function\s+openExternalViaShell[\s\S]*?cmd\.exe/.test(CODE.split('function launch')[0]))
ok('launch 的 spawn 回退分支不再 spawn cmd.exe',
  !/cp\.spawn\('cmd\.exe'/.test(CODE),
  (CODE.match(/cp\.spawn\('cmd\.exe'/g) || []).length + ' 处')
ok('整个 preload 的代码里没有 cmd.exe /c start 写法',
  !/cmd\.exe['"]\s*,\s*\[\s*['"]\/c['"]\s*,\s*['"]start['"]/.test(CODE))
ok('openExternalViaShell 失败时返回 false（不再假装成功）',
  /function\s+openExternalViaShell[\s\S]*?return false/.test(CODE))

/* ---------------- 2. 数据损坏：readData 必须抛错而不是返回 null ---------------- */
console.log('\n== 数据损坏保护 ==')
{
  const tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-preload-'))
  const DATA_FILE = path.join(tmpdir, 'data.json')

  // 用抽出来的真实源码构造一个可运行的 readData
  const fnSrc = extractFn('readData')
  const sandbox = {
    fs,
    DATA_FILE,
    log: () => {},
    ensureDirs: () => {},
    console
  }
  vm.createContext(sandbox)
  vm.runInContext(fnSrc + '\nthis.__readData = readData', sandbox)
  const readData = sandbox.__readData

  // (a) 文件不存在 → null（= 全新安装，可以写）
  ok('文件不存在时返回 null（全新安装）', readData() === null)

  // (b) 空文件 → null
  fs.writeFileSync(DATA_FILE, '   ', 'utf8')
  ok('空文件返回 null', readData() === null)

  // (c) 正常文件 → 对象
  fs.writeFileSync(DATA_FILE, JSON.stringify({ version: 1, shortcuts: [{ name: 'a' }] }), 'utf8')
  const good = readData()
  ok('正常文件返回对象', good && good.version === 1 && good.shortcuts.length === 1)

  // (d) 损坏文件 → **必须抛错**，且带 DATA_CORRUPT + 备份路径
  fs.writeFileSync(DATA_FILE, '{"version":1,"shortcuts":[{"name":"重要', 'utf8')
  let thrown = null
  try { readData() } catch (e) { thrown = e }
  ok('损坏文件抛错（不再是静默 null）', !!thrown)
  ok('错误码是 DATA_CORRUPT', thrown && thrown.code === 'DATA_CORRUPT', thrown && thrown.code)
  ok('带了备份路径', !!(thrown && thrown.backupPath), thrown && thrown.backupPath)
  ok('备份文件真的存在', !!(thrown && thrown.backupPath && fs.existsSync(thrown.backupPath)))
  ok('备份内容 = 损坏前的内容',
    !!(thrown && thrown.backupPath &&
      fs.readFileSync(thrown.backupPath, 'utf8').indexOf('重要') >= 0))

  fs.rmSync(tmpdir, { recursive: true, force: true })
}

/* ---------------- 3. store.js 必须接住 DATA_CORRUPT 并拒绝写入 ---------------- */
console.log('\n== 损坏时拒绝覆盖 ==')
{
  const storeSrc = fs.readFileSync(path.join(ROOT, 'js', 'store.js'), 'utf8')
  ok('store.load() 识别 DATA_CORRUPT', /DATA_CORRUPT/.test(storeSrc))
  ok('store 有 readOnly 状态', /readOnly/.test(storeSrc))
  ok('saveNow 在 readOnly 时直接 return', /if\s*\(\s*readOnly\s*\)\s*\{[\s\S]{0,200}?return/.test(storeSrc))
}

/* ---------------- 4. readImageAsDataUrl：任意文件读取已收窄 ---------------- */
console.log('\n== 任意文件读取 ==')
{
  const fnSrc = extractFn('looksLikeImage')
  const sandbox = { console }
  vm.createContext(sandbox)
  vm.runInContext(fnSrc + '\nthis.__looksLikeImage = looksLikeImage', sandbox)
  const looks = sandbox.__looksLikeImage

  // 真实 PNG 头
  const png = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0])
  ok('PNG 魔数被认作图片', looks(png, 'png') === true)
  // 文本文件伪装成 .png
  const txt = Buffer.from('ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABgQC...')
  ok('文本伪装成 .png 被拒', looks(txt, 'png') === false)
  // EXE 伪装成 .png（MZ 头）
  const exe = Buffer.from([0x4D, 0x5A, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00])
  ok('EXE 伪装成 .png 被拒', looks(exe, 'png') === false)
  ok('JPEG 魔数通过', looks(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), 'jpg') === true)
  ok('未知扩展名一律拒绝', looks(png, 'txt') === false)

  ok('readImageAsDataUrl 有扩展名白名单', /MIME\[ext\]|不支持的图片格式/.test(SRC))
  ok('readImageAsDataUrl 校验了文件头', /looksLikeImage\s*\(/.test(SRC))
}

/* ---------------- 5. SSRF：内网地址被拦 ---------------- */
console.log('\n== SSRF 防护 ==')
{
  const fnSrc = extractFn('isBlockedHost')
  const sandbox = { console, require }
  vm.createContext(sandbox)
  vm.runInContext(fnSrc + '\nthis.__isBlockedHost = isBlockedHost', sandbox)
  const blocked = sandbox.__isBlockedHost

  ok('127.0.0.1 被拦', blocked('127.0.0.1') === true)
  ok('localhost 被拦', blocked('localhost') === true)
  ok('169.254.169.254（云元数据）被拦', blocked('169.254.169.254') === true)
  ok('192.168.1.1 被拦', blocked('192.168.1.1') === true)
  ok('10.0.0.5 被拦', blocked('10.0.0.5') === true)
  ok('172.16.0.1 被拦', blocked('172.16.0.1') === true)
  ok('172.32.0.1（公网）放行', blocked('172.32.0.1') === false)
  ok('::1 被拦', blocked('::1') === true)
  ok('公网域名放行', blocked('example.com') === false)
  ok('request() 里调用了 isBlockedHost', /request[\s\S]{0,2000}?isBlockedHost\s*\(/.test(SRC))
  ok('重定向也走 request（因此同样被拦）', /request\(next,/.test(SRC))
}

/* ---------------- 6. 子进程健壮性 ---------------- */
console.log('\n== 子进程 ==')
ok('agent.stdin 挂了 error 监听', /agent\.stdin\.on\('error'/.test(SRC))
ok('stdin.write 用了 callback 处理失败', /a\.stdin\.write\([\s\S]{0,300}?err\s*=>/.test(SRC))
ok('进程退出时清理常驻 PS', /process\.on\('exit',\s*stopAgent\)/.test(SRC))

/* ---------------- 7. 日志轮转而不是清空 ---------------- */
console.log('\n== 日志 ==')
ok('日志超限改为 rename 轮转（不再清空）',
  /LOG_FILE \+ '\.1'/.test(SRC) && !/writeFileSync\(LOG_FILE, ''\)/.test(SRC.replace(/clearLog[\s\S]{0,300}/, '')))

/* ---------------- 8. PS 失败不再被吞 ---------------- */
console.log('\n== PS 失败可见 ==')
ok('resolvePaths 失败时返回 ok:false', /resolvePaths[\s\S]{0,1200}?return \{ ok: false, error:/.test(SRC))
ok('extractIcons 失败时返回 ok:false', /extractIcons[\s\S]{0,1500}?return \{ ok: false, error:/.test(SRC))

/* ---------------- 9. ui.js 的 icon 转义 ---------------- */
console.log('\n== XSS ==')
{
  const uiSrc = fs.readFileSync(path.join(ROOT, 'js', 'ui.js'), 'utf8')
  ok('菜单项 icon 已转义', /it\.icon \? esc\(it\.icon\) : ''/.test(uiSrc))
}

/* ---------------- 汇总 ---------------- */
console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED ' + fail) + '  (' + pass + ' 项通过, ' + fail + ' 项失败)')
process.exit(fail === 0 ? 0 : 1)
