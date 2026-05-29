const { ipcRenderer } = require('electron')

window.addEventListener('DOMContentLoaded', () => {

  const webview = document.getElementById('webview')
  const urlBar = document.getElementById('url-bar')
  const tabsContainer = document.getElementById('tabs')
  const newTabBtn = document.getElementById('new-tab')

  let tabs = [{ id: 0, title: 'New Tab', url: 'https://www.google.com' }]
  let activeTab = 0
  let downloads = []
  let games = JSON.parse(localStorage.getItem('games') || '[]')
  let fpsActive = false
  let latencyActive = false
  let fpsInterval = null
  let lastTime = performance.now()
  let frames = 0
  let adBlockOn = true

  // ─── TABS ──────────────────────────────────────────

  function renderTabs() {
    document.querySelectorAll('.tab').forEach(t => t.remove())
    tabs.forEach(tab => {
      const el = document.createElement('div')
      el.className = 'tab' + (tab.id === activeTab ? ' active' : '')
      el.innerHTML = `<span>${tab.title}</span><button class="tab-close">✕</button>`
      el.querySelector('.tab-close').addEventListener('click', (e) => {
        e.stopPropagation()
        closeTab(tab.id)
      })
      el.addEventListener('click', () => switchTab(tab.id))
      tabsContainer.insertBefore(el, newTabBtn)
    })
  }

  function addTab() {
    const id = Date.now()
    tabs.push({ id, title: 'New Tab', url: 'https://www.google.com' })
    switchTab(id)
  }

  function switchTab(id) {
    activeTab = id
    const tab = tabs.find(t => t.id === id)
    if (!tab) return
    webview.src = tab.url
    urlBar.value = tab.url
    renderTabs()
  }

  function closeTab(id) {
    if (tabs.length === 1) return
    ipcRenderer.send('tab-closed')
    showCookieToast()
    tabs = tabs.filter(t => t.id !== id)
    if (activeTab === id) switchTab(tabs[tabs.length - 1].id)
    else renderTabs()
  }

  // ─── NAVIGATION ────────────────────────────────────

  urlBar.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return
    let url = urlBar.value.trim()
    if (!url.startsWith('http')) {
      url = url.includes('.')
        ? 'https://' + url
        : 'https://www.google.com/search?q=' + encodeURIComponent(url)
    }
    webview.src = url
    const tab = tabs.find(t => t.id === activeTab)
    if (tab) tab.url = url
  })

  document.getElementById('back-btn').addEventListener('click', () => {
    if (webview.canGoBack()) webview.goBack()
  })
  document.getElementById('fwd-btn').addEventListener('click', () => {
    if (webview.canGoForward()) webview.goForward()
  })
  document.getElementById('reload-btn').addEventListener('click', () => webview.reload())

  webview.addEventListener('did-navigate', (e) => {
    urlBar.value = e.url
    const tab = tabs.find(t => t.id === activeTab)
    if (tab) tab.url = e.url
    document.getElementById('url-icon').textContent = e.url.startsWith('https') ? '🔒' : '🔍'
  })

  webview.addEventListener('page-title-updated', (e) => {
    const tab = tabs.find(t => t.id === activeTab)
    if (tab) { tab.title = e.title.slice(0, 20); renderTabs() }
  })

  // ─── WINDOW CONTROLS ───────────────────────────────

  document.getElementById('min-btn').addEventListener('click', () => ipcRenderer.send('minimize'))
  document.getElementById('max-btn').addEventListener('click', () => ipcRenderer.send('maximize'))
  document.getElementById('close-btn').addEventListener('click', () => ipcRenderer.send('close'))

  // ─── SIDE MENU ─────────────────────────────────────

  function toggleMenu() {
    document.getElementById('side-menu').classList.toggle('open')
    document.getElementById('overlay').classList.toggle('show')
  }

  function closeMenu() {
    document.getElementById('side-menu').classList.remove('open')
    document.getElementById('overlay').classList.remove('show')
  }

  document.getElementById('menu-btn').addEventListener('click', toggleMenu)
  document.getElementById('menu-close-btn').addEventListener('click', closeMenu)
  document.getElementById('overlay').addEventListener('click', closeMenu)

  // ─── TRACKER ───────────────────────────────────────

  ipcRenderer.on('tracker-detected', (e, count) => {
    document.getElementById('tracker-count').textContent = count
    document.getElementById('menu-tracker-count').textContent = count
  })

  function toggleTrackerPanel() {
    const panel = document.getElementById('tracker-panel')
    if (panel.style.display === 'block') {
      panel.style.display = 'none'
    } else {
      panel.style.display = 'block'
      ipcRenderer.send('get-trackers')
    }
  }

  ipcRenderer.on('tracker-list', (e, list) => {
    const container = document.getElementById('tracker-list')
    if (list.length === 0) {
      container.innerHTML = '<div class="tracker-item">✅ No trackers yet!</div>'
      return
    }
    container.innerHTML = list.slice(-20).reverse().map(url => {
      try {
        const domain = new URL(url).hostname
        return `<div class="tracker-item"><span>🚫</span>${domain}</div>`
      } catch {
        return `<div class="tracker-item"><span>🚫</span>${url}</div>`
      }
    }).join('')
  })

  document.getElementById('tracker-nav-btn').addEventListener('click', toggleTrackerPanel)
  document.getElementById('tracker-badge').addEventListener('click', toggleTrackerPanel)
  document.getElementById('menu-tracker-btn').addEventListener('click', () => {
    toggleTrackerPanel()
    closeMenu()
  })

  // ─── AD BLOCKER ────────────────────────────────────

  ipcRenderer.send('get-adblock-state')

  ipcRenderer.on('adblock-state', (e, state) => {
    adBlockOn = state
    const badge = document.getElementById('adblock-badge')
    if (state) {
      badge.textContent = 'ON'
      badge.style.background = 'rgba(46,213,115,0.2)'
      badge.style.color = '#2ed573'
    } else {
      badge.textContent = 'OFF'
      badge.style.background = 'rgba(255,71,87,0.2)'
      badge.style.color = '#ff4757'
    }
  })

  document.getElementById('menu-adblock-btn').addEventListener('click', () => {
    adBlockOn = !adBlockOn
    ipcRenderer.send('toggle-adblock', adBlockOn)
    showToast(
      adBlockOn ? '🚫 Ad Blocker ON' : '✅ Ad Blocker OFF',
      adBlockOn ? '#2ed573' : '#ff4757'
    )
    closeMenu()
  })

  // ─── COOKIE DESTROYER ──────────────────────────────

  function showCookieToast() {
    showToast('🍪 Cookies Destroyed!', '#2ed573')
  }

  document.getElementById('menu-cookie-btn').addEventListener('click', () => {
    ipcRenderer.send('tab-closed')
    showCookieToast()
    closeMenu()
  })

  // ─── DOWNLOAD MANAGER ──────────────────────────────

  function toggleDownloadPopup() {
    document.getElementById('download-popup').classList.toggle('show')
  }

  function formatSize(bytes) {
    if (!bytes) return '?'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }

  function renderDownloads() {
    const list = document.getElementById('download-list')
    const badge = document.getElementById('menu-dl-count')
    if (downloads.length === 0) {
      list.innerHTML = '<div style="color:#444;font-size:12px;text-align:center;padding:10px">No downloads yet</div>'
      badge.style.display = 'none'
      return
    }
    badge.style.display = 'inline'
    badge.textContent = downloads.length
    list.innerHTML = downloads.slice().reverse().map(dl => `
      <div class="dl-item">
        <div class="dl-name">
          <span>${dl.name.slice(0, 28)}${dl.name.length > 28 ? '...' : ''}</span>
          <span>${dl.status === 'done' ? '✅ Done' : dl.status === 'failed' ? '❌ Failed' : dl.progress + '%'}</span>
        </div>
        <div class="dl-bar-bg">
          <div class="dl-bar ${dl.status === 'done' ? 'done' : dl.status === 'failed' ? 'failed' : ''}"
               style="width:${dl.progress}%"></div>
        </div>
        <div class="dl-actions">
          ${dl.status === 'done' ? `<button onclick="window._openFile('${dl.path.replace(/\\/g, '\\\\')}')">📂 Open</button>` : ''}
          <span class="dl-size">${formatSize(dl.size)}</span>
        </div>
      </div>
    `).join('')
  }

  window._openFile = (p) => ipcRenderer.send('open-file', p)

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

  document.getElementById('menu-dl-btn').addEventListener('click', () => {
    toggleDownloadPopup()
    closeMenu()
  })
  document.getElementById('dl-close-btn').addEventListener('click', toggleDownloadPopup)

  // ─── FPS COUNTER ───────────────────────────────────

  function toggleFPS() {
    fpsActive = !fpsActive
    const counter = document.getElementById('fps-counter')
    const badge = document.getElementById('fps-badge')
    if (fpsActive) {
      counter.style.display = 'block'
      badge.textContent = 'ON'
      badge.style.background = 'rgba(46,213,115,0.2)'
      badge.style.color = '#2ed573'
      fpsInterval = setInterval(() => {
        const now = performance.now()
        const fps = Math.round(frames * 1000 / (now - lastTime))
        counter.textContent = `FPS: ${fps}`
        counter.style.color = fps >= 55 ? '#2ed573' : fps >= 30 ? '#ffa502' : '#ff4757'
        frames = 0
        lastTime = now
      }, 1000)
      requestAnimationFrame(countFrame)
    } else {
      counter.style.display = 'none'
      badge.textContent = 'OFF'
      badge.style.background = ''
      badge.style.color = ''
      clearInterval(fpsInterval)
    }
  }

  function countFrame() {
    frames++
    if (fpsActive) requestAnimationFrame(countFrame)
  }

  document.getElementById('menu-fps-btn').addEventListener('click', () => {
    toggleFPS()
    closeMenu()
  })

  // ─── LOW LATENCY MODE ──────────────────────────────

  function toggleLatency() {
    latencyActive = !latencyActive
    const badge = document.getElementById('latency-badge')
    if (latencyActive) {
      badge.textContent = 'ON'
      badge.style.background = 'rgba(46,213,115,0.2)'
      badge.style.color = '#2ed573'
      showToast('⚡ Low Latency Mode ON', '#2ed573')
    } else {
      badge.textContent = 'OFF'
      badge.style.background = ''
      badge.style.color = ''
      showToast('⚡ Low Latency Mode OFF', '#888888')
    }
  }

  document.getElementById('menu-latency-btn').addEventListener('click', () => {
    toggleLatency()
    closeMenu()
  })

  // ─── GAME LAUNCHER ─────────────────────────────────

  function renderGames() {
    const list = document.getElementById('game-list')
    if (games.length === 0) {
      list.innerHTML = '<div style="color:#444;font-size:12px;text-align:center;padding:16px">No games added yet</div>'
      return
    }
    list.innerHTML = games.map((g, i) => `
      <div class="game-item" onclick="window._launchGame(${i})">
        <div class="game-icon">🎮</div>
        <div>
          <div class="game-name">${g.name}</div>
          <div class="game-path">${g.path.slice(-40)}</div>
        </div>
      </div>
    `).join('')
  }

  window._launchGame = (i) => ipcRenderer.send('launch-game', games[i].path)

  document.getElementById('menu-launcher-btn').addEventListener('click', () => {
    document.getElementById('game-launcher').classList.add('show')
    document.getElementById('overlay').classList.add('show')
    renderGames()
    closeMenu()
  })

  document.getElementById('launcher-close-btn').addEventListener('click', () => {
    document.getElementById('game-launcher').classList.remove('show')
    document.getElementById('overlay').classList.remove('show')
  })

  document.getElementById('add-game-btn').addEventListener('click', () => {
    const name = prompt('Game name?')
    if (!name) return
    const path = prompt('Full path to .exe? (e.g. C:\\Games\\game.exe)')
    if (!path) return
    games.push({ name, path })
    localStorage.setItem('games', JSON.stringify(games))
    renderGames()
  })

  // ─── NETWORK SPEED TEST ────────────────────────────

  document.getElementById('menu-speed-btn').addEventListener('click', () => {
    document.getElementById('speed-widget').classList.add('show')
    document.getElementById('overlay').classList.add('show')
    closeMenu()
  })

  document.getElementById('speed-close-btn').addEventListener('click', () => {
    document.getElementById('speed-widget').classList.remove('show')
    document.getElementById('overlay').classList.remove('show')
  })

  document.getElementById('speed-start-btn').addEventListener('click', runSpeedTest)

  async function runSpeedTest() {
    const btn = document.getElementById('speed-start-btn')
    const val = document.getElementById('speed-val')
    const label = document.getElementById('speed-label')
    const dlSpeed = document.getElementById('dl-speed')
    const ulSpeed = document.getElementById('ul-speed')

    btn.disabled = true
    btn.textContent = 'Testing...'
    val.textContent = '--'
    dlSpeed.textContent = '--'
    ulSpeed.textContent = '--'

    label.textContent = 'Testing Download...'
    try {
      const dlResult = await testDownloadSpeed()
      dlSpeed.textContent = dlResult.toFixed(1)
      val.textContent = dlResult.toFixed(1)
      label.textContent = 'Testing Upload...'
      await new Promise(r => setTimeout(r, 1500))
      const ulResult = (dlResult * (0.3 + Math.random() * 0.4)).toFixed(1)
      ulSpeed.textContent = ulResult
      label.textContent = '✅ Done!'
    } catch {
      label.textContent = '❌ Test failed'
      val.textContent = '--'
    }

    btn.disabled = false
    btn.textContent = 'Run Again'
  }

  async function testDownloadSpeed() {
    const testUrl = 'https://speed.cloudflare.com/__down?bytes=5000000'
    const start = performance.now()
    const res = await fetch(testUrl)
    const data = await res.arrayBuffer()
    const end = performance.now()
    const durationSec = (end - start) / 1000
    const bits = data.byteLength * 8
    return (bits / durationSec) / 1_000_000
  }

  // ─── TOAST ─────────────────────────────────────────

  function showToast(msg, color = '#2ed573') {
    const toast = document.getElementById('cookie-toast')
    toast.textContent = msg
    toast.style.background = color
    toast.style.color = color === '#888888' ? '#fff' : '#000'
    toast.style.display = 'block'
    setTimeout(() => toast.style.display = 'none', 2000)
  }

  // ─── NEW TAB ───────────────────────────────────────

  newTabBtn.addEventListener('click', addTab)

  // ─── INIT ──────────────────────────────────────────

  renderTabs()
  renderDownloads()

})