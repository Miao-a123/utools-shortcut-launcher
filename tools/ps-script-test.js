/* preload 层：ps-bridge.ps1 的 asar 兼容自测。
 *
 * 背景（上架时报过这个错）：插件以 .asar 包装好后，__dirname 变成
 * `...\plugins\<hash>.asar`。Node 的 fs 能读 asar 内文件（Electron 打了补丁），
 * 但 powershell.exe 是**外部进程**、没有补丁，会报「-File 实际参数不存在」，
 * 于是图标提取 / .lnk 解析 / 应用扫描全部失效。
 *
 * 这里把 preload.js 里的 resolvePsScript() 及依赖抽出来，模拟 asar 环境跑：
 *   · 脚本在 .asar 路径下 → 应解压到 BASE_DIR，且内容逐字节一致（含 UTF-8 BOM）
 *   · 内容没变时不重复写盘
 *   · 脚本不在 .asar 里（开发目录）→ 直接返回原路径，不做复制
 *
 * 跑法：node tools/ps-script-test.js
 */
'use strict'
const fs = require('fs')
const os = require('os')
const path = require('path')
const vm = require('vm')

const ROOT = path.join(__dirname, '..')
const SRC = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8')

let pass = 0
let fail = 0
function ok (name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name + (extra ? '  [' + extra + ']' : '')) }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : '')) }
}

/* 从 preload.js 里抽出某个顶层函数（配平大括号） */
function extractFn (name) {
  const re = new RegExp('(^|\\n)function\\s+' + name + '\\s*\\(', 'm')
  const m = re.exec(SRC)
  if (!m) {
    /* 缺函数 = 修复被撤掉了。明确判失败（而不是抛异常崩掉、留下不清晰的输出）。 */
    ok('preload.js 里存在函数 ' + name + '（asar 解压逻辑）', false, '缺失')
    return 'function ' + name + '(){ throw new Error("missing") }'
  }
  const start = m.index + (m[1] ? 1 : 0)
  let i = SRC.indexOf('{', start)
  let depth = 0
  for (; i < SRC.length; i++) {
    if (SRC[i] === '{') depth++
    else if (SRC[i] === '}') { depth--; if (depth === 0) return SRC.slice(start, i + 1) }
  }
  throw new Error('括号不配平 ' + name)
}

/* 构造一个可以跑 resolvePsScript 的沙箱环境 */
function makeSandbox (dirnamePath, baseDir) {
  const scriptInPkg = path.join(dirnamePath, 'tools', 'ps-bridge.ps1')
  const extracted = path.join(baseDir, 'ps-bridge.ps1')
  const logs = []
  const sandbox = {
    fs,
    path,
    require,
    console,
    // 模拟 preload 的目录常量
    __dirname: dirnamePath,
    BASE_DIR: baseDir,
    PS_SCRIPT_IN_PACKAGE: scriptInPkg,
    PS_SCRIPT_EXTRACTED: extracted,
    PS_SCRIPT: scriptInPkg,
    ensureDirs: function () {
      for (const d of [baseDir, path.join(baseDir, 'tmp')]) {
        if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
      }
    },
    log: function (...a) { logs.push(a.join(' ')) }
  }
  vm.createContext(sandbox)
  const code = extractFn('fileHash') + '\n' + extractFn('resolvePsScript') +
    '\nthis.__resolve = resolvePsScript; this.__getPS = function(){ return PS_SCRIPT }'
  vm.runInContext(code, sandbox)
  sandbox.__logs = logs
  return sandbox
}

const realScript = fs.readFileSync(path.join(ROOT, 'tools', 'ps-bridge.ps1'))

