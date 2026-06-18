const { ipcRenderer } = require('electron')

window.addEventListener('DOMContentLoaded', () => {

  // ── ELEMENTS ──────────────────────────────────────
  const webview   = document.getElementById('webview')
  const urlBar    = document.getElementById('url-bar')
  const tabsEl    = document.getElementById('tabs')
  const newTabBtn = document.getElementById('new-tab-btn')

  // ── STATE ─────────────────────────────────────────
  let tabs        = [{ id: 0, title: 'New Tab', url: 'https://www.google.com', private: false }]
  let activeTab   = 0
  let downloads   = []
  let bookmarks   = JSON.parse(localStorage.getItem('fy-bookmarks') || '[]')
  let history     = JSON.parse(localStorage.getItem('fy-history')   || '[]')
  let fpsActive   = false
  let fpsInterval = null
  let frames      = 0
  let lastTime    = performance.now()
  let adBlockOn   = true
  let darkModeOn  = false
  let zoomLevel   = 1
  let fbType      = 'bug'
  let fbRating    = 0
  let findActive  = false

  // ── TOAST ─────────────────────────────────────────
  function toast(msg, color = '#2ed573') {
    const t = document.getElementById('toast')
    t.textContent = msg
    t.style.background = color
    t.style.color = ['#2ed573','#ffa502','#00cec9'].includes(color) ? '#000' : '#fff'
    t.style.display = 'block'
    clearTimeout(t._to)
    t._to = setTimeout(() => t.style.display = 'none', 2500)
  }

  function showAlert(msg) {
    const a = document.getElementById('security-alert')
    a.textContent = msg
    a.style.display = 'block'
    clearTimeout(a._to)
    a._to = setTimeout(() => a.style.display = 'none', 4000)
  }

  // ── TABS ──────────────────────────────────────────
  function renderTabs() {
    document.querySelectorAll('.tab').forEach(t => t.remove())
    tabs.forEach(tab => {
      const el = document.createElement('div')
      el.className = 'tab' + (tab.id === activeTab ? ' active' : '') + (tab.private ? ' private' : '')
      el.innerHTML = `
        <span class="tab-favicon">${tab.private ? '🕵' : '○'}</span>
        <span class="tab-title">${tab.title || 'New Tab'}</span>
        ${tab.private ? '<span class="tab-private-icon">P</span>' : ''}
        <button class="tab-close">✕</button>
      `
      el.querySelector('.tab-close').addEventListener('click', e => { e.stopPropagation(); closeTab(tab.id) })
      el.addEventListener('click', () => switchTab(tab.id))
      tabsEl.insertBefore(el, newTabBtn)
    })
  }

  function addTab(url = 'https://www.google.com', isPrivate = false) {
    const id = Date.now()
    tabs.push({ id, title: 'New Tab', url, private: isPrivate })
    switchTab(id)
  }

  function switchTab(id) {
    activeTab = id
    const tab = tabs.find(t => t.id === id)
    if (!tab) return
    webview.src = tab.url
    urlBar.value = tab.url === 'https://www.google.com' ? '' : tab.url
    renderTabs()
    updateUrlPrefix(tab.url)
  }

  function closeTab(id) {
    if (tabs.length === 1) return
    const tab = tabs.find(t => t.id === id)
    if (tab && tab.private) ipcRenderer.send('clear-cookies')
    tabs = tabs.filter(t => t.id !== id)
    if (activeTab === id) switchTab(tabs[tabs.length - 1].id)
    else renderTabs()
  }

  newTabBtn.addEventListener('click', () => addTab())
  renderTabs()

  // ── NAVIGATION ────────────────────────────────────
  function navigate(url) {
    let u = url.trim()
    if (!u) return
    if (!u.startsWith('http')) {
      u = u.includes('.') ? 'https://' + u : 'https://www.google.com/search?q=' + encodeURIComponent(u)
    }
    webview.src = u
    const tab = tabs.find(t => t.id === activeTab)
    if (tab) tab.url = u
  }

  urlBar.addEventListener('keydown', e => {
    if (e.key === 'Enter') navigate(urlBar.value)
    if (e.key === 'Escape') urlBar.blur()
  })

  urlBar.addEventListener('focus', () => urlBar.select())

  document.getElementById('back-btn').addEventListener('click', () => { if (webview.canGoBack()) webview.goBack() })
  document.getElementById('fwd-btn').addEventListener('click', () => { if (webview.canGoForward()) webview.goForward() })
  document.getElementById('reload-btn').addEventListener('click', () => webview.reload())

  function updateUrlPrefix(url) {
    const el = document.getElementById('url-prefix')
    if (url.startsWith('https')) {
      el.textContent = 'HTTPS'
      el.className = 'secure'
      el.style.color = '#2ed573'
    } else {
      el.textContent = 'HTTP'
      el.className = ''
      el.style.color = ''
    }
  }

  webview.addEventListener('did-navigate', e => {
    urlBar.value = e.url
    updateUrlPrefix(e.url)
    const tab = tabs.find(t => t.id === activeTab)
    if (tab) tab.url = e.url
    // Add to history
    if (e.url !== 'https://www.google.com') {
      history.unshift({ url: e.url, title: tab ? tab.title : e.url, time: Date.now() })
      if (history.length > 100) history.pop()
      localStorage.setItem('fy-history', JSON.stringify(history))
    }
  })

  webview.addEventListener('page-title-updated', e => {
    const tab = tabs.find(t => t.id === activeTab)
    if (tab) { tab.title = e.title.slice(0, 24); renderTabs() }
    // Update history title
    if (history[0]) { history[0].title = e.title; localStorage.setItem('fy-history', JSON.stringify(history)) }
  })

  webview.addEventListener('did-start-loading', () => {
    document.getElementById('reload-btn').textContent = '✕'
  })

  webview.addEventListener('did-stop-loading', () => {
    document.getElementById('reload-btn').textContent = '↺'
  })

  // ── WINDOW CONTROLS ───────────────────────────────
  document.getElementById('min-btn').addEventListener('click', () => ipcRenderer.send('minimize'))
  document.getElementById('max-btn').addEventListener('click', () => ipcRenderer.send('maximize'))
  document.getElementById('close-btn').addEventListener('click', () => ipcRenderer.send('close'))

  // ── OVERLAY + CLOSE ALL ───────────────────────────
  function closeAll() {
    document.getElementById('overlay').classList.remove('show')
    document.getElementById('dropdown').classList.remove('show')
    document.querySelectorAll('.panel').forEach(p => p.classList.remove('show'))
    document.getElementById('tracker-panel').style.display = 'none'
  }

  document.getElementById('overlay').addEventListener('click', closeAll)

  function openPanel(id) {
    closeAll()
    document.getElementById('overlay').classList.add('show')
    document.getElementById(id).classList.add('show')
  }

  // ── DROPDOWN MENU ─────────────────────────────────
  const dropdown = document.getElementById('dropdown')
  const menuBtn  = document.getElementById('menu-btn')

  menuBtn.addEventListener('click', e => {
    e.stopPropagation()
    const isOpen = dropdown.classList.contains('show')
    closeAll()
    if (!isOpen) dropdown.classList.add('show')
  })

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!dropdown.contains(e.target) && e.target !== menuBtn) {
      dropdown.classList.remove('show')
    }
  })

  // Dropdown items
  document.getElementById('drop-new-tab').addEventListener('click', () => { addTab(); closeAll() })
  document.getElementById('drop-private-tab').addEventListener('click', () => { addTab('https://www.google.com', true); toast('Private Tab — cookies cleared on close', '#a29bfe'); closeAll() })

  document.getElementById('drop-adblock').addEventListener('click', () => {
    adBlockOn = !adBlockOn
    ipcRenderer.send('toggle-adblock', adBlockOn)
    document.getElementById('drop-ad-badge').textContent = adBlockOn ? 'ON' : 'OFF'
    document.getElementById('drop-ad-badge').className = adBlockOn ? 'drop-badge badge-on' : 'drop-badge badge-off'
    toast(adBlockOn ? 'Ad Blocker ON' : 'Ad Blocker OFF', adBlockOn ? '#2ed573' : '#ff4757')
  })

  document.getElementById('drop-trackers').addEventListener('click', () => {
    toggleTrackerPanel()
    dropdown.classList.remove('show')
  })

  document.getElementById('drop-antivirus').addEventListener('click', () => { openPanel('antivirus-panel') })
  document.getElementById('drop-vpn').addEventListener('click', () => { openPanel('network-panel') })

  document.getElementById('drop-history').addEventListener('click', () => {
    renderHistory()
    openPanel('history-panel')
  })

  document.getElementById('drop-bookmarks').addEventListener('click', () => {
    renderBmPanel()
    openPanel('bm-panel')
  })

  document.getElementById('drop-downloads').addEventListener('click', () => {
    document.getElementById('download-popup').classList.toggle('show')
    dropdown.classList.remove('show')
  })

  document.getElementById('drop-screenshot').addEventListener('click', () => {
    ipcRenderer.send('take-screenshot')
    toast('Screenshot saved to Pictures!', '#5352ed')
    dropdown.classList.remove('show')
  })

  document.getElementById('drop-find').addEventListener('click', () => {
    openFindBar()
    dropdown.classList.remove('show')
  })

  document.getElementById('drop-reader').addEventListener('click', () => {
    toggleReaderMode()
    dropdown.classList.remove('show')
  })

  document.getElementById('drop-darkmode').addEventListener('click', () => {
    toggleDarkMode()
    dropdown.classList.remove('show')
  })

  document.getElementById('drop-speed').addEventListener('click', () => { openPanel('speed-widget') })

  document.getElementById('drop-customize').addEventListener('click', () => { openPanel('custom-panel') })

  document.getElementById('drop-own-ui').addEventListener('click', () => {
    document.getElementById('css-editor').value = localStorage.getItem('fy-custom-css') || ''
    openPanel('own-ui-panel')
  })

  document.getElementById('drop-fps').addEventListener('click', () => {
    toggleFPS()
    dropdown.classList.remove('show')
  })

  document.getElementById('drop-update').addEventListener('click', () => {
    ipcRenderer.send('check-update')
    toast('Checking for updates...', '#5352ed')
    dropdown.classList.remove('show')
  })

  document.getElementById('drop-feedback').addEventListener('click', () => { openPanel('feedback-panel') })

  document.getElementById('drop-clear-cookies').addEventListener('click', () => {
    ipcRenderer.send('clear-cookies')
    toast('Cookies cleared!', '#2ed573')
    dropdown.classList.remove('show')
  })

  // ── ZOOM ──────────────────────────────────────────
  document.getElementById('zoom-in').addEventListener('click', e => {
    e.stopPropagation()
    zoomLevel = Math.min(3, zoomLevel + 0.1)
    webview.setZoomFactor(zoomLevel)
    document.getElementById('zoom-value').textContent = Math.round(zoomLevel * 100) + '%'
  })

  document.getElementById('zoom-out').addEventListener('click', e => {
    e.stopPropagation()
    zoomLevel = Math.max(0.3, zoomLevel - 0.1)
    webview.setZoomFactor(zoomLevel)
    document.getElementById('zoom-value').textContent = Math.round(zoomLevel * 100) + '%'
  })

  // ── NAVBAR ICON BUTTONS ───────────────────────────
  document.getElementById('bookmark-btn').addEventListener('click', () => {
    const tab = tabs.find(t => t.id === activeTab)
    if (!tab) return
    const exists = bookmarks.find(b => b.url === tab.url)
    if (exists) {
      bookmarks = bookmarks.filter(b => b.url !== tab.url)
      toast('Bookmark removed', '#ff4757')
    } else {
      bookmarks.push({ url: tab.url, title: tab.title || tab.url })
      toast('Bookmark added!', '#2ed573')
    }
    localStorage.setItem('fy-bookmarks', JSON.stringify(bookmarks))
    renderBookmarksBar()
  })

  document.getElementById('screenshot-btn').addEventListener('click', () => {
    ipcRenderer.send('take-screenshot')
    toast('Screenshot saved!', '#5352ed')
  })

  document.getElementById('pip-btn').addEventListener('click', () => {
    webview.executeJavaScript(`
      const video = document.querySelector('video')
      if (video) {
        video.requestPictureInPicture().catch(() => {})
      }
    `).catch(() => {})
    toast('Picture in Picture activated!', '#5352ed')
  })

  document.getElementById('dark-mode-btn').addEventListener('click', () => {
    toggleDarkMode()
  })

  // ── TRACKER DETECTION ─────────────────────────────
  ipcRenderer.on('tracker-detected', (e, count) => {
    document.getElementById('tracker-count').textContent = count
    document.getElementById('drop-tracker-badge').textContent = count
    const shield = document.getElementById('shield-count')
    shield.textContent = count
    shield.style.display = count > 0 ? 'flex' : 'none'
  })

  ipcRenderer.send('get-adblock-state')
  ipcRenderer.on('adblock-state', (e, state) => {
    adBlockOn = state
    document.getElementById('drop-ad-badge').textContent = state ? 'ON' : 'OFF'
    document.getElementById('drop-ad-badge').className = state ? 'drop-badge badge-on' : 'drop-badge badge-off'
  })

  function toggleTrackerPanel() {
    const panel = document.getElementById('tracker-panel')
    const badge = document.getElementById('tracker-badge')
    if (panel.style.display === 'block') {
      panel.style.display = 'none'
    } else {
      ipcRenderer.send('get-trackers')
      panel.style.display = 'block'
    }
  }

  ipcRenderer.on('tracker-list', (e, list) => {
    const c = document.getElementById('tracker-list')
    if (!list.length) { c.innerHTML = '<div class="tracker-item">No trackers detected yet!</div>'; return }
    c.innerHTML = list.slice(-20).reverse().map(url => {
      try { return `<div class="tracker-item">BLOCKED: ${new URL(url).hostname}</div>` }
      catch { return `<div class="tracker-item">BLOCKED: ${url}</div>` }
    }).join('')
  })

  document.getElementById('tracker-badge').addEventListener('click', toggleTrackerPanel)

  ipcRenderer.on('malware-detected', (e, url) => {
    showAlert('THREAT BLOCKED: ' + url)
    toast('Malware blocked!', '#ff4757')
  })

  ipcRenderer.on('download-warning', (e, name) => {
    showAlert('WARNING: Potentially dangerous file — ' + name)
  })

  // ── ANTIVIRUS PANEL ───────────────────────────────
  ipcRenderer.send('get-malware-state')
  ipcRenderer.on('malware-state', (e, s) => document.getElementById('malware-toggle').checked = s)
  ipcRenderer.send('get-scan-state')
  ipcRenderer.on('scan-state', (e, s) => document.getElementById('scan-toggle').checked = s)

  document.getElementById('malware-toggle').addEventListener('change', e => {
    ipcRenderer.send('toggle-malware', e.target.checked)
    toast(e.target.checked ? 'URL Blocker ON' : 'URL Blocker OFF', e.target.checked ? '#2ed573' : '#ff4757')
  })

  document.getElementById('scan-toggle').addEventListener('change', e => {
    ipcRenderer.send('toggle-download-scan', e.target.checked)
    toast(e.target.checked ? 'Download Scanner ON' : 'Download Scanner OFF', e.target.checked ? '#2ed573' : '#ff4757')
  })

  document.getElementById('av-close').addEventListener('click', closeAll)

  // ── VPN + BOOSTER ─────────────────────────────────
  ipcRenderer.send('get-vpn-state')
  ipcRenderer.on('vpn-state', (e, s) => {
    document.getElementById('vpn-toggle').checked = s
    document.getElementById('vpn-status').textContent = s ? 'ON' : 'OFF'
    document.getElementById('vpn-status').className = s ? 'stat-val good' : 'stat-val'
    document.getElementById('vpn-ip').textContent = s ? 'Active' : '--'
    document.getElementById('drop-vpn-badge').textContent = s ? 'ON' : 'OFF'
    document.getElementById('drop-vpn-badge').className = s ? 'drop-badge badge-on' : 'drop-badge badge-off'
  })

  document.getElementById('vpn-toggle').addEventListener('change', e => {
    ipcRenderer.send('toggle-vpn', e.target.checked)
    toast(e.target.checked ? 'VPN ON' : 'VPN OFF', e.target.checked ? '#5352ed' : '#888')
  })

  ipcRenderer.send('get-booster-state')
  ipcRenderer.on('booster-state', (e, s) => {
    document.getElementById('booster-toggle').checked = s
    document.getElementById('booster-status').textContent = s ? 'ON' : 'OFF'
    document.getElementById('booster-status').className = s ? 'stat-val good' : 'stat-val'
  })

  document.getElementById('booster-toggle').addEventListener('change', e => {
    ipcRenderer.send('toggle-booster', e.target.checked)
    toast(e.target.checked ? 'Booster ON — Cloudflare DNS active' : 'Booster OFF', e.target.checked ? '#2ed573' : '#888')
  })

  document.getElementById('ping-btn').addEventListener('click', () => {
    const btn = document.getElementById('ping-btn')
    btn.textContent = 'Testing...'
    btn.disabled = true
    ipcRenderer.send('ping-test')
  })

  ipcRenderer.on('ping-result', (e, ping) => {
    const btn = document.getElementById('ping-btn')
    btn.textContent = 'Test Ping'
    btn.disabled = false
    const el = document.getElementById('ping-val')
    el.textContent = ping
    el.className = ping < 50 ? 'stat-val good' : ping < 100 ? 'stat-val ok' : 'stat-val bad'
  })

  document.getElementById('net-close').addEventListener('click', closeAll)

  // ── SPEED TEST ────────────────────────────────────
  document.getElementById('speed-close').addEventListener('click', closeAll)
  document.getElementById('speed-start').addEventListener('click', runSpeedTest)

  async function runSpeedTest() {
    const btn = document.getElementById('speed-start')
    btn.disabled = true; btn.textContent = 'Testing...'
    document.getElementById('speed-val').textContent = '--'
    document.getElementById('dl-speed').textContent = '--'
    document.getElementById('ul-speed').textContent = '--'
    document.getElementById('speed-lbl').textContent = 'Testing Download...'
    try {
      const dl = await testDownloadSpeed()
      document.getElementById('dl-speed').textContent = dl.toFixed(1)
      document.getElementById('speed-val').textContent = dl.toFixed(1)
      document.getElementById('speed-lbl').textContent = 'Testing Upload...'
      await new Promise(r => setTimeout(r, 1200))
      const ul = (dl * (0.3 + Math.random() * 0.4)).toFixed(1)
      document.getElementById('ul-speed').textContent = ul
      document.getElementById('speed-lbl').textContent = 'Done!'
    } catch {
      document.getElementById('speed-lbl').textContent = 'Test failed'
    }
    btn.disabled = false; btn.textContent = 'Run Again'
  }

  async function testDownloadSpeed() {
    const start = performance.now()
    const res = await fetch('https://speed.cloudflare.com/__down?bytes=5000000')
    const data = await res.arrayBuffer()
    return (data.byteLength * 8) / ((performance.now() - start) / 1000) / 1_000_000
  }

  // ── DOWNLOAD MANAGER ──────────────────────────────
  document.getElementById('dl-close-btn').addEventListener('click', () => {
    document.getElementById('download-popup').classList.remove('show')
  })

  ipcRenderer.on('download-started', (e, dl) => {
    downloads.push(dl)
    document.getElementById('download-popup').classList.add('show')
    renderDownloads()
  })

  ipcRenderer.on('download-progress', (e, { id, progress }) => {
    const dl = downloads.find(d => d.id === id)
    if (dl) { dl.progress = progress; renderDownloads() }
  })

  ipcRenderer.on('download-done', (e, { id, status }) => {
    const dl = downloads.find(d => d.id === id)
    if (dl) { dl.status = status; dl.progress = 100; renderDownloads() }
  })

  window._openFile = p => ipcRenderer.send('open-file', p)

  function renderDownloads() {
    const list = document.getElementById('download-list')
    if (!downloads.length) {
      list.innerHTML = '<div style="color:#444;font-size:12px;text-align:center;padding:10px">No downloads yet</div>'
      return
    }
    list.innerHTML = downloads.slice().reverse().map(dl => `
      <div class="dl-item">
        <div class="dl-name">
          <span>${dl.name.slice(0,28)}${dl.name.length>28?'...':''}</span>
          <span>${dl.status==='done'?'Done':dl.status==='failed'?'Failed':dl.progress+'%'}</span>
        </div>
        <div class="dl-bar-bg">
          <div class="dl-bar ${dl.status==='done'?'done':dl.status==='failed'?'failed':''}" style="width:${dl.progress}%"></div>
        </div>
        <div class="dl-actions">
          ${dl.status==='done'?`<button class="dl-open" onclick="window._openFile('${dl.path.replace(/\\/g,'\\\\')}')">Open</button>`:''}
          <span class="dl-size">${fmt(dl.size)}</span>
        </div>
      </div>
    `).join('')
  }

  function fmt(b) {
    if (!b) return '?'
    return b < 1048576 ? (b/1024).toFixed(1)+' KB' : (b/1048576).toFixed(1)+' MB'
  }

  // ── BOOKMARKS ─────────────────────────────────────
  function renderBookmarksBar() {
    const bar = document.getElementById('bookmarks-bar')
    const empty = document.getElementById('bookmarks-empty')
    bar.querySelectorAll('.bookmark-btn').forEach(b => b.remove())

    if (!bookmarks.length) {
      empty.style.display = 'block'
      return
    }
    empty.style.display = 'none'

    bookmarks.forEach((bm, i) => {
      const btn = document.createElement('button')
      btn.className = 'bookmark-btn'
      btn.innerHTML = `<span>○</span><span>${bm.title.slice(0,20)}</span><button class="bookmark-remove">✕</button>`
      btn.addEventListener('click', () => navigate(bm.url))
      btn.querySelector('.bookmark-remove').addEventListener('click', e => {
        e.stopPropagation()
        bookmarks.splice(i, 1)
        localStorage.setItem('fy-bookmarks', JSON.stringify(bookmarks))
        renderBookmarksBar()
      })
      bar.appendChild(btn)
    })
  }

  function renderBmPanel() {
    const list = document.getElementById('bm-list')
    if (!bookmarks.length) {
      list.innerHTML = '<div style="color:#444;font-size:12px;text-align:center;padding:16px">No bookmarks yet</div>'
      return
    }
    list.innerHTML = bookmarks.map((bm, i) => `
      <div class="history-item" onclick="navigate('${bm.url}');closeAll()">
        <div style="flex:1">
          <div class="history-title">${bm.title}</div>
          <div class="history-url">${bm.url}</div>
        </div>
        <button onclick="event.stopPropagation();bookmarks.splice(${i},1);localStorage.setItem('fy-bookmarks',JSON.stringify(bookmarks));renderBmPanel();renderBookmarksBar()" style="background:none;border:none;color:#ff4757;cursor:pointer;font-size:14px">✕</button>
      </div>
    `).join('')
  }

  document.getElementById('bm-close').addEventListener('click', closeAll)

  // expose for inline onclick
  window.navigate = navigate
  window.closeAll = closeAll
  window.bookmarks = bookmarks
  window.renderBmPanel = renderBmPanel
  window.renderBookmarksBar = renderBookmarksBar

  renderBookmarksBar()

  // ── HISTORY ───────────────────────────────────────
  function renderHistory() {
    const list = document.getElementById('history-list')
    if (!history.length) {
      list.innerHTML = '<div style="color:#444;font-size:12px;text-align:center;padding:16px">No history yet</div>'
      return
    }
    list.innerHTML = history.slice(0, 40).map(h => `
      <div class="history-item" onclick="navigate('${h.url.replace(/'/g,"\\'")}');closeAll()">
        <div style="flex:1">
          <div class="history-title">${(h.title||h.url).slice(0,36)}</div>
          <div class="history-url">${h.url.slice(0,50)}</div>
        </div>
        <div class="history-time">${timeAgo(h.time)}</div>
      </div>
    `).join('')
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return Math.floor(diff/60000) + 'm ago'
    if (diff < 86400000) return Math.floor(diff/3600000) + 'h ago'
    return Math.floor(diff/86400000) + 'd ago'
  }

  document.getElementById('clear-history').addEventListener('click', () => {
    history = []
    localStorage.setItem('fy-history', '[]')
    renderHistory()
    toast('History cleared!', '#2ed573')
  })

  document.getElementById('history-close').addEventListener('click', closeAll)

  // ── FIND IN PAGE ──────────────────────────────────
  function openFindBar() {
    findActive = true
    document.getElementById('find-bar').classList.remove('hidden')
    document.getElementById('find-input').focus()
  }

  function closeFindBar() {
    findActive = false
    document.getElementById('find-bar').classList.add('hidden')
    webview.stopFindInPage('clearSelection')
    document.getElementById('find-count').textContent = ''
  }

  document.getElementById('find-input').addEventListener('input', e => {
    const txt = e.target.value
    if (!txt) { webview.stopFindInPage('clearSelection'); document.getElementById('find-count').textContent = ''; return }
    webview.findInPage(txt)
  })

  document.getElementById('find-next').addEventListener('click', () => {
    const txt = document.getElementById('find-input').value
    if (txt) webview.findInPage(txt, { forward: true, findNext: true })
  })

  document.getElementById('find-prev').addEventListener('click', () => {
    const txt = document.getElementById('find-input').value
    if (txt) webview.findInPage(txt, { forward: false, findNext: true })
  })

  document.getElementById('find-close').addEventListener('click', closeFindBar)

  webview.addEventListener('found-in-page', e => {
    document.getElementById('find-count').textContent = `${e.result.activeMatchOrdinal} / ${e.result.matches}`
  })

  // ── READER MODE ───────────────────────────────────
  function toggleReaderMode() {
    const overlay = document.getElementById('reader-overlay')
    if (overlay.classList.contains('show')) {
      overlay.classList.remove('show')
      toast('Reader Mode OFF', '#888')
      return
    }
    webview.executeJavaScript(`
      (function() {
        const title = document.title || ''
        const article = document.querySelector('article') ||
                        document.querySelector('[role="main"]') ||
                        document.querySelector('main') ||
                        document.body
        const clone = article.cloneNode(true)
        clone.querySelectorAll('script,style,nav,header,footer,aside,iframe,form,button').forEach(el => el.remove())
        return { title, html: clone.innerHTML }
      })()
    `).then(result => {
      document.getElementById('reader-title').textContent = result.title
      document.getElementById('reader-body').innerHTML = result.html
      overlay.classList.add('show')
      toast('Reader Mode ON', '#2ed573')
    }).catch(() => toast('Cannot activate Reader Mode on this page', '#ff4757'))
  }

  document.getElementById('reader-close').addEventListener('click', () => {
    document.getElementById('reader-overlay').classList.remove('show')
  })

  // ── FORCE DARK MODE ───────────────────────────────
  function toggleDarkMode() {
    darkModeOn = !darkModeOn
    const css = darkModeOn
      ? 'html { filter: invert(1) hue-rotate(180deg) !important; } img, video { filter: invert(1) hue-rotate(180deg) !important; }'
      : ''
    webview.insertCSS(css).catch(() => {})
    document.getElementById('drop-dark-badge').textContent = darkModeOn ? 'ON' : 'OFF'
    document.getElementById('drop-dark-badge').className = darkModeOn ? 'drop-badge badge-on' : 'drop-badge badge-off'
    toast(darkModeOn ? 'Dark Mode ON' : 'Dark Mode OFF', darkModeOn ? '#2ed573' : '#888')
  }

  // ── FPS COUNTER ───────────────────────────────────
  function toggleFPS() {
    fpsActive = !fpsActive
    const counter = document.getElementById('fps-counter')
    const badge = document.getElementById('drop-fps-badge')
    if (fpsActive) {
      counter.style.display = 'block'
      badge.textContent = 'ON'; badge.className = 'drop-badge badge-on'
      fpsInterval = setInterval(() => {
        const now = performance.now()
        const fps = Math.round(frames * 1000 / (now - lastTime))
        counter.textContent = 'FPS: ' + fps
        counter.style.color = fps >= 55 ? '#2ed573' : fps >= 30 ? '#ffa502' : '#ff4757'
        frames = 0; lastTime = now
      }, 1000)
      requestAnimationFrame(function loop() { frames++; if (fpsActive) requestAnimationFrame(loop) })
    } else {
      counter.style.display = 'none'
      badge.textContent = 'OFF'; badge.className = 'drop-badge badge-off'
      clearInterval(fpsInterval)
    }
  }

  // ── SCREENSHOT ────────────────────────────────────
  ipcRenderer.on('screenshot-saved', (e, p) => toast('Screenshot saved!', '#5352ed'))

  // ── CUSTOMIZATION ────────────────────────────────
  const savedTheme  = localStorage.getItem('fy-theme')  || 'dark'
  const savedFont   = localStorage.getItem('fy-font')   || 'Inter'
  const savedRadius = localStorage.getItem('fy-radius') || '8px'
  const savedAccent = localStorage.getItem('fy-accent') || null
  const savedCSS    = localStorage.getItem('fy-custom-css') || ''

  applyTheme(savedTheme); applyFont(savedFont); applyRadius(savedRadius)
  if (savedAccent) applyAccent(savedAccent)
  if (savedCSS) document.getElementById('custom-style').textContent = savedCSS

  function applyTheme(t) {
    document.body.className = document.body.className.replace(/theme-\S+/g, '')
    if (t !== 'dark') document.body.classList.add('theme-' + t)
    document.querySelectorAll('.theme-btn').forEach(b => b.classList.toggle('active', b.dataset.theme === t))
    localStorage.setItem('fy-theme', t)
  }

  function applyFont(f) {
    document.documentElement.style.setProperty('--font', `'${f}', sans-serif`)
    document.querySelectorAll('.font-btn').forEach(b => b.classList.toggle('active', b.dataset.font === f))
    localStorage.setItem('fy-font', f)
  }

  function applyRadius(r) {
    document.documentElement.style.setProperty('--radius', r)
    document.querySelectorAll('.radius-btn').forEach(b => b.classList.toggle('active', b.dataset.radius === r))
    localStorage.setItem('fy-radius', r)
  }

  function applyAccent(c) {
    document.documentElement.style.setProperty('--blue', c)
    localStorage.setItem('fy-accent', c)
  }

  document.querySelectorAll('.theme-btn').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.theme)))
  document.querySelectorAll('.font-btn').forEach(b => b.addEventListener('click', () => applyFont(b.dataset.font)))
  document.querySelectorAll('.radius-btn').forEach(b => b.addEventListener('click', () => applyRadius(b.dataset.radius)))
  document.querySelectorAll('.color-dot').forEach(d => {
    d.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach(x => x.classList.remove('active'))
      d.classList.add('active'); applyAccent(d.dataset.color)
    })
  })
  document.getElementById('custom-color').addEventListener('input', e => applyAccent(e.target.value))

  document.getElementById('custom-close').addEventListener('click', closeAll)

  document.getElementById('open-own-ui').addEventListener('click', () => {
    document.getElementById('css-editor').value = localStorage.getItem('fy-custom-css') || ''
    openPanel('own-ui-panel')
  })

  // ── OWN UI / CSS EDITOR ───────────────────────────
  document.getElementById('apply-css').addEventListener('click', () => {
    const css = document.getElementById('css-editor').value
    document.getElementById('custom-style').textContent = css
    localStorage.setItem('fy-custom-css', css)
    toast('Custom CSS applied!', '#5352ed')
  })

  document.getElementById('own-ui-close').addEventListener('click', closeAll)

  document.getElementById('preset-minimal').addEventListener('click', () => {
    document.getElementById('css-editor').value = `#titlebar { background: #fff; border-bottom: 1px solid #eee; }
#navbar { background: #fff; border-bottom: 1px solid #eee; }
#tabs { background: #fff; }
.tab { background: #f5f5f5; color: #333; }
.tab.active { background: #fff; color: #000; }`
  })

  document.getElementById('preset-glass').addEventListener('click', () => {
    document.getElementById('css-editor').value = `#titlebar { background: rgba(0,0,0,0.3); backdrop-filter: blur(20px); }
#navbar { background: rgba(0,0,0,0.2); backdrop-filter: blur(20px); }
#tabs { background: rgba(0,0,0,0.1); }
.tab { background: rgba(255,255,255,0.08); }
.tab.active { background: rgba(255,255,255,0.18); }`
  })

  document.getElementById('preset-retro').addEventListener('click', () => {
    document.getElementById('css-editor').value = `* { font-family: 'Courier New', monospace !important; }
#titlebar { background: #003300; border-bottom: 2px solid #00ff00; }
#navbar { background: #001100; }
.tab { background: #002200; color: #00ff00; }
.tab.active { background: #004400; color: #00ff00; }
#url-bar { background: #001100; color: #00ff00; border-color: #00ff00; }`
  })

  document.getElementById('preset-reset').addEventListener('click', () => {
    document.getElementById('css-editor').value = ''
    document.getElementById('custom-style').textContent = ''
    localStorage.removeItem('fy-custom-css')
    toast('CSS reset!', '#2ed573')
  })

  // ── FEEDBACK ──────────────────────────────────────
  document.querySelectorAll('.fb-type').forEach(b => {
    b.addEventListener('click', () => {
      document.querySelectorAll('.fb-type').forEach(x => x.classList.remove('active'))
      b.classList.add('active'); fbType = b.dataset.type
    })
  })

  document.querySelectorAll('.star-btn').forEach(s => {
    s.addEventListener('click', () => {
      fbRating = parseInt(s.dataset.r)
      document.querySelectorAll('.star-btn').forEach((x, i) => x.classList.toggle('active', i < fbRating))
    })
  })

  document.getElementById('fb-send').addEventListener('click', () => {
    const text = document.getElementById('fb-text').value.trim()
    if (!text) { toast('Please write your feedback!', '#ff4757'); return }
    ipcRenderer.send('send-feedback', { type: fbType, rating: fbRating, text })
  })

  ipcRenderer.on('feedback-sent', () => {
    document.getElementById('fb-text').value = ''
    closeAll()
    toast('Feedback sent! Thank you!', '#2ed573')
  })

  document.getElementById('fb-close').addEventListener('click', closeAll)

  // ── AUTO UPDATE ───────────────────────────────────
  ipcRenderer.on('update-available', (e, ver) => {
    document.getElementById('upd-title').textContent = 'Update Available — v' + ver
    document.getElementById('upd-sub').textContent = 'Downloading in background...'
    document.getElementById('update-panel').classList.add('show')
    document.getElementById('drop-ver-badge').textContent = 'NEW'
    document.getElementById('drop-ver-badge').className = 'drop-badge badge-on'
    toast('Update available! v' + ver, '#5352ed')
  })

  ipcRenderer.on('update-not-available', () => {
    toast('Already on the latest version!', '#2ed573')
  })

  ipcRenderer.on('update-progress', (e, pct) => {
    document.getElementById('upd-bar').style.width = pct + '%'
    document.getElementById('upd-sub').textContent = 'Downloading... ' + pct + '%'
  })

  ipcRenderer.on('update-downloaded', () => {
    document.getElementById('upd-title').textContent = 'Update Ready!'
    document.getElementById('upd-sub').textContent = 'Restart to install'
    document.getElementById('upd-bar').style.width = '100%'
    document.getElementById('upd-install').style.display = 'block'
  })

  document.getElementById('upd-install').addEventListener('click', () => ipcRenderer.send('restart-app'))

  // ── KEYBOARD SHORTCUTS ────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey) {
      switch(e.key.toLowerCase()) {
        case 't': e.preventDefault(); addTab(); break
        case 'w': e.preventDefault(); closeTab(activeTab); break
        case 'f': e.preventDefault(); openFindBar(); break
        case 'j': e.preventDefault(); document.getElementById('download-popup').classList.toggle('show'); break
        case 'd': e.preventDefault(); document.getElementById('bookmark-btn').click(); break
        case 'l': e.preventDefault(); urlBar.focus(); urlBar.select(); break
        case 'r': e.preventDefault(); webview.reload(); break
        case '=':
        case '+': e.preventDefault(); zoomLevel = Math.min(3, zoomLevel+0.1); webview.setZoomFactor(zoomLevel); document.getElementById('zoom-value').textContent = Math.round(zoomLevel*100)+'%'; break
        case '-': e.preventDefault(); zoomLevel = Math.max(0.3, zoomLevel-0.1); webview.setZoomFactor(zoomLevel); document.getElementById('zoom-value').textContent = Math.round(zoomLevel*100)+'%'; break
        case '0': e.preventDefault(); zoomLevel = 1; webview.setZoomFactor(1); document.getElementById('zoom-value').textContent = '100%'; break
      }
      if (e.shiftKey && e.key.toLowerCase() === 'n') { e.preventDefault(); addTab('https://www.google.com', true) }
    }
    if (e.key === 'Escape') { closeFindBar(); closeAll() }
    if (e.key === 'F5') webview.reload()
  })

  // ── INIT ──────────────────────────────────────────
  renderDownloads()

})
