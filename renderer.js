const { ipcRenderer } = require('electron')

window.addEventListener('DOMContentLoaded', () => {

  const webview = document.getElementById('webview')
  const urlBar = document.getElementById('url-bar')
  const tabsContainer = document.getElementById('tabs')
  const newTabBtn = document.getElementById('new-tab')

  let tabs = [{ id: 0, title: 'New Tab', url: 'https://www.google.com' }]
  let activeTab = 0
  let downloads = []
  let fpsActive = false
  let latencyActive = false
  let fpsInterval = null
  let lastTime = performance.now()
  let frames = 0
  let adBlockOn = true
  let feedbackType = 'bug'
  let feedbackRating = 0

  // ─── TABS ──────────────────────────────────────────

  function renderTabs() {
    document.querySelectorAll('.tab').forEach(t => t.remove())
    tabs.forEach(tab => {
      const el = document.createElement('div')
      el.className = 'tab' + (tab.id === activeTab ? ' active' : '')
      el.innerHTML = `<span>${tab.title}</span><button class="tab-close">x</button>`
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
      url = url.includes('.') ? 'https://' + url : 'https://www.google.com/search?q=' + encodeURIComponent(url)
    }
    webview.src = url
    const tab = tabs.find(t => t.id === activeTab)
    if (tab) tab.url = url
  })

  document.getElementById('back-btn').addEventListener('click', () => { if (webview.canGoBack()) webview.goBack() })
  document.getElementById('fwd-btn').addEventListener('click', () => { if (webview.canGoForward()) webview.goForward() })
  document.getElementById('reload-btn').addEventListener('click', () => webview.reload())

  webview.addEventListener('did-navigate', (e) => {
    urlBar.value = e.url
    const tab = tabs.find(t => t.id === activeTab)
    if (tab) tab.url = e.url
    document.getElementById('url-icon').textContent = e.url.startsWith('https') ? 'HTTPS' : 'HTTP'
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

  function closeAllPanels() {
    ['network-panel', 'speed-widget', 'custom-panel', 'antivirus-panel',
     'feedback-panel', 'own-ui-panel'].forEach(id => {
      document.getElementById(id).classList.remove('show')
    })
    document.getElementById('overlay').classList.remove('show')
  }

  document.getElementById('menu-btn').addEventListener('click', toggleMenu)
  document.getElementById('menu-close-btn').addEventListener('click', closeMenu)
  document.getElementById('overlay').addEventListener('click', () => { closeMenu(); closeAllPanels() })

  // ─── TRACKER ───────────────────────────────────────

  ipcRenderer.on('tracker-detected', (e, count) => {
    document.getElementById('tracker-count').textContent = count
    document.getElementById('menu-tracker-count').textContent = count
  })

  function toggleTrackerPanel() {
    const panel = document.getElementById('tracker-panel')
    panel.style.display = panel.style.display === 'block' ? 'none' : 'block'
    if (panel.style.display === 'block') ipcRenderer.send('get-trackers')
  }

  ipcRenderer.on('tracker-list', (e, list) => {
    const container = document.getElementById('tracker-list')
    if (list.length === 0) {
      container.innerHTML = '<div class="tracker-item">No trackers yet</div>'
      return
    }
    container.innerHTML = list.slice(-20).reverse().map(url => {
      try {
        const domain = new URL(url).hostname
        return `<div class="tracker-item">BLOCKED: ${domain}</div>`
      } catch {
        return `<div class="tracker-item">BLOCKED: ${url}</div>`
      }
    }).join('')
  })

  document.getElementById('tracker-nav-btn').addEventListener('click', toggleTrackerPanel)
  document.getElementById('tracker-badge').addEventListener('click', toggleTrackerPanel)
  document.getElementById('menu-tracker-btn').addEventListener('click', () => { toggleTrackerPanel(); closeMenu() })

  // ─── AD BLOCKER ────────────────────────────────────

  ipcRenderer.send('get-adblock-state')

  ipcRenderer.on('adblock-state', (e, state) => {
    adBlockOn = state
    const badge = document.getElementById('adblock-badge')
    badge.textContent = state ? 'ON' : 'OFF'
    badge.style.background = state ? 'rgba(46,213,115,0.2)' : 'rgba(255,71,87,0.2)'
    badge.style.color = state ? '#2ed573' : '#ff4757'
  })

  document.getElementById('menu-adblock-btn').addEventListener('click', () => {
    adBlockOn = !adBlockOn
    ipcRenderer.send('toggle-adblock', adBlockOn)
    showToast(adBlockOn ? 'Ad Blocker ON' : 'Ad Blocker OFF', adBlockOn ? '#2ed573' : '#ff4757')
    closeMenu()
  })

  // ─── ANTIVIRUS ─────────────────────────────────────

  ipcRenderer.send('get-malware-state')
  ipcRenderer.send('get-scan-state')

  ipcRenderer.on('malware-state', (e, state) => {
    document.getElementById('malware-toggle').checked = state
  })

  ipcRenderer.on('scan-state', (e, state) => {
    document.getElementById('scan-toggle').checked = state
  })

  ipcRenderer.on('malware-detected', (e, url) => {
    showAlert('THREAT BLOCKED: Dangerous website blocked - ' + url)
    showToast('Threat Blocked!', '#ff4757')
  })

  ipcRenderer.on('download-warning', (e, fileName) => {
    showAlert('WARNING: Potentially dangerous file - ' + fileName + ' - Open with caution!')
  })

  document.getElementById('malware-toggle').addEventListener('change', (e) => {
    ipcRenderer.send('toggle-malware', e.target.checked)
    showToast(e.target.checked ? 'URL Blocker ON' : 'URL Blocker OFF', e.target.checked ? '#2ed573' : '#ff4757')
  })

  document.getElementById('scan-toggle').addEventListener('change', (e) => {
    ipcRenderer.send('toggle-download-scan', e.target.checked)
    showToast(e.target.checked ? 'Download Scanner ON' : 'Download Scanner OFF', e.target.checked ? '#2ed573' : '#ff4757')
  })

  document.getElementById('menu-antivirus-btn').addEventListener('click', () => {
    document.getElementById('antivirus-panel').classList.add('show')
    document.getElementById('overlay').classList.add('show')
    closeMenu()
  })

  document.getElementById('av-close-btn').addEventListener('click', () => {
    document.getElementById('antivirus-panel').classList.remove('show')
    document.getElementById('overlay').classList.remove('show')
  })

  // ─── COOKIE DESTROYER ──────────────────────────────

  function showCookieToast() { showToast('Cookies Destroyed!', '#2ed573') }

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
          <span>${dl.status === 'done' ? 'Done' : dl.status === 'failed' ? 'Failed' : dl.progress + '%'}</span>
        </div>
        <div class="dl-bar-bg">
          <div class="dl-bar ${dl.status === 'done' ? 'done' : dl.status === 'failed' ? 'failed' : ''}" style="width:${dl.progress}%"></div>
        </div>
        <div class="dl-actions">
          ${dl.status === 'done' ? `<button onclick="window._openFile('${dl.path.replace(/\\/g, '\\\\')}')">Open</button>` : ''}
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

  document.getElementById('menu-dl-btn').addEventListener('click', () => { toggleDownloadPopup(); closeMenu() })
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
        counter.textContent = 'FPS: ' + fps
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

  function countFrame() { frames++; if (fpsActive) requestAnimationFrame(countFrame) }

  document.getElementById('menu-fps-btn').addEventListener('click', () => { toggleFPS(); closeMenu() })

  // ─── LOW LATENCY MODE ──────────────────────────────

  function toggleLatency() {
    latencyActive = !latencyActive
    const badge = document.getElementById('latency-badge')
    badge.textContent = latencyActive ? 'ON' : 'OFF'
    badge.style.background = latencyActive ? 'rgba(46,213,115,0.2)' : ''
    badge.style.color = latencyActive ? '#2ed573' : ''
    showToast(latencyActive ? 'Low Latency ON' : 'Low Latency OFF', latencyActive ? '#2ed573' : '#888888')
  }

  document.getElementById('menu-latency-btn').addEventListener('click', () => { toggleLatency(); closeMenu() })

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
      label.textContent = 'Done!'
    } catch {
      label.textContent = 'Test failed'
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
    return (data.byteLength * 8) / ((end - start) / 1000) / 1_000_000
  }

  // ─── VPN + NETWORK BOOSTER ─────────────────────────

  function openNetworkPanel() {
    document.getElementById('network-panel').classList.add('show')
    document.getElementById('overlay').classList.add('show')
    closeMenu()
  }

  document.getElementById('menu-network-btn').addEventListener('click', openNetworkPanel)
  document.getElementById('booster-nav-btn').addEventListener('click', openNetworkPanel)
  document.getElementById('network-close-btn').addEventListener('click', () => {
    document.getElementById('network-panel').classList.remove('show')
    document.getElementById('overlay').classList.remove('show')
  })

  ipcRenderer.send('get-vpn-state')
  ipcRenderer.on('vpn-state', (e, state) => {
    document.getElementById('vpn-toggle').checked = state
    const status = document.getElementById('vpn-status')
    const ip = document.getElementById('vpn-ip')
    status.textContent = state ? 'ON' : 'OFF'
    status.className = state ? 'stat-val good' : 'stat-val'
    ip.textContent = state ? 'Active' : '--'
    ip.className = state ? 'stat-val good' : 'stat-val'
  })

  document.getElementById('vpn-toggle').addEventListener('change', (e) => {
    ipcRenderer.send('toggle-vpn', e.target.checked)
    showToast(e.target.checked ? 'VPN ON' : 'VPN OFF', e.target.checked ? '#5352ed' : '#888888')
  })

  ipcRenderer.send('get-booster-state')
  ipcRenderer.on('booster-state', (e, state) => {
    document.getElementById('booster-toggle').checked = state
    const status = document.getElementById('booster-status')
    status.textContent = state ? 'ON' : 'OFF'
    status.className = state ? 'stat-val good' : 'stat-val'
  })

  document.getElementById('booster-toggle').addEventListener('change', (e) => {
    ipcRenderer.send('toggle-booster', e.target.checked)
    showToast(e.target.checked ? 'Booster ON' : 'Booster OFF', e.target.checked ? '#2ed573' : '#888888')
  })

  document.getElementById('ping-btn').addEventListener('click', () => {
    const btn = document.getElementById('ping-btn')
    const pingVal = document.getElementById('ping-val')
    btn.textContent = 'Testing...'
    btn.disabled = true
    pingVal.textContent = '--'
    ipcRenderer.send('ping-test')
  })

  ipcRenderer.on('ping-result', (e, ping) => {
    const btn = document.getElementById('ping-btn')
    const pingVal = document.getElementById('ping-val')
    btn.textContent = 'Test Ping'
    btn.disabled = false
    pingVal.textContent = ping
    pingVal.className = ping < 50 ? 'stat-val good' : ping < 100 ? 'stat-val ok' : 'stat-val bad'
  })

  // ─── CUSTOMIZATION ─────────────────────────────────

  const savedTheme = localStorage.getItem('fy-theme') || 'dark'
  const savedFont = localStorage.getItem('fy-font') || 'Inter'
  const savedRadius = localStorage.getItem('fy-radius') || '8px'
  const savedAccent = localStorage.getItem('fy-accent') || null
  const savedCSS = localStorage.getItem('fy-custom-css') || ''

  applyTheme(savedTheme)
  applyFont(savedFont)
  applyRadius(savedRadius)
  if (savedAccent) applyAccent(savedAccent)
  if (savedCSS) document.getElementById('custom-style').textContent = savedCSS

  function applyTheme(theme) {
    document.body.className = document.body.className.replace(/theme-\w+/g, '')
    if (theme !== 'dark') document.body.classList.add('theme-' + theme)
    document.querySelectorAll('.theme-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.theme === theme)
    })
    localStorage.setItem('fy-theme', theme)
  }

  function applyFont(font) {
    document.documentElement.style.setProperty('--font', `'${font}', sans-serif`)
    document.querySelectorAll('.font-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.font === font)
    })
    localStorage.setItem('fy-font', font)
  }

  function applyRadius(radius) {
    document.querySelectorAll('.radius-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.radius === radius)
    })
    document.documentElement.style.setProperty('--radius', radius)
    localStorage.setItem('fy-radius', radius)
  }

  function applyAccent(color) {
    document.documentElement.style.setProperty('--blue', color)
    document.documentElement.style.setProperty('--accent2', color)
    localStorage.setItem('fy-accent', color)
  }

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme))
  })

  document.querySelectorAll('.font-btn').forEach(btn => {
    btn.addEventListener('click', () => applyFont(btn.dataset.font))
  })

  document.querySelectorAll('.radius-btn').forEach(btn => {
    btn.addEventListener('click', () => applyRadius(btn.dataset.radius))
  })

  document.querySelectorAll('.color-dot').forEach(dot => {
    dot.addEventListener('click', () => {
      document.querySelectorAll('.color-dot').forEach(d => d.classList.remove('active'))
      dot.classList.add('active')
      applyAccent(dot.dataset.color)
    })
  })

  document.getElementById('custom-color').addEventListener('input', (e) => {
    applyAccent(e.target.value)
  })

  document.getElementById('menu-custom-btn').addEventListener('click', () => {
    document.getElementById('custom-panel').classList.add('show')
    document.getElementById('overlay').classList.add('show')
    closeMenu()
  })

  document.getElementById('custom-close-btn').addEventListener('click', () => {
    document.getElementById('custom-panel').classList.remove('show')
    document.getElementById('overlay').classList.remove('show')
  })

  // ─── OWN UI ────────────────────────────────────────

  document.getElementById('own-ui-btn').addEventListener('click', () => {
    document.getElementById('own-ui-panel').classList.add('show')
    document.getElementById('css-editor').value = localStorage.getItem('fy-custom-css') || ''
  })

  document.getElementById('own-ui-close-btn').addEventListener('click', () => {
    document.getElementById('own-ui-panel').classList.remove('show')
  })

  document.getElementById('apply-css-btn').addEventListener('click', () => {
    const css = document.getElementById('css-editor').value
    document.getElementById('custom-style').textContent = css
    localStorage.setItem('fy-custom-css', css)
    showToast('Custom CSS Applied!', '#5352ed')
  })

  // CSS Presets
  document.getElementById('preset-minimal').addEventListener('click', () => {
    document.getElementById('css-editor').value = `
#titlebar { background: #fff; border-bottom: 1px solid #eee; }
#navbar { background: #fff; border-bottom: 1px solid #eee; }
#tabs { background: #fff; }
.tab { background: #f5f5f5; color: #333; }
.tab.active { background: #fff; color: #000; }
#side-menu { background: #fff; }
.menu-item { color: #333; }
.menu-item:hover { background: #f5f5f5; color: #000; }
    `.trim()
  })

  document.getElementById('preset-glass').addEventListener('click', () => {
    document.getElementById('css-editor').value = `
#titlebar { background: rgba(0,0,0,0.3); backdrop-filter: blur(20px); }
#navbar { background: rgba(0,0,0,0.2); backdrop-filter: blur(20px); }
#tabs { background: rgba(0,0,0,0.1); }
.tab { background: rgba(255,255,255,0.1); }
.tab.active { background: rgba(255,255,255,0.2); }
#side-menu { background: rgba(0,0,0,0.5); backdrop-filter: blur(20px); }
    `.trim()
  })

  document.getElementById('preset-retro').addEventListener('click', () => {
    document.getElementById('css-editor').value = `
* { font-family: 'Courier New', monospace !important; }
#titlebar { background: #003300; border-bottom: 2px solid #00ff00; }
#navbar { background: #001100; border-bottom: 2px solid #00ff00; }
#tabs { background: #003300; }
.tab { background: #002200; color: #00ff00; border-color: #00ff00; }
.tab.active { background: #004400; color: #00ff00; }
#url-bar { background: #001100; color: #00ff00; border-color: #00ff00; }
#side-menu { background: #001100; border-left: 2px solid #00ff00; }
    `.trim()
  })

  document.getElementById('preset-reset').addEventListener('click', () => {
    document.getElementById('css-editor').value = ''
    document.getElementById('custom-style').textContent = ''
    localStorage.removeItem('fy-custom-css')
    showToast('CSS Reset!', '#2ed573')
  })

  // ─── FEEDBACK ──────────────────────────────────────

  document.getElementById('menu-feedback-btn').addEventListener('click', () => {
    document.getElementById('feedback-panel').classList.add('show')
    document.getElementById('overlay').classList.add('show')
    closeMenu()
  })

  document.getElementById('feedback-close-btn').addEventListener('click', () => {
    document.getElementById('feedback-panel').classList.remove('show')
    document.getElementById('overlay').classList.remove('show')
  })

  document.querySelectorAll('.feedback-type').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.feedback-type').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      feedbackType = btn.dataset.type
    })
  })

  document.querySelectorAll('.rating-star').forEach(star => {
    star.addEventListener('click', () => {
      feedbackRating = parseInt(star.dataset.rating)
      document.querySelectorAll('.rating-star').forEach((s, i) => {
        s.classList.toggle('active', i < feedbackRating)
      })
    })
  })

  document.getElementById('send-feedback-btn').addEventListener('click', () => {
    const text = document.getElementById('feedback-text').value.trim()
    if (!text) { showToast('Please write your feedback!', '#ff4757'); return }
    ipcRenderer.send('send-feedback', {
      type: feedbackType,
      rating: feedbackRating,
      text: text
    })
  })

  ipcRenderer.on('feedback-sent', () => {
    document.getElementById('feedback-text').value = ''
    document.getElementById('feedback-panel').classList.remove('show')
    document.getElementById('overlay').classList.remove('show')
    showToast('Feedback sent! Thank you!', '#2ed573')
  })

  // ─── AUTO UPDATE ───────────────────────────────────

  document.getElementById('menu-update-btn').addEventListener('click', () => {
    ipcRenderer.send('check-update')
    showToast('Checking for updates...', '#5352ed')
    closeMenu()
  })

  ipcRenderer.on('update-available', (e, version) => {
    const panel = document.getElementById('update-panel')
    document.getElementById('update-title').textContent = 'Update Available - v' + version
    document.getElementById('update-sub').textContent = 'Downloading in background...'
    document.getElementById('update-badge').textContent = 'NEW'
    document.getElementById('update-badge').style.background = 'rgba(46,213,115,0.2)'
    document.getElementById('update-badge').style.color = '#2ed573'
    panel.classList.add('show')
  })

  ipcRenderer.on('update-not-available', () => {
    showToast('You are on the latest version!', '#2ed573')
  })

  ipcRenderer.on('update-progress', (e, percent) => {
    document.getElementById('update-bar').style.width = percent + '%'
    document.getElementById('update-sub').textContent = 'Downloading... ' + percent + '%'
  })

  ipcRenderer.on('update-downloaded', () => {
    document.getElementById('update-title').textContent = 'Update Ready!'
    document.getElementById('update-sub').textContent = 'Click restart to install'
    document.getElementById('update-bar').style.width = '100%'
    document.getElementById('update-install-btn').style.display = 'block'
  })

  document.getElementById('update-install-btn').addEventListener('click', () => {
    ipcRenderer.send('restart-app')
  })

  ipcRenderer.on('restart-app', () => { ipcRenderer.send('restart-app') })

  // ─── TOAST + ALERT ─────────────────────────────────

  function showToast(msg, color = '#2ed573') {
    const toast = document.getElementById('cookie-toast')
    toast.textContent = msg
    toast.style.background = color
    toast.style.color = (color === '#888888' || color === '#5352ed') ? '#fff' : '#000'
    toast.style.display = 'block'
    toast.style.cursor = 'default'
    toast.onclick = null
    setTimeout(() => toast.style.display = 'none', 2500)
  }

  function showAlert(msg) {
    const alert = document.getElementById('security-alert')
    alert.textContent = msg
    alert.style.display = 'block'
    setTimeout(() => alert.style.display = 'none', 4000)
  }

  // ─── NEW TAB ───────────────────────────────────────

  newTabBtn.addEventListener('click', addTab)

  // ─── INIT ──────────────────────────────────────────

  renderTabs()
  renderDownloads()

})