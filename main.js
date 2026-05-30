const { app, BrowserWindow, ipcMain, session, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const { exec } = require('child_process')

const TRACKERS = [
  'google-analytics.com', 'googletagmanager.com', 'doubleclick.net',
  'facebook.net', 'connect.facebook.net', 'ads.twitter.com',
  'amazon-adsystem.com', 'scorecardresearch.com', 'quantserve.com',
  'hotjar.com', 'mixpanel.com', 'segment.com', 'adroll.com',
  'criteo.com', 'taboola.com', 'outbrain.com', 'pubmatic.com'
]

const ADS = [
  'ads.google.com', 'pagead2.googlesyndication.com', 'adservice.google.com',
  'googlesyndication.com', 'doubleclick.net', 'googleadservices.com',
  'adsystem.amazon.com', 'media.net', 'bidswitch.net', 'rubiconproject.com',
  'openx.net', 'appnexus.com', 'advertising.com', 'yieldmanager.com',
  'adnxs.com', 'adsrvr.org', 'contextweb.com', 'casalemedia.com',
  'smartadserver.com', 'revcontent.com', 'mgid.com', 'ads.yahoo.com',
  'adtech.de', 'zedo.com', 'trafficjunky.net', 'exoclick.com'
]

let mainWindow
let blockedTrackers = []
let adBlockEnabled = true
let networkBoosterOn = false
let vpnProxyOn = false

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    title: 'F.Y Browser',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true
    }
  })

  mainWindow.loadFile('index.html')

  // ── AUTO UPDATER ──
  try {
    autoUpdater.checkForUpdatesAndNotify()
    autoUpdater.on('update-available', () => {
      mainWindow.webContents.send('update-available')
    })
    autoUpdater.on('update-downloaded', () => {
      mainWindow.webContents.send('update-downloaded')
    })
  } catch (e) {
    console.log('Updater error:', e)
  }

  // ── TRACKER + AD BLOCKER ──
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url
    const isTracker = TRACKERS.some(t => url.includes(t))
    if (isTracker) {
      blockedTrackers.push(url)
      mainWindow.webContents.send('tracker-detected', blockedTrackers.length)
      callback({ cancel: true })
      return
    }
    const isAd = adBlockEnabled && ADS.some(a => url.includes(a))
    if (isAd) {
      callback({ cancel: true })
      return
    }
    callback({ cancel: false })
  })

  // ── DOWNLOAD MANAGER ──
  session.defaultSession.on('will-download', (event, item) => {
    const fileName = item.getFilename()
    const fileSize = item.getTotalBytes()
    const savePath = path.join(app.getPath('downloads'), fileName)
    item.setSavePath(savePath)
    const downloadId = Date.now()
    mainWindow.webContents.send('download-started', {
      id: downloadId, name: fileName, size: fileSize,
      path: savePath, progress: 0, status: 'downloading'
    })
    item.on('updated', (e, state) => {
      if (state === 'progressing') {
        const progress = item.getTotalBytes()
          ? Math.round((item.getReceivedBytes() / item.getTotalBytes()) * 100) : 0
        mainWindow.webContents.send('download-progress', { id: downloadId, progress })
      }
    })
    item.once('done', (e, state) => {
      mainWindow.webContents.send('download-done', {
        id: downloadId, status: state === 'completed' ? 'done' : 'failed'
      })
    })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ── WINDOW CONTROLS ──
ipcMain.on('minimize', () => mainWindow.minimize())
ipcMain.on('maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
})
ipcMain.on('close', () => mainWindow.close())

// ── COOKIES ──
ipcMain.on('tab-closed', async () => {
  await session.defaultSession.clearStorageData({ storages: ['cookies'] })
})

// ── TRACKERS ──
ipcMain.on('get-trackers', (e) => { e.reply('tracker-list', blockedTrackers) })
ipcMain.on('reset-trackers', () => {
  blockedTrackers = []
  mainWindow.webContents.send('tracker-detected', 0)
})

// ── AD BLOCKER ──
ipcMain.on('toggle-adblock', (e, state) => {
  adBlockEnabled = state
  mainWindow.webContents.send('adblock-state', adBlockEnabled)
})
ipcMain.on('get-adblock-state', (e) => { e.reply('adblock-state', adBlockEnabled) })

// ── FILES ──
ipcMain.on('open-file', (e, filePath) => { shell.openPath(filePath) })

// ── GAME LAUNCHER ──
ipcMain.on('launch-game', (e, gamePath) => { shell.openPath(gamePath) })

// ── NETWORK BOOSTER ──
ipcMain.on('toggle-booster', (e, state) => {
  networkBoosterOn = state
  const iface = 'Wi-Fi'
  if (state) {
    exec(`netsh interface ip set dns "${iface}" static 1.1.1.1`)
    exec(`netsh interface ip add dns "${iface}" 8.8.8.8 index=2`)
  } else {
    exec(`netsh interface ip set dns "${iface}" dhcp`)
  }
  mainWindow.webContents.send('booster-state', state)
})
ipcMain.on('get-booster-state', (e) => { e.reply('booster-state', networkBoosterOn) })

// ── VPN PROXY ──
ipcMain.on('toggle-vpn', (e, state) => {
  vpnProxyOn = state
  if (state) {
    exec('netsh winhttp set proxy proxy-server="socks=127.0.0.1:1080"')
  } else {
    exec('netsh winhttp reset proxy')
  }
  mainWindow.webContents.send('vpn-state', state)
})
ipcMain.on('get-vpn-state', (e) => { e.reply('vpn-state', vpnProxyOn) })

// ── PING TEST ──
ipcMain.on('ping-test', (e) => {
  const start = Date.now()
  const cmd = process.platform === 'win32' ? 'ping -n 1 1.1.1.1' : 'ping -c 1 1.1.1.1'
  exec(cmd, () => { e.reply('ping-result', Date.now() - start) })
})

// ── AUTO UPDATE ──
ipcMain.on('restart-app', () => { autoUpdater.quitAndInstall() })