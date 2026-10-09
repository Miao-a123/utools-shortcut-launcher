(function () {
  'use strict'
  const KL = (window.KL = window.KL || {})

  const S = window.services

  const DEFAULT_SETTINGS = {
    showLabels: true,
    sortBy: 'manual',
    cell: 92,
    sidebarWidth: 184,
    theme: 'auto',
    faviconService: '',
    launchOnDoubleClick: false,
    confirmDelete: true,
    hideOnLaunch: true,
    tileRadius: 16
  }

  const DEFAULT_PALETTE = ['#534AB7', '#185FA5', '#0F6E56', '#993C1D', '#993556', '#3B6D11', '#854F0B', '#5F5E5A']

  let state = {
    version: 1,
    settings: Object.assign({}, DEFAULT_SETTINGS),
    categories: [],
    shortcuts: []
  }

  let dirty = false
  let saveTimer = null
  let batchDepth = 0
  const batchEmit = {}
  const listeners = []

  function uid (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
  }

  function normalizeCategory (c) {
    return {
      id: c.id || uid('cat'),
      name: c.name || '未命名分类',
      color: c.color || DEFAULT_PALETTE[0],
      order: typeof c.order === 'number' ? c.order : 999
    }
  }

  function normalizeShortcut (s) {
    const now = Date.now()
    const launch = s.launch || {}
    return {
      id: s.id || uid('sc'),
      name: s.name || (launch.target ? String(launch.target).split(/[\\/]/).pop() : '未命名'),
      categoryId: s.categoryId || null,
      col: Math.max(1, Math.min(4, parseInt(s.col, 10) || 1)),
      row: Math.max(1, Math.min(4, parseInt(s.row, 10) || 1)),
      launch: {
        kind: launch.kind || 'path',
        target: launch.target || '',
        args: launch.args || '',
        workDir: launch.workDir || '',
        appId: launch.appId || ''
      },
      icon: s.icon && typeof s.icon === 'object' ? s.icon : { type: 'auto' },
      originalPath: s.originalPath || '',
      iconLocation: s.iconLocation || '',
      iconIndex: s.iconIndex == null ? -1 : s.iconIndex,
      source: s.source || '',
      note: s.note || '',
      createdAt: s.createdAt || now,
      updatedAt: s.updatedAt || now,
      launchCount: s.launchCount || 0,
      lastLaunched: s.lastLaunched || 0,
      missing: !!s.missing
    }
  }

  function normalize (raw) {
    const data = raw && typeof raw === 'object' ? raw : {}
    state = {
      version: 1,
      settings: Object.assign({}, DEFAULT_SETTINGS, data.settings || {}),
      categories: Array.isArray(data.categories) ? data.categories.map(normalizeCategory) : [],
      shortcuts: Array.isArray(data.shortcuts) ? data.shortcuts.map(normalizeShortcut) : []
    }
    state.categories.sort((a, b) => a.order - b.order)
    return state
  }

  function load () {
    let raw = null
    try {
      raw = S.loadData()
    } catch (e) {
      console.warn('load failed', e)
    }
    return normalize(raw)
  }

  function saveNow () {
    dirty = false
    try {
      S.saveData(state)
    } catch (e) {
      console.error('save failed', e)
      if (KL.toast) KL.toast('保存失败：' + e.message, 'error')
    }
  }

  function save (immediate) {
    dirty = true
    if (batchDepth > 0) return
    if (immediate) return saveNow()
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(saveNow, 320)
  }

  function flush () {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    if (dirty) saveNow()
  }

  function emit (type, payload) {
    if (batchDepth > 0) {
      batchEmit[type] = payload
      return
    }
    for (const fn of listeners) {
      try { fn(type, payload) } catch (e) { console.error(e) }
    }
  }

  function batch (fn) {
    batchDepth++
    let out
    try {
      out = fn()
    } finally {
      batchDepth--
      if (batchDepth === 0) {
        if (dirty) saveNow()
        const keys = Object.keys(batchEmit)
        for (const k of keys) {
          const payload = batchEmit[k]
          delete batchEmit[k]
          for (const fn of listeners) {
            try { fn(k, payload) } catch (e) { console.error(e) }
          }
        }
      }
    }
    return out
  }

  function on (fn) { listeners.push(fn) }

  /* ---------------- categories ---------------- */

  function addCategory (name, color) {
    const order = state.categories.reduce((m, c) => Math.max(m, c.order), 0) + 1
    const cat = normalizeCategory({
      name: name || ('分类 ' + (state.categories.length + 1)),
      color: color || DEFAULT_PALETTE[state.categories.length % DEFAULT_PALETTE.length],
      order
    })
    state.categories.push(cat)
    save()
    emit('categories')
    return cat
  }

  function updateCategory (id, patch) {
    const c = state.categories.find(x => x.id === id)
    if (!c) return null
    Object.assign(c, patch)
    save()
    emit('categories')
    return c
  }

  function removeCategory (id) {
    const idx = state.categories.findIndex(x => x.id === id)
    if (idx < 0) return false
    state.categories.splice(idx, 1)
    for (const s of state.shortcuts) if (s.categoryId === id) s.categoryId = null
    save()
    emit('categories')
    emit('shortcuts')
    return true
  }

  /* ---------------- shortcuts ---------------- */

  function addShortcut (partial) {
    const sc = normalizeShortcut(Object.assign({}, partial))
    state.shortcuts.push(sc)
    save()
    emit('shortcuts')
    return sc
  }

  function addShortcuts (list) {
    const out = list.map(p => normalizeShortcut(p))
    state.shortcuts.push.apply(state.shortcuts, out)
    save()
    emit('shortcuts')
    return out
  }

  function updateShortcut (id, patch, opts) {
    const sc = state.shortcuts.find(x => x.id === id)
    if (!sc) return null
    if (patch.launch) patch.launch = Object.assign({}, sc.launch, patch.launch)
    Object.assign(sc, patch, { updatedAt: Date.now() })
    save()
    if (!(opts && opts.silent)) emit('shortcuts')
    return sc
  }

  function removeShortcut (id) {
    const idx = state.shortcuts.findIndex(x => x.id === id)
    if (idx < 0) return false
    state.shortcuts.splice(idx, 1)
    save()
    emit('shortcuts')
    return true
  }

  function removeShortcuts (ids) {
    const set = {}
    ids.forEach(id => { set[id] = 1 })
    state.shortcuts = state.shortcuts.filter(s => !set[s.id])
    save()
    emit('shortcuts')
  }

  function getShortcut (id) {
    return state.shortcuts.find(x => x.id === id) || null
  }

  function setCategory (id, categoryId) {
    return updateShortcut(id, { categoryId: categoryId || null })
  }

  function findByTarget (target) {
    if (!target) return null
    const low = String(target).toLowerCase()
    return state.shortcuts.find(s => String(s.launch.target).toLowerCase() === low) || null
  }

  function findByUrl (url) {
    if (!url) return null
    let a = String(url).toLowerCase().replace(/\/+$/, '')
    return state.shortcuts.find(s => String(s.launch.target).toLowerCase().replace(/\/+$/, '') === a) || null
  }

  /* ---------------- ordering / filtering ---------------- */

  function inCategory (categoryId) {
    if (!categoryId || categoryId === 'all') return state.shortcuts.slice()
    if (categoryId === 'none') return state.shortcuts.filter(s => !s.categoryId)
    return state.shortcuts.filter(s => s.categoryId === categoryId)
  }

  function compare (a, b) {
    const by = state.settings.sortBy
    if (by === 'name') {
      return a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
    }
    if (by === 'created') return b.createdAt - a.createdAt
    if (by === 'updated') return b.lastLaunched - a.lastLaunched || b.updatedAt - a.updatedAt
    return 0
  }

  function visible (categoryId, keyword) {
    let list = inCategory(categoryId)
    if (keyword) {
      const k = keyword.trim().toLowerCase()
      list = list.filter(s => {
        if (s.name.toLowerCase().indexOf(k) >= 0) return true
        if (String(s.launch.target).toLowerCase().indexOf(k) >= 0) return true
        if (String(s.note).toLowerCase().indexOf(k) >= 0) return true
        return false
      })
    }
    if (state.settings.sortBy !== 'manual') {
      list.sort(compare)
    }
    return list
  }

  function manualOrderOf (id) {
    return state.shortcuts.findIndex(s => s.id === id)
  }

  function moveBefore (id, targetId, categoryId) {
    const idx = state.shortcuts.findIndex(s => s.id === id)
    if (idx < 0) return false
    const item = state.shortcuts.splice(idx, 1)[0]
    if (categoryId !== undefined) item.categoryId = categoryId || null
    let target = -1
    if (targetId) target = state.shortcuts.findIndex(s => s.id === targetId)
    if (target < 0) state.shortcuts.push(item)
    else state.shortcuts.splice(target, 0, item)
    item.updatedAt = Date.now()
    save()
    emit('shortcuts')
    return true
  }

  function moveToEnd (id, categoryId) {
    const idx = state.shortcuts.findIndex(s => s.id === id)
    if (idx < 0) return false
    const item = state.shortcuts.splice(idx, 1)[0]
    if (categoryId !== undefined) item.categoryId = categoryId || null
    state.shortcuts.push(item)
    save()
    emit('shortcuts')
    return true
  }

  function reorderInCategory (categoryId, orderedIds) {
    const groups = {}
    orderedIds.forEach((id, i) => { groups[id] = i })
    const items = state.shortcuts.filter(s => groups[s.id] !== undefined)
    const others = state.shortcuts.filter(s => groups[s.id] === undefined)
    items.sort((a, b) => groups[a.id] - groups[b.id])
    if (categoryId && categoryId !== 'all') {
      const keep = []
      const moved = []
      for (const s of others) {
        if (s.categoryId === categoryId) keep.push(s)
        else moved.push(s)
      }
      state.shortcuts = moved.concat(keep).concat(items)
      for (const s of items) s.categoryId = categoryId
    } else {
      state.shortcuts = others.concat(items)
    }
    save()
    emit('shortcuts')
  }

  function countByCategory (categoryId) {
    if (categoryId === 'none') return state.shortcuts.filter(s => !s.categoryId).length
    return state.shortcuts.filter(s => s.categoryId === categoryId).length
  }

  function setSetting (key, value) {
    state.settings[key] = value
    save()
    emit('settings', { key, value })
  }

  function exportJSON () {
    return JSON.stringify(state, null, 2)
  }

  function importJSON (data, mode) {
    if (!data || !Array.isArray(data.shortcuts)) return false
    if (mode === 'replace') {
      state = normalize(data)
    } else {
      const existing = {}
      state.shortcuts.forEach(s => { existing[s.launch.target.toLowerCase()] = 1 })
      const cats = {}
      state.categories.forEach(c => { cats[c.name] = c.id })
      const catMap = {}
      for (const c of (data.categories || [])) {
        if (cats[c.name]) catMap[c.id] = cats[c.name]
        else { const nc = addCategory(c.name, c.color); catMap[c.id] = nc.id }
      }
      const added = []
      for (const s of (data.shortcuts || [])) {
        const t = String((s.launch || {}).target || '').toLowerCase()
        if (t && existing[t]) continue
        const ns = normalizeShortcut(s)
        ns.id = uid('sc')
        ns.categoryId = catMap[s.categoryId] || null
        added.push(ns)
      }
      state.shortcuts.push.apply(state.shortcuts, added)
    }
    saveNow()
    emit('categories')
    emit('shortcuts')
    return true
  }

  function reset () {
    state = {
      version: 1,
      settings: Object.assign({}, DEFAULT_SETTINGS),
      categories: [],
      shortcuts: []
    }
    saveNow()
    emit('categories')
    emit('shortcuts')
  }

  KL.store = {
    DEFAULT_PALETTE,
    DEFAULT_SETTINGS,
    get state () { return state },
    get settings () { return state.settings },
    get categories () { return state.categories },
    get shortcuts () { return state.shortcuts },
    uid,
    load,
    save,
    saveNow,
    flush,
    batch,
    on,
    emit,
    addCategory,
    updateCategory,
    removeCategory,
    addShortcut,
    addShortcuts,
    updateShortcut,
    removeShortcut,
    removeShortcuts,
    getShortcut,
    setCategory,
    findByTarget,
    findByUrl,
    inCategory,
    visible,
    manualOrderOf,
    moveBefore,
    moveToEnd,
    reorderInCategory,
    countByCategory,
    setSetting,
    exportJSON,
    importJSON,
    reset,
    normalize
  }
})()
