(function () {
  'use strict'
  const KL = (window.KL = window.KL || {})
  const store = KL.store
  const S = window.services

  const el = KL.ui.el
  const esc = KL.ui.esc
  const toast = KL.ui.toast

  const RESIZE_SVG = '<svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 8L8 12M12 4.5L4.5 12"/></svg>'

  const GRID_MIME = 'application/x-kl-tile'

  let gridEl = null
  let emptyEl = null
  let contentEl = null
  let currentCategory = 'all'
  let keyword = ''
  const selected = new Set()
  const tileNodes = {}
  let dragHint = null

  function clamp (v, a, b) { return Math.max(a, Math.min(b, v)) }

  function currentCell () {
    return clamp(parseInt(store.settings.cell, 10) || 92, 64, 160)
  }

  function tilePixelBox (sc) {
    const cell = currentCell()
    const gap = 10
    return {
      w: cell * sc.col + gap * (sc.col - 1),
      h: cell * sc.row + gap * (sc.row - 1)
    }
  }

  function iconSizeFor (sc, showLabels) {
    const box = tilePixelBox(sc)
    const base = Math.min(box.w, box.h)
    const ratio = showLabels ? 0.56 : 0.74
    return clamp(Math.round(base * ratio), 22, 168)
  }

  /* ---------------- rendering ---------------- */

  function render () {
    if (!gridEl) return
    const settings = store.settings
    const list = store.visible(currentCategory, keyword)
    gridEl.style.setProperty('--cell', currentCell() + 'px')
    gridEl.classList.toggle('hide-labels', !settings.showLabels)
    gridEl.innerHTML = ''
    for (const k in tileNodes) delete tileNodes[k]

    for (const sc of list) {
      const node = buildTile(sc)
      gridEl.appendChild(node)
      tileNodes[sc.id] = node
    }

    const isEmpty = list.length === 0
    emptyEl.classList.toggle('show', isEmpty)
    if (isEmpty) {
      emptyEl.querySelector('.big').textContent = keyword
        ? '没有匹配「' + keyword + '」的快捷方式'
        : (currentCategory === 'all' ? '还没有任何快捷方式' : '这个分类还是空的')
      emptyEl.querySelector('.small').textContent = keyword
        ? '换个关键词试试'
        : '把文件、文件夹或网址拖进来，或点击右上角「添加」'
    }
    checkMissing(list)
  }

  function buildTile (sc) {
    const settings = store.settings
    const tile = el('div', 'tile')
    tile.dataset.id = sc.id
    tile.draggable = true
    tile.style.gridColumn = 'span ' + sc.col
    tile.style.gridRow = 'span ' + sc.row
    tile.style.setProperty('--icon-size', iconSizeFor(sc, settings.showLabels) + 'px')
    if (selected.has(sc.id)) tile.classList.add('selected')

    const box = el('div', 'icon-box')
    const img = el('img', 'icon')
    img.draggable = false
    img.src = KL.icons.resolve(sc)
    img.alt = ''
    box.appendChild(img)
    tile.appendChild(box)

    const label = el('div', 'label')
    label.textContent = sc.name
    label.title = sc.name
    tile.appendChild(label)

    const resize = el('div', 'resize', RESIZE_SVG)
    resize.title = '拖动调整尺寸'
    tile.appendChild(resize)

    if (sc.missing) {
      const badge = el('div', 'badge')
      badge.title = '目标不存在'
      tile.appendChild(badge)
    }

    tile.addEventListener('click', e => {
      const mode = store.settings.launchOnDoubleClick
      if (e.ctrlKey || e.metaKey || (mode && !e.detail)) {
        e.preventDefault()
        toggleSelect(sc.id)
        return
      }
      if (mode) { toggleSelect(sc.id); return }
      launch(sc)
    })
    tile.addEventListener('dblclick', e => {
      if (!store.settings.launchOnDoubleClick) return
      e.preventDefault()
      launch(sc)
    })
    tile.addEventListener('contextmenu', e => {
      e.preventDefault()
      e.stopPropagation()
      if (!selected.has(sc.id)) {
        if (!e.ctrlKey) selected.clear()
        selected.add(sc.id)
        syncSelection()
      }
      showTileMenu(sc, e.clientX, e.clientY)
    })
    tile.addEventListener('dragstart', e => {
      const ids = selected.has(sc.id) ? Array.from(selected) : [sc.id]
      if (!selected.has(sc.id)) { selected.clear(); selected.add(sc.id); syncSelection() }
      e.dataTransfer.setData(GRID_MIME, JSON.stringify(ids))
      e.dataTransfer.setData('text/plain', sc.name)
      e.dataTransfer.effectAllowed = 'move'
      setTimeout(() => { for (const id of ids) if (tileNodes[id]) tileNodes[id].classList.add('dragging') }, 0)
      dragHint = { ids: ids }
    })
    tile.addEventListener('dragend', () => {
      clearDropHints()
      for (const k in tileNodes) tileNodes[k].classList.remove('dragging')
      dragHint = null
    })
    tile.addEventListener('dragover', e => {
      if (!isInternal(e)) return
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      clearDropHints()
      const r = tile.getBoundingClientRect()
      if (e.clientX < r.left + r.width / 2) tile.classList.add('drop-before')
      else tile.classList.add('drop-after')
    })
    tile.addEventListener('dragleave', () => {
      tile.classList.remove('drop-before', 'drop-after')
    })
    tile.addEventListener('drop', e => {
      if (!isInternal(e)) return
      e.preventDefault()
      e.stopPropagation()
      const before = tile.classList.contains('drop-before')
      tile.classList.remove('drop-before', 'drop-after')
      const ids = parseDrag(e)
      if (!ids.length || ids.indexOf(sc.id) >= 0) return
      dropOn(ids, sc.id, before)
    })

    attachResize(tile, sc)
    return tile
  }

  function attachResize (tile, sc) {
    const handle = tile.querySelector('.resize')
    handle.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      const step = currentCell() + 10
      const startX = e.clientX
      const startY = e.clientY
      const baseCol = sc.col
      const baseRow = sc.row
      let col = baseCol
      let row = baseRow
      const applyVisual = () => {
        tile.style.gridColumn = 'span ' + col
        tile.style.gridRow = 'span ' + row
        const ghost = Object.assign({}, sc, { col: col, row: row })
        tile.style.setProperty('--icon-size', iconSizeFor(ghost, store.settings.showLabels) + 'px')
      }
      const maxCol = Math.max(1, Math.floor((contentEl.clientWidth - 4) / step))
      const onMove = ev => {
        col = clamp(baseCol + Math.round((ev.clientX - startX) / step), 1, Math.min(4, Math.max(1, maxCol)))
        row = clamp(baseRow + Math.round((ev.clientY - startY) / step), 1, 4)
        applyVisual()
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        if (col !== sc.col || row !== sc.row) store.updateShortcut(sc.id, { col: col, row: row })
        else render()
      }
      document.body.style.cursor = 'nwse-resize'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  }

  function syncSelection () {
    for (const id in tileNodes) {
      tileNodes[id].classList.toggle('selected', selected.has(id))
    }
    if (KL.app && KL.app.onSelectionChange) KL.app.onSelectionChange(selected)
  }

  function toggleSelect (id) {
    if (selected.has(id)) selected.delete(id)
    else selected.add(id)
    syncSelection()
  }

  function clearSelection () {
    selected.clear()
    syncSelection()
  }

  function selectAll () {
    const list = store.visible(currentCategory, keyword)
    list.forEach(s => selected.add(s.id))
    syncSelection()
  }

  function isInternal (e) {
    if (!e.dataTransfer) return false
    const types = e.dataTransfer.types || []
    for (let i = 0; i < types.length; i++) if (types[i] === GRID_MIME) return true
    return false
  }

  function parseDrag (e) {
    try {
      const raw = e.dataTransfer.getData(GRID_MIME)
      if (!raw) return []
      const ids = JSON.parse(raw)
      return Array.isArray(ids) ? ids.filter(id => store.getShortcut(id)) : []
    } catch (err) {
      return []
    }
  }

  function clearDropHints () {
    if (!gridEl) return
    const hinted = gridEl.querySelectorAll('.drop-before,.drop-after,.drop-inside')
    for (let i = 0; i < hinted.length; i++) hinted[i].classList.remove('drop-before', 'drop-after', 'drop-inside')
  }

  function dropOn (ids, targetId, before) {
    const cat = currentCategory === 'all' || currentCategory === 'none' ? currentCategory : currentCategory
    const categoryId = cat === 'all' ? undefined : (cat === 'none' ? null : cat)
    if (store.settings.sortBy !== 'manual') {
      store.setSetting('sortBy', 'manual')
      toast('已切换为手动排序')
    }
    if (before) {
      ids.forEach(id => store.moveBefore(id, targetId, categoryId))
    } else {
      const list = store.visible(currentCategory, '').filter(s => ids.indexOf(s.id) < 0)
      const idx = list.findIndex(s => s.id === targetId)
      const next = idx >= 0 ? list[idx + 1] : null
      if (next) ids.forEach(id => store.moveBefore(id, next.id, categoryId))
      else ids.forEach(id => store.moveToEnd(id, categoryId))
    }
    render()
  }

  function dropAtEnd (ids) {
    if (!ids.length) return
    const categoryId = currentCategory === 'all' ? undefined : (currentCategory === 'none' ? null : currentCategory)
    if (store.settings.sortBy !== 'manual') store.setSetting('sortBy', 'manual')
    ids.forEach(id => store.moveToEnd(id, categoryId))
    render()
  }

  function refreshTile (id) {
    const sc = store.getShortcut(id)
    const node = tileNodes[id]
    if (!sc || !node) return
    const img = node.querySelector('img.icon')
    if (img) img.src = KL.icons.resolve(sc)
    node.querySelector('.label').textContent = sc.name
  }

  function setBusy (id, busy) {
    const node = tileNodes[id]
    if (!node) return
    let sp = node.querySelector('.spinner')
    if (busy && !sp) node.appendChild(el('div', 'spinner'))
    else if (!busy && sp) sp.remove()
  }

  /* ---------------- missing check ---------------- */

  let missingTimer = null
  function checkMissing (list) {
    if (missingTimer) clearTimeout(missingTimer)
    missingTimer = setTimeout(() => {
      for (const sc of list) {
        if (sc.launch.kind !== 'file') continue
        if (!sc.launch.target) continue
        const exists = S.exists(sc.launch.target)
        if (!!sc.missing !== !exists) {
          sc.missing = !exists
          store.save()
          const node = tileNodes[sc.id]
          if (node) {
            let badge = node.querySelector('.badge')
            if (!exists && !badge) {
              badge = el('div', 'badge')
              badge.title = '目标不存在'
              node.appendChild(badge)
            } else if (exists && badge) {
              badge.remove()
            }
          }
        }
      }
    }, 400)
  }

  /* ---------------- launch ---------------- */

  async function launch (sc) {
    if (sc.missing) {
      const go = await KL.ui.confirm({
        title: '目标不存在',
        text: '「' + sc.name + '」指向的 ' + sc.launch.target + ' 已经找不到了。要删除这个快捷方式吗？',
        okText: '删除',
        danger: true
      })
      if (go) store.removeShortcut(sc.id)
      render()
      return
    }
    const r = await S.launch(sc)
    if (!r || !r.ok) {
      toast('打开失败：' + ((r && r.error) || '未知错误'), 'error')
      return
    }
    store.updateShortcut(sc.id, { launchCount: (sc.launchCount || 0) + 1, lastLaunched: Date.now() })
    if (store.settings.hideOnLaunch !== false) {
      try { utools.hideMainWindow() } catch (e) {}
    }
  }

  /* ---------------- context menu ---------------- */

  function sizePresets () {
    return [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [3, 2], [2, 3], [3, 3]]
  }

  function showTileMenu (sc, x, y) {
    const ids = Array.from(selected)
    const multi = ids.length > 1
    const items = []

    if (!multi) {
      items.push({
        label: '打开',
        onClick: () => launch(sc)
      })
      if (sc.launch.kind === 'url') {
        items.push({
          label: '在浏览器中打开',
          onClick: () => S.launch({ launch: { kind: 'url', target: sc.launch.target } })
        })
        items.push({ label: '复制网址', onClick: () => { S.copyText(sc.launch.target); toast('已复制网址') } })
      } else if (sc.launch.target) {
        items.push({
          label: '打开所在位置',
          onClick: () => {
            const p = sc.launch.kind === 'appid' ? '' : sc.launch.target
            if (p) S.revealPath(p)
          }
        })
        items.push({ label: '复制路径', onClick: () => { S.copyText(sc.launch.target); toast('已复制路径') } })
      }
      items.push({ separator: true })
    }

    if (!multi) {
      items.push({ label: '编辑…', hint: 'F2', onClick: () => KL.dialogs.editShortcut(sc, () => render()) })
      items.push({
        label: '刷新图标',
        onClick: async () => {
          setBusy(sc.id, true)
          const data = await KL.icons.ensure(sc, { force: true })
          setBusy(sc.id, false)
          if (data) { refreshTile(sc.id); toast('图标已更新') } else { toast('没能取到图标', 'error') }
        }
      })
      items.push({
        label: '改用文字图标',
        onClick: () => {
          store.updateShortcut(sc.id, { icon: KL.icons.defaultTextIcon(sc) })
          render()
        }
      })
      items.push({
        label: '自定义图标…',
        onClick: () => KL.dialogs.iconPicker(sc, () => render())
      })
      items.push({ separator: true })
    }

    const sizeItems = sizePresets().map(p => ({
      label: p[0] + ' × ' + p[1],
      onClick: () => {
        ids.forEach(id => store.updateShortcut(id, { col: p[0], row: p[1] }))
        render()
      }
    }))
    items.push({ label: '图标尺寸', items: sizeItems })

    const catItems = [{
      label: '未分类',
      onClick: () => {
        ids.forEach(id => store.setCategory(id, null))
        render()
      }
    }].concat(store.categories.map(c => ({
      label: c.name,
      onClick: () => {
        ids.forEach(id => store.setCategory(id, c.id))
        toast('已移动到「' + c.name + '」')
        render()
      }
    })))
    items.push({ label: multi ? '移动 ' + ids.length + ' 项到分类' : '移动到分类', items: catItems })

    items.push({ separator: true })
    if (!multi && sc.note) items.push({ label: sc.note, disabled: true })
    items.push({
      label: multi ? '删除 ' + ids.length + ' 项' : '删除',
      danger: true,
      hint: 'Del',
      onClick: async () => {
        if (store.settings.confirmDelete !== false) {
          const ok = await KL.ui.confirm({
            title: '删除快捷方式',
            text: multi ? '确定删除选中的 ' + ids.length + ' 个快捷方式吗？' : '确定删除「' + sc.name + '」吗？',
            okText: '删除',
            danger: true
          })
          if (!ok) return
        }
        store.removeShortcuts(ids)
        selected.clear()
        render()
      }
    })

    KL.ui.menu(items, { x: x, y: y })
  }

  function showBlankMenu (x, y) {
    KL.ui.menu([
      { label: '添加文件 / 文件夹', onClick: () => KL.dialogs.addFromFiles() },
      { label: '添加网址', onClick: () => KL.dialogs.addUrl() },
      { label: '从剪贴板添加', onClick: () => KL.dialogs.addFromClipboard() },
      { separator: true },
      { label: '扫描本机应用', onClick: () => KL.dialogs.scanApps() },
      { label: '导入浏览器收藏夹', onClick: () => KL.dialogs.importBookmarks() },
      { separator: true },
      { label: '新建分类', onClick: () => KL.dialogs.newCategory() },
      { label: '全选', hint: 'Ctrl+A', onClick: selectAll },
      { label: '设置…', onClick: () => KL.dialogs.settings() }
    ], { x: x, y: y })
  }

  /* ---------------- init ---------------- */

  function init () {
    gridEl = document.getElementById('grid')
    emptyEl = document.getElementById('empty')
    contentEl = document.getElementById('content')

    gridEl.addEventListener('dragover', e => {
      if (!isInternal(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (e.target === gridEl) clearDropHints()
    })
    gridEl.addEventListener('drop', e => {
      if (!isInternal(e)) return
      e.preventDefault()
      if (e.target === gridEl) dropAtEnd(parseDrag(e))
    })
    contentEl.addEventListener('contextmenu', e => {
      if (e.target.closest('.tile')) return
      e.preventDefault()
      selected.clear()
      syncSelection()
      showBlankMenu(e.clientX, e.clientY)
    })
    contentEl.addEventListener('click', e => {
      if (e.target.closest('.tile')) return
      if (selected.size) clearSelection()
    })

    store.on((type, payload) => {
      if (type === 'shortcuts' || type === 'settings') render()
    })

    render()
  }

  KL.grid = {
    init: init,
    render: render,
    refreshTile: refreshTile,
    setBusy: setBusy,
    launch: launch,
    setCategory: function (id) {
      currentCategory = id || 'all'
      if (currentCategory !== 'all') selected.clear()
      render()
      syncSelection()
    },
    getCategory: function () { return currentCategory },
    setKeyword: function (kw) {
      keyword = kw || ''
      render()
    },
    getKeyword: function () { return keyword },
    selectedIds: function () { return Array.from(selected) },
    clearSelection: clearSelection,
    selectAll: selectAll,
    syncSelection: syncSelection,
    showTileMenu: showTileMenu,
    showBlankMenu: showBlankMenu,
    GRID_MIME: GRID_MIME,
    isInternal: isInternal
  }
})()
