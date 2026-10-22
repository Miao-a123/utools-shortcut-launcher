'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const cp = require('child_process')
const http = require('http')
const https = require('https')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

// 扫描应用时需要过滤掉的“非应用”条目（卸载程序、帮助文档、更新器等）
const DEFAULT_APP_FILTER = '(?i)(uninstall|卸载|帮助|help|readme|说明书|许可|license|更新|update|setup|安装|install|website|网站|主页|homepage|documentation|手册|manual|release|changelog|repair|修复|配置|configure|教程|文档|documentation|「开始」菜单|开始菜单)'

function safeGetPath (name, fallback) {
  try {
    const p = utools.getPath(name)
    if (p) return p
  } catch (e) {}
  return fallback
}

const BASE_DIR = path.join(safeGetPath('userData', path.join(os.homedir(), '.utools-shortcut-launcher')), 'shortcut-launcher')
const DATA_FILE = path.join(BASE_DIR, 'data.json')
const TMP_DIR = path.join(BASE_DIR, 'tmp')
const LOG_FILE = path.join(BASE_DIR, 'plugin.log')
const PS_SCRIPT = path.join(__dirname, 'tools', 'ps-bridge.ps1')

function ensureDirs () {
  for (const d of [BASE_DIR, TMP_DIR]) {
    try {
      if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true })
    } catch (e) {}
  }
}

function log (...args) {
  try {
    ensureDirs()
    const parts = args.map(a => {
      if (typeof a === 'string') return a
      try { return JSON.stringify(a) } catch (e) { return String(a) }
    })
    const line = '[' + new Date().toISOString() + '] ' + parts.join(' ') + '\n'
    fs.appendFileSync(LOG_FILE, line)
    /* 轮转而不是清空：以前超过 512KB 直接 writeFileSync('')，正好在最需要上下文
       （刚崩过、刚出过错）的时候把历史证据全删了。现在留一份 .1。 */
    let size = 0
    try { size = fs.statSync(LOG_FILE).size } catch (e) { size = 0 }
    if (size > 512 * 1024) {
      const old = LOG_FILE + '.1'
      try { if (fs.existsSync(old)) fs.unlinkSync(old) } catch (e) {}
      try { fs.renameSync(LOG_FILE, old) } catch (e) {}
    }
  } catch (e) {}
}

function toArray (v) {
  if (v == null) return []
  if (Array.isArray(v)) return v.filter(x => x != null)
  return [v]
}

/* ------------------------------------------------------------------ *
 * PowerShell bridge: persistent agent + one-shot fallback
 * ------------------------------------------------------------------ */

let agent = null
let agentBuf = ''
let agentSeq = 0
const agentPending = new Map()

function startAgent () {
  if (agent && !agent.killed && agent.exitCode === null) return agent
  try {
    agent = cp.spawn(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT, '-Agent'],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    )
  } catch (e) {
    log('agent spawn failed', e.message)
    agent = null
    return null
  }
  agent.stdout.setEncoding('utf8')
  agent.stderr.setEncoding('utf8')
  agent.stdout.on('data', chunk => {
    agentBuf += chunk
    let idx
    while ((idx = agentBuf.indexOf('\n')) >= 0) {
      const line = agentBuf.slice(0, idx).replace(/^\uFEFF/, '').trim()
      agentBuf = agentBuf.slice(idx + 1)
      if (!line) continue
      let msg = null
      try {
        msg = JSON.parse(line)
      } catch (e) {
        log('agent bad line', line.slice(0, 300))
        continue
      }
      if (msg.ready) continue
      const pending = agentPending.get(msg.id)
      if (pending) {
        agentPending.delete(msg.id)
        pending.resolve(msg)
      }
    }
  })
  agent.stderr.on('data', d => log('agent stderr', String(d).slice(0, 1500)))
  // stdin 也要挂 error：写入已死管道时错误从这里来（write 本身不同步抛错）
  agent.stdin.on('error', e => log('agent stdin error', e.message))
  const onDead = () => {
    for (const [, p] of agentPending) p.resolve({ ok: false, agentDead: true, error: 'agent exited' })
    agentPending.clear()
    agent = null
    agentBuf = ''
  }
  agent.on('exit', onDead)
  agent.on('error', onDead)
  return agent
}

function stopAgent () {
  if (agent) {
    try { agent.stdin.write(JSON.stringify({ id: 0, mode: 'exit', payload: {} }) + '\n') } catch (e) {}
    try { agent.kill() } catch (e) {}
    agent = null
  }
}

