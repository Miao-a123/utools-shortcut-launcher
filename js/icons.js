(function () {
  'use strict'
  const KL = (window.KL = window.KL || {})
  const S = window.services

  const GLYPH_COLOR = {
    folder: '#BA7517',
    image: '#0F6E56',
    video: '#993C1D',
    audio: '#993556',
    doc: '#185FA5',
    sheet: '#3B6D11',
    slide: '#993C1D',
    code: '#534AB7',
    archive: '#5F5E5A',
    app: '#444441',
    url: '#185FA5',
    disk: '#5F5E5A',
    generic: '#5F5E5A'
  }

  const STROKE = 'fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"'

  const GLYPHS = {
    folder: '<path ' + STROKE + ' d="M8 17c0-1.9 1.5-3.4 3.4-3.4h6.4l3.6 4.2h15.2c1.9 0 3.4 1.5 3.4 3.4v13.4c0 1.9-1.5 3.4-3.4 3.4H11.4C9.5 38 8 36.5 8 34.6z"/>',
    image: '<path ' + STROKE + ' d="M9.5 12.5h29v23h-29z"/><path ' + STROKE + ' d="M9.5 30.5l8.4-8.4 6.6 6.6 5.4-4.6 8.6 8.6"/><circle ' + STROKE + ' cx="18.4" cy="19.6" r="2.4"/>',
    video: '<rect ' + STROKE + ' x="9.5" y="13" width="29" height="22" rx="3.4"/><path ' + STROKE + ' d="M20.6 18.6l9.6 5.4-9.6 5.4z"/>',
    audio: '<path ' + STROKE + ' d="M20 32.4V15.6l14-3v16.2"/><ellipse ' + STROKE + ' cx="15.6" cy="33.4" rx="4.4" ry="3.6"/><ellipse ' + STROKE + ' cx="29.6" cy="30.4" rx="4.4" ry="3.6"/>',
    doc: '<path ' + STROKE + ' d="M14 9.5h13.6L36 18v20.5H14z"/><path ' + STROKE + ' d="M27.4 9.5V18H36"/><path ' + STROKE + ' d="M19 25h12M19 31h9"/>',
    sheet: '<path ' + STROKE + ' d="M14 9.5h13.6L36 18v20.5H14z"/><path ' + STROKE + ' d="M27.4 9.5V18H36"/><path ' + STROKE + ' d="M14 24h22M14 30h22M21 24v9.5"/>',
    slide: '<rect ' + STROKE + ' x="9.5" y="12" width="29" height="20" rx="2.6"/><path ' + STROKE + ' d="M17 26l7-6 4 3.4 6-5.4"/><path ' + STROKE + ' d="M24 32v4.5"/>',
    code: '<path ' + STROKE + ' d="M19 17.5L11.5 25 19 32.5M29 17.5L36.5 25 29 32.5M26 14l-4 22"/>',
    archive: '<path ' + STROKE + ' d="M11 19.5h26v15.9c0 1.7-1.4 3.1-3.1 3.1H14.1A3.1 3.1 0 0 1 11 35.4z"/><path ' + STROKE + ' d="M9 12.5h30v7H9z"/><path ' + STROKE + ' d="M19.5 25.5h9"/>',
    app: '<rect ' + STROKE + ' x="11" y="12" width="26" height="24" rx="2.6"/><path ' + STROKE + ' d="M11 19.6h26"/><circle ' + STROKE + ' cx="15.4" cy="15.8" r="0.9"/>',
    url: '<circle ' + STROKE + ' cx="24" cy="24" r="14"/><path ' + STROKE + ' d="M10 24h28M24 10c4 4.4 5.8 9 5.8 14S27.9 33.6 24 38c-4-4.4-5.8-9-5.8-14S20.1 14.4 24 10z"/>',
    disk: '<circle ' + STROKE + ' cx="24" cy="24" r="14"/><circle ' + STROKE + ' cx="24" cy="24" r="3.4"/>',
    generic: '<path ' + STROKE + ' d="M14 9.5h13.6L36 18v20.5H14z"/><path ' + STROKE + ' d="M27.4 9.5V18H36"/>'
  }

  const EXT_KIND = {
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', bmp: 'image', webp: 'image', svg: 'image', ico: 'image', tif: 'image', tiff: 'image', psd: 'image', raw: 'image', heic: 'image',
    mp4: 'video', mkv: 'video', avi: 'video', mov: 'video', wmv: 'video', flv: 'video', webm: 'video', m4v: 'video', mpg: 'video', mpeg: 'video', rmvb: 'video', ts: 'video',
    mp3: 'audio', wav: 'audio', flac: 'audio', ape: 'audio', aac: 'audio', ogg: 'audio', m4a: 'audio', wma: 'audio', mid: 'audio',
    pdf: 'doc', doc: 'doc', docx: 'doc', txt: 'doc', md: 'doc', rtf: 'doc', odt: 'doc', epub: 'doc', mobi: 'doc', wps: 'doc', tex: 'doc',
    xls: 'sheet', xlsx: 'sheet', csv: 'sheet', tsv: 'sheet', ods: 'sheet', et: 'sheet',
    ppt: 'slide', pptx: 'slide', odp: 'slide', dps: 'slide',
    zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive', bz2: 'archive', xz: 'archive', iso: 'disk', img: 'disk', cue: 'disk',
    js: 'code', mjs: 'code', cjs: 'code', ts: 'code', jsx: 'code', tsx: 'code', json: 'code', html: 'code', htm: 'code', css: 'code', scss: 'code', less: 'code',
    py: 'code', java: 'code', c: 'code', h: 'code', cpp: 'code', hpp: 'code', cs: 'code', go: 'code', rs: 'code', rb: 'code', php: 'code', sh: 'code', bat: 'code',
    ps1: 'code', sql: 'code', yml: 'code', yaml: 'code', toml: 'code', xml: 'code', ini: 'code', vue: 'code', lua: 'code', kt: 'code', swift: 'code', dart: 'code',
    exe: 'app', msi: 'app', lnk: 'app', url: 'url', 'appref-ms': 'app', com: 'app'
  }

  function extOf (name) {
    const m = /\.([a-z0-9_]+)$/i.exec(String(name || ''))
    return m ? m[1].toLowerCase() : ''
  }

  function kindOfShortcut (sc) {
    const l = (sc && sc.launch) || {}
    if (l.kind === 'url') return 'url'
    if (l.kind === 'appid') return 'app'
    const target = String(l.target || sc.originalPath || '')
    if (!target) return 'generic'
    if (/[\\/]$/.test(target)) return 'folder'
    const ext = extOf(target)
    if (!ext) return 'folder'
    return EXT_KIND[ext] || 'generic'
  }

  /* ---------------- svg / canvas icon factories ---------------- */

  function svgToDataUrl (svg) {
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  }

  function glyph (kind, color) {
    const g = GLYPHS[kind] || GLYPHS.generic
    const c = color || GLYPH_COLOR[kind] || GLYPH_COLOR.generic
    return svgToDataUrl(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">' +
      '<rect x="0" y="0" width="48" height="48" rx="11" fill="' + c + '"/>' + g + '</svg>'
    )
  }

  function hexToRgba (hex, alpha) {
    let h = String(hex || '#534AB7').replace('#', '')
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    const n = parseInt(h, 16)
    if (isNaN(n)) return 'rgba(83,74,183,' + alpha + ')'
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + alpha + ')'
  }

  const letterCache = {}

  function letter (text, bg, fg) {
    let t = String(text == null ? '' : text).trim()
    if (!t) t = '?'
    const chars = Array.from(t)
    if (chars.length > 2) t = chars.slice(0, 1).join('')
    const key = t + '|' + (bg || '') + '|' + (fg || '')
    if (letterCache[key]) return letterCache[key]
    const size = 128
    const cv = document.createElement('canvas')
    cv.width = cv.height = size
    const ctx = cv.getContext('2d')
    ctx.fillStyle = bg || '#534AB7'
    roundRect(ctx, 0, 0, size, size, size * 0.22)
    ctx.fill()
    ctx.fillStyle = fg || '#ffffff'
    const fs = chars.length > 1 && Array.from(t).length > 1 ? size * 0.44 : size * 0.54
    ctx.font = '600 ' + fs + 'px "Segoe UI", "Microsoft YaHei", system-ui, sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(t, size / 2, size / 2 + size * 0.02)
    const url = cv.toDataURL('image/png')
    letterCache[key] = url
    return url
  }

  function roundRect (ctx, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2)
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.arcTo(x + w, y, x + w, y + h, rr)
    ctx.arcTo(x + w, y + h, x, y + h, rr)
    ctx.arcTo(x, y + h, x, y, rr)
    ctx.arcTo(x, y, x + w, y, rr)
    ctx.closePath()
  }

  /* ---------------- normalization ---------------- */

  function loadImage (src) {
    return new Promise(resolve => {
      const img = new Image()
      let done = false
      const finish = v => { if (!done) { done = true; resolve(v) } }
      img.onload = () => finish(img)
      img.onerror = () => finish(null)
      setTimeout(() => finish(null), 8000)
      img.src = src
    })
  }

  async function normalize (dataUrl, max) {
    if (!dataUrl) return null
    const limit = max || 128
    if (/^data:image\/png;base64,/.test(dataUrl)) {
      const dim = pngSize(dataUrl)
      if (dim && dim.w <= limit && dim.h <= limit) return dataUrl
    }
    const img = await loadImage(dataUrl)
    if (!img) return null
    let w = img.naturalWidth || img.width || limit
    let h = img.naturalHeight || img.height || limit
    if (!w || !h) { w = h = limit }
    const scale = Math.min(1, limit / Math.max(w, h))
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))
    const cv = document.createElement('canvas')
    cv.width = tw
    cv.height = th
    const ctx = cv.getContext('2d')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    try {
      ctx.drawImage(img, 0, 0, tw, th)
    } catch (e) {
      return null
    }
    try {
      return cv.toDataURL('image/png')
    } catch (e) {
      return null
    }
  }

  function pngSize (dataUrl) {
    try {
      const b64 = dataUrl.split(',')[1]
      const bin = atob(b64.slice(0, 64))
      if (bin.charCodeAt(1) !== 0x50) return null
      const w = (bin.charCodeAt(16) << 24) | (bin.charCodeAt(17) << 16) | (bin.charCodeAt(18) << 8) | bin.charCodeAt(19)
      const h = (bin.charCodeAt(20) << 24) | (bin.charCodeAt(21) << 16) | (bin.charCodeAt(22) << 8) | bin.charCodeAt(23)
      return { w: w, h: h }
    } catch (e) {
      return null
    }
  }

  function base64ToDataUrl (b64, mime) {
    return 'data:' + (mime || 'image/png') + ';base64,' + b64
  }

  /* ---------------- resolve for render ---------------- */

  function resolve (sc) {
    const ic = (sc && sc.icon) || { type: 'auto' }
    if (ic.type === 'text') {
      return letter(ic.text || (sc && sc.name ? sc.name[0] : '?'), ic.bg, ic.fg)
    }
    if (ic.type === 'glyph') return glyph(ic.kind || kindOfShortcut(sc), ic.bg)
    if (ic.data) return ic.data
    return glyph(kindOfShortcut(sc))
  }

  function isFallback (sc) {
    const ic = (sc && sc.icon) || {}
    return ic.type !== 'glyph' && ic.type !== 'text' && !ic.data
  }

  /* ---------------- extraction pipeline ---------------- */

  function iconSourceOf (sc) {
    const l = (sc && sc.launch) || {}
    if (sc && sc.iconFile) return { kind: 'imageFile', path: sc.iconFile }
    if (l.kind === 'url') return { kind: 'url', url: l.target }
    if (l.kind === 'appid') return { kind: 'appid', path: l.target }
    const target = l.target || sc.originalPath
    if (!target) return null
    return { kind: 'file', path: target }
  }

  async function extractOne (sc) {
    const src = iconSourceOf(sc)
    if (!src) return null
    if (src.kind === 'url') {
      const r = await S.fetchFavicon(src.url, { service: KL.store.settings.faviconService })
      if (!r || !r.ok) return null
      return normalize(r.dataUrl, 128)
    }
    if (src.kind === 'imageFile') {
      const r = S.readImageAsDataUrl(src.path)
      if (!r || !r.ok) return null
      return normalize(r.dataUrl, 128)
    }
    // 本地文件 / 快捷方式 / UWP
    const iconPath = sc.iconLocation || sc.originalPath || (sc.launch.kind === 'file' ? sc.launch.target : '')
    if (!iconPath) return null
    if (!S.exists(iconPath)) return null
    const res = await S.extractIcons([{ path: sc.originalPath || iconPath, iconPath: iconPath }])
    if (!res || !res.ok || !res.items || !res.items.length) return null
    const it = res.items[0]
    if (!it || !it.ok || !it.png) return null
    return normalize(base64ToDataUrl(it.png, 'image/png'), 128)
  }

  async function extractBatch (items) {
    // items: [{ path, iconPath, iconIndex, imageFile }]  -> returns array aligned with input
    const out = items.map(() => null)
    const jobs = []
    items.forEach((it, i) => {
      if (it && it.imageFile) {
        const r = S.readImageAsDataUrl(it.imageFile)
        out[i] = r && r.ok ? r.dataUrl : null
      } else if (it && it.path) {
        jobs.push({ i: i, path: it.path, iconPath: it.iconPath || it.path, iconIndex: it.iconIndex == null ? -1 : it.iconIndex })
      }
    })
    if (!jobs.length) return out
    const chunkSize = 25
    for (let c = 0; c < jobs.length; c += chunkSize) {
      const chunk = jobs.slice(c, c + chunkSize)
      const res = await S.extractIcons(chunk.map(j => ({ path: j.path, iconPath: j.iconPath, iconIndex: j.iconIndex })))
      if (res && res.ok && res.items) {
        res.items.forEach((r, k) => {
          const job = chunk[k]
          if (!job) return
          if (r && r.ok && r.png) out[job.i] = base64ToDataUrl(r.png, 'image/png')
        })
      }
      if (KL.progress && jobs.length > chunkSize) KL.progress(c + chunk.length, jobs.length)
    }
    return out
  }

  async function ensure (sc, opts) {
    const o = opts || {}
    const data = await extractOne(sc)
    if (!data) return null
    const current = KL.store.getShortcut(sc.id)
    if (!current) return null
    if (!o.force && current.icon && current.icon.data === data) return data
    const type = current.icon && (current.icon.type === 'glyph' || current.icon.type === 'text') ? current.icon.type : 'auto'
    if (type !== 'auto') return data
    KL.store.updateShortcut(sc.id, { icon: Object.assign({}, current.icon, { type: 'auto', data: data, fetchedAt: Date.now() }) }, { silent: true })
    return data
  }

  async function ensureMany (list, concurrency, onEach) {
    const items = list.slice()
    const limit = concurrency || 3
    let active = 0
    let index = 0
    return new Promise(resolve => {
      const next = () => {
        if (index >= items.length) {
          if (active === 0) resolve()
          return
        }
        const sc = items[index++]
        active++
        extractOne(sc).then(data => {
          if (data && KL.store.getShortcut(sc.id)) {
            const cur = KL.store.getShortcut(sc.id)
            if (cur.icon && (cur.icon.type === 'glyph' || cur.icon.type === 'text')) {
              // 用户已手动指定图标，跳过
            } else {
              KL.store.updateShortcut(sc.id, { icon: Object.assign({}, cur.icon, { type: 'auto', data: data, fetchedAt: Date.now() }) }, { silent: true })
            }
          }
          if (onEach) onEach(sc, data)
        }).catch(() => {}).then(() => {
          active--
          if (index >= items.length && active === 0) resolve()
          else next()
        })
      }
      for (let i = 0; i < Math.min(limit, items.length); i++) next()
      if (!items.length) resolve()
    })
  }

  function defaultTextIcon (sc) {
    const name = (sc && sc.name) || '?'
    const ch = Array.from(name.trim())[0] || '?'
    const kind = kindOfShortcut(sc)
    const bg = GLYPH_COLOR[kind] || GLYPH_COLOR.generic
    return { type: 'text', text: ch, bg: bg, fg: '#ffffff' }
  }

  function hsvPalette (n) {
    const out = []
    for (let i = 0; i < (n || 8); i++) {
      const h = (i * 47) % 360
      out.push(hslToHex(h, 62, 48))
    }
    return out
  }

  function hslToHex (h, s, l) {
    s /= 100
    l /= 100
    const k = n => (n + h / 30) % 12
    const a = s * Math.min(l, 1 - l)
    const f = n => {
      const v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
      return Math.round(255 * v).toString(16).padStart(2, '0')
    }
    return '#' + f(0) + f(8) + f(4)
  }

  KL.icons = {
    GLYPH_COLOR: GLYPH_COLOR,
    PALETTE: ['#534AB7', '#185FA5', '#0F6E56', '#993C1D', '#993556', '#3B6D11', '#854F0B', '#5F5E5A', '#4A3FD8', '#0E7490'],
    kindOfShortcut: kindOfShortcut,
    extOf: extOf,
    glyph: glyph,
    letter: letter,
    normalize: normalize,
    resolve: resolve,
    isFallback: isFallback,
    extractOne: extractOne,
    extractBatch: extractBatch,
    ensure: ensure,
    ensureMany: ensureMany,
    defaultTextIcon: defaultTextIcon,
    hsvPalette: hsvPalette,
    hexToRgba: hexToRgba,
    pngSize: pngSize
  }
})()
