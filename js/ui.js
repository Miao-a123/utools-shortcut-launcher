(function () {
  'use strict'
  const KL = (window.KL = window.KL || {})

  function el (tag, cls, html) {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (html != null) e.innerHTML = html
    return e
  }

  function esc (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
  }

  /* ---------------- toast ---------------- */

  let toastRoot = null
  function toast (msg, type, ms) {
    if (!toastRoot) {
      toastRoot = el('div', 'toasts')
      document.body.appendChild(toastRoot)
    }
    const t = el('div', 'toast' + (type === 'error' ? ' error' : ''))
    t.textContent = msg
    toastRoot.appendChild(t)
    setTimeout(() => {
      t.style.transition = 'opacity .2s'
      t.style.opacity = '0'
      setTimeout(() => t.remove(), 220)
    }, ms || (type === 'error' ? 3600 : 1900))
  }

  /* ---------------- progress bar ---------------- */

  let progressEl = null
  function progress (done, total, text) {
    if (!progressEl) {
      progressEl = el('div', 'progress')
      progressEl.innerHTML = '<i></i>'
      progressEl.style.position = 'fixed'
      progressEl.style.left = '0'
      progressEl.style.right = '0'
      progressEl.style.top = '0'
      progressEl.style.zIndex = '95'
      progressEl.style.height = '3px'
      progressEl.style.marginTop = '0'
      document.body.appendChild(progressEl)
    }
    const bar = progressEl.querySelector('i')
    if (total == null) {
      bar.style.width = '0%'
      progressEl.style.display = 'none'
      return
    }
    progressEl.style.display = 'block'
    bar.style.width = Math.max(2, Math.min(100, (done / Math.max(1, total)) * 100)) + '%'
    if (done >= total) setTimeout(() => { if (progressEl) progressEl.style.display = 'none' }, 400)
  }

  /* ---------------- context menu ---------------- */

  let menuEl = null

  function closeMenu () {
    if (menuEl) {
      menuEl.remove()
      menuEl = null
      document.removeEventListener('mousedown', onDocDown, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('blur', closeMenu)
    }
  }

  function onDocDown (e) {
    if (menuEl && !menuEl.contains(e.target)) closeMenu()
  }

  function onKey (e) {
    if (e.key === 'Escape') {
      closeMenu()
      e.stopPropagation()
    }
  }

  function buildItems (container, items) {
    for (const it of items) {
      if (!it) continue
      if (it.separator) {
        container.appendChild(el('div', 'sep'))
        continue
      }
      if (it.title) {
        container.appendChild(el('div', 'label', esc(it.title)))
        continue
      }
      if (it.custom) {
        const holder = el('div')
        it.custom(holder)
        container.appendChild(holder)
        continue
      }
      const row = el('div', 'item' + (it.danger ? ' danger' : '') + (it.items ? ' has-sub' : ''))
      row.innerHTML = (it.icon || '') + '<span>' + esc(it.label) + '</span>' +
        (it.hint ? '<span class="k">' + esc(it.hint) + '</span>' : '')
      if (it.disabled) {
        row.style.opacity = '.4'
        row.style.pointerEvents = 'none'
      }
      if (it.items) {
        const sub = el('div', 'sub')
        buildItems(sub, it.items)
        row.appendChild(sub)
      } else {
        row.addEventListener('click', ev => {
          ev.stopPropagation()
          if (it.keepOpen) {
            it.onClick && it.onClick(ev)
          } else {
            closeMenu()
            it.onClick && it.onClick(ev)
          }
        })
      }
      container.appendChild(row)
    }
    return container
  }

  function menu (items, opts) {
    closeMenu()
    const o = opts || {}
    menuEl = el('div', 'ctx show')
    buildItems(menuEl, items)
    document.body.appendChild(menuEl)
    let x = o.x || 0
    let y = o.y || 0
    const rect = menuEl.getBoundingClientRect()
    if (x + rect.width > window.innerWidth - 6) x = Math.max(6, window.innerWidth - rect.width - 6)
    if (y + rect.height > window.innerHeight - 6) y = Math.max(6, window.innerHeight - rect.height - 6)
    menuEl.style.left = x + 'px'
    menuEl.style.top = y + 'px'
    if (o.onClose) menuEl.__onClose = o.onClose
    setTimeout(() => {
      document.addEventListener('mousedown', onDocDown, true)
      document.addEventListener('keydown', onKey, true)
      window.addEventListener('blur', closeMenu)
    }, 0)
    return menuEl
  }

  /* ---------------- modal ---------------- */

  let openModals = 0

  const CLOSE_SVG = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>'

  function modal (opts) {
    const o = opts || {}
    const mask = el('div', 'mask')
    const box = el('div', 'modal' + (o.size ? ' ' + o.size : ''))
    const head = el('div', 'modal-head')
    const h = el('h2')
    h.textContent = o.title || ''
    if (o.subtitle) {
      const s = el('span', 'sub')
      s.textContent = o.subtitle
      h.appendChild(s)
    }
    head.appendChild(h)
    const closeBtn = el('button', 'btn icon-only ghost', CLOSE_SVG)
    closeBtn.title = '关闭'
    head.appendChild(closeBtn)
    const body = el('div', 'modal-body')
    const foot = el('div', 'modal-foot')
    box.appendChild(head)
    box.appendChild(body)
    if (o.footer !== false) box.appendChild(foot)
    mask.appendChild(box)
    document.body.appendChild(mask)
    openModals++

    if (typeof o.body === 'string') body.innerHTML = o.body
    else if (o.body) body.appendChild(o.body)

    const api = {
      mask: mask,
      box: box,
      body: body,
      foot: foot,
      close: function (result) {
        if (api.closed) return
        api.closed = true
        openModals = Math.max(0, openModals - 1)
        mask.classList.add('closing')
        setTimeout(() => mask.remove(), 120)
        document.removeEventListener('keydown', onKey, true)
        if (o.onClose) o.onClose(result)
      }
    }

    function onKey (e) {
      if (e.key === 'Escape') {
        if (menuEl) { closeMenu(); return }
        e.stopPropagation()
        api.close(null)
      }
    }

    closeBtn.addEventListener('click', () => api.close(null))
    mask.addEventListener('mousedown', e => {
      if (e.target === mask && o.maskClosable !== false) api.close(null)
    })
    document.addEventListener('keydown', onKey, true)

    if (o.footer === false) {
      foot.remove()
    } else if (typeof o.buttons === 'function') {
      o.buttons(foot, api)
    } else if (Array.isArray(o.buttons)) {
      for (const b of o.buttons) {
        const btn = el('button', 'btn ' + (b.kind || ''), esc(b.label))
        btn.addEventListener('click', () => b.onClick ? b.onClick(api) : api.close(b.value))
        foot.appendChild(btn)
      }
    }

    if (o.onMount) o.onMount(api)
    return api
  }

  function confirm (opts) {
    const o = typeof opts === 'string' ? { text: opts } : (opts || {})
    return new Promise(resolve => {
      const api = modal({
        title: o.title || '确认',
        size: 'narrow',
        body: '<div style="line-height:1.7">' + esc(o.text || '确定执行该操作吗？') + '</div>',
        maskClosable: false,
        buttons: function (foot, m) {
          const cancel = el('button', 'btn', '取消')
          cancel.addEventListener('click', () => { m.close(); resolve(false) })
          const ok = el('button', 'btn ' + (o.danger ? 'danger' : 'primary'), esc(o.okText || '确定'))
          ok.addEventListener('click', () => { m.close(); resolve(true) })
          foot.appendChild(el('div', 'grow'))
          foot.appendChild(cancel)
          foot.appendChild(ok)
        },
        onClose: () => resolve(false)
      })
    })
  }

  function prompt (opts) {
    const o = opts || {}
    return new Promise(resolve => {
      let settled = false
      const wrap = el('div')
      wrap.innerHTML = '<input class="input" type="text" value="' + esc(o.value || '') + '" placeholder="' + esc(o.placeholder || '') + '">'
      const input = wrap.querySelector('input')
      const api = modal({
        title: o.title || '输入',
        size: 'narrow',
        body: wrap,
        maskClosable: false,
        buttons: function (foot, m) {
          const cancel = el('button', 'btn', '取消')
          cancel.addEventListener('click', () => { m.close(); settled = true; resolve(null) })
          const ok = el('button', 'btn primary', esc(o.okText || '确定'))
          ok.addEventListener('click', () => { m.close(); settled = true; resolve(input.value.trim()) })
          foot.appendChild(el('div', 'grow'))
          foot.appendChild(cancel)
          foot.appendChild(ok)
        },
        onMount: () => setTimeout(() => { input.focus(); input.select() }, 30),
        onClose: () => { if (!settled) resolve(null) }
      })
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') {
          e.preventDefault()
          settled = true
          api.close()
          resolve(input.value.trim())
        }
      })
    })
  }

  const ICONS = {
    search: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="7" cy="7" r="4.4"/><path d="M10.4 10.4L14 14"/></svg>',
    plus: '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
    chevron: '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5l4 4 4-4"/></svg>',
    check: '<svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>'
  }

  KL.ui = {
    el: el,
    esc: esc,
    toast: toast,
    progress: progress,
    menu: menu,
    closeMenu: closeMenu,
    modal: modal,
    confirm: confirm,
    prompt: prompt,
    ICONS: ICONS,
    get modalCount () { return openModals }
  }

  KL.toast = toast
  KL.progress = progress
})()
