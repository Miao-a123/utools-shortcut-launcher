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
    if (fs.statSync(LOG_FILE).size > 512 * 1024) fs.writeFileSync(LOG_FILE, '')
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
    const timer = setTimeout(() => {
      agentPending.delete(id)
      log('agent timeout', mode)
      resolve({ ok: false, agentDead: true, error: 'timeout' })
    }, timeout || 180000)
    agentPending.set(id, {
      resolve: r => { clearTimeout(timer); resolve(r) }
    })
    try {
      a.stdin.write(JSON.stringify({ id, mode, payload: payload || {} }) + '\n')
    } catch (e) {
      clearTimeout(timer)
      agentPending.delete(id)
      resolve({ ok: false, agentDead: true, error: e.message })
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

function readData () {
  ensureDirs()
  try {
    if (!fs.existsSync(DATA_FILE)) return null
    const txt = fs.readFileSync(DATA_FILE, 'utf8').replace(/^\uFEFF/, '')
    if (!txt.trim()) return null
    return JSON.parse(txt)
  } catch (e) {
    log('readData failed', e.message)
    try {
      fs.copyFileSync(DATA_FILE, DATA_FILE + '.broken-' + Date.now())
    } catch (e2) {}
    return null
  }
}

function writeData (data) {
  ensureDirs()
  const tmp = DATA_FILE + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(data), 'utf8')
  fs.renameSync(tmp, DATA_FILE)
  return { ok: true, bytes: fs.statSync(DATA_FILE).size }
}

/* ------------------------------------------------------------------ *
 * HTTP helpers (favicon)
 * ------------------------------------------------------------------ */

function request (url, opts) {
  const o = opts || {}
  const maxBytes = o.maxBytes || 512 * 1024
  const timeout = o.timeout || 8000
  const redirects = o.redirects == null ? 4 : o.redirects
  return new Promise(resolve => {
    let settled = false
    const finish = v => { if (!settled) { settled = true; resolve(v) } }
    let mod
    try {
      mod = new URL(url).protocol === 'http:' ? http : https
    } catch (e) {
      return finish({ ok: false, error: 'bad url' })
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

function launch (sc) {
  return new Promise(resolve => {
    try {
      const l = (sc && sc.launch) || {}
      const kind = l.kind || 'path'
      const target = l.target
      if (!target) return resolve({ ok: false, error: '目标为空' })
      if (kind === 'url') {
        utools.shellOpenExternal(target)
        return resolve({ ok: true })
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
        let child
        try {
          child = cp.spawn(target, args, opts)
        } catch (e) {
          child = cp.spawn('cmd.exe', ['/c', 'start', '', target].concat(args), { detached: true, stdio: 'ignore', windowsHide: true })
        }
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
 * .url 文件解析（Internet Shortcut，编码可能为 UTF-16LE/BE、UTF-8、GBK）
 * ------------------------------------------------------------------ */

function decodeUrlFileBuffer (buf) {
  try {
    if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return buf.toString('utf16le', 2)
    if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) {
      const sw = Buffer.from(buf)
      sw.swap16()
      return sw.toString('utf16le', 2)
    }
    // 无 BOM 的 UTF-16 启发式：头部 ASCII 区域奇数位几乎全为 0
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

/* ------------------------------------------------------------------ *
 * Exposed API
 * ------------------------------------------------------------------ */

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
      const items = (r && r.ok && r.data) ? toArray(r.data.items) : []
      // 兜底：.url 文件解析失败（常见于 PS 侧文本编码问题）时，用 Node 直接重读解析
      for (let k = 0; k < items.length; k++) {
        const it = items[k]
        const p = String(chunk[k] || '')
        if (/\.url$/i.test(p) && (!it || !it.ok)) {
          const parsed = parseUrlFileRaw(p)
          if (parsed) {
            items[k] = {
              path: p, ok: true, kind: 'url',
              target: parsed.target,
              iconLocation: parsed.iconLocation || ''
            }
          }
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
      if (r && r.ok && r.data) {
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

  readImageAsDataUrl (p) {
    try {
      const buf = fs.readFileSync(p)
      if (buf.length > 8 * 1024 * 1024) return { ok: false, error: '图片过大' }
      const ext = path.extname(p).toLowerCase().replace('.', '')
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
        : ext === 'svg' ? 'image/svg+xml'
          : ext === 'webp' ? 'image/webp'
            : ext === 'gif' ? 'image/gif'
              : ext === 'bmp' ? 'image/bmp'
                : ext === 'ico' ? 'image/x-icon'
                  : 'image/png'
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

window.services = services
try {
  const electron = require('electron')
  if (electron && electron.contextBridge && electron.contextBridge.exposeInMainWorld) {
    electron.contextBridge.exposeInMainWorld('services', services)
  }
} catch (e) {
  log('contextBridge expose skipped', e.message)
}
