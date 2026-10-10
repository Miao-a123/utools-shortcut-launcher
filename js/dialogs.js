(function () {
  'use strict'
  const KL = (window.KL = window.KL || {})
  const store = KL.store
  const S = window.services
  const el = KL.ui.el
  const esc = KL.ui.esc
  const toast = KL.ui.toast
  const ICONS = KL.ui.ICONS

  const VERSION = '1.5.0'
  const REPO_URL = 'https://github.com/Miao-a123/utools-shortcut-launcher'
  const CHANGELOG = [
    {
      v: '1.5.0',
      date: '2026-10-09',
      items: [
        '新增：图标格子背景色支持不透明度调节 —— 选好颜色后拖动「不透明度」滑块即可让背景半透明，0% 全透明、100% 完全不透明',
        '改进：设置面板改为从左下角弹出的小面板，遮罩全透明，尽量不遮挡图标页面；同时收窄了面板宽度',
        '调整：唤起关键词精简为「快捷方式 / 快捷启动 / 快捷面板」三个（中文关键词自动支持拼音和首字母），原有的 launcher / shortcut / kl 已移除'
      ]
    },
    {
      v: '1.4.0',
      date: '2026-10-09',
      items: [
        '改进：文件夹内图标大小改为只由设置决定，不再随文件夹尺寸变化 —— 不同尺寸的文件夹里图标现在大小一致；设置面板可切换 小 / 中 / 大 / 与主格一致',
        '新增：光标位于大文件夹内时可用滚轮滚动浏览未显示完的图标（内容超出时出现细滚动条）',
        '新增：点击大文件夹的标题栏即可打开文件夹，浏览全部图标',
        '新增：图标格子支持背景颜色与描边（颜色 + 粗细可分别设置）'
      ]
    },
    {
      v: '1.3.0',
      date: '2026-10-09',
      items: [
        '新增：文件夹 / 大文件夹（同一个容器）——1×1 是小文件夹，点开后在弹层里操作图标；把尺寸调大即成为大文件夹，内部图标平铺显示、可直接点击，且内部每个图标也能各自调整大小',
        '新增：文件夹可设置背景颜色、重命名；右键可调整尺寸、解散（内部图标移回主面板）、删除',
        '新增：图标可自由移入 / 移出文件夹——拖到文件夹上即放入，从大文件夹拖到主面板即移出，多选后可整体移入',
        '新增：橡皮筋框选——在空白处拖拽画框即可多选图标（Ctrl 可追加），选中后支持批量拖拽、删除、装进新文件夹',
        '新增：右键/工具栏提供"新建文件夹"与"装进文件夹"'
      ]
    },
    {
      v: '1.2.3',
      date: '2026-10-09',
      items: [
        '修复：一行/两行名称混排时图标上下不对齐（文字区域改为固定保留两行高度，各格子内容高度一致，图标位置随之统一）'
      ]
    },
    {
      v: '1.2.2',
      date: '2026-10-09',
      items: [
        '修复：大量图标仍是空白。根因是误把快捷方式里的图标位置索引当成了系统图标索引（"xxx.exe,0" 中的 0 是该程序的第几个图标资源，与系统图标列表无关），于是命中列表首项——空白占位图。现改为直接用快捷方式文件本身提取、索引交给系统自动识别',
        '修复：网址类快捷方式（如 Steam 游戏）抓不到网站图标时，回退使用本地图标文件',
        '修复：导入时若图标路径不存在则不再写入"未知文件"占位图'
      ]
    },
    {
      v: '1.2.1',
      date: '2026-10-09',
      items: [
        '修复：重建图标后全部变成空白图标。根因是图标索引默认取了 0 —— 而索引 0 恰好是系统图标列表里的占位图标，导致所有应用取到同一个空白图。现改为：仅当快捷方式显式指定索引时才使用，否则交给系统自动识别'
      ]
    },
    {
      v: '1.2.0',
      date: '2026-10-09',
      items: [
        '修复：部分应用图标取不到/显示过小（图标位置 "路径,索引" 解析失败、透明边距未裁剪）',
        '修复：长名称第二行文字被裁切（图标尺寸改为自动为文字预留空间）',
        '新增：侧边栏宽度可调（拖动右边缘，或设置面板滑块）',
        '新增：打开插件后直接敲键盘即输入搜索框，无需先点击',
        '调整：只保留侧边栏底部一个设置入口'
      ]
    },
    {
      v: '1.1.0',
      date: '2026-10-09',
      items: [
        '修复：右键菜单/确认框"删除"无效（确认弹窗返回值竞态）',
        '修复：Chrome 等浏览器"创建网站快捷方式"拖入失败（识别为网址快捷方式）',
        '修复：URL 目标快捷方式（如微信小程序 weixin://）打开报"目标为空"',
        '修复：图标视觉大小不一（裁掉透明边并铺满画布，可在设置里一键重建）',
        '新增：侧边栏底部设置入口；设置面板新增版本号与更新日志'
      ]
    },
    {
      v: '1.0.0',
      date: '2026-10-08',
      items: [
        '拖拽文件/文件夹/网址创建快捷方式，.lnk/.url 自动解析目标',
        '系统图标高清提取（256px）、网址图标自动抓取',
        '侧边栏分类管理、宫格自由尺寸（1×1~4×4）、拖拽排序与归类',
        '一键扫描本机应用（含 UWP）、批量导入浏览器收藏夹',
        '搜索、多选批量操作、数据导入导出、深浅色主题跟随'
      ]
    }
  ]

  function basename (p) {
    const parts = String(p || '').split(/[\\/]/)
    return parts[parts.length - 1] || p
  }

  function stripExt (name) {
    return String(name || '').replace(/\.(lnk|url|exe|appref-ms)$/i, '')
  }

  function currentCategoryId () {
    const c = KL.grid.getCategory()
    if (c === 'all') return null
    if (c === 'none') return null
    return c
  }

  function field (label, control, hint) {
    const f = el('div', 'field')
    if (label) {
      const l = el('label')
      l.textContent = label
      f.appendChild(l)
    }
    f.appendChild(control)
    if (hint) f.appendChild(el('div', 'hint', esc(hint)))
    return f
  }

  function input (value, placeholder, type) {
    const i = el('input', 'input')
    i.type = type || 'text'
    i.value = value == null ? '' : value
    if (placeholder) i.placeholder = placeholder
    return i
  }

  function select (options, value) {
    const s = el('select', 'input')
    for (const o of options) {
      const opt = document.createElement('option')
      opt.value = o.value
      opt.textContent = o.label
      if (String(o.value) === String(value == null ? '' : value)) opt.selected = true
      s.appendChild(opt)
    }
    return s
  }

  function segmented (options, value, onPick) {
    const wrap = el('div', 'seg')
    const btns = []
    for (const o of options) {
      const b = el('button', '', esc(o.label))
      b.type = 'button'
      if (o.value === value) b.classList.add('on')
      b.addEventListener('click', () => {
        btns.forEach(x => x.classList.remove('on'))
        b.classList.add('on')
        onPick && onPick(o.value)
      })
      btns.push(b)
      wrap.appendChild(b)
    }
    wrap.setValue = function (v) {
      options.forEach((o, i) => btns[i].classList.toggle('on', o.value === v))
    }
    return wrap
  }

  /* ==================================================================
   * 图标编辑区
   * ================================================================== */

  function buildIconEditor (sc, onChange) {
    const wrap = el('div')
    const colors = KL.icons.PALETTE.concat(KL.icons.hsvPalette(8))
    const state = Object.assign({ type: 'auto' }, sc.icon || {})

    const preview = el('div', 'icon-preview')
    const previewImg = el('img')
    preview.appendChild(previewImg)

    const row = el('div', 'row')
    row.style.alignItems = 'flex-start'
    row.appendChild(preview)

    const right = el('div')
    right.style.flex = '1 1 auto'
    right.style.minWidth = '0'

    const seg = segmented([
      { value: 'auto', label: '文件默认' },
      { value: 'text', label: '文字' },
      { value: 'glyph', label: '字形' },
      { value: 'data', label: '图片' }
    ], state.type, v => {
      state.type = v
      if (v === 'text' && !state.text) {
        state.text = Array.from(sc.name || '?')[0] || '?'
        state.bg = state.bg || KL.icons.GLYPH_COLOR[KL.icons.kindOfShortcut(sc)] || '#534AB7'
        state.fg = state.fg || '#ffffff'
      }
      if (v === 'glyph' && !state.kind) state.kind = KL.icons.kindOfShortcut(sc)
      renderPanels()
      update()
    })
    right.appendChild(seg)

    const panelBox = el('div')
    panelBox.style.marginTop = '10px'
    right.appendChild(panelBox)

    row.appendChild(right)
    wrap.appendChild(row)

    /* --- 文字面板 --- */
    const textPanel = el('div')
    const charInput = input(state.text || '', '一个字符')
    charInput.style.width = '80px'
    charInput.style.textAlign = 'center'
    charInput.addEventListener('input', () => {
      state.text = charInput.value.slice(0, 2)
      update()
    })
    const bgRow = el('div', 'swatch-row')
    const fgRow = el('div', 'swatch-row')
    let bgSwatches, fgSwatches
    function buildSwatches (container, key, isFg) {
      container.innerHTML = ''
      const list = isFg ? ['#ffffff', '#2c2c2a'].concat(colors) : colors
      const nodes = list.map(c => {
        const i = el('i')
        i.style.background = c
        if ((state[key] || '').toLowerCase() === c.toLowerCase()) i.classList.add('on')
        i.addEventListener('click', () => {
          state[key] = c
          nodes.forEach(n => n.classList.remove('on'))
          i.classList.add('on')
          update()
        })
        container.appendChild(i)
        return i
      })
      return nodes
    }
    const charRow = el('div', 'row')
    charRow.appendChild(field('字符', charInput))
    textPanel.appendChild(charRow)
    textPanel.appendChild(field('背景色', bgRow))
    textPanel.appendChild(field('文字颜色', fgRow))

    /* --- 字形面板 --- */
    const glyphPanel = el('div')
    const kinds = ['folder', 'generic', 'image', 'video', 'audio', 'doc', 'sheet', 'slide', 'code', 'archive', 'app', 'url']
    const kindChips = el('div', 'chips')
    const kindNodes = kinds.map(k => {
      const c = el('div', 'chip', esc(k))
      c.addEventListener('click', () => {
        state.kind = k
        kindNodes.forEach(n => n.classList.remove('on'))
        c.classList.add('on')
        update()
      })
      kindChips.appendChild(c)
      return c
    })
    glyphPanel.appendChild(field('图标样式', kindChips))
    const glyphColors = el('div', 'swatch-row')
    glyphPanel.appendChild(field('底色', glyphColors))
    let glyphColorNodes
    function buildGlyphColors () {
      glyphColors.innerHTML = ''
      const list = colors
      glyphColorNodes = list.map(c => {
        const i = el('i')
        i.style.background = c
        if ((state.bg || '').toLowerCase() === c.toLowerCase()) i.classList.add('on')
        i.addEventListener('click', () => {
          state.bg = c
          glyphColorNodes.forEach(n => n.classList.remove('on'))
          i.classList.add('on')
          update()
        })
        glyphColors.appendChild(i)
        return i
      })
    }

    /* --- 图片面板 --- */
    const imgPanel = el('div')
    const pickBtn = el('button', 'btn', '选择图片文件…')
    pickBtn.type = 'button'
    pickBtn.addEventListener('click', async () => {
      const r = S.pickImage()
      if (!r || !r.length) return
      const res = S.readImageAsDataUrl(r[0])
      if (!res || !res.ok) { toast('读取图片失败', 'error'); return }
      const data = await KL.icons.normalize(res.dataUrl, 128)
      if (!data) { toast('这张图没法用', 'error'); return }
      state.data = data
      update()
    })
    const urlBtn = el('button', 'btn', '从图标地址拉取…')
    urlBtn.type = 'button'
    urlBtn.addEventListener('click', async () => {
      const u = await KL.ui.prompt({ title: '图标图片地址', placeholder: 'https://example.com/icon.png', value: 'https://' })
      if (!u) return
      toast('正在拉取…')
      const r = await S.fetchFavicon(u, { service: store.settings.faviconService })
      const src = (r && r.ok) ? r.dataUrl : null
      if (!src) {
        const rr = await S.fetchFavicon(u, {})
        if (!rr || !rr.ok) { toast('拉取失败', 'error'); return }
        const d1 = await KL.icons.normalize(rr.dataUrl, 128)
        if (!d1) { toast('图标格式不支持', 'error'); return }
        state.data = d1
        update()
        return
      }
      const d = await KL.icons.normalize(src, 128)
      if (!d) { toast('图标格式不支持', 'error'); return }
      state.data = d
      update()
    })
    const imgRow = el('div', 'row')
    imgRow.appendChild(pickBtn)
    imgRow.appendChild(urlBtn)
    imgPanel.appendChild(field('自定义图片', imgRow, '支持 PNG / JPG / ICO / SVG / WebP，会自动缩放到 128px'))

    /* --- 自动面板 --- */
    const autoPanel = el('div')
    const refetch = el('button', 'btn', '重新获取图标')
    refetch.type = 'button'
    refetch.addEventListener('click', async () => {
      refetch.disabled = true
      refetch.textContent = '获取中…'
      const data = await KL.icons.extractOne(Object.assign({}, sc, { icon: state }))
      refetch.disabled = false
      refetch.textContent = '重新获取图标'
      if (!data) { toast('没能取到图标，将使用字形图标', 'error'); return }
      state.data = data
      update()
      toast('图标已更新')
    })
    const autoRow = el('div', 'row')
    autoRow.appendChild(refetch)
    autoPanel.appendChild(field('来源', autoRow, '本地文件与快捷方式使用系统图标，网址自动拉取网站图标'))

    function renderPanels () {
      panelBox.innerHTML = ''
      if (state.type === 'text') {
        buildSwatches(bgRow, 'bg', false)
        buildSwatches(fgRow, 'fg', true)
        panelBox.appendChild(textPanel)
      } else if (state.type === 'glyph') {
        kindNodes.forEach((n, i) => n.classList.toggle('on', kinds[i] === (state.kind || 'generic')))
        buildGlyphColors()
        panelBox.appendChild(glyphPanel)
      } else if (state.type === 'data') {
        panelBox.appendChild(imgPanel)
      } else {
        panelBox.appendChild(autoPanel)
      }
    }

    function update () {
      const fake = Object.assign({}, sc, { icon: state })
      let src = null
      if (state.type === 'text') src = KL.icons.letter(state.text || '?', state.bg, state.fg)
      else if (state.type === 'glyph') src = KL.icons.glyph(state.kind || 'generic', state.bg)
      else if (state.type === 'data' && state.data) src = state.data
      else if (state.data) src = state.data
      else src = KL.icons.glyph(KL.icons.kindOfShortcut(fake))
      previewImg.src = src
      if (onChange) onChange(getIcon())
    }

    function getIcon () {
      if (state.type === 'text') return { type: 'text', text: state.text || '?', bg: state.bg || '#534AB7', fg: state.fg || '#ffffff' }
      if (state.type === 'glyph') return { type: 'glyph', kind: state.kind || 'generic', bg: state.bg || '' }
      if (state.type === 'data') return { type: 'data', data: state.data || '' }
      return { type: 'auto', data: state.data || '' }
    }

    renderPanels()
    update()
    return { el: wrap, getIcon: getIcon }
  }

  /* ==================================================================
   * 编辑器
   * ================================================================== */

  function editShortcut (sc, done) {
    const draft = {
      name: sc.name,
      kind: sc.launch.kind === 'url' ? 'url' : (sc.launch.kind === 'appid' ? 'appid' : 'path'),
      target: sc.launch.target,
      args: sc.launch.args || '',
      workDir: sc.launch.workDir || '',
      appId: sc.launch.appId || '',
      categoryId: sc.categoryId,
      col: sc.col,
      row: sc.row,
      note: sc.note || ''
    }

    const body = el('div')
    const nameInput = input(draft.name, '显示名称')
    const targetInput = input(draft.target, '文件路径 / 网址 / 应用 ID')
    const browseBtn = el('button', 'btn', '浏览…')
    browseBtn.type = 'button'
    browseBtn.addEventListener('click', () => {
      const r = S.pickFiles({ multi: false, title: '选择目标' })
      if (!r || !r.length) return
      targetInput.value = r[0]
      if (!nameInput.value.trim()) nameInput.value = stripExt(basename(r[0]))
      onTargetChange()
    })

    const argsInput = input(draft.args, '启动参数（可留空）')
    const workDirInput = input(draft.workDir, '工作目录（可留空）')
    const appIdInput = input(draft.appId, '应用 ID，例如 Microsoft.WindowsCalculator_8wekyb3d8bbwe!App')
    const noteInput = input(draft.note, '备注（可选）')

    const argsField = field('启动参数', argsInput)
    const workDirField = field('工作目录', workDirInput)
    const appIdField = field('应用 ID', appIdInput)
    const browseWrap = el('div', 'row')
    browseWrap.appendChild(targetInput)
    browseWrap.appendChild(browseBtn)
    const targetField = field('目标', browseWrap)

    const kindSeg = segmented([
      { value: 'path', label: '文件 / 文件夹' },
      { value: 'url', label: '网址' },
      { value: 'appid', label: '应用 ID' }
    ], draft.kind, v => {
      draft.kind = v
      applyKind()
      if (v === 'url' && /^[a-z]:\\/i.test(targetInput.value)) targetInput.value = ''
      onTargetChange()
    })

    function applyKind () {
      browseBtn.classList.toggle('hidden', draft.kind !== 'path')
      argsField.classList.toggle('hidden', draft.kind !== 'path')
      workDirField.classList.toggle('hidden', draft.kind !== 'path')
      appIdField.classList.toggle('hidden', draft.kind !== 'appid')
      targetField.classList.toggle('hidden', draft.kind === 'appid')
      targetInput.placeholder = draft.kind === 'url' ? 'https://example.com' : 'C:\\path\\to\\file'
    }

    const catSelect = select(
      [{ value: '', label: '未分类' }].concat(store.categories.map(c => ({ value: c.id, label: c.name }))),
      draft.categoryId || ''
    )
    const sizeChips = el('div', 'chips')
    const sizes = [[1, 1], [2, 1], [1, 2], [2, 2], [3, 1], [3, 2], [2, 3], [3, 3]]
    const sizeNodes = sizes.map(s => {
      const c = el('div', 'chip', s[0] + ' × ' + s[1])
      if (s[0] === draft.col && s[1] === draft.row) c.classList.add('on')
      c.addEventListener('click', () => {
        draft.col = s[0]
        draft.row = s[1]
        sizeNodes.forEach(n => n.classList.remove('on'))
        c.classList.add('on')
      })
      sizeChips.appendChild(c)
      return c
    })

    const iconEditor = buildIconEditor(sc, () => {})
    body.appendChild(iconEditor.el)
    body.appendChild(el('div', '', '<div style="height:16px"></div>'))

    body.appendChild(field('名称', nameInput))
    body.appendChild(field('目标类型', kindSeg))
    body.appendChild(targetField)
    body.appendChild(appIdField)
    const argsRow = el('div', 'row')
    argsRow.style.alignItems = 'flex-start'
    argsField.style.flex = '1 1 auto'
    workDirField.style.flex = '1 1 auto'
    argsRow.appendChild(argsField)
    argsRow.appendChild(workDirField)
    body.appendChild(argsRow)

    const metaRow = el('div', 'row')
    metaRow.style.alignItems = 'flex-start'
    const catField = field('分类', catSelect)
    catField.style.flex = '0 0 160px'
    metaRow.appendChild(catField)
    const sizeField = field('图标尺寸', sizeChips)
    sizeField.style.flex = '1 1 auto'
    metaRow.appendChild(sizeField)
    body.appendChild(metaRow)
    body.appendChild(field('备注', noteInput))

    const previewLabel = el('div', 'hint')
    function onTargetChange () {
      if (draft.kind === 'path') {
        const info = S.pathInfo(targetInput.value.trim())
        previewLabel.textContent = !targetInput.value.trim() ? '' : (info.exists ? (info.isDir ? '文件夹存在' : '文件存在') : '路径不存在')
        previewLabel.style.color = (!targetInput.value.trim() || info.exists) ? '' : 'var(--danger)'
      } else if (draft.kind === 'url') {
        previewLabel.textContent = /^https?:\/\//i.test(targetInput.value.trim()) ? '' : '建议以 http:// 或 https:// 开头'
        previewLabel.style.color = ''
      } else {
        previewLabel.textContent = ''
      }
    }
    targetField.appendChild(previewLabel)
    targetInput.addEventListener('input', onTargetChange)
    applyKind()
    onTargetChange()

    const api = KL.ui.modal({
      title: '编辑快捷方式',
      size: 'wide',
      body: body,
      buttons: function (foot, m) {
        const del = el('button', 'btn danger', '删除')
        del.addEventListener('click', async () => {
          const ok = await KL.ui.confirm({ title: '删除快捷方式', text: '确定删除「' + sc.name + '」吗？', okText: '删除', danger: true })
          if (!ok) return
          store.removeShortcut(sc.id)
          m.close()
          done && done()
        })
        const grow = el('div', 'grow')
        const cancel = el('button', 'btn', '取消')
        cancel.addEventListener('click', () => m.close())
        const save = el('button', 'btn primary', '保存')
        save.addEventListener('click', () => {
          const target = targetInput.value.trim()
          const appId = appIdInput.value.trim()
          if (draft.kind === 'appid' && !appId) { toast('请填写应用 ID', 'error'); return }
          if (draft.kind !== 'appid' && !target) { toast('请填写目标', 'error'); return }
          const name = nameInput.value.trim() || stripExt(basename(target || appId))
          const launch = draft.kind === 'url'
            ? { kind: 'url', target: target, args: '', workDir: '', appId: '' }
            : draft.kind === 'appid'
              ? { kind: 'appid', target: 'shell:AppsFolder\\' + appId, appId: appId, args: '', workDir: '' }
              : { kind: 'path', target: target, args: argsInput.value.trim(), workDir: workDirInput.value.trim(), appId: '' }
          const icon = iconEditor.getIcon()
          store.updateShortcut(sc.id, {
            name: name,
            launch: launch,
            icon: icon,
            categoryId: catSelect.value || null,
            col: draft.col,
            row: draft.row,
            note: noteInput.value.trim()
          })
          m.close()
          done && done()
          if (icon.type === 'auto' && !icon.data) {
            KL.icons.ensure(store.getShortcut(sc.id), { force: true }).then(data => {
              if (data) KL.grid.refreshTile(sc.id)
            })
          }
        })
        foot.appendChild(del)
        foot.appendChild(grow)
        foot.appendChild(cancel)
        foot.appendChild(save)
      }
    })
    return api
  }

  function iconPicker (sc, done) {
    const wrap = el('div')
    const editor = buildIconEditor(sc, () => {})
    wrap.appendChild(editor.el)
    KL.ui.modal({
      title: '自定义图标',
      subtitle: sc.name,
      size: 'narrow',
      body: wrap,
      buttons: function (foot, m) {
        const reset = el('button', 'btn', '恢复默认图标')
        reset.addEventListener('click', () => {
          const data = sc.icon && sc.icon.data ? sc.icon.data : ''
          store.updateShortcut(sc.id, { icon: { type: 'auto', data: data } })
          m.close()
          done && done()
        })
        const grow = el('div', 'grow')
        const cancel = el('button', 'btn', '取消')
        cancel.addEventListener('click', () => m.close())
        const save = el('button', 'btn primary', '保存')
        save.addEventListener('click', () => {
          store.updateShortcut(sc.id, { icon: editor.getIcon() })
          m.close()
          done && done()
        })
        foot.appendChild(reset)
        foot.appendChild(grow)
        foot.appendChild(cancel)
        foot.appendChild(save)
      }
    })
  }

  /* ==================================================================
   * 导入（拖拽 / 选择文件 / 剪贴板）
   * ================================================================== */

  async function ingestPaths (paths, opts) {
    const o = opts || {}
    const list = (paths || []).filter(Boolean)
    if (!list.length) return { added: 0, skipped: 0 }
    const catId = o.categoryId === undefined ? currentCategoryId() : o.categoryId
    const res = await S.resolvePaths(list)
    const rows = (res && res.items) || []
    const added = []
    const iconJobs = []
    let skipped = 0
    const names = []

    store.batch(() => {
      for (const r of rows) {
        if (!r || !r.ok) { skipped++; continue }
        const il = KL.icons.parseIconLocation(r.iconLocation)
        let name = stripExt(basename(r.path))
        if (r.kind === 'file' && !/\.(lnk|url|appref-ms)$/i.test(r.path) && !/\.exe$/i.test(r.path)) name = basename(r.path)
        const launch = r.kind === 'url'
          ? { kind: 'url', target: r.target, args: '', workDir: '', appId: '' }
          : { kind: 'path', target: r.target, args: r.args || '', workDir: r.workDir || '', appId: '' }
        if (r.target && store.findByTarget(r.target)) { skipped++; continue }
        if (r.kind === 'url' && store.findByUrl(r.target)) { skipped++; continue }
        const sc = store.addShortcut({
          name: name || '未命名',
          launch: launch,
          originalPath: r.path,
          iconLocation: r.iconLocation || '',
          categoryId: catId,
          icon: { type: 'auto' },
          source: o.source || 'manual'
        })
        sc.iconLocation = r.iconLocation || ''
        added.push(sc)
        names.push(sc.name)
        if (r.kind === 'url') {
          const job = { id: sc.id, url: r.target }
          // 仅当 IconFile 是独立图片时才作为 favicon 的兜底（Steam 的 .ico、微信小程序等）
          if (il.path && /\.(ico|png)$/i.test(il.path)) job.iconPath = il.path
          iconJobs.push(job)
        } else {
          // 一律用原始文件本身提取（.lnk 交给 Shell 解析它自己指定的图标）。
          // 切勿使用 IconLocation 的 "路径,索引"：那个索引与 shell 图标索引无关。
          iconJobs.push({ id: sc.id, path: r.path, iconPath: r.path })
        }
      }
    })

    if (added.length) toast('已添加 ' + added.length + ' 个快捷方式' + (skipped ? '（跳过 ' + skipped + ' 个重复/无效项）' : ''))
    else if (skipped) toast('没有可添加的项目（' + skipped + ' 个重复或无效）', 'error')

    if (added.length) hydrate(added, iconJobs)
    return { added: added.length, skipped: skipped }
  }

  function hydrate (shortcuts, jobs) {
    const local = []
    const remote = []
    for (const j of jobs) {
      if (j.url) remote.push(j)
      else local.push(j)
    }
    if (local.length) {
      KL.icons.extractBatch(local.map(j => ({ path: j.path, iconPath: j.iconPath }))).then(results => {
        results.forEach((data, i) => {
          const job = local[i]
          if (!data || !job) return
          KL.icons.normalize(data, 128).then(norm => {
            if (!norm) return
            store.updateShortcut(job.id, { icon: { type: 'auto', data: norm } }, { silent: true })
            KL.grid.refreshTile(job.id)
          })
        })
      }).catch(e => console.error(e))
    }
    if (remote.length) {
      let done = 0
      const total = remote.length
      const concurrency = 4
      let index = 0
      const next = () => {
        if (index >= remote.length) return
        const job = remote[index++]
        const sc = store.getShortcut(job.id)
        if (!sc) { next(); return }
        KL.icons.extractOne(sc).then(async data => {
          // 网址图标抓取失败时，回退到本地图标（如 .lnk 带的 IconLocation）
          if (!data && job.iconPath && S.exists(job.iconPath)) {
            const res = await KL.icons.extractBatch([{ path: job.iconPath, iconPath: job.iconPath }])
            if (res && res[0]) data = await KL.icons.normalize(res[0], 128)
          }
          if (data) {
            store.updateShortcut(job.id, { icon: { type: 'auto', data: data } }, { silent: true })
            KL.grid.refreshTile(job.id)
          }
          done++
          KL.ui.progress(done, total)
        }).catch(() => {}).then(next)
      }
      for (let i = 0; i < Math.min(concurrency, remote.length); i++) next()
    }
  }

  async function addFromFiles () {
    const r = S.pickFiles({ multi: true, title: '选择要添加的文件或文件夹' })
    if (!r || !r.length) return
    await ingestPaths(r, {})
  }

  function addUrl () {
    const longForm = el('div')
    const urlInput = input('https://', 'https://example.com')
    const nameInput = input('', '留空则自动使用网站标题')
    const catSelect = select(
      [{ value: '', label: '未分类' }].concat(store.categories.map(c => ({ value: c.id, label: c.name }))),
      currentCategoryId() || ''
    )
    longForm.appendChild(field('网址', urlInput, '支持 http / https'))
    longForm.appendChild(field('名称', nameInput))
    longForm.appendChild(field('分类', catSelect))

    const api = KL.ui.modal({
      title: '添加网址',
      size: 'narrow',
      body: longForm,
      buttons: function (foot, m) {
        const grow = el('div', 'grow')
        const cancel = el('button', 'btn', '取消')
        cancel.addEventListener('click', () => m.close())
        const ok = el('button', 'btn primary', '添加')
        ok.addEventListener('click', () => {
          let u = urlInput.value.trim()
          if (!u) { toast('请填写网址', 'error'); return }
          if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(u)) u = 'https://' + u
          m.close()
          addUrlQuick(u, nameInput.value.trim(), catSelect.value || null)
        })
        foot.appendChild(grow)
        foot.appendChild(cancel)
        foot.appendChild(ok)
      },
      onMount: () => setTimeout(() => urlInput.focus(), 40)
    })
    return api
  }

  async function addUrlQuick (url, name, categoryId) {
    if (store.findByUrl(url)) {
      toast('这个网址已经在列表里了', 'error')
      return null
    }
    let host = url
    try { host = new URL(url).hostname.replace(/^www\./, '') } catch (e) {}
    const sc = store.addShortcut({
      name: name || host,
      launch: { kind: 'url', target: url },
      categoryId: categoryId === undefined ? currentCategoryId() : categoryId,
      icon: { type: 'auto' },
      source: 'url'
    })
    toast('已添加 ' + sc.name)
    hydrate([sc], [{ id: sc.id, url: url }])
    return sc
  }

  function addFromClipboard () {
    const clip = S.readClipboard()
    if (clip && clip.files && clip.files.length) {
      ingestPaths(clip.files, {})
      return
    }
    const text = (clip && clip.text || '').trim()
    if (!text) { toast('剪贴板里没有内容', 'error'); return }
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
    const urls = lines.filter(l => /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(l))
    if (urls.length === lines.length && urls.length > 0) {
      store.batch(() => {
        for (const u of urls) {
          try { const h = new URL(u).hostname.replace(/^www\./, ''); addUrlQuick(u, h, currentCategoryId()) } catch (e) {}
        }
      })
      return
    }
    const paths = lines.filter(l => /^[a-zA-Z]:[\\/]/.test(l) || /^\\\\/.test(l))
    if (paths.length) {
      ingestPaths(paths, {})
      return
    }
    if (lines.length === 1 && /\./.test(lines[0]) && !/\s/.test(lines[0])) {
      addUrlQuick(/^https?:/.test(lines[0]) ? lines[0] : 'https://' + lines[0], '', currentCategoryId())
      return
    }
    toast('剪贴板内容无法识别为路径或网址', 'error')
  }

  /* ==================================================================
   * 扫描本机应用
   * ================================================================== */

  function scanApps () {
    const body = el('div')
    const sourceChips = el('div', 'chips')
    const sources = [
      { key: 'startmenu', label: '开始菜单快捷方式' },
      { key: 'startapps', label: '应用列表（含 UWP）' },
      { key: 'desktop', label: '桌面快捷方式' },
      { key: 'registry', label: '已安装程序' }
    ]
    const chosen = { startmenu: true, startapps: true, desktop: false, registry: true }
    const chipNodes = {}
    for (const s of sources) {
      const c = el('div', 'chip' + (chosen[s.key] ? ' on' : ''), esc(s.label))
      c.addEventListener('click', () => {
        chosen[s.key] = !chosen[s.key]
        c.classList.toggle('on', chosen[s.key])
      })
      chipNodes[s.key] = c
      sourceChips.appendChild(c)
    }
    body.appendChild(field('扫描来源', sourceChips))

    const scanRow = el('div', 'row')
    const scanBtn = el('button', 'btn primary', '开始扫描')
    scanBtn.type = 'button'
    const status = el('div', 'stat')
    scanRow.appendChild(scanBtn)
    scanRow.appendChild(status)
    body.appendChild(field('', scanRow, '扫描在本机进行，不会联网'))

    const searchInput = input('', '筛选应用名称或路径…')
    const listWrap = el('div', 'list')
    listWrap.style.maxHeight = '300px'
    const searchField = field('', searchInput)
    searchField.classList.add('hidden')
    body.appendChild(searchField)
    body.appendChild(listWrap)

    const statLine = el('div', 'toolbar-line')
    const selectAllBtn = el('button', 'btn', '全选')
    const invertBtn = el('button', 'btn', '反选')
    const clearBtn = el('button', 'btn', '清空选择')
    const countLabel = el('div', 'stat')
    statLine.appendChild(countLabel)
    statLine.appendChild(el('div', 'grow'))
    statLine.appendChild(selectAllBtn)
    statLine.appendChild(invertBtn)
    statLine.appendChild(clearBtn)
    statLine.classList.add('hidden')
    body.appendChild(statLine)

    let results = []
    const picked = new Set()

    function renderList () {
      const kw = searchInput.value.trim().toLowerCase()
      const filtered = results.filter(r => !kw || r.name.toLowerCase().indexOf(kw) >= 0 || String(r.target).toLowerCase().indexOf(kw) >= 0)
      listWrap.innerHTML = ''
      if (!filtered.length) {
        listWrap.appendChild(el('div', '', '<div class="stat" style="padding:14px">' + (results.length ? '没有匹配的项' : '还没有扫描结果') + '</div>'))
        return
      }
      for (const r of filtered) {
        const row = el('div', 'list-item' + (picked.has(r.id) ? ' on' : ''))
        const check = el('div', 'check', ICONS.check)
        const iconBox = el('div', 'li-icon')
        const im = el('img')
        if (r.preview) {
          im.src = r.preview
        } else {
          im.src = KL.icons.glyph(r.kind === 'appid' ? 'app' : KL.icons.kindOfShortcut({ launch: { kind: 'path', target: r.target } }))
        }
        iconBox.appendChild(im)
        const main = el('div', 'li-main')
        const nm = el('div', 'li-name')
        nm.textContent = r.name
        const sub = el('div', 'li-sub')
        sub.textContent = r.target
        sub.title = r.target
        main.appendChild(nm)
        main.appendChild(sub)
        const tag = el('div', 'li-tag', esc(r.sourceLabel))
        row.appendChild(check)
        row.appendChild(iconBox)
        row.appendChild(main)
        row.appendChild(tag)
        row.addEventListener('click', () => {
          if (picked.has(r.id)) picked.delete(r.id)
          else picked.add(r.id)
          row.classList.toggle('on', picked.has(r.id))
          updateCount()
        })
        listWrap.appendChild(row)
      }
      updateCount()
    }

    function updateCount () {
      countLabel.textContent = results.length ? ('共 ' + results.length + ' 项，已选 ' + picked.size + ' 项') : ''
    }

    searchInput.addEventListener('input', renderList)
    selectAllBtn.addEventListener('click', () => {
      results.forEach(r => picked.add(r.id))
      renderList()
    })
    invertBtn.addEventListener('click', () => {
      results.forEach(r => { if (picked.has(r.id)) picked.delete(r.id); else picked.add(r.id) })
      renderList()
    })
    clearBtn.addEventListener('click', () => { picked.clear(); renderList() })

    const sourceLabels = { startmenu: '开始菜单', desktop: '桌面', startapps: '应用列表', uwp: 'UWP', registry: '注册表', installed: '已安装' }

    scanBtn.addEventListener('click', async () => {
      const list = Object.keys(chosen).filter(k => chosen[k])
      if (!list.length) { toast('至少选择一个扫描来源', 'error'); return }
      scanBtn.disabled = true
      scanBtn.textContent = '扫描中…'
      status.textContent = '正在读取系统信息，请稍候…'
      const t0 = Date.now()
      const r = await S.scanApps(list)
      scanBtn.disabled = false
      scanBtn.textContent = '重新扫描'
      if (!r || !r.ok) {
        status.textContent = '扫描失败：' + ((r && r.error) || '未知错误')
        return
      }
      let n = 0
      results = r.items.filter(it => {
        if (it.source === 'desktop' && list.indexOf('desktop') < 0) return false
        return true
      }).map(it => ({
        id: 'a' + (n++),
        name: it.name,
        source: it.source,
        sourceLabel: sourceLabels[it.source] || it.source,
        kind: it.kind,
        target: it.target,
        appId: it.appId || '',
        iconPath: it.iconPath || it.target,
        iconFile: it.iconFile || ''
      }))
      status.textContent = '扫到 ' + results.length + ' 项，用时 ' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒'
      searchField.classList.remove('hidden')
      statLine.classList.remove('hidden')
      renderList()
      prefetchIcons()
    })

    async function prefetchIcons () {
      const batch = results.slice(0, 400)
      const jobs = batch.map(r => r.iconFile ? { imageFile: r.iconFile } : { path: r.iconPath, iconPath: r.iconPath })
      try {
        const data = await KL.icons.extractBatch(jobs)
        data.forEach((d, i) => {
          if (d && batch[i]) batch[i].preview = d
        })
        renderList()
      } catch (e) {}
    }

    KL.ui.modal({
      title: '扫描本机应用',
      size: 'wide',
      body: body,
      buttons: function (foot, m) {
        const grow = el('div', 'grow')
        const cancel = el('button', 'btn', '关闭')
        cancel.addEventListener('click', () => m.close())
        const ok = el('button', 'btn primary', '导入选中项')
        ok.addEventListener('click', async () => {
          const items = results.filter(r => picked.has(r.id))
          if (!items.length) { toast('还没有选择任何应用', 'error'); return }
          m.close()
          await ingestApps(items)
        })
        foot.appendChild(grow)
        foot.appendChild(cancel)
        foot.appendChild(ok)
      }
    })
  }

  async function ingestApps (items) {
    const catId = currentCategoryId()
    const added = []
    const iconJobs = []
    store.batch(() => {
      for (const it of items) {
        const launch = it.kind === 'appid'
          ? { kind: 'appid', target: 'shell:AppsFolder\\' + it.appId, appId: it.appId, args: '', workDir: '' }
          : { kind: 'path', target: it.target, args: '', workDir: '' }
        if (it.target && store.findByTarget(it.target)) continue
        const sc = store.addShortcut({
          name: it.name,
          launch: launch,
          originalPath: it.iconPath || it.target,
          categoryId: catId,
          icon: { type: 'auto' },
          source: 'scan'
        })
        added.push(sc)
        iconJobs.push(it.iconFile ? { id: sc.id, imageFile: it.iconFile } : { id: sc.id, path: it.iconPath || it.target, iconPath: it.iconPath || it.target })
      }
    })
    toast('已导入 ' + added.length + ' 个应用')
    if (!added.length) return
    const jobs = iconJobs.filter(j => j.imageFile || j.path)
    const imgJobs = jobs.filter(j => j.imageFile)
    const localJobs = jobs.filter(j => !j.imageFile && j.path)
    for (const j of imgJobs) {
      const r = S.readImageAsDataUrl(j.imageFile)
      if (r && r.ok) {
        KL.icons.normalize(r.dataUrl, 128).then(d => {
          if (!d) return
          store.updateShortcut(j.id, { icon: { type: 'auto', data: d } }, { silent: true })
          KL.grid.refreshTile(j.id)
        })
      }
    }
    if (localJobs.length) {
      KL.icons.extractBatch(localJobs.map(j => ({ path: j.path, iconPath: j.iconPath }))).then(results => {
        results.forEach((d, i) => {
          const job = localJobs[i]
          if (!d || !job) return
          KL.icons.normalize(d, 128).then(norm => {
            if (!norm) return
            store.updateShortcut(job.id, { icon: { type: 'auto', data: norm } }, { silent: true })
            KL.grid.refreshTile(job.id)
          })
        })
      })
    }
  }

  /* ==================================================================
   * 浏览器收藏夹
   * ================================================================== */

  function importBookmarks () {
    const body = el('div')
    const status = el('div', 'stat', '正在读取浏览器收藏夹…')
    body.appendChild(status)
    const bodyHost = el('div')
    body.appendChild(bodyHost)
    let picked = new Set()
    let treeData = null
    let srcIndex = 0
    let specs = []

    const listWrap = el('div', 'list')
    listWrap.style.maxHeight = '330px'
    const searchInput = input('', '筛选标题或网址…')
    const searchField = field('', searchInput)
    searchField.classList.add('hidden')
    bodyHost.appendChild(searchField)
    bodyHost.appendChild(listWrap)

    const statLine = el('div', 'toolbar-line')
    const countLabel = el('div', 'stat')
    const allBtn = el('button', 'btn', '全选本页')
    const noneBtn = el('button', 'btn', '清空选择')
    statLine.appendChild(countLabel)
    statLine.appendChild(el('div', 'grow'))
    statLine.appendChild(allBtn)
    statLine.appendChild(noneBtn)
    statLine.classList.add('hidden')
    bodyHost.appendChild(statLine)

    function buildTree (urls) {
      const root = { name: '', children: {}, items: [] }
      for (const u of urls) {
        const path = u.folderPath || []
        let node = root
        for (const seg of path) {
          if (!node.children[seg]) node.children[seg] = { name: seg, children: {}, items: [] }
          node = node.children[seg]
        }
        node.items.push(u)
      }
      return root
    }

    function collect (node, out) {
      for (const u of node.items) out.push(u)
      for (const k in node.children) collect(node.children[k], out)
      return out
    }

    function renderTree () {
      const kw = searchInput.value.trim().toLowerCase()
      listWrap.innerHTML = ''
      const spec = specs[srcIndex]
      if (!spec) return
      if (!treeData) treeData = buildTree(spec.urls)
      const filtered = kw
        ? spec.urls.filter(u => (u.title || '').toLowerCase().indexOf(kw) >= 0 || u.url.toLowerCase().indexOf(kw) >= 0)
        : collect(treeData, [])

      const flat = kw ? filtered : null
      if (flat) {
        for (const u of flat) listWrap.appendChild(itemRow(u))
      } else {
        const walk = (node, container) => {
          for (const k in node.children) {
            const child = node.children[k]
            const group = el('div', 'tree-folder')
            const head = el('div', 'folder-head')
            const tw = el('span', 'tw', '▾')
            const cb = el('div', 'check', ICONS.check)
            const nm = el('span', '', esc(child.name))
            const cnt = el('span', 'li-tag', String(collect(child, []).length))
            head.appendChild(tw)
            head.appendChild(cb)
            head.appendChild(nm)
            head.appendChild(cnt)
            const kids = el('div', 'folder-kids')
            const inner = collect(child, [])
            const allOn = inner.length > 0 && inner.every(u => picked.has(u.url))
            cb.classList.toggle('on', allOn)
            head.addEventListener('click', e => {
              if (e.target === tw) {
                kids.classList.toggle('collapsed')
                tw.textContent = kids.classList.contains('collapsed') ? '▸' : '▾'
                return
              }
              const on = !inner.every(u => picked.has(u.url))
              inner.forEach(u => { if (on) picked.add(u.url); else picked.delete(u.url) })
              renderTree()
            })
            tw.addEventListener('click', e => {
              e.stopPropagation()
              kids.classList.toggle('collapsed')
              tw.textContent = kids.classList.contains('collapsed') ? '▸' : '▾'
            })
            group.appendChild(head)
            for (const u of child.items) kids.appendChild(itemRow(u))
            walk(child, kids)
            group.appendChild(kids)
            container.appendChild(group)
          }
        }
        walk(treeData, listWrap)
        for (const u of treeData.items) listWrap.appendChild(itemRow(u))
      }
      updateCount()
    }

    function itemRow (u) {
      const row = el('div', 'list-item' + (picked.has(u.url) ? ' on' : ''))
      const check = el('div', 'check', ICONS.check)
      const iconBox = el('div', 'li-icon')
      const im = el('img')
      im.src = KL.icons.glyph('url')
      iconBox.appendChild(im)
      const main = el('div', 'li-main')
      const nm = el('div', 'li-name')
      nm.textContent = u.title || u.url
      const sub = el('div', 'li-sub')
      sub.textContent = u.url
      sub.title = u.url
      main.appendChild(nm)
      main.appendChild(sub)
      row.appendChild(check)
      row.appendChild(iconBox)
      row.appendChild(main)
      row.addEventListener('click', () => {
        if (picked.has(u.url)) picked.delete(u.url)
        else picked.add(u.url)
        row.classList.toggle('on', picked.has(u.url))
        updateCount()
      })
      return row
    }

    function updateCount () {
      const spec = specs[srcIndex]
      if (!spec) return
      countLabel.textContent = '已选 ' + picked.size + ' / ' + spec.urls.length + ' 条'
    }

    searchInput.addEventListener('input', renderTree)
    allBtn.addEventListener('click', () => {
      const spec = specs[srcIndex]
      if (!spec) return
      spec.urls.forEach(u => picked.add(u.url))
      renderTree()
    })
    noneBtn.addEventListener('click', () => { picked.clear(); renderTree() })

    function loadSources () {
      const r = S.readBookmarks()
      const sources = (r && r.sources) || []
      if (!sources.length) {
        status.textContent = '没有找到可读取的浏览器收藏夹（支持 Chrome / Edge / Brave / Vivaldi / Chromium 等）'
        return
      }
      specs = sources
      status.textContent = '找到 ' + sources.length + ' 个收藏夹数据源'
      const srcChips = el('div', 'chips')
      srcChips.style.marginBottom = '10px'
      sources.forEach((s, i) => {
        const c = el('div', 'chip' + (i === 0 ? ' on' : ''), esc(s.browser + ' · ' + s.profile + '（' + s.count + '）'))
        c.addEventListener('click', () => {
          Array.from(srcChips.children).forEach(x => x.classList.remove('on'))
          c.classList.add('on')
          srcIndex = i
          treeData = null
          renderTree()
        })
        srcChips.appendChild(c)
      })
      bodyHost.insertBefore(srcChips, searchField)
      searchField.classList.remove('hidden')
      statLine.classList.remove('hidden')
      renderTree()
    }

    const api = KL.ui.modal({
      title: '导入浏览器收藏夹',
      size: 'wide',
      body: body,
      buttons: function (foot, m) {
        const grow = el('div', 'grow')
        const cancel = el('button', 'btn', '关闭')
        cancel.addEventListener('click', () => m.close())
        const ok = el('button', 'btn primary', '导入选中项')
        ok.addEventListener('click', async () => {
          const spec = specs[srcIndex]
          if (!spec) return
          const urls = spec.urls.filter(u => picked.has(u.url))
          if (!urls.length) { toast('还没有选择任何书签', 'error'); return }
          m.close()
          await ingestUrls(urls)
        })
        foot.appendChild(grow)
        foot.appendChild(cancel)
        foot.appendChild(ok)
      },
      onMount: () => setTimeout(loadSources, 60)
    })
    return api
  }

  async function ingestUrls (urls) {
    const catId = currentCategoryId()
    const added = []
    const jobs = []
    store.batch(() => {
      for (const u of urls) {
        if (store.findByUrl(u.url)) continue
        let host = u.url
        try { host = new URL(u.url).hostname.replace(/^www\./, '') } catch (e) {}
        const sc = store.addShortcut({
          name: u.title || host,
          launch: { kind: 'url', target: u.url },
          categoryId: catId,
          icon: { type: 'auto' },
          source: 'bookmark'
        })
        added.push(sc)
        jobs.push({ id: sc.id, url: u.url })
      }
    })
    toast('已导入 ' + added.length + ' 条书签' + (urls.length - added.length ? '（跳过重复 ' + (urls.length - added.length) + ' 条）' : ''))
    if (added.length) hydrate(added, jobs)
  }

  /* ==================================================================
   * 分类
   * ================================================================== */

  /* ==================================================================
   * 文件夹
   * ================================================================== */

  function newFolder () {
    KL.ui.prompt({ title: '新建文件夹', value: '新建文件夹', placeholder: '文件夹名称', okText: '创建' }).then(name => {
      if (name == null || !name) return
      const cat = KL.grid.getCategory()
      store.createFolder({ name: name, categoryId: (cat === 'all' || cat === 'none') ? null : cat })
      KL.app.renderSidebar()
      KL.grid.render()
      toast('已创建「' + name + '」')
    })
  }

  // 小文件夹（1×1）的内容视图：点开后才能操作其中的图标
  function folderView (folderId) {
    const folder = store.getShortcut(folderId)
    if (!folder) return
    const body = el('div')

    const head = el('div', 'fv-head')
    const countEl = el('span', 'fv-count', '')
    const renameBtn = el('button', 'btn', '重命名')
    const colorBtn = el('button', 'btn', '背景色')
    const sizeBtn = el('button', 'btn', '尺寸')
    head.appendChild(countEl)
    head.appendChild(el('div', 'grow'))
    head.appendChild(renameBtn)
    head.appendChild(colorBtn)
    head.appendChild(sizeBtn)
    body.appendChild(head)

    const gridEl = el('div', 'fv-grid')
    body.appendChild(gridEl)

    function refresh () {
      const kids = store.childrenOf(folderId)
      countEl.textContent = kids.length + ' 项'
      gridEl.innerHTML = ''
      if (!kids.length) {
        gridEl.appendChild(el('div', 'fv-empty', '这个文件夹还是空的'))
        return
      }
      for (const k of kids) {
        const item = el('div', 'fv-item')
        const img = el('img')
        img.src = KL.icons.resolve(k)
        img.draggable = false
        item.appendChild(img)
        const nm = el('div', 'fv-name')
        nm.textContent = k.name
        nm.title = k.name
        item.appendChild(nm)
        item.addEventListener('click', () => KL.grid.launch(k))
        item.addEventListener('contextmenu', e => {
          e.preventDefault()
          e.stopPropagation()
          KL.ui.menu([
            { label: '打开', onClick: () => KL.grid.launch(k) },
            { separator: true },
            { label: '移出文件夹', onClick: () => { store.setParent([k.id], null); toast('已移出'); refresh(); KL.grid.render() } },
            { label: '编辑…', onClick: () => editShortcut(k, () => { refresh(); KL.grid.render() }) },
            {
              label: '刷新图标',
              onClick: async () => {
                const d = await KL.icons.ensure(k, { force: true })
                if (d) { toast('图标已更新'); refresh() } else toast('没能取到图标', 'error')
              }
            },
            { separator: true },
            {
              label: '删除',
              danger: true,
              onClick: async () => {
                const ok = await KL.ui.confirm({ title: '删除', text: '确定删除「' + k.name + '」吗？', okText: '删除', danger: true })
                if (!ok) return
                store.removeShortcut(k.id)
                refresh()
                KL.grid.render()
              }
            }
          ], { x: e.clientX, y: e.clientY })
        })
        gridEl.appendChild(item)
      }
    }

    renameBtn.addEventListener('click', async () => {
      const n = await KL.ui.prompt({ title: '重命名文件夹', value: folder.name, okText: '保存' })
      if (n == null || !n) return
      store.updateShortcut(folderId, { name: n })
      api.box.querySelector('.modal-head h2').textContent = n
      KL.grid.render()
    })
    colorBtn.addEventListener('click', e => {
      const r = colorBtn.getBoundingClientRect()
      KL.ui.menu(['', '#534AB7', '#185FA5', '#0F6E56', '#993C1D', '#993556', '#3B6D11', '#854F0B', '#5F5E5A'].map(c => ({
        label: c || '无（默认）',
        onClick: () => { store.updateShortcut(folderId, { color: c }); KL.grid.render() }
      })), { x: r.left, y: r.bottom + 4 })
    })
    sizeBtn.addEventListener('click', e => {
      const r = sizeBtn.getBoundingClientRect()
      KL.ui.menu([[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [3, 3], [4, 3], [4, 4]].map(p => ({
        label: p[0] + ' × ' + p[1] + (p[0] * p[1] === 1 ? '（小文件夹）' : '（大文件夹）'),
        onClick: () => { store.updateShortcut(folderId, { col: p[0], row: p[1] }); KL.grid.render(); toast('尺寸已调整') }
      })), { x: r.left, y: r.bottom + 4 })
    })

    const api = KL.ui.modal({
      title: folder.name,
      size: 'wide',
      body: body,
      buttons: function (foot, m) {
        foot.appendChild(el('div', 'grow'))
        const done = el('button', 'btn primary', '完成')
        done.addEventListener('click', () => m.close())
        foot.appendChild(done)
      }
    })
    refresh()
  }

  async function newCategory () {
    const name = await KL.ui.prompt({ title: '新建分类', placeholder: '分类名称' })
    if (!name) return null
    const c = store.addCategory(name)
    KL.app.renderSidebar()
    KL.app.setCategory(c.id)
    return c
  }

  async function renameCategory (cat) {
    const name = await KL.ui.prompt({ title: '重命名分类', value: cat.name })
    if (!name) return
    store.updateCategory(cat.id, { name: name })
    KL.app.renderSidebar()
  }

  async function deleteCategory (cat) {
    const n = store.countByCategory(cat.id)
    const ok = await KL.ui.confirm({
      title: '删除分类',
      text: n ? '「' + cat.name + '」里有 ' + n + ' 个快捷方式，删除分类后它们会变成未分类。' : '确定删除分类「' + cat.name + '」吗？',
      okText: '删除',
      danger: true
    })
    if (!ok) return
    store.removeCategory(cat.id)
    if (KL.grid.getCategory() === cat.id) KL.app.setCategory('all')
    else KL.app.renderSidebar()
  }

  function categoryMenu (cat, x, y) {
    const palette = KL.icons.PALETTE
    KL.ui.menu([
      { label: '重命名', onClick: () => renameCategory(cat) },
      {
        label: '颜色',
        custom: holder => {
          const wrap = el('div', 'swatches')
          palette.forEach(c => {
            const i = el('i')
            i.style.background = c
            if (c.toLowerCase() === String(cat.color).toLowerCase()) i.style.outline = '2px solid var(--text)'
            i.addEventListener('click', () => {
              store.updateCategory(cat.id, { color: c })
              KL.app.renderSidebar()
              KL.ui.closeMenu()
            })
            wrap.appendChild(i)
          })
          holder.appendChild(wrap)
        }
      },
      { separator: true },
      { label: '删除分类', danger: true, onClick: () => deleteCategory(cat) }
    ], { x: x, y: y })
  }

  /* ==================================================================
   * 设置
   * ================================================================== */

  /* ==================================================================
   * 图标重建 / 更新日志
   * ================================================================== */

  async function rebuildAllIcons () {
    const autoList = store.shortcuts.filter(sc => {
      const t = (sc.icon && sc.icon.type) || 'auto'
      return t !== 'text' && t !== 'glyph'
    })
    if (!autoList.length) { toast('没有可重建的图标'); return }
    const ok = await KL.ui.confirm({
      title: '重建全部图标',
      text: '将用当前规则重新提取 ' + autoList.length + ' 个快捷方式的图标（文字图标与字形图标会保留）。大约需要几秒到几十秒。',
      okText: '开始重建'
    })
    if (!ok) return
    let n = 0
    KL.ui.progress(0, autoList.length)
    await KL.icons.ensureMany(autoList, 3, () => { n++; KL.ui.progress(n, autoList.length) })
    KL.grid.render()
    toast('已重建 ' + n + ' 个图标')
  }

  function showChangelog () {
    const html = CHANGELOG.map(c =>
      '<div style="margin-bottom:16px">' +
      '<div style="font-weight:600;margin-bottom:6px">v' + esc(c.v) +
      ' <span style="color:var(--text-3);font-weight:400;font-size:11.5px">' + esc(c.date) + '</span></div>' +
      '<ul style="margin:0;padding-left:18px;line-height:1.8">' +
      c.items.map(i => '<li>' + esc(i) + '</li>').join('') + '</ul></div>'
    ).join('')
    KL.ui.modal({
      title: '更新日志',
      size: 'narrow',
      body: '<div style="max-height:52vh;overflow:auto">' + html + '</div>',
      buttons: function (foot, m) {
        const b = el('button', 'btn primary', '关闭')
        b.addEventListener('click', () => m.close())
        foot.appendChild(el('div', 'grow'))
        foot.appendChild(b)
      }
    })
  }

  const COLOR_PRESETS = ['#534AB7', '#185FA5', '#0F6E56', '#993C1D', '#993556', '#3B6D11', '#854F0B', '#5F5E5A', '#BA7517', '#444441']

  // 颜色行控件：无 / 预设色块 / 自定义取色器
  function colorRow (current, onPick) {
    const row = el('div', 'chips color-row')
    const none = el('div', 'chip' + (!current ? ' on' : ''), '无')
    none.addEventListener('click', () => onPick(''))
    row.appendChild(none)
    COLOR_PRESETS.forEach(c => {
      const chip = el('div', 'chip swatch' + (current === c ? ' on' : ''))
      chip.style.background = c
      chip.title = c
      chip.addEventListener('click', () => onPick(c))
      row.appendChild(chip)
    })
    const custom = el('input')
    custom.type = 'color'
    custom.className = 'color-input'
    custom.value = current || '#534AB7'
    custom.title = '自定义颜色'
    custom.addEventListener('input', () => onPick(custom.value))
    row.appendChild(custom)
    return row
  }

  function settings () {
    const s = store.settings
    const body = el('div')

    // 按当前颜色 + 不透明度刷新格子背景（含 alpha）
    function applyTileBg () {
      const val = KL.app.tileBgValue ? KL.app.tileBgValue(store.settings) : (store.settings.tileBgColor || 'transparent')
      document.documentElement.style.setProperty('--tile-bg', val)
    }

    const labelSeg = segmented([
      { value: true, label: '显示名称' },
      { value: false, label: '隐藏名称' }
    ], s.showLabels !== false, v => store.setSetting('showLabels', v))
    body.appendChild(field('图标文字', labelSeg))

    const sortSeg = segmented([
      { value: 'manual', label: '手动' },
      { value: 'name', label: '名称' },
      { value: 'created', label: '创建时间' },
      { value: 'updated', label: '最近使用' }
    ], s.sortBy, v => {
      store.setSetting('sortBy', v)
      KL.app.syncToolbar()
    })
    body.appendChild(field('排列顺序', sortSeg))

    const sizeRange = el('input')
    sizeRange.type = 'range'
    sizeRange.min = '64'
    sizeRange.max = '160'
    sizeRange.step = '2'
    sizeRange.value = String(s.cell || 92)
    sizeRange.style.width = '100%'
    const sizeLabel = el('span', 'stat', (s.cell || 92) + ' px')
    const sizeRow = el('div', 'row')
    sizeRow.appendChild(sizeRange)
    sizeRow.appendChild(sizeLabel)
    sizeRange.addEventListener('input', () => {
      sizeLabel.textContent = sizeRange.value + ' px'
      store.setSetting('cell', parseInt(sizeRange.value, 10))
    })
    body.appendChild(field('图标格子大小', sizeRow))

    const sbRange = el('input')
    sbRange.type = 'range'
    sbRange.min = '120'
    sbRange.max = '420'
    sbRange.step = '4'
    sbRange.value = String(s.sidebarWidth || 184)
    sbRange.style.width = '100%'
    const sbLabel = el('span', 'stat', (s.sidebarWidth || 184) + ' px')
    const sbRow = el('div', 'row')
    sbRow.appendChild(sbRange)
    sbRow.appendChild(sbLabel)
    sbRange.addEventListener('input', () => {
      sbLabel.textContent = sbRange.value + ' px'
      store.setSetting('sidebarWidth', parseInt(sbRange.value, 10))
      document.documentElement.style.setProperty('--sidebar-w', sbRange.value + 'px')
      KL.grid.render()
    })
    body.appendChild(field('侧边栏宽度', sbRow, '也可以直接拖动侧边栏右侧边缘调整'))

    const radiusRange = el('input')
    radiusRange.type = 'range'
    radiusRange.min = '4'
    radiusRange.max = '24'
    radiusRange.step = '1'
    radiusRange.value = String(s.tileRadius || 16)
    radiusRange.style.width = '100%'
    const radiusLabel = el('span', 'stat', (s.tileRadius || 16) + ' px')
    const radiusRow = el('div', 'row')
    radiusRow.appendChild(radiusRange)
    radiusRow.appendChild(radiusLabel)
    radiusRange.addEventListener('input', () => {
      radiusLabel.textContent = radiusRange.value + ' px'
      store.setSetting('tileRadius', parseInt(radiusRange.value, 10))
      document.documentElement.style.setProperty('--tile-radius', radiusRange.value + 'px')
    })
    body.appendChild(field('图标圆角', radiusRow))

    const folderSizeSeg = segmented([
      { value: 'small', label: '小' },
      { value: 'medium', label: '中' },
      { value: 'large', label: '大' },
      { value: 'same', label: '与主格一致' }
    ], s.folderIconSize || 'medium', v => {
      store.setSetting('folderIconSize', v)
      KL.grid.render()
    })
    body.appendChild(field('文件夹内图标大小', folderSizeSeg, '只影响大文件夹内部图标的显示大小，与文件夹本身尺寸无关'))

    const bgWrap = el('div')
    bgWrap.appendChild(colorRow(s.tileBgColor, v => {
      store.setSetting('tileBgColor', v)
      applyTileBg()
    }))
    bgWrap.appendChild(el('div', '', '<div style="height:8px"></div>'))
    const opRange = el('input')
    opRange.type = 'range'
    opRange.min = '0'
    opRange.max = '100'
    opRange.step = '1'
    opRange.value = String(s.tileBgOpacity == null ? 100 : s.tileBgOpacity)
    opRange.style.width = '100%'
    const opLabel = el('span', 'stat', (s.tileBgOpacity == null ? 100 : s.tileBgOpacity) + '%')
    const opRow = el('div', 'row')
    const opName = el('span', 'stat', '不透明度')
    opName.style.whiteSpace = 'nowrap'
    opRow.appendChild(opName)
    opRow.appendChild(opRange)
    opRow.appendChild(opLabel)
    opRange.addEventListener('input', () => {
      opLabel.textContent = opRange.value + '%'
      store.setSetting('tileBgOpacity', parseInt(opRange.value, 10))
      applyTileBg()
    })
    bgWrap.appendChild(opRow)
    body.appendChild(field('图标格子背景', bgWrap, '留空为透明；选好颜色后可用下面的滑块把背景调成半透明'))

    const borderWrap = el('div')
    borderWrap.appendChild(colorRow(s.tileBorderColor, v => {
      store.setSetting('tileBorderColor', v)
      document.documentElement.style.setProperty('--tile-border-color', v || 'transparent')
    }))
    borderWrap.appendChild(el('div', '', '<div style="height:6px"></div>'))
    borderWrap.appendChild(segmented([
      { value: 1, label: '1px' },
      { value: 2, label: '2px' },
      { value: 3, label: '3px' }
    ], parseInt(s.tileBorderWidth, 10) || 1, v => {
      store.setSetting('tileBorderWidth', v)
      document.documentElement.style.setProperty('--tile-border-w', v + 'px')
    }))
    body.appendChild(field('图标格子描边', borderWrap, '先选颜色再选粗细；留空即无描边'))

    const themeSeg = segmented([
      { value: 'auto', label: '跟随 uTools' },
      { value: 'dark', label: '深色' },
      { value: 'light', label: '浅色' }
    ], s.theme, v => {
      store.setSetting('theme', v)
      KL.app.applyTheme()
    })
    body.appendChild(field('主题', themeSeg))

    const clickSeg = segmented([
      { value: false, label: '单击打开' },
      { value: true, label: '双击打开' }
    ], !!s.launchOnDoubleClick, v => store.setSetting('launchOnDoubleClick', v))
    body.appendChild(field('打开方式', clickSeg))

    const hideSeg = segmented([
      { value: true, label: '打开后隐藏' },
      { value: false, label: '打开后保留' }
    ], s.hideOnLaunch !== false, v => store.setSetting('hideOnLaunch', v))
    body.appendChild(field('打开快捷方式后', hideSeg))

    const confirmSeg = segmented([
      { value: true, label: '删除前确认' },
      { value: false, label: '直接删除' }
    ], s.confirmDelete !== false, v => store.setSetting('confirmDelete', v))
    body.appendChild(field('删除快捷方式', confirmSeg))

    const svcInput = input(s.faviconService || '', 'https://favicon.im/{domain}')
    svcInput.addEventListener('change', () => store.setSetting('faviconService', svcInput.value.trim()))
    body.appendChild(field('第三方图标服务（可选）', svcInput, '当网站自身图标抓不到时的兜底。可用变量：{domain} 域名、{origin} 源、{url} 完整网址。留空则只用网站自身的图标'))

    body.appendChild(el('div', '', '<div style="height:6px"></div>'))
    const iconRow = el('div', 'chips')
    const rebuildBtn = el('div', 'chip', '重建全部图标')
    rebuildBtn.addEventListener('click', () => rebuildAllIcons())
    iconRow.appendChild(rebuildBtn)
    body.appendChild(field('图标', iconRow, '按当前规则重新提取全部图标，可修正因图标来源不同导致的大小不一'))

    const dataRow = el('div', 'chips')
    const openBtn = el('div', 'chip', '打开数据目录')
    openBtn.addEventListener('click', () => S.openDataDir())
    const exportBtn = el('div', 'chip', '导出数据')
    exportBtn.addEventListener('click', () => {
      const r = S.exportData()
      if (r && r.ok) toast('已导出到 ' + r.path)
      else if (r && !r.canceled) toast('导出失败：' + r.error, 'error')
    })
    const importBtn = el('div', 'chip', '导入数据')
    importBtn.addEventListener('click', async () => {
      const r = S.importData()
      if (!r) return
      if (r.canceled) return
      if (!r.ok) { toast('导入失败：' + r.error, 'error'); return }
      const merge = await KL.ui.confirm({ title: '导入方式', text: '点「合并」把备份里的快捷方式追加进来，点「覆盖」则完全替换当前数据。', okText: '覆盖现有数据' })
      store.importJSON(r.data, merge ? 'replace' : 'merge')
      KL.app.renderSidebar()
      exportBtn.textContent = merge ? '导入数据' : '导入数据'
      toast('导入完成')
    })
    dataRow.appendChild(openBtn)
    dataRow.appendChild(exportBtn)
    dataRow.appendChild(importBtn)
    body.appendChild(field('数据', dataRow, '当前 ' + store.shortcuts.length + ' 个快捷方式、' + store.categories.length + ' 个分类'))

    const dangerRow = el('div', 'chips')
    const resetBtn = el('div', 'chip', '清空全部数据')
    resetBtn.style.color = 'var(--danger)'
    resetBtn.addEventListener('click', async () => {
      const ok = await KL.ui.confirm({ title: '清空全部数据', text: '这会删除所有快捷方式和分类，且无法撤销。建议先导出备份。', okText: '清空', danger: true })
      if (!ok) return
      store.reset()
      KL.app.renderSidebar()
      KL.app.setCategory('all')
      toast('已清空')
    })
    const logBtn = el('div', 'chip', '查看日志')
    logBtn.addEventListener('click', () => {
      const t = S.readLog() || '(日志为空)'
      KL.ui.modal({
        title: '运行日志',
        size: 'wide',
        body: '<textarea class="input" readonly style="height:320px;font-family:monospace;font-size:11.5px">' + esc(t) + '</textarea>',
        buttons: function (foot, m) {
          const btn = el('button', 'btn primary', '关闭')
          btn.addEventListener('click', () => m.close())
          foot.appendChild(el('div', 'grow'))
          foot.appendChild(btn)
        }
      })
    })
    dangerRow.appendChild(resetBtn)
    dangerRow.appendChild(logBtn)
    body.appendChild(field('其他', dangerRow))

    body.appendChild(el('div', '', '<div style="height:6px"></div>'))
    const aboutRow = el('div', 'chips')
    const logChip = el('div', 'chip', '更新日志')
    logChip.addEventListener('click', () => showChangelog())
    const repoChip = el('div', 'chip', 'GitHub 仓库')
    repoChip.addEventListener('click', () => S.launch({ launch: { kind: 'url', target: REPO_URL } }))
    aboutRow.appendChild(logChip)
    aboutRow.appendChild(repoChip)
    body.appendChild(field('关于', aboutRow, '快捷方式面板 v' + VERSION + ' · by imo'))

    KL.ui.modal({
      title: '设置',
      placement: 'bottom-left',
      body: body,
      buttons: function (foot, m) {
        const grow = el('div', 'grow')
        const btn = el('button', 'btn primary', '完成')
        btn.addEventListener('click', () => {
          store.flush()
          m.close()
        })
        foot.appendChild(grow)
        foot.appendChild(btn)
      }
    })
  }

  /* ==================================================================
   * 批量操作条（多选时）
   * ================================================================== */

  function batchMenu (x, y) {
    const ids = KL.grid.selectedIds()
    if (!ids.length) return
    KL.ui.menu([
      { label: '打开全部（' + ids.length + '）', onClick: () => ids.forEach(id => { const sc = store.getShortcut(id); if (sc) S.launch(sc) }) },
      { separator: true },
      {
        label: '移动到分类',
        items: [{ label: '未分类', onClick: () => { ids.forEach(id => store.setCategory(id, null)); KL.grid.render() } }]
          .concat(store.categories.map(c => ({ label: c.name, onClick: () => { ids.forEach(id => store.setCategory(id, c.id)); KL.grid.render() } })))
      },
      {
        label: '图标尺寸',
        items: [[1, 1], [2, 1], [1, 2], [2, 2], [3, 2], [3, 3]].map(p => ({
          label: p[0] + ' × ' + p[1],
          onClick: () => { ids.forEach(id => store.updateShortcut(id, { col: p[0], row: p[1] })); KL.grid.render() }
        }))
      },
      { label: '刷新图标', onClick: () => { const list = ids.map(id => store.getShortcut(id)).filter(Boolean); KL.icons.ensureMany(list, 3, (sc) => KL.grid.refreshTile(sc.id)) } },
      { separator: true },
      {
        label: '删除（' + ids.length + '）',
        danger: true,
        onClick: async () => {
          const ok = await KL.ui.confirm({ title: '删除快捷方式', text: '确定删除选中的 ' + ids.length + ' 个快捷方式吗？', okText: '删除', danger: true })
          if (!ok) return
          store.removeShortcuts(ids)
          KL.grid.clearSelection()
          KL.grid.render()
        }
      }
    ], { x: x, y: y })
  }

  KL.dialogs = {
    ingestPaths,
    newFolder,
    folderView,
    ingestApps,
    ingestUrls,
    hydrate,
    addFromFiles,
    addUrl,
    addUrlQuick,
    addFromClipboard,
    editShortcut,
    iconPicker,
    scanApps,
    importBookmarks,
    newCategory,
    renameCategory,
    deleteCategory,
    categoryMenu,
    settings,
    batchMenu
  }
})()