function agentCall (mode, payload, timeout) {
  return new Promise(resolve => {
    const a = startAgent()
    if (!a) return resolve({ ok: false, agentDead: true, error: 'no agent' })
    const id = ++agentSeq
    const done = r => {
      clearTimeout(timer)
      agentPending.delete(id)
      resolve(r)
    }
    const timer = setTimeout(() => {
      agentPending.delete(id)
      log('agent timeout', mode)
      resolve({ ok: false, agentDead: true, error: 'timeout' })
    }, timeout || 180000)
    agentPending.set(id, { resolve: r => { clearTimeout(timer); resolve(r) } })
    /* stdin.write 的坑（实测确认）：向已退出的子进程写入**不会同步抛异常**，
       只返回 false 并把错误交给 callback。原来只写了 try/catch，于是：
       进程刚死、'exit' 还没派发的窗口期里进来的请求，JSON 根本没发出去，
       只能干等到超时（默认 180s、扫描 240s）—— UI 上就是"点了转圈好几分钟"。
       现在用 callback 立刻失败，并且给 stdin 挂 error 监听兜底。 */
    try {
      a.stdin.write(JSON.stringify({ id, mode, payload: payload || {} }) + '\n', err => {
        if (!err) return
        log('agent write failed', mode, err.message)
        if (agentPending.has(id)) done({ ok: false, agentDead: true, error: err.message })
      })
    } catch (e) {
      done({ ok: false, agentDead: true, error: e.message })
    }
  })
}

function oneShot (mode, payload, timeout) {
  return new Promise(resolve => {
    ensureDirs()
    const stamp = Date.now() + '_' + Math.random().toString(36).slice(2)
    const inFile = path.join(TMP_DIR, 'in_' + stamp + '.json')
    const outFile = path.join(TMP_DIR, 'out_' + stamp + '.json')
    try {
      fs.writeFileSync(inFile, JSON.stringify(payload || {}), 'utf8')
    } catch (e) {
      return resolve({ ok: false, error: 'write request failed: ' + e.message })
    }
    cp.execFile(
      'powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', PS_SCRIPT,
        '-Mode', mode, '-InFile', inFile, '-OutFile', outFile],
      { windowsHide: true, timeout: timeout || 180000, maxBuffer: 16 * 1024 * 1024 },
      (err, stdout, stderr) => {
        let parsed = null
        try {
          const txt = fs.readFileSync(outFile, 'utf8').replace(/^\uFEFF/, '')
          if (txt) parsed = JSON.parse(txt)
        } catch (e) {}
        try { fs.unlinkSync(inFile) } catch (e) {}
        try { fs.unlinkSync(outFile) } catch (e) {}
        if (parsed) return resolve(parsed)
        log('oneshot failed', mode, (err && err.message) || '', String(stderr || '').slice(0, 800))
        resolve({ ok: false, error: (err && err.message) || String(stderr || '').slice(0, 400) || 'powershell 执行失败' })
      }
    )
  })
}

async function callPS (mode, payload, timeout) {
  let r = await agentCall(mode, payload, timeout)
  if (r && r.ok) return r
  if (r && r.agentDead) {
    r = await oneShot(mode, payload, timeout)
  }
  return r
}

/* ------------------------------------------------------------------ *
 * Data persistence
 * ------------------------------------------------------------------ */

/* 读数据。返回值有明确的三态语义，store.load() 依赖这个区分：
     · null  —— 文件不存在 / 空文件（= 全新安装，可以正常写入）
     · 对象  —— 正常
     · 抛错  —— **文件存在但读不出来/解析不了（损坏）**，带 code='DATA_CORRUPT'
   为什么必须抛错：以前这里 `return null`，于是"数据损坏"和"全新安装"完全无法区分 ——
   store.load() 拿到 null 就 normalize 成空 state，界面上没有任何提示；用户以为数据没了，
   随手加一个快捷方式触发保存，2MB 的真实数据就被空数据覆盖了（实测确认过这条路径）。
   现在抛错让上层能拦住写入。 */
function readData () {
  ensureDirs()
  let txt
  try {
    txt = fs.readFileSync(DATA_FILE, 'utf8')
  } catch (e) {
    if (e && e.code === 'ENOENT') return null      // 文件不存在 = 全新安装
    throw e
  }
  txt = txt.replace(/^\uFEFF/, '')
  if (!txt.trim()) return null                     // 空文件也当全新安装
  try {
    return JSON.parse(txt)
  } catch (e) {
    log('readData failed', e.message)
    let bak = ''
    try {
      bak = DATA_FILE + '.broken-' + Date.now()
      fs.copyFileSync(DATA_FILE, bak)
    } catch (e2) { bak = '' }
    const err = new Error('数据文件损坏' + (bak ? '，已备份到 ' + bak : ''))
    err.code = 'DATA_CORRUPT'
    err.backupPath = bak
    throw err
  }
}

function writeData (data) {
  ensureDirs()
  /* .tmp 带 pid + 时间戳：固定名在"两个窗口同时保存"时会互相覆盖对方的临时文件。
     先写 tmp 再 rename 已经是原子替换；这里再补一次 fsync，避免 rename 成功后
     内容还留在 page cache 里，断电后得到"文件名对、内容是空的"的 data.json。 */
  const tmp = DATA_FILE + '.' + process.pid + '.' + Date.now() + '.tmp'
  const json = JSON.stringify(data)
  let fd = null
  try {
    fd = fs.openSync(tmp, 'w')
    fs.writeFileSync(fd, json, 'utf8')
    try { fs.fsyncSync(fd) } catch (e) {}
  } finally {
    if (fd !== null) { try { fs.closeSync(fd) } catch (e) {} }
  }
  fs.renameSync(tmp, DATA_FILE)
  return { ok: true, bytes: fs.statSync(DATA_FILE).size }
}

