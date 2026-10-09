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

  /* ---------------- folders ---------------- */

  // 大文件夹内部的单元尺寸：按文件夹实际宽度均分，使内容铺满
  function innerMetrics (folderSc) {
    const cell = currentCell()
    const box = tilePixelBox(folderSc)
    const pad = 6
    const gap = 4
    const labelH = store.settings.showLabels ? 22 : 0
    const innerW = Math.max(40, box.w - pad * 2)
    const target = Math.max(34, Math.round(cell * 0.5))
    const cols = Math.max(1, Math.floor((innerW + gap) / (target + gap)))
    const unit = Math.max(28, Math.floor((innerW - (cols - 1) * gap) / cols))
    return { cols: cols, unit: unit, gap: gap, pad: pad, labelH: labelH, innerW: innerW }
  }

  function innerIconSize (sc, m) {
    const w = m.unit * (sc.col || 1) + m.gap * ((sc.col || 1) - 1)
    const h = m.unit * (sc.row || 1) + m.gap * ((sc.row || 1) - 1)
    const base = Math.min(w, h) - 8
    if (!store.settings.showLabels) return clamp(Math.round(base - 4), 16, 220)
    return clamp(Math.round(base - m.labelH), 16, 220)
  }

  function buildFolderTile (sc) {
    const count = store.childCount(sc.id)
    const tile = el('div', 'tile folder')
    tile.dataset.id = sc.id
    tile.draggable = true

    if (sc.col * sc.row <= 1) {
      // 小文件夹（1×1）：点开后才可操作内部图标
      tile.classList.add('folder-mini')
      tile.style.gridColumn = 'span ' + sc.col
      tile.style.gridRow = 'span ' + sc.row
      const box = el('div', 'icon-box')
      const face = el('div', 'folder-face')
      if (sc.color) face.style.background = sc.color
      face.innerHTML = '<svg viewBox="0 0 48 48" width="100%" height="100%" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M8 17c0-1.9 1.5-3.4 3.4-3.4h6.4l3.6 4.2h15.2c1.9 0 3.4 1.5 3.4 3.4v13.4c0 1.9-1.5 3.4-3.4 3.4H11.4C9.5 38 8 36.5 8 34.6z"/></svg>'
      box.appendChild(face)
      tile.appendChild(box)
      const label = el('div', 'label')
      label.textContent = sc.name
      label.title = sc.name
      tile.appendChild(label)
      if (count) tile.appendChild(el('div', 'folder-badge', String(count)))
    } else {
      // 大文件夹（m×n）：内部平铺，可直接点图标
      tile.classList.add('folder-big')
      tile.style.gridColumn = 'span ' + sc.col
      tile.style.gridRow = 'span ' + sc.row
      const head = el('div', 'folder-head')
      const nameEl = el('span', 'folder-name')
      nameEl.textContent = sc.name
      nameEl.title = sc.name
      head.appendChild(nameEl)
      head.appendChild(el('span', 'folder-count', String(count)))
      tile.appendChild(head)
      if (sc.color) tile.style.background = sc.color
      const m = innerMetrics(sc)
      tile.style.setProperty('--inner-cols', String(m.cols))
      const inner = el('div', 'folder-inner')
      inner.style.gridTemplateColumns = 'repeat(' + m.cols + ', ' + m.unit + 'px)'
      inner.style.gridAutoRows = m.unit + 'px'
      inner.style.gap = m.gap + 'px'
      const kids = store.childrenOf(sc.id)
      for (const k of kids) {
        const node = buildInnerTile(k, m, sc)
        inner.appendChild(node)
        tileNodes[k.id] = node
      }
      tile.appendChild(inner)
    }

    if (selected.has(sc.id)) tile.classList.add('selected')

    tile.addEventListener('click', e => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault(); e.stopPropagation()
        toggleSelect(sc.id)
        return
      }
      e.stopPropagation()
      if (sc.col * sc.row <= 1) {
        if (KL.dialogs && KL.dialogs.folderView) KL.dialogs.folderView(sc.id)
      }
    })
    tile.addEventListener('contextmenu', e => {
      e.preventDefault()
      e.stopPropagation()
      if (!selected.has(sc.id)) {
        if (!e.ctrlKey) selected.clear()
        selected.add(sc.id)
        syncSelection()
      }
      showFolderMenu(sc, e.clientX, e.clientY)
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
    // 拖到文件夹上 → 移入
    tile.addEventListener('dragover', e => {
      if (!isInternal(e)) return
      const ids = dragHint ? dragHint.ids : []
      if (ids.indexOf(sc.id) >= 0) return          // 自己不能拖进自己
      e.preventDefault()
      e.stopPropagation()
      e.dataTransfer.dropEffect = 'move'
      clearDropHints()
      tile.classList.add('drop-into')
    })
    tile.addEventListener('dragleave', () => tile.classList.remove('drop-into'))
    tile.addEventListener('drop', e => {
      if (!isInternal(e)) return
      e.preventDefault()
      e.stopPropagation()
      tile.classList.remove('drop-into')
      const ids = parseDrag(e)
      if (!ids.length || ids.indexOf(sc.id) >= 0) return
      store.setParent(ids, sc.id)
      toast('已移入「' + sc.name + '」')
      clearSelection()
      render()
    })

    attachFolderResize(tile, sc)
    return tile
  }

  function buildInnerTile (sc, m, folder) {
    const tile = el('div', 'inner-tile')
    tile.dataset.id = sc.id
    tile.draggable = true
    tile.style.gridColumn = 'span ' + (sc.col || 1)
    tile.style.gridRow = 'span ' + (sc.row || 1)
    tile.style.setProperty('--icon-size', innerIconSize(sc, m) + 'px')
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
    if (sc.missing) tile.appendChild(el('div', 'badge'))

    tile.addEventListener('click', e => {
      e.stopPropagation()
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); toggleSelect(sc.id); return }
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
      showTileMenu(sc, e.clientX, e.clientY)      // 复用主菜单（含"移出文件夹"）
    })
    tile.addEventListener('dragstart', e => {
      e.stopPropagation()
      const ids = selected.has(sc.id) ? Array.from(selected) : [sc.id]
      if (!selected.has(sc.id)) { selected.clear(); selected.add(sc.id); syncSelection() }
      e.dataTransfer.setData(GRID_MIME, JSON.stringify(ids))
      e.dataTransfer.setData('text/plain', sc.name)
      e.dataTransfer.effectAllowed = 'move'
      setTimeout(() => { for (const id of ids) if (tileNodes[id]) tileNodes[id].classList.add('dragging') }, 0)
      dragHint = { ids: ids }
    })
    tile.addEventListener('dragend', e => {
      clearDropHints()
      for (const k in tileNodes) tileNodes[k].classList.remove('dragging')
      dragHint = null
    })
    // 内部拖拽排序：拖到同文件夹内其他图标上
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
    tile.addEventListener('dragleave', () => tile.classList.remove('drop-before', 'drop-after'))
    tile.addEventListener('drop', e => {
      if (!isInternal(e)) return
      e.preventDefault()
      e.stopPropagation()
      const before = tile.classList.contains('drop-before')
      tile.classList.remove('drop-before', 'drop-after')
      const ids = parseDrag(e)
      if (!ids.length || ids.indexOf(sc.id) >= 0) return
      // 从主网格拖进来的图标 → 先归入本文件夹，再排序
      if (store.settings.sortBy !== 'manual') store.setSetting('sortBy', 'manual')
      store.batch(() => {
        ids.forEach(id => store.setParent([id], folder.id))
        if (before) ids.forEach(id => store.moveBefore(id, sc.id, undefined))
        else {
          const list = store.childrenOf(folder.id).filter(s => ids.indexOf(s.id) < 0)
          const idx = list.findIndex(s => s.id === sc.id)
          const next = idx >= 0 ? list[idx + 1] : null
          if (next) ids.forEach(id => store.moveBefore(id, next.id, undefined))
          else ids.forEach(id => store.moveToEnd(id, undefined))
        }
      })
      render()
    })
    tile.addEventListener('dblclick', e => e.stopPropagation())

    attachInnerResize(tile, sc)
    return tile
  }

  function attachFolderResize (tile, sc) {
    const handle = el('div', 'resize', RESIZE_SVG)
    handle.title = '拖动调整尺寸'
    tile.appendChild(handle)
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
      const maxCol = Math.max(1, Math.floor((contentEl.clientWidth - 4) / step))
      const onMove = ev => {
        col = clamp(baseCol + Math.round((ev.clientX - startX) / step), 1, Math.min(4, Math.max(1, maxCol)))
        row = clamp(baseRow + Math.round((ev.clientY - startY) / step), 1, 4)
        tile.style.gridColumn = 'span ' + col
        tile.style.gridRow = 'span ' + row
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

  function attachInnerResize (tile, sc) {
    const handle = el('div', 'resize', RESIZE_SVG)
    handle.title = '拖动调整尺寸'
    tile.appendChild(handle)
    handle.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startY = e.clientY
      const baseCol = sc.col || 1
      const baseRow = sc.row || 1
      const parent = store.getShortcut(sc.parentId)
      const m = parent ? innerMetrics(parent) : { unit: 40, gap: 4 }
      const step = m.unit + m.gap
      let col = baseCol
      let row = baseRow
      const onMove = ev => {
        col = clamp(baseCol + Math.round((ev.clientX - startX) / step), 1, 4)
        row = clamp(baseRow + Math.round((ev.clientY - startY) / step), 1, 4)
        tile.style.gridColumn = 'span ' + col
        tile.style.gridRow = 'span ' + row
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        if (col !== baseCol || row !== baseRow) store.updateShortcut(sc.id, { col: col, row: row })
        else render()
      }
      document.body.style.cursor = 'nwse-resize'
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  }

  function showFolderMenu (sc, x, y) {
    const ids = Array.from(selected)
    const multi = ids.length > 1
    const count = store.childCount(sc.id)
    KL.ui.menu([
      { label: '打开文件夹', disabled: multi, onClick: () => KL.dialogs.folderView(sc.id) },
      { separator: true },
      {
        label: '重命名…',
        disabled: multi,
        onClick: async () => {
          const n = await KL.ui.prompt({ title: '重命名文件夹', value: sc.name, okText: '保存' })
          if (n == null || !n) return
          store.updateShortcut(sc.id, { name: n })
          render()
        }
      },
      { label: '背景颜色', items: ['', '#534AB7', '#185FA5', '#0F6E56', '#993C1D', '#993556', '#3B6D11', '#854F0B', '#5F5E5A'].map(c => ({
        label: c ? c : '无（默认）',
        onClick: () => { store.updateShortcut(sc.id, { color: c }); render() }
      })) },
      { label: '文件夹尺寸', items: [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [3, 3], [4, 3], [4, 4]].map(p => ({
        label: p[0] + ' × ' + p[1] + (p[0] * p[1] === 1 ? '（小文件夹）' : ''),
        hint: (sc.col === p[0] && sc.row === p[1]) ? '✓' : '',
        onClick: () => { store.updateShortcut(sc.id, { col: p[0], row: p[1] }); render() }
      })) },
      { separator: true },
      {
        label: '解散文件夹（' + count + ' 项移出）',
        disabled: multi || !count,
        onClick: async () => {
          const ok = await KL.ui.confirm({ title: '解散文件夹', text: '「' + sc.name + '」里的 ' + count + ' 个图标会移回主面板，文件夹本身删除。', okText: '解散' })
          if (!ok) return
          store.dissolveFolder(sc.id)
          toast('文件夹已解散')
          render()
        }
      },
      {
        label: multi ? '删除 ' + ids.length + ' 项' : '删除文件夹',
        danger: true,
        onClick: async () => {
          const ok = await KL.ui.confirm({
            title: '删除',
            text: multi ? '删除选中的 ' + ids.length + ' 个项目？' : ('删除文件夹「' + sc.name + '」' + (count ? '及其中的 ' + count + ' 个图标' : '') + '？'),
            okText: '删除', danger: true
          })
          if (!ok) return
          store.removeShortcuts(ids)
          clearSelection()
          render()
        }
      }
    ], { x: x, y: y })
  }

  function iconSizeFor (sc, showLabels) {
    const box = tilePixelBox(sc)
    const base = Math.min(box.w, box.h)
    if (!showLabels) return clamp(Math.round(base * 0.72), 22, 168)
    // 预留两行文字 + 内边距/间距的高度，避免长名称第二行被裁掉
    const labelH = 2 * 11.5 * 1.25 + 1
    const chrome = 6 * 2 + 6
    return clamp(Math.round(base - chrome - labelH), 22, 168)
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
      const node = sc.kind === 'folder' ? buildFolderTile(sc) : buildTile(sc)
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
    store.batch(() => {
      // 拖到主网格的图标上，说明要回到主层级（从文件夹里拖出）
      store.setParent(ids, null)
      if (before) {
        ids.forEach(id => store.moveBefore(id, targetId, categoryId))
      } else {
        const list = store.visible(currentCategory, '').filter(s => ids.indexOf(s.id) < 0)
        const idx = list.findIndex(s => s.id === targetId)
        const next = idx >= 0 ? list[idx + 1] : null
        if (next) ids.forEach(id => store.moveBefore(id, next.id, categoryId))
        else ids.forEach(id => store.moveToEnd(id, categoryId))
      }
    })
    render()
  }

  function dropAtEnd (ids) {
    if (!ids.length) return
    const categoryId = currentCategory === 'all' ? undefined : (currentCategory === 'none' ? null : currentCategory)
    if (store.settings.sortBy !== 'manual') store.setSetting('sortBy', 'manual')
    store.batch(() => {
      // 拖到主网格空白处 = 从文件夹里移出
      store.setParent(ids, null)
      ids.forEach(id => store.moveToEnd(id, categoryId))
    })
    render()
  }

  /* ---------------- rubber-band selection ---------------- */

  let suppressClick = false

  function beginRubber (e) {
    if (e.button !== 0) return
    if (e.target.closest('.tile') || e.target.closest('.inner-tile')) return
    if (KL.ui.modalCount > 0) return
    const sx = e.clientX
    const sy = e.clientY
    const additive = e.ctrlKey || e.metaKey
    const baseSel = new Set()
    if (additive) selected.forEach(id => baseSel.add(id))
    else { selected.clear(); syncSelection() }
    const band = el('div', 'rubber')
    document.body.appendChild(band)
    let moved = false
    const onMove = ev => {
      const x1 = Math.min(sx, ev.clientX)
      const y1 = Math.min(sy, ev.clientY)
      const x2 = Math.max(sx, ev.clientX)
      const y2 = Math.max(sy, ev.clientY)
      if (x2 - x1 > 3 || y2 - y1 > 3) moved = true
      band.style.left = x1 + 'px'
      band.style.top = y1 + 'px'
      band.style.width = (x2 - x1) + 'px'
      band.style.height = (y2 - y1) + 'px'
      selected.clear()
      baseSel.forEach(id => selected.add(id))
      for (const id in tileNodes) {
        const node = tileNodes[id]
        if (node.closest('.folder-inner')) continue      // 文件夹内部不参与主网格框选
        const r = node.getBoundingClientRect()
        if (!(r.right < x1 || r.left > x2 || r.bottom < y1 || r.top > y2)) selected.add(id)
      }
      syncSelection()
    }
    const onUp = () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      band.remove()
      if (moved) suppressClick = true
      if (KL.app && KL.app.onSelectionChange) KL.app.onSelectionChange(selected)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  function refreshTile (id) {
    const sc = store.getShortcut(id)
    const node = tileNodes[id]
    if (!sc || !node) return
    const img = node.querySelector('img.icon')
    if (img) img.src = KL.icons.resolve(sc)
    const lb = node.querySelector('.label')
    if (lb) lb.textContent = sc.name
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

    // 文件夹相关
    const anyInside = ids.some(id => { const s = store.getShortcut(id); return s && s.parentId })
    if (anyInside) {
      items.push({
        label: '移出文件夹',
        onClick: () => { store.setParent(ids, null); toast('已移出文件夹'); clearSelection(); render() }
      })
      items.push({ separator: true })
    }
    const folders = store.shortcuts.filter(s => s.kind === 'folder' && !s.parentId)
    if (folders.length && !anyInside) {
      items.push({
        label: '移入文件夹',
        items: folders.map(f => ({
          label: f.name,
          onClick: () => { store.setParent(ids, f.id); toast('已移入「' + f.name + '」'); clearSelection(); render() }
        }))
      })
    }
    if (multi) {
      items.push({
        label: '装进新文件夹',
        onClick: async () => {
          const n = await KL.ui.prompt({ title: '新建文件夹', value: '新建文件夹', placeholder: '文件夹名称', okText: '创建' })
          if (n == null || !n) return
          const f = store.createFolder({
            name: n,
            categoryId: currentCategory === 'all' || currentCategory === 'none' ? null : currentCategory
          })
          store.setParent(ids, f.id)
          clearSelection()
          toast('已创建「' + n + '」并放入 ' + ids.length + ' 项')
          render()
        }
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
      { label: '新建文件夹', onClick: () => KL.dialogs.newFolder() },
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
    // 拖到网格/空白处 → 放到末尾（若是文件夹内的图标，则移出文件夹）
    contentEl.addEventListener('dragover', e => {
      if (!isInternal(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
    })
    contentEl.addEventListener('drop', e => {
      if (!isInternal(e)) return
      e.preventDefault()
      dropAtEnd(parseDrag(e))
    })
    contentEl.addEventListener('contextmenu', e => {
      if (e.target.closest('.tile') || e.target.closest('.inner-tile')) return
      e.preventDefault()
      selected.clear()
      syncSelection()
      showBlankMenu(e.clientX, e.clientY)
    })
    contentEl.addEventListener('click', e => {
      if (suppressClick) { suppressClick = false; return }
      if (e.target.closest('.tile') || e.target.closest('.inner-tile')) return
      if (selected.size) clearSelection()
    })
    contentEl.addEventListener('mousedown', beginRubber)

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
