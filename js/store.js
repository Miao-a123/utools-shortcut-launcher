(function () {
  'use strict'
  const KL = (window.KL = window.KL || {})

  const S = window.services

  const DEFAULT_SETTINGS = {
    showLabels: true,
    sortBy: 'manual',
    cell: 92,
    sidebarWidth: 184,
    folderIconSize: 'medium',
    tileBgColor: '',
    tileBorderColor: '',
    tileBorderWidth: 1,
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
      kind: s.kind === 'folder' ? 'folder' : 'shortcut',
      parentId: s.parentId || null,
      color: s.color || '',
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
    return removeShortcuts([id])
  }

  function removeShortcuts (ids) {
    const set = {}
    // 删除文件夹时连同其内部项一起删除
    const collect = id => {
      if (set[id]) return
      set[id] = 1
      for (const s of state.shortcuts) if (s.parentId === id) collect(s.id)
    }
    ids.forEach(collect)
    const before = state.shortcuts.length
    state.shortcuts = state.shortcuts.filter(s => !set[s.id])
    save()
    emit('shortcuts')
    return state.shortcuts.length !== before
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
    // 只返回顶层项：文件夹里的图标不直接出现在主网格上
    const top = state.shortcuts.filter(s => !s.parentId)
    if (!categoryId || categoryId === 'all') return top
    if (categoryId === 'none') return top.filter(s => !s.categoryId)
    return top.filter(s => s.categoryId === categoryId)
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
      const hits = {}
      state.shortcuts.forEach(s => {
        if (s.kind === 'folder') {
          if (String(s.name).toLowerCase().indexOf(k) >= 0) hits[s.id] = 1
          return
        }
        const matched = s.name.toLowerCase().indexOf(k) >= 0 ||
          String(s.launch.target).toLowerCase().indexOf(k) >= 0 ||
          String(s.note).toLowerCase().indexOf(k) >= 0
        if (matched) {
          hits[s.id] = 1
          if (s.parentId) hits[s.parentId] = 1   // 命中文件夹内的图标时，把文件夹一并显示
        }
      })
      list = list.filter(s => hits[s.id])
    }
    if (state.settings.sortBy !== 'manual') {
      list.sort(compare)
    }
    return list
  }

  /* ---------------- folders ---------------- */

  function createFolder (partial) {
    const p = partial || {}
    const f = normalizeShortcut({
      kind: 'folder',
      name: p.name || '新建文件夹',
      color: p.color || '',
      col: p.col || 1,
      row: p.row || 1,
      categoryId: p.categoryId === undefined ? null : p.categoryId,
      launch: { kind: 'path', target: '' }
    })
    state.shortcuts.push(f)
    save()
    emit('shortcuts')
    return f
  }

  function childrenOf (folderId) {
    return state.shortcuts.filter(s => s.parentId === folderId)
  }

  function childCount (folderId) {
    let n = 0
    for (const s of state.shortcuts) if (s.parentId === folderId) n++
    return n
  }

  // 把若干项移入 / 移出文件夹（parentId = null 表示移到主网格）
  function setParent (ids, parentId) {
    const pid = parentId || null
    for (const id of ids) {
      const s = state.shortcuts.find(x => x.id === id)
      if (!s || s.id === pid) continue
      if (s.kind === 'folder' && pid) continue   // 文件夹不允许嵌套
      s.parentId = pid
      s.updatedAt = Date.now()
    }
    save()
    emit('shortcuts')
  }

  // 解散文件夹：内部项回到主网格，文件夹本身删除
  function dissolveFolder (folderId) {
    let n = 0
    state.shortcuts.forEach(s => { if (s.parentId === folderId) { s.parentId = null; n++ } })
    const idx = state.shortcuts.findIndex(s => s.id === folderId)
    if (idx >= 0) state.shortcuts.splice(idx, 1)
    save()
    emit('shortcuts')
    return n
  }

  function folderOf (id) {
    const s = getShortcut(id)
    return s && s.parentId ? getShortcut(s.parentId) : null
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
    const top = state.shortcuts.filter(s => !s.parentId)
    if (categoryId === 'none') return top.filter(s => !s.categoryId).length
    return top.filter(s => s.categoryId === categoryId).length
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
    createFolder,
    childrenOf,
    childCount,
    setParent,
    dissolveFolder,
    folderOf,
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