/* ------------------------------------------------------------------ *
 * HTTP helpers (favicon)
 * ------------------------------------------------------------------ */

/* 拦住指向本机 / 内网的地址。
   为什么需要：fetchFavicon 会跟随页面里 <link rel=icon> 给的**任意** href
   （parseIconLinks 只做 new URL(href, base)，不校验同源），也会跟随重定向，
   于是"用户加一个外网网址"就能变成"本机替第三方去打内网"。
   典型目标：169.254.169.254（云元数据）、127.0.0.1 上的管理接口、
   192.168.x 路由器的 GET 型 reboot 接口。
   只拦字面 IP 与 localhost 系（不做 DNS 解析后再校验 —— 那会让每次抓图标
   多一次解析、且解析结果与真正连接用的可能不同，收益不大）。 */
function isBlockedHost (hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '')
  if (!h) return true
  if (h === 'localhost' || /\.localhost$/.test(h) || /\.local$/.test(h) || /\.internal$/.test(h)) return true
  const net = require('net')
  const v = net.isIP(h)
  if (!v) return false                       // 域名放行（见上方说明）
  if (v === 4) {
    const p = h.split('.').map(Number)
    if (p[0] === 127 || p[0] === 10 || p[0] === 0) return true
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true
    if (p[0] === 192 && p[1] === 168) return true
    if (p[0] === 169 && p[1] === 254) return true
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true   // CGNAT
    return false
  }
  // IPv6：::1、fc00::/7（ULA）、fe80::/10（链路本地）
  if (h === '::1' || h === '::') return true
  if (/^f[cd]/.test(h)) return true
  if (/^fe[89ab]/.test(h)) return true
  return false
}

function request (url, opts) {
  const o = opts || {}
  const maxBytes = o.maxBytes || 512 * 1024
  const timeout = o.timeout || 8000
  const redirects = o.redirects == null ? 4 : o.redirects
  return new Promise(resolve => {
    let settled = false
    const finish = v => { if (!settled) { settled = true; resolve(v) } }
    let mod
    let parsed
    try {
      parsed = new URL(url)
      mod = parsed.protocol === 'http:' ? http : https
    } catch (e) {
      return finish({ ok: false, error: 'bad url' })
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return finish({ ok: false, error: 'bad protocol' })
    }
    if (isBlockedHost(parsed.hostname)) {
      return finish({ ok: false, error: 'blocked host' })
    }
    let req
    try {
      req = mod.get(url, {
        headers: { 'User-Agent': UA, Accept: '*/*' }
      }, res => {
        const code = res.statusCode || 0
        if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
          res.resume()
          let next
          try { next = new URL(res.headers.location, url).toString() } catch (e) { return finish({ ok: false, error: 'bad redirect' }) }
          return request(next, Object.assign({}, o, { redirects: redirects - 1 })).then(finish)
        }
        if (code !== 200) {
          res.resume()
          return finish({ ok: false, status: code, error: 'HTTP ' + code })
        }
        const chunks = []
        let size = 0
        let aborted = false
        res.on('data', c => {
          if (aborted) return
          size += c.length
          if (size > maxBytes) {
            aborted = true
            try { req.destroy() } catch (e) {}
            return finish({ ok: false, error: 'too large' })
          }
          chunks.push(c)
        })
        res.on('end', () => finish({ ok: true, buffer: Buffer.concat(chunks), headers: res.headers, url }))
        res.on('error', e => finish({ ok: false, error: e.message }))
      })
    } catch (e) {
      return finish({ ok: false, error: e.message })
    }
    req.setTimeout(timeout, () => {
      try { req.destroy() } catch (e) {}
      finish({ ok: false, error: 'timeout' })
    })
    req.on('error', e => finish({ ok: false, error: e.message }))
  })
}

function guessMime (url, contentType) {
  const ct = String(contentType || '').split(';')[0].trim().toLowerCase()
  if (ct && ct !== 'application/octet-stream' && ct !== 'text/plain') return ct
  const clean = String(url).split('?')[0].split('#')[0].toLowerCase()
  if (clean.endsWith('.svg')) return 'image/svg+xml'
  if (clean.endsWith('.png')) return 'image/png'
  if (clean.endsWith('.jpg') || clean.endsWith('.jpeg')) return 'image/jpeg'
  if (clean.endsWith('.webp')) return 'image/webp'
  if (clean.endsWith('.gif')) return 'image/gif'
  if (clean.endsWith('.ico')) return 'image/x-icon'
  return 'image/x-icon'
}

