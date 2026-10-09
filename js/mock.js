/* 浏览器预览用：仅在缺少 uTools 宿主（window.services 不存在）时生效。
   在 uTools 里插件由 preload.js 提供 window.services，本文件不会做任何事。 */
(function () {
  'use strict'
  if (window.services) return

  const DARK = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches

  window.utools = {
    isDarkColors: function () { return DARK },
    setExpendHeight: function () {},
    hideMainWindow: function () {},
    showNotification: function (t) { console.log('[notify]', t) },
    shellOpenExternal: function (u) { console.log('[open url]', u); window.open(u, '_blank') },
    shellOpenPath: function (p) { console.log('[open path]', p); return '' },
    shellShowItemInFolder: function (p) { console.log('[reveal]', p) },
    getCopyedFiles: function () { return [] },
    copyText: function (t) { console.log('[copy]', t) },
    showOpenDialog: function () { return [] },
    showSaveDialog: function () { return null },
    getPath: function () { return '' },
    onPluginEnter: function () {},
    onPluginOut: function () {}
  }

  const KEY = 'kl-mock-data'
  const PARAMS = new URLSearchParams(location.search.replace(/^#/, ''))

  function glyphFor (kind) {
    return (window.KL && KL.icons) ? KL.icons.glyph(kind) : null
  }

  function letterFor (t, bg) {
    return (window.KL && KL.icons) ? KL.icons.letter(t, bg) : null
  }

  let seq = 0
  function sc (name, kind, target, cat, col, row, iconKind, letterBg) {
    seq++
    const now = Date.now()
    let icon
    if (letterBg) icon = { type: 'text', text: Array.from(name)[0], bg: letterBg, fg: '#ffffff' }
    else icon = { type: 'glyph', kind: iconKind || 'generic' }
    return {
      id: 'mock' + seq,
      name: name,
      categoryId: cat,
      col: col || 1,
      row: row || 1,
      launch: kind === 'url'
        ? { kind: 'url', target: target, args: '', workDir: '', appId: '' }
        : { kind: 'path', target: target, args: '', workDir: '', appId: '' },
      icon: icon,
      originalPath: kind === 'url' ? '' : target,
      source: 'mock',
      note: '',
      createdAt: now - seq * 86400000,
      updatedAt: now - seq * 3600000,
      launchCount: seq,
      lastLaunched: now - seq * 1800000,
      missing: name === 'STM32CubeIDE'
    }
  }

  function mockData () {
    const cats = [
      { id: 'c1', name: '开发工具', color: '#534AB7', order: 1 },
      { id: 'c2', name: '常用网站', color: '#185FA5', order: 2 },
      { id: 'c3', name: '工作文档', color: '#3B6D11', order: 3 }
    ]
    const items = [
      sc('VS Code', 'path', 'C:\\Program Files\\Microsoft VS Code\\Code.exe', 'c1', 2, 2, 'code'),
      sc('KiCad', 'path', 'C:\\Program Files\\KiCad\\bin\\kicad.exe', 'c1', 1, 1, 'app'),
      sc('STM32CubeMX', 'path', 'C:\\ST\\STM32CubeMX\\STM32CubeMX.exe', 'c1', 1, 1, 'app'),
      sc('STM32CubeIDE', 'path', 'D:\\ST\\STM32CubeIDE\\stm32cubeide.exe', 'c1', 1, 1, 'code'),
      sc('PlatformIO', 'path', 'C:\\Users\\imo\\.platformio\\penv\\Scripts\\pio.exe', 'c1', 1, 2, 'code'),
      sc('draw.io', 'path', 'C:\\Program Files\\draw.io\\draw.io.exe', 'c1', 2, 1, 'image'),
      sc('GitHub', 'url', 'https://github.com/Miao-a123', 'c2', 1, 1, 'url'),
      sc('ESP-IDF 文档', 'url', 'https://docs.espressif.com/projects/esp-idf/', 'c2', 2, 1, 'url'),
      sc('哔哩哔哩', 'url', 'https://www.bilibili.com', 'c2', 1, 1, 'url'),
      sc('知乎', 'url', 'https://www.zhihu.com', 'c2', 1, 1, 'url'),
      sc('Zotero', 'path', 'C:\\Program Files\\Zotero\\zotero.exe', 'c3', 1, 1, 'doc'),
      sc('Obsidian 知识空间', 'path', 'E:\\imo\\imo知识空间', 'c3', 2, 1, 'folder'),
      sc('单片机数据手册', 'path', 'E:\\imo\\datasheets\\ESP32-S3-WROOM-1.pdf', 'c3', 1, 1, 'doc'),
      sc('项目清单.xlsx', 'path', 'E:\\imo\\projects\\清单.xlsx', 'c3', 1, 1, 'sheet'),
      sc('下载文件夹', 'path', 'C:\\Users\\imo\\Downloads', null, 1, 1, 'folder', '#BA7517'),
      sc('飞牛 NAS 照片库', 'path', '\\\\10.0.0.175\\photo\\DCIM', null, 1, 1, 'folder', '#0F6E56'),
      sc('固件备份', 'path', 'E:\\imo\\firmware', null, 1, 1, 'folder', '#0F6E56'),
      sc('演示视频.mp4', 'path', 'E:\\imo\\demo\\ble-hid.mp4', null, 2, 1, 'video')
    ]
    return {
      version: 1,
      settings: {
        showLabels: true, sortBy: 'manual', cell: 92, theme: 'auto', faviconService: '',
        launchOnDoubleClick: false, confirmDelete: true, hideOnLaunch: true, tileRadius: 16
      },
      categories: cats,
      shortcuts: items
    }
  }

  const MOCK_APPS = [
    ['Visual Studio Code', 'code', 'C:\\Program Files\\Microsoft VS Code\\Code.exe'],
    ['Arduino IDE', 'app', 'C:\\Program Files\\Arduino IDE\\Arduino IDE.exe'],
    ['KiCad', 'app', 'C:\\Program Files\\KiCad\\bin\\kicad.exe'],
    ['STM32CubeMX', 'app', 'C:\\ST\\STM32CubeMX\\STM32CubeMX.exe'],
    ['Obsidian', 'doc', 'C:\\Users\\imo\\AppData\\Local\\Obsidian\\Obsidian.exe'],
    ['Zotero', 'doc', 'C:\\Program Files\\Zotero\\zotero.exe'],
    ['Google Chrome', 'url', 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'],
    ['Microsoft Edge', 'url', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'],
    ['PowerShell 7', 'code', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe'],
    ['Windows Terminal', 'code', 'C:\\Program Files\\WindowsApps\\wt.exe'],
    ['Notepad++', 'doc', 'C:\\Program Files\\Notepad++\\notepad++.exe'],
    ['draw.io', 'image', 'C:\\Program Files\\draw.io\\draw.io.exe'],
    ['Ollama', 'app', 'C:\\Users\\imo\\AppData\\Local\\Programs\\Ollama\\ollama.exe'],
    ['Wireshark', 'app', 'C:\\Program Files\\Wireshark\\Wireshark.exe'],
    ['Git Bash', 'code', 'C:\\Program Files\\Git\\bin\\bash.exe'],
    ['Everything', 'app', 'C:\\Program Files\\Everything\\Everything.exe'],
    ['计算器', 'app', 'C:\\Windows\\System32\\calc.exe'],
    ['画图', 'image', 'C:\\Windows\\System32\\mspaint.exe'],
    ['截图工具', 'image', 'C:\\Windows\\System32\\SnippingTool.exe'],
    ['任务管理器', 'app', 'C:\\Windows\\System32\\Taskmgr.exe']
  ]

  const MOCK_BOOKMARKS = (function () {
    const folders = {
      '书签栏 / 嵌入式': ['ESP-IDF Programming Guide|https://docs.espressif.com/projects/esp-idf/en/latest/', 'NimBLE 文档|https://mynewt.apache.org/latest/network/index.html', 'TinyUSB|https://docs.tinyusb.org/en/latest/', 'LVGL 文档|https://docs.lvgl.io/master/', '乐鑫技术论坛|https://www.esp32.com/'],
      '书签栏 / 工具': ['GitHub|https://github.com', 'Stack Overflow|https://stackoverflow.com', 'draw.io|https://app.diagrams.net', 'regex101|https://regex101.com', 'C 标准库参考|https://zh.cppreference.com/'],
      '其他书签 / 学习': ['B站 嵌入式课程|https://www.bilibili.com', '慕课网|https://www.imooc.com', '知乎|https://www.zhihu.com', 'CSDN|https://www.csdn.net']
    }
    const urls = []
    Object.keys(folders).forEach(f => {
      folders[f].forEach(entry => {
        const parts = entry.split('|')
        urls.push({
          title: parts[0],
          url: parts[1],
          folder: f,
          folderPath: f.split(' / '),
          addedAt: Date.now()
        })
      })
    })
    return [
      { browser: 'Edge', profile: 'Default', file: 'C:\\Users\\imo\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Bookmarks', count: urls.length, folders: [{ path: '书签栏 / 嵌入式', count: 5 }], urls: urls },
      { browser: 'Chrome', profile: 'Default', file: 'C:\\Users\\imo\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Bookmarks', count: 4, folders: [], urls: urls.slice(0, 4) }
    ]
  })()

  const noop = function () { return { ok: true } }

  window.services = {
    isUtools: false,
    isMock: true,
    log: function () {},
    getDataDir: function () { return '(浏览器预览模式，无数据目录)' },
    getDataFilePath: function () { return '(mock)' },
    openDataDir: function () { window.services.notify('预览模式：没有真实数据目录') },
    revealPath: function () {},
    readLog: function () { return '(浏览器预览模式，无日志)' },

    loadData: function () {
      if (PARAMS.get('empty')) return { version: 1, settings: {}, categories: [], shortcuts: [] }
      const theme = PARAMS.get('theme')
      try {
        const raw = localStorage.getItem(KEY)
        if (raw) {
          const d = JSON.parse(raw)
          if (theme) d.settings = Object.assign({}, d.settings, { theme: theme })
          return d
        }
      } catch (e) {}
      const d = mockData()
      if (theme) d.settings.theme = theme
      try { localStorage.setItem(KEY, JSON.stringify(d)) } catch (e) {}
      return d
    },
    saveData: function (d) {
      try { localStorage.setItem(KEY, JSON.stringify(d)) } catch (e) {}
      return { ok: true }
    },

    ping: function () { return Promise.resolve({ ok: true, data: { items: [], pong: true, ps: 'mock' } }) },

    resolvePaths: function (paths) {
      return Promise.resolve({
        ok: true,
        items: (paths || []).map(p => {
          const isUrl = /^https?:\/\//i.test(p)
          return {
            path: p,
            ok: true,
            kind: isUrl ? 'url' : 'file',
            target: p,
            args: '',
            workDir: '',
            iconLocation: ''
          }
        })
      })
    },

    extractIcons: function (items) {
      return Promise.resolve({
        ok: true,
        engine: false,
        items: (items || []).map(it => ({ path: it.path || it.iconPath, ok: false, error: 'preview mode' }))
      })
    },

    scanApps: function (sources) {
      const srcs = sources && sources.length ? sources : ['startmenu', 'startapps', 'registry']
      const labels = { startmenu: '开始菜单', startapps: '应用列表', registry: '注册表', desktop: '桌面' }
      const out = []
      let i = 0
      for (const s of srcs) {
        for (let k = 0; k < 7; k++) {
          const a = MOCK_APPS[(i * 3 + k) % MOCK_APPS.length]
          out.push({
            name: a[0],
            source: s,
            sourceLabel: labels[s] || s,
            kind: 'file',
            target: a[2],
            appId: '',
            iconPath: a[2],
            iconFile: '',
            glyphKind: a[1]
          })
        }
        i++
      }
      return new Promise(resolve => setTimeout(() => resolve({ ok: true, items: out }), 700))
    },

    readBookmarks: function () { return { ok: true, sources: MOCK_BOOKMARKS } },

    fetchFavicon: function () {
      return new Promise(resolve => setTimeout(() => resolve({ ok: false, error: '预览模式无法联网抓取图标' }), 400))
    },

    launch: function (s) {
      const l = (s && s.launch) || {}
      if (l.kind === 'url') { console.log('[open]', l.target); try { window.open(l.target, '_blank') } catch (e) {} }
      else console.log('[open path]', l.target)
      return Promise.resolve({ ok: true })
    },

    readImageAsDataUrl: function () { return { ok: false, error: 'preview' } },
    exists: function (p) { return true },
    pathInfo: function (p) { return { ok: true, exists: !!p, isDir: false, name: p, dir: '', ext: '' } },
    pickFiles: function () { window.services.notify('预览模式不能打开文件选择器'); return [] },
    pickImage: function () { window.services.notify('预览模式不能打开文件选择器'); return [] },
    readClipboard: function () { return { text: '', files: [] } },
    exportData: function () { window.services.notify('预览模式不能导出'); return { ok: false, canceled: true } },
    importData: function () { window.services.notify('预览模式不能导入'); return { ok: false, canceled: true } },
    notify: function (m) { if (window.KL && KL.toast) KL.toast(String(m)) },
    copyText: function (t) { try { navigator.clipboard.writeText(t) } catch (e) {} return { ok: true } },
    isDark: function () { return DARK },
    setHeight: function () {},
    getPathForFile: function () { return null },
    getPath: function () { return '' },
    shutdown: function () {}
  }

  console.log('[KL] 浏览器预览模式已启用（数据存放在 localStorage，可在控制台执行 localStorage.removeItem("kl-mock-data") 重置）')

  /* 预览调试钩子：?dlg=scan|bookmarks|settings|add|edit|icon|confirm 可直接打开对应弹窗 */
  window.addEventListener('load', function () {
    if (PARAMS.get('debug')) {
      setTimeout(function () {
        try {
          const bs = getComputedStyle(document.body)
          document.title = 'T=' + document.documentElement.dataset.theme +
            ' setting=' + ((window.KL && KL.store.settings.theme) || '?') +
            ' bg=' + bs.backgroundColor + ' color=' + bs.color
        } catch (e) {}
      }, 400)
    }
    const dlg = PARAMS.get('dlg')
    if (!dlg) return
    setTimeout(function () {
      const KL = window.KL
      if (!KL || !KL.dialogs) return
      try {
        if (dlg === 'scan') KL.dialogs.scanApps()
        else if (dlg === 'bookmarks') KL.dialogs.importBookmarks()
        else if (dlg === 'settings') KL.dialogs.settings()
        else if (dlg === 'add') KL.dialogs.addUrl()
        else if (dlg === 'edit' || dlg === 'icon') {
          const sc = KL.store.shortcuts[0]
          if (!sc) return
          if (dlg === 'edit') KL.dialogs.editShortcut(sc, function () {})
          else KL.dialogs.iconPicker(sc, function () {})
        } else if (dlg === 'confirm') {
          KL.ui.confirm({ title: '删除快捷方式', text: '确定删除「VS Code」吗？', okText: '删除', danger: true })
        }
        const auto = PARAMS.get('auto')
        if (auto) {
          setTimeout(function () {
            const want = auto === 'scan' ? '开始扫描' : auto === 'all' ? '全选本页' : auto
            const btns = Array.prototype.slice.call(document.querySelectorAll('.modal button, .modal .chip'))
            const t = btns.filter(function (b) { return b.textContent.trim() === want })[0]
            if (t) t.click()
            const auto2 = PARAMS.get('auto2')
            if (auto2) {
              setTimeout(function () {
                const want2 = auto2 === 'all' ? '全选本页' : auto2
                const bs = Array.prototype.slice.call(document.querySelectorAll('.modal button, .modal .chip'))
                const t2 = bs.filter(function (b) { return b.textContent.trim() === want2 })[0]
                if (t2) t2.click()
              }, 900)
            }
          }, 700)
        }
      } catch (e) { console.error(e) }
    }, 500)
  })
})()
