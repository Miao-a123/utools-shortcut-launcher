const cp = require('child_process')
const path = require('path')

const PS = path.join(__dirname, 'ps-bridge.ps1')
const CH = 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\UU加速器.lnk'
const APP_FILTER = '(?i)(uninstall|卸载|帮助|help|readme|说明书|许可|license|更新|update|setup|安装|install|website|网站|主页|homepage|documentation|手册|manual|release|changelog|repair|修复|配置|configure|「开始」菜单|开始菜单)'

const agent = cp.spawn('powershell.exe',
  ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS, '-Agent'],
  { windowsHide: true })

let buf = ''
const pending = new Map()
let seq = 0

agent.stdout.setEncoding('utf8')
agent.stdout.on('data', d => {
  buf += d
  let i
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).replace(/^\uFEFF/, '').trim()
    buf = buf.slice(i + 1)
    if (!line) continue
    let m
    try { m = JSON.parse(line) } catch (e) { console.log('BAD LINE:', line.slice(0, 200)); continue }
    if (m.ready) { console.log('AGENT READY'); continue }
    const p = pending.get(m.id)
    if (p) { pending.delete(m.id); p(m) }
  }
})
agent.stderr.setEncoding('utf8')
agent.stderr.on('data', d => console.log('STDERR:', String(d).slice(0, 600)))

function call (mode, payload, timeout) {
  return new Promise(resolve => {
    const id = ++seq
    const t = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: 'timeout' }) }, timeout || 60000)
    pending.set(id, r => { clearTimeout(t); resolve(r) })
    agent.stdin.write(JSON.stringify({ id, mode, payload: payload || {} }) + '\n')
  })
}

function assert (name, cond, extra) {
  console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  ' + extra : ''))
  if (!cond) process.exitCode = 1
}

(async () => {
  await new Promise(r => setTimeout(r, 1200))

  let t = Date.now()
  const ping = await call('ping', {})
  assert('ping', ping.ok === true, JSON.stringify(ping).slice(0, 120) + ' ' + (Date.now() - t) + 'ms')

  t = Date.now()
  const ic = await call('icons', { items: [{ path: CH, index: -1 }, { path: 'C:\\Windows\\System32\\calc.exe', index: -1 }, { path: 'C:\\不存在的文件.exe', index: -1 }] })
  const ms1 = Date.now() - t
  assert('icons ok', ic.ok === true)
  const items = (ic.data && ic.data.items) || []
  assert('icons count', items.length === 3, 'got ' + items.length)
  for (const it of items) {
    const missing = it.path.indexOf('不存在') >= 0
    assert('  icon ' + it.path, missing ? true : (it.ok === true && it.w >= 32),
      (missing ? '(不存在的路径 → 系统返回通用图标，JS 侧会跳过提取) ' : '') +
      'ok=' + it.ok + ' w=' + it.w + ' h=' + it.h + ' chars=' + ((it.png || '').length) + ' err=' + it.error)
  }
  console.log('   first icons call (含 C# 编译) : ' + ms1 + 'ms')

  t = Date.now()
  const ic2 = await call('icons', { items: [{ path: 'C:\\Windows\\explorer.exe', index: -1 }] })
  const ms2 = Date.now() - t
  assert('icons warm', ic2.ok === true && ic2.data.items[0].ok === true, ms2 + 'ms (热调用)')

  t = Date.now()
  const rs = await call('resolve', { paths: [CH, 'C:\\Windows'] })
  const ms3 = Date.now() - t
  const ritems = (rs.data && rs.data.items) || []
  assert('resolve ok', rs.ok === true && ritems.length === 2)
  for (const it of ritems) {
    assert('  resolve ' + it.path, it.ok === true, 'kind=' + it.kind + ' target=' + it.target + ' args=' + it.args)
  }
  console.log('   resolve: ' + ms3 + 'ms')

  t = Date.now()
  const ap = await call('apps', { sources: ['startapps'], filter: APP_FILTER })
  const items2 = (ap.data && ap.data.items) || []
  assert('apps startapps', ap.ok === true && items2.length > 5, items2.length + ' 项 / ' + (Date.now() - t) + 'ms')
  const uwp = items2.filter(x => x.iconFile)
  assert('uwp logo 命中', uwp.length > 0, uwp.length + ' 个带 iconFile，例：' + (uwp[0] ? uwp[0].name + ' -> ' + uwp[0].iconFile : ''))
  console.log('   样例：' + items2.slice(0, 5).map(x => x.name).join(' | '))

  agent.stdin.write(JSON.stringify({ id: 99, mode: 'exit', payload: {} }) + '\n')
  setTimeout(() => { agent.kill(); process.exit(process.exitCode || 0) }, 400)
})().catch(e => { console.log('THROWN', e); process.exit(1) })
