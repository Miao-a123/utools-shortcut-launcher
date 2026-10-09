(function () {
  'use strict'
  const KL = (window.KL = window.KL || {})
  const store = KL.store
  const S = window.services
  const el = KL.ui.el
  const toast = KL.ui.toast

  const KEYWORDS = ['快捷方式', '快捷启动', '快捷面板', 'launcher', 'shortcut', 'kl']

  let searchInput = null
  let searchWrap = null
  let dropOverlay = null
  let dragDepth = 0

  /* ---------------- theme & vars ---------------- */

  function applyTheme () {
    const mode = store.settings.theme || 'auto'
    let dark = true
    if (mode === 'auto') {
      try { dark = utools.isDarkColors() } catch (e) { dark = true }
    } else {
      dark = mode === 'dark'
    }
    document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  }

  function applyVars () {
    const s = store.settings
    const cell = Math.max(64, Math.min(160, parseInt(s.cell, 10) || 92))
    document.documentElement.style.setProperty('--cell', cell + 'px')
    document.documentElement.style.setProperty('--tile-radius', (s.tileRadius || 16) + 'px')
    const grid = document.getElementById('grid')
    if (grid) grid.style.setProperty('--cell', cell + 'px')
    const sw = Math.max(120, Math.min(420, parseInt(s.sidebarWidth, 10) || 184))
    document.documentElement.style.setProperty('--sidebar-w', sw + 'px')
  }

  /* ---------------- sidebar resize ---------------- */

  function bindSideResizer () {
    const handle = document.getElementById('sideResizer')
    if (!handle) return
    handle.addEventListener('mousedown', e => {
      e.preventDefault()
      const startX = e.clientX
      const startW = parseInt(store.settings.sidebarWidth, 10) || 184
      handle.classList.add('active')
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
      const onMove = ev => {
        const w = Math.max(120, Math.min(420, startW + (ev.clientX - startX)))
        document.documentElement.style.setProperty('--sidebar-w', w + 'px')
      }
      const onUp = ev => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        handle.classList.remove('active')
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        const w = Math.max(120, Math.min(420, startW + (ev.clientX - startX)))
        store.setSetting('sidebarWidth', w)
        KL.grid.render()
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  }

  /* ---------------- sidebar ---------------- */

  function renderSidebar () {
    const side = document.getElementById('sidebar')
    side.innerHTML = ''

    const head = el('div', 'side-title')
    head.appendChild(el('span', '', '分类'))
    const addBtn = el('button', '', '+')
    addBtn.title = '新建分类'
    addBtn.addEventListener('click', () => KL.dialogs.newCategory())
    head.appendChild(addBtn)
    side.appendChild(head)

    const current = KL.grid.getCategory()

    const all = el('div', 'cat' + (current === 'all' ? ' active' : ''))
    all.dataset.cat = 'all'
    all.innerHTML = '<span class="dot" style="background:var(--text-3)"></span><span class="name">全部</span><span class="count">' +
      store.shortcuts.length + '</span>'
    all.addEventListener('click', () => setCategory('all'))
    side.appendChild(all)

    const noneCount = store.shortcuts.filter(s => !s.categoryId).length
    if (noneCount > 0) {
      const none = el('div', 'cat' + (current === 'none' ? ' active' : ''))
      none.dataset.cat = 'none'
      none.innerHTML = '<span class="dot" style="background:var(--text-3)"></span><span class="name">未分类</span><span class="count">' +
        noneCount + '</span>'
      none.addEventListener('click', () => setCategory('none'))
      side.appendChild(none)
    }

    for (const c of store.categories) {
      const count = store.shortcuts.filter(s => s.categoryId === c.id).length
      const node = el('div', 'cat' + (current === c.id ? ' active' : ''))
      node.dataset.cat = c.id
      const dot = el('span', 'dot')
      dot.style.background = c.color || 'var(--text-3)'
      node.appendChild(dot)
      const name = el('span', 'name')
      name.textContent = c.name
      node.appendChild(name)
      const cnt = el('span', 'count', String(count))
      node.appendChild(cnt)
      const more = el('button', 'cat-more', '⋯')
      more.title = '分类操作'
      more.addEventListener('click', e => {
        e.stopPropagation()
        const r = more.getBoundingClientRect()
        KL.dialogs.categoryMenu(c, r.left, r.bottom + 4)
      })
      node.appendChild(more)
      node.addEventListener('click', () => setCategory(c.id))
      node.addEventListener('contextmenu', e => {
        e.preventDefault()
        KL.dialogs.categoryMenu(c, e.clientX, e.clientY)
      })
      side.appendChild(node)
    }

    const foot = el('div', 'side-foot')
    const setBtn = el('div', 'side-btn',
      '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="8" cy="8" r="2.4"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4"/></svg><span>设置</span>')
    setBtn.title = '设置'
    setBtn.addEventListener('click', () => KL.dialogs.settings())
    foot.appendChild(setBtn)
    side.appendChild(foot)

    bindCategoryDrops(side)
    updateSelectionBar()
  }

  function bindCategoryDrops (side) {
    const nodes = side.querySelectorAll('.cat')
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      node.addEventListener('dragover', e => {
        if (!KL.grid.isInternal(e)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        node.classList.add('drop-target')
      })
      node.addEventListener('dragleave', () => node.classList.remove('drop-target'))
      node.addEventListener('drop', e => {
        if (!KL.grid.isInternal(e)) return
        e.preventDefault()
        node.classList.remove('drop-target')
        let ids = []
        try { ids = JSON.parse(e.dataTransfer.getData(KL.grid.GRID_MIME)) || [] } catch (err) { return }
        const cat = node.dataset.cat
        const target = cat === 'all' ? undefined : (cat === 'none' ? null : cat)
        if (target === undefined) return
        store.batch(() => { ids.forEach(id => store.setCategory(id, target)) })
        if (target) {
          const c = store.categories.find(x => x.id === target)
          toast('已移动到「' + (c ? c.name : '') + '」')
        } else {
          toast('已移出分类')
        }
        KL.grid.clearSelection()
        renderSidebar()
        KL.grid.render()
      })
    }
  }

  function setCategory (id) {
    KL.grid.setCategory(id)
    const nodes = document.querySelectorAll('.cat')
    for (let i = 0; i < nodes.length; i++) {
      nodes[i].classList.toggle('active', nodes[i].dataset.cat === id)
    }
  }

  /* ---------------- toolbar ---------------- */

  function sortLabelOf (v) {
    return v === 'name' ? '名称' : v === 'created' ? '创建时间' : v === 'updated' ? '最近使用' : '手动'
  }

  function syncToolbar () {
    const s = store.settings
    document.getElementById('sortLabel').textContent = sortLabelOf(s.sortBy)
    document.getElementById('btnLabels').classList.toggle('active', !!s.showLabels)
    document.getElementById('btnLabels').title = s.showLabels ? '当前：显示名称' : '当前：隐藏名称'
  }

  function bindToolbar () {
    document.getElementById('btnAdd').addEventListener('click', e => {
      const r = e.currentTarget.getBoundingClientRect()
      KL.ui.menu([
        { label: '添加文件 / 文件夹…', onClick: () => KL.dialogs.addFromFiles() },
        { label: '添加网址…', onClick: () => KL.dialogs.addUrl() },
        { label: '从剪贴板添加', onClick: () => KL.dialogs.addFromClipboard() },
        { label: '新建文件夹', onClick: () => KL.dialogs.newFolder() },
        { separator: true },
        { label: '手动新建快捷方式…', onClick: () => manualNew() },
        { separator: true },
        { label: '扫描本机应用…', onClick: () => KL.dialogs.scanApps() },
        { label: '导入浏览器收藏夹…', onClick: () => KL.dialogs.importBookmarks() }
      ], { x: r.left, y: r.bottom + 6 })
    })

    document.getElementById('btnSort').addEventListener('click', e => {
      const r = e.currentTarget.getBoundingClientRect()
      const cur = store.settings.sortBy
      const opts = [
        { key: 'manual', label: '手动排序（拖拽调整）' },
        { key: 'name', label: '按名称排列' },
        { key: 'created', label: '按创建时间排列' },
        { key: 'updated', label: '按最近使用排列' }
      ]
      KL.ui.menu(opts.map(o => ({
        label: o.label,
        hint: cur === o.key ? '✓' : '',
        onClick: () => {
          store.setSetting('sortBy', o.key)
          syncToolbar()
        }
      })), { x: r.left, y: r.bottom + 6 })
    })

    document.getElementById('btnLabels').addEventListener('click', () => {
      store.setSetting('showLabels', !store.settings.showLabels)
      syncToolbar()
    })
  }

  function manualNew () {
    const base = store.addShortcut({
      name: '新快捷方式',
      launch: { kind: 'path', target: '' },
      categoryId: KL.grid.getCategory() === 'all' || KL.grid.getCategory() === 'none' ? null : KL.grid.getCategory(),
      icon: { type: 'auto' }
    })
    KL.grid.render()
    KL.dialogs.editShortcut(base, () => {
      KL.grid.render()
      renderSidebar()
    })
  }

  /* ---------------- selection bar ---------------- */

  function updateSelectionBar () {
    const bar = document.getElementById('selbar')
    const ids = KL.grid.selectedIds()
    if (!ids.length) {
      bar.classList.remove('show')
      return
    }
    document.getElementById('selCount').textContent = '已选 ' + ids.length + ' 项'
    bar.classList.add('show')
  }

  function onSelectionChange () {
    updateSelectionBar()
  }

  function bindSelbar () {
    const bar = document.getElementById('selbar')
    bar.addEventListener('contextmenu', e => {
      e.preventDefault()
      KL.dialogs.batchMenu(e.clientX, e.clientY)
    })
    document.getElementById('selMove').addEventListener('click', e => {
      const r = e.currentTarget.getBoundingClientRect()
      const ids = KL.grid.selectedIds()
      KL.ui.menu([{ label: '未分类', onClick: () => { store.batch(() => ids.forEach(id => store.setCategory(id, null))); finishBatch() } }]
        .concat(store.categories.map(c => ({
          label: c.name,
          onClick: () => { store.batch(() => ids.forEach(id => store.setCategory(id, c.id))); finishBatch() }
        }))), { x: r.left, y: r.top })
    })
    document.getElementById('selFolder').addEventListener('click', e => {
      const r = e.currentTarget.getBoundingClientRect()
      const ids = KL.grid.selectedIds()
      if (!ids.length) return
      const cat = KL.grid.getCategory()
      const catId = (cat === 'all' || cat === 'none') ? null : cat
      const folders = store.shortcuts.filter(s => s.kind === 'folder' && !s.parentId)
      const items = [{
        label: '新建文件夹…',
        onClick: async () => {
          const n = await KL.ui.prompt({ title: '装进新文件夹', value: '新建文件夹', placeholder: '文件夹名称', okText: '创建' })
          if (n == null || !n) return
          store.batch(() => {
            const f = store.createFolder({ name: n, categoryId: catId })
            store.setParent(ids, f.id)
          })
          toast('已创建「' + n + '」并放入 ' + ids.length + ' 项')
          finishBatch()
        }
      }]
      if (folders.length) {
        items.push({ separator: true })
        items.push({
          label: '放进已有文件夹',
          items: folders.map(f => ({
            label: f.name,
            onClick: () => { store.setParent(ids, f.id); toast('已移入「' + f.name + '」'); finishBatch() }
          }))
        })
      }
      KL.ui.menu(items, { x: r.left, y: r.top - 8 })
    })
    document.getElementById('selSize').addEventListener('click', e => {
      const r = e.currentTarget.getBoundingClientRect()
      const ids = KL.grid.selectedIds()
      KL.ui.menu([[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [3, 2], [2, 3], [3, 3]].map(p => ({
        label: p[0] + ' × ' + p[1],
        onClick: () => {
          store.batch(() => ids.forEach(id => store.updateShortcut(id, { col: p[0], row: p[1] })))
          finishBatch()
        }
      })), { x: r.left, y: r.top })
    })
    document.getElementById('selRefresh').addEventListener('click', () => {
      const ids = KL.grid.selectedIds()
      const list = ids.map(id => store.getShortcut(id)).filter(Boolean)
      toast('正在刷新 ' + list.length + ' 个图标…')
      KL.icons.ensureMany(list, 3, sc => KL.grid.refreshTile(sc.id)).then(() => toast('图标刷新完成'))
    })
    document.getElementById('selDelete').addEventListener('click', async () => {
      const ids = KL.grid.selectedIds()
      if (store.settings.confirmDelete !== false) {
        const ok = await KL.ui.confirm({
          title: '删除快捷方式',
          text: '确定删除选中的 ' + ids.length + ' 个快捷方式吗？',
          okText: '删除',
          danger: true
        })
        if (!ok) return
      }
      store.removeShortcuts(ids)
      KL.grid.clearSelection()
      finishBatch()
    })
    document.getElementById('selCancel').addEventListener('click', () => {
      KL.grid.clearSelection()
      updateSelectionBar()
    })
  }

  function finishBatch () {
    KL.grid.clearSelection()
    renderSidebar()
    KL.grid.render()
    updateSelectionBar()
  }

  /* ---------------- external drag & drop ---------------- */

  function hasFiles (e) {
    if (!e.dataTransfer || !e.dataTransfer.types) return false
    const t = e.dataTransfer.types
    for (let i = 0; i < t.length; i++) {
      if (t[i] === 'Files' || t[i] === 'text/uri-list') return true
      if (t[i] === KL.grid.GRID_MIME) return false
    }
    return false
  }

  function pathsFromDrop (dt) {
    const out = []
    if (dt.files && dt.files.length) {
      for (let i = 0; i < dt.files.length; i++) {
        const f = dt.files[i]
        let p = f.path
        if (!p && S.getPathForFile) {
          try { p = S.getPathForFile(f) } catch (e) { p = null }
        }
        if (p) out.push(p)
      }
    }
    if (!out.length) {
      let text = ''
      try { text = dt.getData('text/uri-list') || dt.getData('text/plain') || '' } catch (e) {}
      const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(s => s && s[0] !== '#')
      for (const l of lines) {
        if (/^file:\/\//i.test(l)) {
          try {
            out.push(decodeURIComponent(l.replace(/^file:\/\/\//i, '').replace(/\//g, '\\')))
          } catch (e) {}
        } else {
          out.push(l)
        }
      }
    }
    return out
  }

  function bindFileDrop () {
    dropOverlay = document.getElementById('dropOverlay')

    document.addEventListener('dragenter', e => {
      if (KL.grid.isInternal(e)) return
      if (!hasFiles(e)) return
      e.preventDefault()
      dragDepth++
      dropOverlay.classList.add('show')
    })

    document.addEventListener('dragover', e => {
      if (KL.grid.isInternal(e)) return
      e.preventDefault()
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = e.dataTransfer.types && e.dataTransfer.types.indexOf('Files') >= 0 ? 'copy' : 'link'
      }
      if (!dropOverlay.classList.contains('show')) dropOverlay.classList.add('show')
    })

    document.addEventListener('dragleave', e => {
      if (KL.grid.isInternal(e)) return
      dragDepth--
      if (dragDepth <= 0) {
        dragDepth = 0
        dropOverlay.classList.remove('show')
      }
    })

    document.addEventListener('drop', async e => {
      if (KL.grid.isInternal(e)) return
      e.preventDefault()
      dragDepth = 0
      dropOverlay.classList.remove('show')
      const items = pathsFromDrop(e.dataTransfer)
      if (!items.length) {
        toast('没读到拖入的内容', 'error')
        return
      }
      const urls = items.filter(x => /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(x))
      const rest = items.filter(x => !/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(x))
      if (rest.length) await KL.dialogs.ingestPaths(rest, {})
      if (urls.length) {
        for (const u of urls) await KL.dialogs.addUrlQuick(u, '', undefined)
      }
    })
  }

  /* ---------------- keyboard ---------------- */

  function bindKeys () {
    document.addEventListener('keydown', e => {
      const tag = (e.target.tagName || '').toLowerCase()
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select'
      const mod = e.ctrlKey || e.metaKey

      if (e.key === 'Escape') {
        if (KL.ui.modalCount > 0) return
        if (typing) { e.target.blur(); return }
        KL.grid.clearSelection()
        updateSelectionBar()
        return
      }
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchInput.focus()
        searchInput.select()
        return
      }
      if (mod && e.key.toLowerCase() === 'a' && !typing) {
        e.preventDefault()
        KL.grid.selectAll()
        updateSelectionBar()
        return
      }
      // 直接键入即进入搜索（无需先点击搜索框）
      if (!typing && !mod && !e.altKey && KL.ui.modalCount === 0 && e.key && e.key.length === 1) {
        searchInput.focus()
        searchInput.value += e.key
        searchWrap.classList.add('has-value')
        KL.grid.setKeyword(searchInput.value.trim())
        e.preventDefault()
        return
      }
      if (typing) return
      const ids = KL.grid.selectedIds()
      if (e.key === 'Delete' && ids.length) {
        e.preventDefault()
        document.getElementById('selDelete').click()
        return
      }
      if (e.key === 'F2' && ids.length === 1) {
        e.preventDefault()
        const sc = store.getShortcut(ids[0])
        if (sc) KL.dialogs.editShortcut(sc, () => { KL.grid.render(); renderSidebar() })
      }
    })
  }

  function refreshSidebarCounts () {
    const side = document.getElementById('sidebar')
    if (!side) return
    const nodes = side.querySelectorAll('.cat')
    for (let i = 0; i < nodes.length; i++) {
      const id = nodes[i].dataset.cat
      const countEl = nodes[i].querySelector('.count')
      if (!countEl) continue
      if (id === 'all') countEl.textContent = String(store.shortcuts.length)
      else if (id === 'none') countEl.textContent = String(store.shortcuts.filter(s => !s.categoryId).length)
      else countEl.textContent = String(store.shortcuts.filter(s => s.categoryId === id).length)
    }
  }

  /* ---------------- uTools ---------------- */

  function initUtools () {
    if (typeof utools === 'undefined') return
    try { S.setHeight(620) } catch (e) {}

    if (!S.isUtools) return

    window.utools.onPluginEnter(info => {
      const code = info.code
      const type = info.type
      const payload = info.payload
      applyTheme()
      applyVars()
      try { utools.setExpendHeight(620) } catch (e) {}

      if (code === 'launcher-add' && type === 'files') {
        KL.dialogs.ingestPaths(payload, {})
        return
      }
      if (code === 'launcher-add-url' && type === 'text') {
        KL.dialogs.addUrlQuick(String(payload).trim(), '', null)
        return
      }
      if (type === 'files' && payload && payload.length) {
        KL.dialogs.ingestPaths(payload, {})
        return
      }
      if (type === 'text' && payload) {
        const t = String(payload).trim()
        const low = t.toLowerCase()
        if (KEYWORDS.indexOf(low) >= 0) return
        if (/^https?:\/\//i.test(t)) {
          KL.dialogs.addUrlQuick(t, '', null)
          return
        }
        if (t.length >= 2) {
          searchInput.value = t
          searchWrap.classList.add('has-value')
          KL.grid.setKeyword(t)
        }
      }
      focusSearch()
    })

    window.utools.onPluginOut(() => {
      store.flush()
      KL.ui.closeMenu()
    })
  }

  /* ---------------- boot ---------------- */

  function focusSearch () {
    if (!searchInput) return
    setTimeout(() => { try { searchInput.focus() } catch (e) {} }, 60)
  }

  function boot () {
    store.load()
    applyTheme()
    applyVars()

    searchInput = document.getElementById('search')
    searchWrap = document.getElementById('searchWrap')

    KL.grid.init()
    renderSidebar()
    bindToolbar()
    bindSideResizer()
    bindSelbar()
    bindFileDrop()
    bindKeys()
    syncToolbar()
    store.on((type) => {
      if (type === 'categories') renderSidebar()
      else if (type === 'shortcuts') refreshSidebarCounts()
    })

    let searchTimer = null
    searchInput.addEventListener('input', () => {
      searchWrap.classList.toggle('has-value', !!searchInput.value)
      if (searchTimer) clearTimeout(searchTimer)
      searchTimer = setTimeout(() => {
        KL.grid.setKeyword(searchInput.value.trim())
        updateSelectionBar()
      }, 120)
    })
    searchInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const list = store.visible(KL.grid.getCategory(), KL.grid.getKeyword())
        if (list.length === 1) KL.grid.launch(list[0])
        else if (list.length > 1) {
          KL.grid.clearSelection()
          toast('找到 ' + list.length + ' 个结果')
        }
      }
      if (e.key === 'Escape') {
        searchInput.value = ''
        searchWrap.classList.remove('has-value')
        KL.grid.setKeyword('')
      }
    })
    document.getElementById('searchClear').addEventListener('click', () => {
      searchInput.value = ''
      searchWrap.classList.remove('has-value')
      KL.grid.setKeyword('')
      searchInput.focus()
    })

    initUtools()
    focusSearch()

    // 首次使用时给一个引导
    if (!store.shortcuts.length && !sessionStorage.getItem('kl-seen-tip')) {
      sessionStorage.setItem('kl-seen-tip', '1')
      setTimeout(() => {
        toast('把文件或网址拖到窗口里就能创建快捷方式', null, 5200)
      }, 500)
    }
  }

  KL.app = {
    applyTheme: applyTheme,
    applyVars: applyVars,
    renderSidebar: renderSidebar,
    setCategory: setCategory,
    syncToolbar: syncToolbar,
    onSelectionChange: onSelectionChange
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})()
