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

  /* 光标悬浮时在光标处弹出名称气泡（无字模式，以及大文件夹内部）。
     标题还显示着的时候不弹，免得两处重复显示同一个名字。
     always=true 用于"名称一定不显示"的场合（大文件夹内部的图标），
     这时不再看"显示/隐藏名称"开关。
     注意 mouseenter / mouseleave 不冒泡：大文件夹内部的图标不会触发
     外层文件夹的悬浮逻辑，反之亦然。 */
  function attachNameTip (node, name, always) {
    const need = () => always || !store.settings.showLabels
    node.addEventListener('mouseenter', e => {
      if (!need() || e.buttons) return
      KL.ui.tip.hover(name, e.clientX, e.clientY)
    })
    node.addEventListener('mousemove', e => {
      if (!need()) return
      // 按着鼠标不放（橡皮筋框选 / 拖大小 / 拖拽排序）时一律不弹，
      // 否则从图标上划拉过去会满屏气泡。用 e.buttons 而不是自己记状态：
      // 鼠标在窗口外松开时收不到 mouseup，状态会卡死。
      if (e.buttons) return KL.ui.tip.hide()
      KL.ui.tip.move(e.clientX, e.clientY)
    })
    node.addEventListener('mouseleave', () => KL.ui.tip.hide())
  }

  /* ---------------- 自由摆放（关闭「自动对齐」时生效） ----------------
     自动对齐开着时，图标靠 CSS grid 的 `grid-auto-flow: row dense` 排布，
     永远往上补齐空位；关掉以后每个图标按存下来的 (x, y) 明确落格，可以留空洞。

     坐标只在这里算、不往数据里回写：
       · 避免"渲染 → 存盘 → 再渲染"打转；
       · 窗口变窄导致的临时挤压也不会破坏用户已经摆好的位置（窗口变宽就复原）。 */

  const GRID_GAP = 10
  const LABEL_GAP = 4      // 名称与格子下沿之间的距离
  const LABEL_BOX = 29     // 名称占的高度（11.5px × 1.25 × 2 行 ≈ 29）
  /* 图标占格子边长的比例。主网格和大文件夹内部**共用同一个值** ——
     以前内部格子是「图标 + 8px 内衬」挤出来的，图标占了格子将近 9 成，
     格子紧紧箍住图标（内部格子加了描边之后特别明显）。现在两边都按 72% 算，
     内部格子就是主格子的等比缩小版。 */
  const ICON_RATIO = 0.72

  /* 名称画在**格子外面**（见 css 的 .tile .label），所以有字模式下每一行之间
     要多留出「名称 + 一点间隔」的高度，否则下一行的图标会压到名称上。
     图标本身不再为文字让位 —— 两种模式下图标和格子大小完全一致。 */
  function labelSpace () {
    return store.settings.showLabels ? LABEL_GAP + LABEL_BOX : 0
  }

  function rowGapY () {
    return GRID_GAP + labelSpace()
  }

  function freeMode () {
    return store.settings.autoAlign === false
  }

  function gridMetrics () {
    const cell = currentCell()
    let cols = 0
    try {
      // repeat(auto-fill, …) 会按容器宽度解析成实际 track 列表，数一下就是列数
      const tpl = window.getComputedStyle(gridEl).gridTemplateColumns
      if (tpl && tpl !== 'none') cols = tpl.trim().split(/\s+/).filter(Boolean).length
    } catch (e) {}
    if (!cols) cols = Math.floor(((gridEl.clientWidth || 0) + GRID_GAP) / (cell + GRID_GAP))
    // gap = 横向间距；纵向间距（gapY）在有字模式下更大，因为名称画在格子外面
    return { cell: cell, gap: GRID_GAP, gapX: GRID_GAP, gapY: rowGapY(), cols: Math.max(1, cols) }
  }

  // 占位登记 + 找空位。列数变化时会被重新构造，所以不缓存状态。
  function makePacker (cols) {
    const occupied = new Set()
    const K = (x, y) => x + ',' + y

    function fits (x, y, col, row) {
      if (x < 0 || y < 0 || x + col > cols) return false
      for (let dy = 0; dy < row; dy++) {
        for (let dx = 0; dx < col; dx++) if (occupied.has(K(x + dx, y + dy))) return false
      }
      return true
    }
    function mark (x, y, col, row) {
      for (let dy = 0; dy < row; dy++) {
        for (let dx = 0; dx < col; dx++) occupied.add(K(x + dx, y + dy))
      }
    }
    // 从 y=0 起逐行扫出来的第一个空位 —— 和 CSS grid-auto-flow: row dense 的结果一致，
    // 所以"从自动对齐切到自由摆放"时画面不会跳。
    function firstFree (col, row) {
      for (let y = 0; y < 500; y++) {
        for (let x = 0; x + col <= cols; x++) if (fits(x, y, col, row)) return { x: x, y: y }
      }
      return { x: 0, y: 0 }
    }
    // 离落点最近的空位：先比曼哈顿距离，再比 y 小、x 小
    function nearestFree (tx, ty, col, row) {
      let best = null
      let bestD = Infinity
      for (let y = 0; y <= ty + 40; y++) {
        for (let x = 0; x + col <= cols; x++) {
          if (!fits(x, y, col, row)) continue
          const d = Math.abs(x - tx) + Math.abs(y - ty)
          if (d < bestD) { bestD = d; best = { x: x, y: y } }
        }
      }
      return best || firstFree(col, row)
    }
    function isFree (x, y) { return !occupied.has(K(x, y)) }
    return {
      cols: cols, fits: fits, mark: mark, isFree: isFree,
      firstFree: firstFree, nearestFree: nearestFree
    }
  }

  /* 算出这一屏每个顶层图标的实际落格。existing 传进来时会在它的占位上继续排
     （拖拽时用它把"其他图标已经占了哪些格子"带进来）。 */
  function layoutFree (list, m, existing) {
    const p = existing || makePacker(m.cols)
    const pos = {}
    for (const sc of list) {
      const col = clamp(sc.col || 1, 1, m.cols)
      const row = Math.max(1, sc.row || 1)
      let x
      let y
      if (sc.x == null || sc.y == null) {
        // 新增的图标 / 刚从自动对齐切过来 —— 补第一个空位
        const f = p.firstFree(col, row)
        x = f.x
        y = f.y
      } else {
        x = clamp(sc.x, 0, Math.max(0, m.cols - col))    // 窗口变窄先夹回来（不写回数据）
        y = sc.y
        if (!p.fits(x, y, col, row)) {
          let ok = false
          for (let yy = y + 1; yy < y + 200 && !ok; yy++) {
            if (p.fits(x, yy, col, row)) { y = yy; ok = true }
          }
          if (!ok) { const f = p.firstFree(col, row); x = f.x; y = f.y }
        }
      }
      p.mark(x, y, col, row)
      pos[sc.id] = { x: x, y: y }
    }
    return pos
  }

  // 鼠标落在第几格（左上角对齐）
  function cellFromPoint (clientX, clientY, m) {
    const r = gridEl.getBoundingClientRect()
    return {
      x: Math.max(0, Math.floor((clientX - r.left) / (m.cell + m.gapX))),
      y: Math.max(0, Math.floor((clientY - r.top) / (m.cell + m.gapY)))
    }
  }

  /* ---------------- 成组摆放（批量拖动） ----------------
     多选拖动时，如果逐个找空位，一组图标的相对排布会被打散。
     这里改成"整组一起落"：以被抓住的那个图标为原点，记下组内每个图标的相对偏移，
     落格时整体平移，形状原样保留。 */

  function groupItems (ids, grabbed) {
    const originId = (grabbed && ids.indexOf(grabbed) >= 0) ? grabbed : ids[0]
    const origin = store.getShortcut(originId)
    if (!origin || origin.x == null || origin.y == null) return null
    const items = []
    for (const id of ids) {
      const s = store.getShortcut(id)
      // 有成员还没有格子坐标（比如刚从文件夹里拖出来）→ 组信息不完整，
      // 交给调用方退化成逐个找空位
      if (!s || s.x == null || s.y == null) return null
      items.push({
        id: id,
        dx: s.x - origin.x,
        dy: s.y - origin.y,
        col: Math.max(1, s.col || 1),
        row: Math.max(1, s.row || 1)
      })
    }
    return items
  }

  // 整组能不能落在以 (ox, oy) 为原点的位置：不越界、不压别的图标、组内也不自压
  function groupFits (p, items, ox, oy, cols) {
    const seen = new Set()
    for (const it of items) {
      const x = ox + it.dx
      const y = oy + it.dy
      if (x < 0 || y < 0 || x + it.col > cols) return false
      for (let dy = 0; dy < it.row; dy++) {
        for (let dx = 0; dx < it.col; dx++) {
          const k = (x + dx) + ',' + (y + dy)
          if (!p.isFree(x + dx, y + dy)) return false
          if (seen.has(k)) return false
          seen.add(k)
        }
      }
    }
    return true
  }

  /* 先把整组的左上角夹回可视列范围，再从落点按曼哈顿距离找最近一个"整组放得下"的位置。
     找不到（组比窗口还宽）返回 null，由调用方退化成逐个找空位。 */
  function groupOrigin (p, items, cx, cy, cols) {
    let minDx = 0
    let maxRight = 0
    for (const it of items) {
      if (it.dx < minDx) minDx = it.dx
      if (it.dx + it.col > maxRight) maxRight = it.dx + it.col
    }
    const lo = -minDx
    const hi = Math.max(lo, cols - maxRight)
    const tx = clamp(cx, lo, hi)
    const ty = Math.max(0, cy)
    if (groupFits(p, items, tx, ty, cols)) return { x: tx, y: ty }
    let best = null
    let bestD = Infinity
    for (let y = 0; y <= ty + 40; y++) {
      for (let x = lo; x <= hi; x++) {
        if (!groupFits(p, items, x, y, cols)) continue
        const d = Math.abs(x - tx) + Math.abs(y - ty)
        if (d < bestD) { bestD = d; best = { x: x, y: y } }
      }
    }
    return best
  }

  function eachNearestFree (p, m, list, cx, cy, map) {
    list.forEach(id => {
      const sc = store.getShortcut(id)
      if (!sc) return
      const col = clamp(sc.col || 1, 1, m.cols)
      const row = Math.max(1, sc.row || 1)
      const free = p.nearestFree(cx, cy, col, row)
      p.mark(free.x, free.y, col, row)
      map[id] = free
    })
  }

  // 返回 true 表示整组一起落的；false 表示退化成逐个放
  function placeGroup (p, m, list, cx, cy, map) {
    const items = groupItems(list, dragHint && dragHint.grabbed)
    if (items) {
      const o = groupOrigin(p, items, cx, cy, m.cols)
      if (o) {
        for (const it of items) map[it.id] = { x: o.x + it.dx, y: o.y + it.dy }
        return true
      }
    }
    eachNearestFree(p, m, list, cx, cy, map)
    return false
  }

  /* ---------------- 拖拽落点虚框（自由摆放） ---------------- */

  let ghostEls = []
  let ghostPacker = null
  let ghostMetrics = null
  let ghostGroup = null
  let ghostOthers = null

  function hideGhost () {
    for (const g of ghostEls) if (g.parentNode) g.parentNode.removeChild(g)
    ghostEls = []
    ghostPacker = null
    ghostMetrics = null
    ghostGroup = null
    ghostOthers = null
  }

  function showGhosts (cells) {
    while (ghostEls.length < cells.length) {
      const g = el('div', 'drop-cell')
      gridEl.appendChild(g)
      ghostEls.push(g)
    }
    for (let i = 0; i < ghostEls.length; i++) {
      const g = ghostEls[i]
      const c = cells[i]
      if (!c) { g.style.display = 'none'; continue }
      g.style.display = ''
      g.style.gridColumn = (c.x + 1) + ' / span ' + c.col
      g.style.gridRow = (c.y + 1) + ' / span ' + c.row
    }
  }

  // 算出落点虚框该出现在哪几格。返回 null 表示这次拖拽不需要虚框。
  function ghostCells (c) {
    const m = ghostMetrics
    if (ghostGroup) {
      const o = groupOrigin(ghostPacker, ghostGroup, c.x, c.y, m.cols)
      if (o) {
        return ghostGroup.map(it => ({ x: o.x + it.dx, y: o.y + it.dy, col: it.col, row: it.row }))
      }
    }
    // 组信息不完整 / 组太宽放不下 → 按"逐个找最近空位"预览（用一份临时占位表，别污染拖拽用的）
    const list = dragHint.ids.filter(id => store.getShortcut(id))
    const p2 = makePacker(m.cols)
    layoutFree(ghostOthers || [], m, p2)
    const out = []
    list.forEach(id => {
      const sc = store.getShortcut(id)
      if (!sc) return
      const col = clamp(sc.col || 1, 1, m.cols)
      const row = Math.max(1, sc.row || 1)
      const free = p2.nearestFree(c.x, c.y, col, row)
      p2.mark(free.x, free.y, col, row)
      out.push({ x: free.x, y: free.y, col: col, row: row })
    })
    return out
  }

  // 拖拽开始时先把"其他图标的占位"打包好，dragover 时只需要算光标落在哪一格
  function prepareGhost (ids) {
    if (!freeMode()) { hideGhost(); return }
    const m = gridMetrics()
    const others = store.visible(currentCategory, keyword).filter(s => ids.indexOf(s.id) < 0)
    const p = makePacker(m.cols)
    layoutFree(others, m, p)
    ghostPacker = p
    ghostMetrics = m
    ghostOthers = others
    ghostGroup = groupItems(ids, dragHint && dragHint.grabbed)
  }

  function ghostAt (e) {
    if (!freeMode() || !ghostPacker || !dragHint) return
    // 拖到大文件夹上 = 移入文件夹（既有行为），这时不显示落格虚框
    if (e.target && e.target.closest && e.target.closest('.tile.folder')) return hideGhost()
    const c = cellFromPoint(e.clientX, e.clientY, ghostMetrics)
    const cells = ghostCells(c)
    if (cells) showGhosts(cells)
  }

  /* 自由摆放下的落子：
     多个图标一起拖 → 整组平移，保留彼此的相对位置；
     单个图标 → 落在落点格；该格被占就找最近的空位。 */
  function dropFree (ids, clientX, clientY) {
    const list = ids.filter(id => store.getShortcut(id))
    if (!list.length) return
    const m = gridMetrics()
    const others = store.visible(currentCategory, keyword).filter(s => list.indexOf(s.id) < 0)
    const p = makePacker(m.cols)
    layoutFree(others, m, p)
    const c = cellFromPoint(clientX, clientY, m)
    const map = {}
    let grouped = false
    store.batch(() => {
      store.setParent(list, null)          // 落回主网格（从文件夹里拖出来的情况）
      grouped = placeGroup(p, m, list, c.x, c.y, map)
      store.setPositions(map)
    })
    hideGhost()
    render()
    if (!grouped && list.length > 1) {
      toast('这组里有还没摆过位置的图标，已按顺序挨着放好')
    }
  }

  /* 改尺寸后原位可能放不下（压到别人 / 超出当前列数）→ 挪到最近的空位。
     只在 store.batch() 里调用，不自己 render。 */
  function settleFree (id) {
    const sc = store.getShortcut(id)
    if (!sc) return
    const m = gridMetrics()
    const others = store.visible(currentCategory, keyword).filter(s => s.id !== id)
    const p = makePacker(m.cols)
    layoutFree(others, m, p)
    const col = clamp(sc.col || 1, 1, m.cols)
    const row = Math.max(1, sc.row || 1)
    const x = clamp(sc.x == null ? 0 : sc.x, 0, Math.max(0, m.cols - col))
    const y = sc.y == null ? 0 : sc.y
    if (p.fits(x, y, col, row)) return
    store.setPositions({ [id]: p.nearestFree(x, y, col, row) })
  }

  /* 位置全部重算一遍：清掉坐标后触发 render，render 会按当前顺序重新密排并钉住。
     自由摆放时切换「排列顺序」用它 —— 否则位置是写死的，按名称排序看不到任何变化。 */
  function repack () {
    const list = store.visible(currentCategory, keyword).map(s => s.id)
    store.clearPositions(list)
  }

  function currentCell () {
    return clamp(parseInt(store.settings.cell, 10) || 92, 64, 160)
  }

  function tilePixelBox (sc) {
    const cell = currentCell()
    return {
      w: cell * sc.col + GRID_GAP * (sc.col - 1),
      h: cell * sc.row + rowGapY() * (sc.row - 1)
    }
  }

  /* ---------------- folders ---------------- */

  // 文件夹内图标大小档位（相对主格子）
  /* 这个比例是「内部格子边长 / 主格子边长」，**不是**图标比例 ——
     图标再按 ICON_RATIO(0.72) 从格子边长算出来（和主网格同源）。
     这样「文件夹内图标大小 = 与主格一致」时，里面的格子和图标都和主网格一模一样
     （92 / 66）；其它档位是它的等比缩小版。
     数值按"看起来和以前差不多大"调过（medium 0.75 → 格子 69、图标 50）。 */
  const FOLDER_SCALES = { small: 0.55, medium: 0.75, large: 0.95, same: 1 }

  function folderScale () {
    return FOLDER_SCALES[store.settings.folderIconSize] || FOLDER_SCALES.medium
  }

  function openFolderView (id) {
    if (KL.dialogs && KL.dialogs.folderView) KL.dialogs.folderView(id)
  }

  /* 文件夹的标题：位置、字号、折行、显隐完全走和图标名称同一套（都是 .label），
     只是额外带一个数量。挂在 tile 上就是格子下方，点它自然冒泡到 tile → 打开文件夹。 */
  function folderLabel (sc, count) {
    const label = el('div', 'label')
    label.title = sc.name
    const n = el('span', 'label-name', sc.name)
    label.appendChild(n)
    if (count) label.appendChild(el('span', 'label-count', String(count)))
    return label
  }

  // 大文件夹内部的单元尺寸：图标档位给出图标尺寸上限，列数按文件夹可用宽度
  // 自适应——先按档位尺寸试排，右侧剩下的空白超过能多塞一列时自动缩一点图标
  // 把列数加满（下限 80% 档位值，避免为了填满把图标缩得认不出）。
  //
  // 两种显示方式（每个文件夹用 folderView 单独设置，见 showFolderMenu）：
  //   · 'grid'（默认）：小图标平铺成多列；
  //   · 'list'：一行一个，图标缩到 55% 贴在左边、名称写在右边 —— 适合文件夹里
  //     装的是文档。列表行高由缩放后的图标决定，所以比网格行矮，一页能放更多。
  //
  // 内容超出时**整页翻动**（`rows` 行 × `cols` 列一页，见 renderFolderPage）：
  // 只渲染整行，所以永远不会出现"某一行被裁掉半截"。翻页只用滚轮，**不做任何
  // 页标 / 页码 UI** —— 悬浮在图标区上的控件一定会占地方，曾经那版「‹ 1/2 ›」
  // 就是因此在某些尺寸下压到图标被删掉的。
  //
  // 文件夹的标题不在这里，它和图标名称一样画在**格子下方**（见 folderLabel），
  // 所以 headH 恒为 0 —— 内部空间一点不被标题占。
  //
  // 网格模式下内部图标**不显示名称**：名称靠光标气泡（attachNameTip(…, true)）；
  // 列表模式下名称就写在行里，所以不挂气泡。
  const INNER_CHROME = 8      // inner-tile 上下 padding 2px×2 + 边框 1px×2 + 行内 gap 2px
  const INNER_PAD = 6         // inner-tile 实际吃掉的边距：padding 2×2 + border 1×2
  const LIST_ICON_RATIO = 0.55   // 列表模式下图标相对网格图标的比例
  const LIST_CHROME = 10      // 列表行：上下 padding 4px×2 + 边框 1px×2

  function innerMetrics (folderSc) {
    const cell = currentCell()
    const box = tilePixelBox(folderSc)
    const scale = folderScale()
    const gap = Math.max(3, Math.round(4 * scale))
    const pad = 6
    const headH = 0      // 标题在格子外面，不占内部空间
    const innerW = Math.max(40, box.w - pad * 2)
    const innerH = Math.max(30, box.h - pad * 2 - headH)
    const iconMax = Math.max(26, Math.round(cell * scale))

    // 列表模式：单列，行高由缩小后的图标决定
    if (folderSc.folderView === 'list') {
      const listIcon = clamp(Math.round(iconMax * LIST_ICON_RATIO), 18, 96)
      const rowH = listIcon + LIST_CHROME
      const rows = Math.max(1, Math.floor((innerH + gap) / (rowH + gap)))
      return {
        list: true, cols: 1, icon: listIcon, unit: innerW, rowH: rowH, rows: rows,
        gap: gap, pad: pad, labelH: 0, headH: headH,
        innerW: innerW, innerH: innerH
      }
    }

    /* 网格模式：挑一个「最能铺满」的 (列数, 行数) 组合。

       以前只按宽度最大化列数、行数取"最多能放几行"来分页，于是在很多尺寸下会出现：
         · 末行只有一两个图标，下面空一大条（不对称）；
         · 图标被挤到比「文件夹内图标大小」还小一档，而右侧还空着。
       现在按两个指标挑组合：
         fill    = 网格占用的面积 / 内部可用面积（越大越不浪费）
         rowFill = 末行图标数 / 列数（越小说明末行越瘪，越难看）
       取 fill × rowFill 最大的；并列时优先列数多（横向读起来更顺）。
       格子边长再被「档位上限」和「实际可用空间」双重夹住 ——
       夹不住就会出现格子比容器还大、图标边缘被 overflow:hidden 裁掉的怪现象。 */
    const total = store.childCount(folderSc.id)
    // 档位比例直接作用在**格子边长**上（iconMax 只剩列表模式还在用）
    const cellMax = Math.max(28, Math.round(cell * scale))
    const fitCols = (w) => Math.max(1, Math.floor((innerW + gap) / (w + gap)))
    const fitRows = (h) => Math.max(1, Math.floor((innerH + gap) / (h + gap)))
    const maxCols = fitCols(cellMax)
    const maxRows = fitRows(cellMax)
    const cap = maxCols * maxRows

    // 搜索时允许格子比档位值小一点（≤ 78%），换来排得更匀称；
    // 但不能无限缩小 —— 太小就变成"格子箍着图标"了。
    const sizeFloor = Math.max(24, Math.round(cellMax * 0.78))
    const maxColsS = fitCols(sizeFloor)
    const maxRowsS = fitRows(sizeFloor)

    let cols = maxCols
    let rows = maxRows
    let size = Math.min(cellMax, innerW, innerH)

    if (total > 0 && total <= cap) {
      // 一页装得下 → 找一个最匀称的摆法
      let best = null
      for (let c = Math.min(maxColsS, total); c >= 1; c--) {
        const r = Math.ceil(total / c)
        if (r > maxRowsS) continue
        const w = (innerW - (c - 1) * gap) / c
        const h = (innerH - (r - 1) * gap) / r
        const s = Math.min(Math.floor(Math.min(w, h)), cellMax)
        if (s < sizeFloor) continue          // 缩得太多就不值当了
        const usedW = c * s + (c - 1) * gap
        const usedH = r * s + (r - 1) * gap
        const fill = (usedW * usedH) / (innerW * innerH)
        const rowFill = (total - (r - 1) * c) / c
        const score = fill * rowFill
        if (!best || score > best.score + 1e-9) best = { c: c, r: r, s: s, score: score }
      }
      if (best) { cols = best.c; rows = best.r; size = best.s }
    }

    return {
      cols: cols, icon: Math.max(16, size - INNER_CHROME), unit: size, rowH: size, rows: rows,
      gap: gap, pad: pad, labelH: 0, headH: headH,
      innerW: innerW, innerH: innerH
    }
  }
  /* 内部图标的尺寸。格子边长（含跨格）乘 ICON_RATIO —— 和主网格的 iconSizeFor
     用同一个比例，所以里面的图标和格子的关系看起来跟外面一模一样，不会出现
     "格子箍着图标"的失衡感。
     再夹一道「格子自己的内边距」：无论尺寸怎么算，图标都不会顶到、更不会越出格子
     （.inner-tile 是 overflow:hidden，越出就会被裁掉边缘）。 */
  function innerIconSize (sc, m) {
    if (m.list) return m.icon          // 列表模式所有行同一个图标尺寸
    const c = sc.col || 1
    const r = sc.row || 1
    const w = m.unit * c + m.gap * (c - 1)          // 格子边长（不先扣内衬）
    const h = m.rowH * r + m.gap * (r - 1)
    const room = Math.min(w, h) - INNER_PAD          // 扣掉 padding 与边框
    return clamp(Math.round(Math.min(Math.min(w, h) * ICON_RATIO, room)), 16, 220)
  }

  /* ---------------- 大文件夹内部：分页 + 翻页 ----------------
     每页 rows 行 × cols 列，只渲染整行 —— 永远不会出现"一行被裁掉半截"。
     翻页入口只有滚轮，**没有页标**：图标区不能有任何悬浮控件。
     翻页只重绘这个文件夹的内部，不整屏 render（页码存在 folderPage 里不会丢）。 */

  const folderPage = {}    // folderId → 当前页码（0 起）

  function folderPageCount (m, total) {
    return Math.max(1, Math.ceil(total / (m.cols * m.rows)))
  }

  function renderFolderPage (sc, inner, m, kids) {
    const pages = folderPageCount(m, kids.length)
    let page = folderPage[sc.id] || 0
    if (page >= pages) page = pages - 1
    if (page < 0) page = 0
    folderPage[sc.id] = page
    inner.innerHTML = ''
    const show = kids.slice(page * m.cols * m.rows, (page + 1) * m.cols * m.rows)
    for (const k of show) {
      const node = buildInnerTile(k, m, sc)
      inner.appendChild(node)
      tileNodes[k.id] = node
    }
    return pages
  }

  // 翻页后只重绘这个文件夹的内部，别整屏 render
  function refreshFolderInner (sc) {
    const tile = tileNodes[sc.id]
    if (!tile) return
    const inner = tile.querySelector('.folder-inner')
    if (!inner) return
    renderFolderPage(sc, inner, innerMetrics(sc), store.childrenOf(sc.id))
  }

  /* 滚轮翻页。翻到头就把事件**放行**给外层页面，免得用户被卡在文件夹里。
     用"累积 delta"而不是按时间节流：鼠标滚轮一格 deltaY≈100+，一次就够一页；
     触控板连发的小 delta 攒够一页（MIN_STEP）才动 —— 两种设备都自然，
     而且不依赖计时器，程序化派发事件也能得到确定结果（测试正是靠这一点）。 */
  function attachFolderPaging (inner, sc, pages) {
    if (pages <= 1) return
    const MIN_STEP = 24
    let acc = 0
    inner.addEventListener('wheel', e => {
      const p = folderPage[sc.id] || 0
      const down = e.deltaY > 0
      if (down ? p >= pages - 1 : p <= 0) { acc = 0; return }
      e.preventDefault()
      e.stopPropagation()
      acc += e.deltaY
      if (Math.abs(acc) < MIN_STEP) return
      acc = 0
      folderPage[sc.id] = clamp(p + (down ? 1 : -1), 0, pages - 1)
      refreshFolderInner(sc)
    }, { passive: false })
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
      attachNameTip(tile, sc.name)      // 小文件夹的标题同样会被无字模式隐藏
    } else {
      // 大文件夹（m×n）：内部整页平铺，可直接点图标；放不下的滚轮翻页
      tile.classList.add('folder-big')
      tile.style.gridColumn = 'span ' + sc.col
      tile.style.gridRow = 'span ' + sc.row
      if (sc.color) tile.style.background = sc.color
      const m = innerMetrics(sc)
      const inner = el('div', 'folder-inner')
      inner.style.gridTemplateColumns = m.list ? '1fr' : 'repeat(' + m.cols + ', ' + m.unit + 'px)'
      inner.style.gridAutoRows = m.rowH + 'px'
      inner.style.gap = m.gap + 'px'
      if (m.list) tile.classList.add('folder-list')
      const pages = renderFolderPage(sc, inner, m, store.childrenOf(sc.id))
      tile.appendChild(inner)
      attachFolderPaging(inner, sc, pages)
      // 文件夹的标题也画在**格子下方**，和图标名称同一套逻辑（同样受
      // 「显示/隐藏名称」开关控制，无字模式下靠悬浮气泡）—— 只是多带一个数量
      tile.appendChild(folderLabel(sc, count))
      attachNameTip(tile, sc.name)
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
        // 小文件夹：整个图标都是"打开"
        openFolderView(sc.id)
        return
      }
      // 大文件夹：内部的图标、标题栏、拉伸手柄各自都 stopPropagation 了，
      // 能走到这里的就是"空白处" —— 一律当作打开文件夹。
      const t = e.target
      if (t && t.closest && t.closest('.resize')) return
      openFolderView(sc.id)
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
      dragHint = { ids: ids, grabbed: sc.id }
      prepareGhost(ids)
    })
    tile.addEventListener('dragend', () => {
      clearDropHints()
      hideGhost()
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
      hideGhost()                                  // 落在文件夹上 = 移入，不显示落格虚框
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
    if (m.list) {
      // 列表模式：一行一个，忽略子项自己的 col/row
      tile.classList.add('list-row')
      tile.style.gridColumn = 'span 1'
      tile.style.gridRow = 'span 1'
    } else {
      tile.style.gridColumn = 'span ' + (sc.col || 1)
      tile.style.gridRow = 'span ' + (sc.row || 1)
    }
    tile.style.setProperty('--icon-size', innerIconSize(sc, m) + 'px')
    if (selected.has(sc.id)) tile.classList.add('selected')

    const box = el('div', 'icon-box')
    const img = el('img', 'icon')
    img.draggable = false
    img.src = KL.icons.resolve(sc)
    img.alt = ''
    box.appendChild(img)
    tile.appendChild(box)
    if (m.list) {
      // 列表模式的核心就是把名称写出来（同样不受「显示/隐藏名称」开关影响）
      const nameEl = el('div', 'inner-name')
      nameEl.textContent = sc.name
      nameEl.title = sc.name
      tile.appendChild(nameEl)
    }
    if (sc.missing) tile.appendChild(el('div', 'badge'))
    // 网格模式下内部不渲染名称 → 名称靠光标气泡（第三个参数 true = 不受开关影响）。
    // 列表模式下名称已经在行里，再弹气泡就是重复。
    if (!m.list) attachNameTip(tile, sc.name, true)

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
      dragHint = { ids: ids, grabbed: sc.id }
      prepareGhost(ids)        // 拖出文件夹时也能看到落格虚框
    })
    tile.addEventListener('dragend', e => {
      clearDropHints()
      hideGhost()
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
      // 横纵步长分开：有字模式下行距更大（名称画在格子外面）
      const stepX = currentCell() + GRID_GAP
      const stepY = currentCell() + rowGapY()
      const startX = e.clientX
      const startY = e.clientY
      const baseCol = sc.col
      const baseRow = sc.row
      let col = baseCol
      let row = baseRow
      const info = freeResizeInfo(tile)
      const capCol = Math.min(4, Math.max(1, Math.floor((contentEl.clientWidth - 4) / stepX)), info.maxCol)
      const onMove = ev => {
        col = clamp(baseCol + Math.round((ev.clientX - startX) / stepX), 1, capCol)
        row = clamp(baseRow + Math.round((ev.clientY - startY) / stepY), 1, 4)
        tile.style.gridColumn = info.startCol ? info.startCol + ' / span ' + col : 'span ' + col
        tile.style.gridRow = info.startRow ? info.startRow + ' / span ' + row : 'span ' + row
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        if (col !== sc.col || row !== sc.row) {
          store.batch(() => {
            store.updateShortcut(sc.id, { col: col, row: row })
            if (freeMode()) settleFree(sc.id)
          })
        } else {
          render()
        }
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
    const isBig = sc.col * sc.row > 1
    const view = sc.folderView === 'list' ? 'list' : 'grid'
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
      // 1×1 的小文件夹不展示内部，这个开关没有意义，就不给出来
      ...(isBig ? [{ label: '内部显示方式', items: [
        { label: '图标', hint: view === 'grid' ? '✓' : '', onClick: () => { store.updateShortcut(sc.id, { folderView: 'grid' }); render() } },
        { label: '列表（图标 + 名称）', hint: view === 'list' ? '✓' : '', onClick: () => { store.updateShortcut(sc.id, { folderView: 'list' }); render() } }
      ] }] : []),
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

  /* 图标尺寸：只由格子大小决定 —— 名称已经移到格子**外面**，图标不再为文字让位，
     所以有字 / 无字两种模式下图标大小完全一致。 */
  function iconSizeFor (sc) {
    const box = tilePixelBox(sc)
    const base = Math.min(box.w, box.h)
    return clamp(Math.round(base * ICON_RATIO), 22, 168)
  }

  /* ---------------- rendering ---------------- */

  function render () {
    if (!gridEl) return
    const settings = store.settings
    const list = store.visible(currentCategory, keyword)
    gridEl.style.setProperty('--cell', currentCell() + 'px')
    // 名称画在格子外面：有字模式下行距要多留出「名称 + 间距」，网格自己也要留出
    // 底部空间，否则最后一行的名称会被 .content 的裁剪框切掉
    gridEl.style.setProperty('--gap-y', rowGapY() + 'px')
    gridEl.style.setProperty('--label-pad', labelSpace() + 'px')
    gridEl.classList.toggle('hide-labels', !settings.showLabels)
    gridEl.classList.toggle('free-layout', settings.autoAlign === false)
    // 重渲染会把正在悬浮的节点换掉，mouseleave 不会再触发 —— 主动收起气泡
    KL.ui.tip.hide()
    hideGhost()
    gridEl.innerHTML = ''
    for (const k in tileNodes) delete tileNodes[k]

    // 自由摆放：先把这一屏的落格算出来，再把每个图标明确摆到对应格子上
    const m = settings.autoAlign === false ? gridMetrics() : null
    const pos = m ? layoutFree(list, m) : null

    if (pos) {
      // 关键：把"还没有坐标"的图标就地钉住。
      // 否则每次渲染都会按当时的顺序给它们重新补空位 —— 一旦别的图标挪了格子，
      // 这些图标就会跟着跳，看起来像"自由摆放不管用"。
      // 钉完之后 render 就退化成纯读，不会反复触发（用 silent 就是为此：渲染途中
      // 再抛一个 shortcuts 事件会把刚建好的节点冲掉）。
      const pin = {}
      let needPin = false
      for (const sc of list) {
        if (sc.x == null || sc.y == null) { pin[sc.id] = pos[sc.id]; needPin = true }
      }
      if (needPin) store.setPositions(pin, true)
    }

    for (const sc of list) {
      const node = sc.kind === 'folder' ? buildFolderTile(sc) : buildTile(sc)
      if (pos) {
        const p = pos[sc.id]
        node.style.gridColumn = (p.x + 1) + ' / span ' + clamp(sc.col || 1, 1, m.cols)
        node.style.gridRow = (p.y + 1) + ' / span ' + Math.max(1, sc.row || 1)
      }
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

  /* 拉长的格子（1×n / n×1）：图标按 1×1 大小贴到**上 / 左**，不再两边留白，
     空出来的那块地方用来常驻显示一份名称（见 css 的 .tile-name-fill）。
     这份名称**不受「显示/隐藏名称」开关影响** —— 它本来就是给无字模式准备的；
     格子下方那份 .label 仍然走原来的逻辑（受开关控制）。
     只跟形状有关，跟开关无关 —— 免得"拉伸"和"开关"两个变量互相打架。
     文件夹不参与：它的格子里装的是内部图标，没有"空白处"可用。 */
  function isElongated (col, row) {
    return (col === 1 && row > 1) || (row === 1 && col > 1)
  }

  function applyElongatedClass (node, col, row) {
    node.classList.toggle('tall', col === 1 && row > 1)
    node.classList.toggle('wide', row === 1 && col > 1)
  }

  function buildTile (sc) {
    const settings = store.settings
    const tile = el('div', 'tile')
    tile.dataset.id = sc.id
    tile.draggable = true
    tile.style.gridColumn = 'span ' + sc.col
    tile.style.gridRow = 'span ' + sc.row
    tile.style.setProperty('--icon-size', iconSizeFor(sc) + 'px')
    applyElongatedClass(tile, sc.col, sc.row)
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

    // 格子内部那份常驻名称：普通格子里是隐藏的（CSS 控制），拉长时才露出来
    const fill = el('div', 'tile-name-fill')
    fill.textContent = sc.name
    fill.title = sc.name
    tile.appendChild(fill)

    const resize = el('div', 'resize', RESIZE_SVG)
    resize.title = '拖动调整尺寸'
    tile.appendChild(resize)

    if (sc.missing) {
      const badge = el('div', 'badge')
      badge.title = '目标不存在'
      tile.appendChild(badge)
    }

    // 拉长的格子里名称常驻可见，不需要再悬浮弹气泡（和其它"名称已显示"的情况一致）
    if (!isElongated(sc.col, sc.row)) attachNameTip(tile, sc.name)

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
      dragHint = { ids: ids, grabbed: sc.id }
      prepareGhost(ids)
    })
    tile.addEventListener('dragend', () => {
      clearDropHints()
      hideGhost()
      for (const k in tileNodes) tileNodes[k].classList.remove('dragging')
      dragHint = null
    })
    tile.addEventListener('dragover', e => {
      if (!isInternal(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      // 自由摆放：不显示"前/后"插入位，改用 contentEl 上的落格虚框（所以不 stopPropagation）
      if (freeMode()) return
      e.stopPropagation()
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
      if (freeMode()) return dropFree(ids, e.clientX, e.clientY)
      dropOn(ids, sc.id, before)
    })

    attachResize(tile, sc)
    return tile
  }

  /* 自由摆放下拖大小要用到的两个信息：
     · 起始格号 —— 从内联样式里取出来保留，否则拖动过程中图标会跳回自动流位置
     · 最大跨度 —— 别超过当前列数，否则会撑出隐式列导致横向溢出
     必须在 applyVisual 改样式之前取。 */
  function freeResizeInfo (tile) {
    if (!freeMode()) return { startCol: '', startRow: '', maxCol: 4 }
    const gc = String(tile.style.gridColumn || '')
    const gr = String(tile.style.gridRow || '')
    const startCol = gc.indexOf('/') >= 0 ? gc.split('/')[0].trim() : ''
    const startRow = gr.indexOf('/') >= 0 ? gr.split('/')[0].trim() : ''
    const n = parseInt(startCol, 10)
    const cols = gridMetrics().cols
    return {
      startCol: startCol,
      startRow: startRow,
      maxCol: Number.isFinite(n) ? Math.max(1, cols - n + 1) : 4
    }
  }

  function attachResize (tile, sc) {
    const handle = tile.querySelector('.resize')
    handle.addEventListener('mousedown', e => {
      e.preventDefault()
      e.stopPropagation()
      const stepX = currentCell() + GRID_GAP
      const stepY = currentCell() + rowGapY()
      const startX = e.clientX
      const startY = e.clientY
      const baseCol = sc.col
      const baseRow = sc.row
      let col = baseCol
      let row = baseRow
      const info = freeResizeInfo(tile)
      const applyVisual = () => {
        tile.style.gridColumn = info.startCol ? info.startCol + ' / span ' + col : 'span ' + col
        tile.style.gridRow = info.startRow ? info.startRow + ' / span ' + row : 'span ' + row
        const ghost = Object.assign({}, sc, { col: col, row: row })
        tile.style.setProperty('--icon-size', iconSizeFor(ghost) + 'px')
        // 拉动过程中就切到贴边布局，别等松手才跳一下
        applyElongatedClass(tile, col, row)
      }
      const maxCol = Math.max(1, Math.floor((contentEl.clientWidth - 4) / stepX))
      const capCol = Math.min(4, Math.max(1, maxCol), info.maxCol)
      const onMove = ev => {
        col = clamp(baseCol + Math.round((ev.clientX - startX) / stepX), 1, capCol)
        row = clamp(baseRow + Math.round((ev.clientY - startY) / stepY), 1, 4)
        applyVisual()
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        if (col !== sc.col || row !== sc.row) {
          store.batch(() => {
            store.updateShortcut(sc.id, { col: col, row: row })
            if (freeMode()) settleFree(sc.id)   // 放大后原位放不下就挪到最近的空位
          })
        } else {
          render()
        }
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
      if (freeMode()) ghostAt(e)
    })
    // 拖到网格/空白处 → 放到末尾（若是文件夹内的图标，则移出文件夹）
    // 自由摆放下改成"放到鼠标所在的格子"
    contentEl.addEventListener('dragover', e => {
      if (!isInternal(e)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (freeMode()) ghostAt(e)
    })
    contentEl.addEventListener('drop', e => {
      if (!isInternal(e)) return
      e.preventDefault()
      const ids = parseDrag(e)
      hideGhost()
      if (freeMode()) return dropFree(ids, e.clientX, e.clientY)
      dropAtEnd(ids)
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

    // 无字模式的名称气泡：这些情况下 mouseleave 不一定会来，统一兜底收起，
    // 否则气泡会"粘"在屏幕上（拖拽 / 滚动 / 切窗口 / 鼠标移出窗口时）
    document.addEventListener('dragstart', () => KL.ui.tip.hide())
    window.addEventListener('blur', () => KL.ui.tip.hide())
    window.addEventListener('scroll', () => KL.ui.tip.hide(), true)
    document.addEventListener('mouseleave', () => KL.ui.tip.hide())

    store.on((type, payload) => {
      // 自由摆放下位置是写死的，换「排列顺序」必须重新密排一次，否则看不出任何变化
      if (type === 'settings' && payload && payload.key === 'sortBy' && freeMode()) {
        repack()
        return
      }
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
    // —— 自由摆放（关闭自动对齐）——
    freeMode: freeMode,
    repack: repack,
    layoutFree: layoutFree,
    gridMetrics: gridMetrics,
    dropFree: dropFree,
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