/* ---------------- 1. asar 环境：应解压到 BASE_DIR ---------------- */
console.log('\n== asar 安装（脚本在 .asar 内）==')
{
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-asar-'))
  // 造一个假的 "<hash>.asar\tools\ps-bridge.ps1"
  const fakeAsar = path.join(tmpRoot, 'plugins', 'de6d4325235fe93bb6ab2b8406850f0c.asar')
  fs.mkdirSync(path.join(fakeAsar, 'tools'), { recursive: true })
  fs.writeFileSync(path.join(fakeAsar, 'tools', 'ps-bridge.ps1'), realScript)
  const baseDir = path.join(tmpRoot, 'userdata', 'shortcut-launcher')

  const sb = makeSandbox(fakeAsar, baseDir)
  const resolved = sb.__resolve()
  ok('返回的路径不在 .asar 内', resolved.indexOf('.asar') < 0, resolved)
  ok('返回的路径是 BASE_DIR 下的真实文件', resolved === path.join(baseDir, 'ps-bridge.ps1'))
  ok('解压出的文件真的存在', fs.existsSync(resolved))

  // 关键：逐字节一致（BOM 必须保住，否则 PowerShell 5.1 按 ANSI 解码会乱码）
  const extracted = fs.readFileSync(resolved)
  ok('解压内容与源逐字节一致', extracted.equals(realScript),
    'src=' + realScript.length + ' dst=' + extracted.length)
  ok('保留了 UTF-8 BOM',
    extracted[0] === 0xEF && extracted[1] === 0xBB && extracted[2] === 0xBF)

  // 幂等：再调一次，内容没变就不该重写（用 mtime 判断）
  const mtime1 = fs.statSync(resolved).mtimeMs
  const sb2 = makeSandbox(fakeAsar, baseDir)
  const resolved2 = sb2.__resolve()
  const mtime2 = fs.statSync(resolved2).mtimeMs
  ok('内容未变时不重复写盘（幂等）', Math.abs(mtime2 - mtime1) < 5, 'm1=' + mtime1 + ' m2=' + mtime2)

  // 脚本更新：改了源内容，应重新解压
  const changed = Buffer.concat([realScript, Buffer.from('\n# changed\n')])
  fs.writeFileSync(path.join(fakeAsar, 'tools', 'ps-bridge.ps1'), changed)
  const sb3 = makeSandbox(fakeAsar, baseDir)
  const resolved3 = sb3.__resolve()
  ok('源内容变化后会重新解压', fs.readFileSync(resolved3).equals(changed))

  fs.rmSync(tmpRoot, { recursive: true, force: true })
}

/* ---------------- 2. 开发目录：应直接用原路径、不复制 ---------------- */
console.log('\n== 开发目录（脚本是普通文件）==')
{
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kl-dev-'))
  const devDir = path.join(tmpRoot, 'repo')
  fs.mkdirSync(path.join(devDir, 'tools'), { recursive: true })
  fs.writeFileSync(path.join(devDir, 'tools', 'ps-bridge.ps1'), realScript)
  const baseDir = path.join(tmpRoot, 'userdata', 'shortcut-launcher')

  const sb = makeSandbox(devDir, baseDir)
  const resolved = sb.__resolve()
  ok('开发目录下返回原路径',
    resolved === path.join(devDir, 'tools', 'ps-bridge.ps1'), resolved)
  ok('开发目录下没有往 BASE_DIR 复制脚本', !fs.existsSync(path.join(baseDir, 'ps-bridge.ps1')))

  fs.rmSync(tmpRoot, { recursive: true, force: true })
}

/* ---------------- 3. 代码里确实调用了 resolvePsScript ---------------- */
console.log('\n== 接线检查 ==')
{
  const startAgent = /function startAgent[\s\S]*?\n}/.exec(SRC)
  ok('startAgent 里调用了 resolvePsScript', !!startAgent && startAgent[0].indexOf('resolvePsScript()') >= 0)
  const oneShotFn = /function oneShot[\s\S]*?\n}/.exec(SRC)
  ok('oneShot 里调用了 resolvePsScript', !!oneShotFn && oneShotFn[0].indexOf('resolvePsScript()') >= 0)
}

console.log('\n' + (fail === 0 ? 'ALL PASS' : 'FAILED ' + fail) + '  (' + pass + ' 项通过, ' + fail + ' 项失败)')
process.exit(fail === 0 ? 0 : 1)