function parseIconLinks (html, base) {
  const out = []
  const re = /<link\b[^>]*>/gi
  let m
  const attr = (tag, name) => {
    const r = new RegExp('\\b' + name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')
    const mm = r.exec(tag)
    if (!mm) return ''
    return mm[2] || mm[3] || mm[4] || ''
  }
  while ((m = re.exec(html))) {
    const tag = m[0]
    const relStr = attr(tag, 'rel').toLowerCase()
    if (!/(^|\s)(shortcut icon|icon|apple-touch-icon|apple-touch-icon-precomposed|mask-icon)(\s|$)/.test(relStr)) continue
    const href = attr(tag, 'href')
    if (!href) continue
    let abs
    try { abs = new URL(href, base).toString() } catch (e) { continue }
    const sizes = attr(tag, 'sizes')
    let size = 0
    const sm = /(\d+)\s*[xX]\s*(\d+)/.exec(sizes)
    if (sm) size = parseInt(sm[1], 10)
    const isSvg = /\.svg(\?|#|$)/i.test(abs)
    let weight = 2
    if (/apple-touch-icon/.test(relStr)) weight = 3
    else if (/mask-icon/.test(relStr)) weight = 1
    out.push({ href: abs, size, rel: relStr, isSvg, weight })
  }
  out.sort((a, b) => (Number(a.isSvg) - Number(b.isSvg)) || (b.weight - a.weight) || (b.size - a.size))
  const seen = {}
  return out.filter(c => {
    if (seen[c.href]) return false
    seen[c.href] = 1
    return true
  }).slice(0, 6)
}

async function fetchFavicon (rawUrl, options) {
  const o = options || {}
  // 「仅本地」模式：一个请求都不发。抓网站图标是整个插件里唯一会联网的地方，
  // 关掉之后完全离线 —— 网址图标会退回快捷方式自带的 .ico，再不行就是字形图标。
  if (o.online === false) return { ok: false, offline: true, error: '已关闭联网获取图标' }
  let base
  try {
    base = new URL(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawUrl) ? rawUrl : 'https://' + rawUrl)
  } catch (e) {
    return { ok: false, error: '网址格式不正确' }
  }
  const candidates = []
  const page = await request(base.toString(), { maxBytes: 500 * 1024, timeout: 7000 })
  if (page.ok) {
    const html = page.buffer.toString('utf8').slice(0, 400000)
    for (const c of parseIconLinks(html, base)) candidates.push(c)
  }
  candidates.push({ href: base.origin + '/favicon.ico', size: 0, rel: 'implicit', isSvg: false, weight: 0 })
  if (o.service) {
    const svc = String(o.service)
      .replace(/\{domain\}/g, base.hostname)
      .replace(/\{origin\}/g, base.origin)
      .replace(/\{url\}/g, encodeURIComponent(base.toString()))
    candidates.push({ href: svc, size: 0, rel: 'service', isSvg: false, weight: 0 })
  }
  const tried = []
  for (const c of candidates) {
    const r = await request(c.href, { maxBytes: 400 * 1024, timeout: 6000 })
    if (r.ok && r.buffer && r.buffer.length > 0) {
      const mime = guessMime(c.href, r.headers && r.headers['content-type'])
      return {
        ok: true,
        dataUrl: 'data:' + mime + ';base64,' + r.buffer.toString('base64'),
        mime,
        source: c.rel || 'icon',
        from: c.href,
        bytes: r.buffer.length
      }
    }
    tried.push({ url: c.href, error: r.error || ('HTTP ' + r.status) })
  }
  return { ok: false, error: '未能获取图标', tried }
}

/* ------------------------------------------------------------------ *
 * Browser bookmarks
 * ------------------------------------------------------------------ */

function walkBookmarkNode (node, folderPath, out) {
  if (!node) return
  if (node.type === 'url' && node.url) {
    out.push({
      title: node.name || node.url,
      url: node.url,
      folder: folderPath.join(' / '),
      folderPath: folderPath.slice(),
      addedAt: node.date_added ? Number(node.date_added) : 0
    })
    return
  }
  if (node.type === 'folder' || node.children) {
    const next = node.name ? folderPath.concat(node.name) : folderPath
    if (node.type === 'folder' && node.children && node.children.length && !node.children.some(c => c.type === 'url')) {
      // still traverse, folders may contain only folders
    }
    const kids = node.children || []
    if (kids.length === 0 && node.type === 'folder') {
      out.push({ folderOnly: true, folder: next.join(' / '), folderPath: next })
    }
    for (const c of kids) walkBookmarkNode(c, node.type === 'folder' ? next : folderPath, out)
  }
}

function readBrowserBookmarks () {
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local')
  const roaming = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
  const browsers = [
    { name: 'Chrome', dir: path.join(localAppData, 'Google', 'Chrome', 'User Data') },
    { name: 'Edge', dir: path.join(localAppData, 'Microsoft', 'Edge', 'User Data') },
    { name: 'Brave', dir: path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data') },
    { name: 'Vivaldi', dir: path.join(localAppData, 'Vivaldi', 'User Data') },
    { name: 'Chromium', dir: path.join(localAppData, 'Chromium', 'User Data') },
    { name: '360极速', dir: path.join(localAppData, '360Chrome', 'Chrome', 'User Data') },
    { name: 'QQ浏览器', dir: path.join(localAppData, 'Tencent', 'QQBrowser', 'User Data') }
  ]
  const result = []
  for (const b of browsers) {
    let profiles = []
    try {
      if (!fs.existsSync(b.dir)) continue
      profiles = fs.readdirSync(b.dir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name)
        .filter(n => n === 'Default' || /^Profile \d+$/i.test(n))
    } catch (e) { continue }
    for (const prof of profiles) {
      const file = path.join(b.dir, prof, 'Bookmarks')
      try {
        if (!fs.existsSync(file)) continue
        const raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
        const json = JSON.parse(raw)
        const items = []
        for (const key of ['bookmark_bar', 'other', 'synced']) {
          if (json.roots && json.roots[key]) {
            const label = key === 'bookmark_bar' ? '书签栏' : key === 'other' ? '其他书签' : '移动设备'
            walkBookmarkNode(json.roots[key], [label], items)
          }
        }
        const urls = items.filter(i => i.url)
        if (urls.length === 0) continue
        const folders = {}
        for (const u of urls) {
          const f = u.folder || '(根目录)'
          folders[f] = (folders[f] || 0) + 1
        }
        result.push({
          browser: b.name,
          profile: prof,
          file,
          count: urls.length,
          folders: Object.keys(folders).sort().map(f => ({ path: f, count: folders[f] })),
          urls
        })
      } catch (e) {
        log('bookmark read failed', file, e.message)
      }
    }
  }
  return { ok: true, sources: result }
}

/* ------------------------------------------------------------------ *
 * Launch
 * ------------------------------------------------------------------ */

function splitArgs (str) {
  const out = []
  let cur = ''
  let inQuote = false
  let started = false
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]
    if (ch === '"') {
      inQuote = !inQuote
      started = true
      continue
    }
    if (!inQuote && /\s/.test(ch)) {
      if (started) { out.push(cur); cur = ''; started = false }
      continue
    }
    cur += ch
    started = true
  }
  if (started) out.push(cur)
  return out
}

/* ------------------------------------------------------------------ *
 * URL / 快捷方式解析辅助
 * ------------------------------------------------------------------ */

// 浏览器可执行文件名（Chrome 等创建的"网站快捷方式"目标是指向它们的 exe）
const BROWSER_EXE_RE = /(chrome|chrome_proxy|msedge|msedge_proxy|firefox|brave|vivaldi|opera|launcher|chromium|360se|360se6|360chrome|qqbrowser|sogouexplorer|iexplore)\.exe$/i

function firstUrlIn (s) {
  const m = /https?:\/\/[^\s"'<>]+/i.exec(String(s || ''))
  return m ? m[0] : null
}

// 从 .lnk 原始字节中提取内嵌 URL（URL 目标的快捷方式 TargetPath 为空）
function lnkEmbeddedUrl (p) {
  try {
    const buf = fs.readFileSync(p)
    if (!buf.length || buf.length > 4 * 1024 * 1024) return null
    let m = /[a-zA-Z][a-zA-Z0-9+.\-]{1,24}:\/\/[^\u0000-\u001F"'<>|]{2,2048}/.exec(buf.toString('utf16le'))
    if (m) return m[0]
    m = /[a-zA-Z][a-zA-Z0-9+.\-]{1,24}:\/\/[^\u0000-\u001F"'<>|\s]{2,2048}/.exec(buf.toString('latin1'))
    return m ? m[0] : null
  } catch (e) {
    return null
  }
}

// .url 文件解码（编码可能为 UTF-16LE/BE、UTF-8、GBK）
function decodeUrlFileBuffer (buf) {
  try {
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le', 2)
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
      const sw = Buffer.from(buf)
      sw.swap16()
      return sw.toString('utf16le', 2)
    }
    let zeros = 0
    const step = Math.min(64, buf.length)
    for (let i = 1; i < step; i += 2) if (buf[i] === 0) zeros++
    if (step >= 16 && zeros >= (step / 2) * 0.8) return buf.toString('utf16le')
    const utf8 = buf.toString('utf8')
    if (utf8.indexOf('\uFFFD') >= 0) {
      try { return new TextDecoder('gbk').decode(buf) } catch (e) { return utf8 }
    }
    return utf8
  } catch (e) {
    try { return buf.toString('utf8') } catch (e2) { return '' }
  }
}

function parseUrlFileRaw (p) {
  try {
    const buf = fs.readFileSync(p)
    if (!buf.length || buf.length > 1024 * 1024) return null
    const txt = decodeUrlFileBuffer(buf)
    const m = /^\s*URL\s*=\s*(.+)\s*$/im.exec(txt)
    if (!m) return null
    const out = { target: m[1].trim() }
    const im = /^\s*IconFile\s*=\s*(.+)\s*$/im.exec(txt)
    if (im) out.iconLocation = im[1].trim()
    return out
  } catch (e) {
    return null
  }
}

/* 用系统 shell 打开（支持 http(s) 与自定义协议）
   ⚠️ 这里**绝不能**退回 `cmd.exe /c start`。原因（实测确认）：
   Node 的 cp.spawn 用数组传参只保证"参数不被 Node 拆分"，但 cmd.exe 收到命令行后
   **自己会再解析一遍**，`& | < > ^` 在 cmd 里是元字符。只要 target 里没有空格，
   Node 就不会给它加引号，于是
       target = "C:\Windows\System32\whoami.exe&echo+PWNED>%TEMP%\x.txt"
   会把后半段当成独立命令执行 —— 任意命令执行。而 target 来自用户拖入的 .url/.lnk、
   导入的 data.json，都是不可信输入。
   正确做法：shellOpenExternal 走的是系统 ShellExecute，它失败就说明协议没注册，
   cmd 也救不回来。直接返回失败即可。 */
function openExternalViaShell (target) {
  try {
    if (utools.shellOpenExternal(target) !== false) return true
    return false
  } catch (e) {
    log('shellOpenExternal failed', target, e.message)
    return false
  }
}

function launch (sc) {
  return new Promise(resolve => {
    try {
      const l = (sc && sc.launch) || {}
      const kind = l.kind || 'path'
      let target = l.target
      // 兜底：目标为空但原始快捷方式文件还在，现场重新解析一次
      if (!target && sc && sc.originalPath) {
        const op = String(sc.originalPath)
        if (/\.url$/i.test(op)) {
          const parsed = parseUrlFileRaw(op)
          if (parsed && parsed.target) target = parsed.target
        } else if (/\.lnk$/i.test(op)) {
          const u = lnkEmbeddedUrl(op)
          if (u) target = u
        }
      }
      if (!target) return resolve({ ok: false, error: '目标为空（快捷方式可能已失效）' })
      const urlLike = kind === 'url' || /^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(String(target))
      if (urlLike) {
        if (openExternalViaShell(target)) return resolve({ ok: true })
        return resolve({ ok: false, error: '无法打开该链接' })
      }
      if (kind === 'appid') {
        const child = cp.spawn('explorer.exe', ['shell:AppsFolder\\' + (l.appId || target.replace(/^shell:AppsFolder\\/i, ''))], {
          detached: true, stdio: 'ignore', windowsHide: false
        })
        child.on('error', e => log('launch appid error', e.message))
        child.unref()
        return resolve({ ok: true })
      }
      const args = l.args ? splitArgs(String(l.args)) : []
      if (args.length > 0) {
        const opts = { detached: true, stdio: 'ignore', windowsHide: false }
        if (l.workDir && fs.existsSync(l.workDir)) opts.cwd = l.workDir
        /* 注意：这里**没有** cmd.exe 回退分支。
           cp.spawn 对不存在的 exe 不会同步抛错（只异步 emit 'error'），所以原来那个
           try/catch 里的 cmd 回退既是死代码、又是个命令注入入口（见 openExternalViaShell
           上方的说明）。spawn 失败由下面的 'error' 处理器兜底到 shellOpenPath。 */
        const child = cp.spawn(target, args, opts)
        child.on('error', e => {
          log('launch spawn error', target, e.message)
          try { utools.shellOpenPath(target) } catch (e2) {}
        })
        child.unref()
        return resolve({ ok: true })
      }
      const err = utools.shellOpenPath(target)
      if (err) return resolve({ ok: false, error: err })
      resolve({ ok: true })
    } catch (e) {
      log('launch failed', e.message)
      resolve({ ok: false, error: e.message })
    }
  })
}

/* ------------------------------------------------------------------ *
 * Exposed API
 * ------------------------------------------------------------------ */

/* 校验文件头魔数，用于 readImageAsDataUrl —— 不信任扩展名。
   SVG 是文本格式，没有魔数，只能做"开头看起来像 svg/xml"的弱校验
   （它的风险由调用侧负责：只从本地文件读，且渲染时走 <img src>，脚本不会执行）。 */
function looksLikeImage (buf, ext) {
  if (!buf || buf.length < 4) return false
  const b = i => buf[i]
  switch (ext) {
    case 'png':
      return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47
    case 'jpg':
    case 'jpeg':
      return b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF
    case 'gif':
      return b(0) === 0x47 && b(1) === 0x49 && b(2) === 0x46
    case 'bmp':
      return b(0) === 0x42 && b(1) === 0x4D
    case 'webp':
      return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 &&
        buf.length >= 12 && buf.toString('ascii', 8, 12) === 'WEBP'
    case 'ico':
      return b(0) === 0x00 && b(1) === 0x00 && (b(2) === 0x01 || b(2) === 0x00) && b(3) === 0x00
    case 'svg': {
      const head = buf.toString('utf8', 0, Math.min(buf.length, 1024)).trim().toLowerCase()
      return head.indexOf('<svg') >= 0 || (head.indexOf('<?xml') === 0 && head.indexOf('<svg') >= 0)
    }
    default:
      return false
  }
}

const services = {
  isUtools: true,

  log,

  getDataDir () { ensureDirs(); return BASE_DIR },
  getDataFilePath () { return DATA_FILE },
  openDataDir () {
    ensureDirs()
    utools.shellOpenPath(BASE_DIR)
    return { ok: true, path: BASE_DIR }
  },
  revealPath (p) {
    if (!p) return { ok: false }
    try {
      utools.shellShowItemInFolder(p)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  },
  readLog () {
    try { return fs.readFileSync(LOG_FILE, 'utf8').slice(-20000) } catch (e) { return '' }
  },
  clearLog () {
    try {
      ensureDirs()
      fs.writeFileSync(LOG_FILE, '')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  },

  loadData: readData,
  saveData: writeData,

  async ping () {
    const r = await callPS('ping', {}, 30000)
    return r
  },

  async resolvePaths (paths) {
    const list = toArray(paths).filter(Boolean)
    if (!list.length) return { ok: true, items: [] }
    const out = []
    for (let i = 0; i < list.length; i += 40) {
      const chunk = list.slice(i, i + 40)
      const r = await callPS('resolve', { paths: chunk }, 120000)
      /* PS 整体失败时要把错误透出去，不能返回"ok 但零条"。
         以前这里把 !r.ok 静默成空数组，于是 powershell.exe 被拦（EDR/组策略）时
         界面显示"添加了 0 项"，用户完全不知道是失败了。 */
      if (!r || !r.ok) {
        return { ok: false, error: (r && r.error) || '解析失败', items: out }
      }
      const items = r.data ? toArray(r.data.items) : []
      for (let k = 0; k < items.length; k++) {
        const p = String(chunk[k] || '')
        let it = items[k]
        if (!it) { continue }
        // .url 解析失败 → Node 侧重读（多编码兜底）
        if (/\.url$/i.test(p) && !it.ok) {
          const parsed = parseUrlFileRaw(p)
          if (parsed && parsed.target) {
            items[k] = { path: p, ok: true, kind: 'url', target: parsed.target, iconLocation: parsed.iconLocation || '' }
          }
          continue
        }
        // .lnk 未解析出目标 → 从字节里提取内嵌 URL（URL 目标快捷方式）
        if (/\.lnk$/i.test(p) && !it.target) {
          const u = lnkEmbeddedUrl(p)
          if (u) { items[k] = Object.assign({}, it, { ok: true, kind: 'url', target: u }); continue }
        }
        // 目标本身是 URL（含自定义协议）→ 按网址处理
        if (it.target && /^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//.test(String(it.target))) {
          items[k] = Object.assign({}, it, { ok: true, kind: 'url' })
          continue
        }
        // 浏览器 exe + URL 参数（Chrome/Edge 等"创建快捷方式"的产物）→ 视为网址
        if (it.target && BROWSER_EXE_RE.test(String(it.target))) {
          const u = firstUrlIn(it.args)
          if (u) items[k] = Object.assign({}, it, { ok: true, kind: 'url', target: u, args: '', workDir: '' })
        }
      }
      out.push.apply(out, items)
    }
    return { ok: true, items: out }
  },

  async extractIcons (items) {
    const list = toArray(items).filter(Boolean)
    if (!list.length) return { ok: true, items: [] }
    const out = []
    let engine = true
    for (let i = 0; i < list.length; i += 25) {
      const chunk = list.slice(i, i + 25).map(it => {
        if (typeof it === 'string') return { path: it, index: -1 }
        return {
          path: it.path,
          index: it.index == null ? -1 : it.index,
          iconPath: it.iconPath || null,
          iconIndex: it.iconIndex == null ? null : it.iconIndex
        }
      })
      const r = await callPS('icons', { items: chunk }, 180000)
      /* 同样不能把 PS 失败吞成"成功但没图标"：以前这里 `if (r && r.ok && r.data)`
         失败就直接跳过，调用侧看到 ok:true + 空 items，表现为"所有图标都空着"
         而没有任何错误提示。 */
      if (!r || !r.ok) {
        return { ok: false, error: (r && r.error) || '图标提取失败', items: out, engine }
      }
      if (r.data) {
        if (r.data.engine === false) engine = false
        out.push.apply(out, toArray(r.data.items))
      }
    }
    return { ok: true, items: out, engine }
  },

  async scanApps (sources, filter) {
    const r = await callPS('apps', { sources: toArray(sources), filter: filter || DEFAULT_APP_FILTER }, 240000)
    if (!r || !r.ok) return { ok: false, error: (r && r.error) || '扫描失败', items: [] }
    return { ok: true, items: toArray(r.data && r.data.items) }
  },

  readBookmarks: readBrowserBookmarks,

  fetchFavicon (url, options) {
    return fetchFavicon(url, options || {})
  },

  launch,

  /* 把本地图片读成 data URL。
     ⚠️ 这个 API 暴露给了渲染进程，所以必须**真的只读图片**：
     以前它名字叫"读图片"，实际是任意文件读取原语（传 id_rsa / Login Data 也会
     原样 base64 返回，MIME 还被错标成 image/png）。现在加两道闸：
       1. 扩展名白名单；
       2. 文件头魔数校验 —— 不信任扩展名，改名的 .exe 会被拦下。 */
  readImageAsDataUrl (p) {
    try {
      const ext = path.extname(String(p || '')).toLowerCase().replace('.', '')
      const MIME = {
        png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
        gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
        ico: 'image/x-icon', svg: 'image/svg+xml'
      }
      const mime = MIME[ext]
      if (!mime) return { ok: false, error: '不支持的图片格式：.' + ext }
      const st = fs.statSync(p)
      if (!st.isFile()) return { ok: false, error: '不是文件' }
      if (st.size > 8 * 1024 * 1024) return { ok: false, error: '图片过大' }
      const buf = fs.readFileSync(p)
      if (!looksLikeImage(buf, ext)) return { ok: false, error: '文件内容不是有效的图片' }
      return { ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64') }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  },

  exists (p) {
    try { return fs.existsSync(p) } catch (e) { return false }
  },

  getPathForFile (file) {
    try {
      const electron = require('electron')
      if (electron && electron.webUtils && electron.webUtils.getPathForFile) {
        return electron.webUtils.getPathForFile(file) || null
      }
    } catch (e) {
      log('getPathForFile failed', e.message)
    }
    try {
      return file && file.path ? file.path : null
    } catch (e) {
      return null
    }
  },

  pathInfo (p) {
    try {
      if (!fs.existsSync(p)) return { ok: false, exists: false }
      const st = fs.statSync(p)
      return { ok: true, exists: true, isDir: st.isDirectory(), name: path.basename(p), dir: path.dirname(p), ext: path.extname(p).toLowerCase() }
    } catch (e) {
      return { ok: false, exists: false, error: e.message }
    }
  },

  pickFiles (opts) {
    const o = opts || {}
    const properties = ['openFile'].concat(o.multi === false ? [] : ['multiSelections'])
    if (o.directory) return utools.showOpenDialog({ title: o.title || '选择文件夹', properties: ['openDirectory'] })
    const r = utools.showOpenDialog({
      title: o.title || '选择文件',
      properties,
      filters: o.filters || [{ name: '所有文件', extensions: ['*'] }]
    })
    return r || []
  },

  pickImage () {
    return utools.showOpenDialog({
      title: '选择图标图片',
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'ico', 'svg', 'webp', 'gif', 'bmp'] }]
    }) || []
  },

  exportData () {
    try {
      ensureDirs()
      const r = utools.showSaveDialog({
        title: '导出快捷方式数据',
        defaultPath: path.join(safeGetPath('desktop', os.homedir()), 'shortcut-launcher-backup.json'),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (!r) return { ok: false, canceled: true }
      fs.copyFileSync(DATA_FILE, r)
      return { ok: true, path: r }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  },

  importData () {
    try {
      const r = utools.showOpenDialog({
        title: '导入快捷方式数据',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }]
      })
      if (!r || !r.length) return { ok: false, canceled: true }
      const txt = fs.readFileSync(r[0], 'utf8').replace(/^\uFEFF/, '')
      const json = JSON.parse(txt)
      if (!json || !Array.isArray(json.shortcuts)) return { ok: false, error: '文件格式不正确' }
      return { ok: true, data: json }
    } catch (e) {
      return { ok: false, error: e.message }
    }
  },

  notify (msg) {
    try { utools.showNotification(String(msg)) } catch (e) {}
  },

  readClipboard () {
    let text = ''
    let files = []
    try { text = require('electron').clipboard.readText() || '' } catch (e) { log('clipboard text failed', e.message) }
    try { files = utools.getCopyedFiles() || [] } catch (e) {}
    return { text: text, files: files }
  },

  copyText (t) {
    try { utools.copyText(String(t)); return { ok: true } } catch (e) { return { ok: false } }
  },

  isDark () {
    try { return !!utools.isDarkColors() } catch (e) { return true }
  },

  setHeight (h) {
    try { utools.setExpendHeight(h) } catch (e) {}
  },

  shutdown () {
    stopAgent()
  }
}

/* 进程退出时收拾常驻 PowerShell，别把它留成孤儿。
   以前 services.shutdown 有实现但**没有任何调用方**（全项目搜索确认），
   于是插件关掉后 PS 还在跑 —— 如果它正在执行 240s 的应用扫描，会一直驻留到跑完。
   注意：不要挂在 onPluginOut 上，那是"失焦"不是"销毁"，每次切回来都重编译 C# 太亏。 */
try {
  process.on('exit', stopAgent)
  process.on('SIGTERM', () => { stopAgent(); process.exit(0) })
  process.on('SIGINT', () => { stopAgent(); process.exit(0) })
} catch (e) {}

window.services = services
// uTools 默认关掉 contextIsolation，这时 contextBridge 本身就不可用 —— 属于预期情况：
// window.services 上面已经挂好了，功能不受影响。以前这里无条件 log 一条，结果每次
// 进入插件都往 plugin.log 里写一行，看起来像出了错（排查时白白多一条噪音）。
// 现在只在"contextIsolation 开着、但 expose 依然失败"时才记录 —— 那才是真问题。
try {
  const electron = require('electron')
  if (electron && electron.contextBridge && electron.contextBridge.exposeInMainWorld) {
    electron.contextBridge.exposeInMainWorld('services', services)
  }
} catch (e) {
  const msg = String((e && e.message) || e)
  if (!/contextIsolation/i.test(msg)) log('contextBridge expose skipped', msg)
}
