const { app, BrowserWindow, ipcMain, session, shell } = require('electron')
const { autoUpdater } = require('electron-updater')
const path = require('path')
const { exec } = require('child_process')
const fs = require('fs')

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
  'adtech.de', 'zedo.com', 'trafficjunky.net', 'exoclick.com',
  'popads.net', 'popcash.net', 'propellerads.com', 'adsterra.com',
  'hilltopads.net', 'clickadu.com', 'admaven.com', 'juicyads.com',
  'trafficfactory.biz', 'plugrush.com', 'adcash.com', 'yllix.com',
  'flashtalking.com', 'serving-sys.com', 'atdmt.com',
  'googleads.g.doubleclick.net', 'pagead.googlesyndication.com',
  'tpc.googlesyndication.com', 'ad.doubleclick.net',
  'ads.pubmatic.com', 'ads.criteo.com', 'ads.outbrain.com',
  'ads.taboola.com', 'ads.reddit.com', 'connect.facebook.net',
  'static.ads-twitter.com', 'analytics.twitter.com'
]

const MALICIOUS = [
  'malware.com', 'phishing.com', 'virus.com', 'trojan.com',
  'ransomware.com', 'spyware.com', 'botnet.com', 'scam.com',
  'fraud.com', 'fake-login.com', 'account-verify.tk',
  'secure-login.ml', 'bank-update.ga', 'paypal-verify.cf',
  'amazon-security.tk', 'apple-id-verify.ml', 'steam-free.tk',
  'free-robux.ml', 'crypto-giveaway.ga', 'win-prize.cf'
]

let mainWindow
let blockedTrackers = []
let adBlockEnabled = true
let networkBoosterOn = false
let vpnProxyOn = false
let malwareBlockEnabled = true
let downloadScanEnabled = true

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
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.checkForUpdatesAndNotify()

    autoUpdater.on('update-available', (info) => {
      mainWindow.webContents.send('update-available', info.version)
    })

    autoUpdater.on('update-not-available', () => {
      mainWindow.webContents.send('update-not-available')
    })

    autoUpdater.on('download-progress', (progress) => {
      mainWindow.webContents.send('update-progress', Math.round(progress.percent))
    })

    autoUpdater.on('update-downloaded', () => {
      mainWindow.webContents.send('update-downloaded')
    })

    autoUpdater.on('error', (err) => {
      console.log('Update error:', err)
    })
  } catch (e) {
    console.log('Updater not available in dev mode')
  }

  // ── REQUEST BLOCKER ──
  const blockRequest = (details, callback) => {
    const url = details.url

    if (malwareBlockEnabled) {
      const isMalicious = MALICIOUS.some(m => url.includes(m))
      if (isMalicious) {
        mainWindow.webContents.send('malware-detected', url)
        callback({ cancel: true })
        return
      }
    }

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
  }

  session.defaultSession.webRequest.onBeforeRequest(blockRequest)

  app.on('session-created', (sess) => {
    sess.webRequest.onBeforeRequest(blockRequest)
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
      const status = state === 'completed' ? 'done' : 'failed'
      mainWindow.webContents.send('download-done', { id: downloadId, status })

      // ── DOWNLOAD SCANNER ──
      if (state === 'completed' && downloadScanEnabled) {
        const dangerousExts = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.js', '.msi']
        const ext = path.extname(fileName).toLowerCase()
        if (dangerousExts.includes(ext)) {
          mainWindow.webContents.send('download-warning', fileName)
        }
      }
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

// ── ANTIVIRUS ──
ipcMain.on('toggle-malware', (e, state) => {
  malwareBlockEnabled = state
  mainWindow.webContents.send('malware-state', malwareBlockEnabled)
})
ipcMain.on('get-malware-state', (e) => { e.reply('malware-state', malwareBlockEnabled) })

ipcMain.on('toggle-download-scan', (e, state) => {
  downloadScanEnabled = state
  mainWindow.webContents.send('scan-state', downloadScanEnabled)
})
ipcMain.on('get-scan-state', (e) => { e.reply('scan-state', downloadScanEnabled) })

// ── FILES ──
ipcMain.on('open-file', (e, filePath) => { shell.openPath(filePath) })

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

// ── FEEDBACK ──
ipcMain.on('send-feedback', (e, feedback) => {
  const feedbackPath = path.join(app.getPath('userData'), 'feedback.json')
  let feedbacks = []
  try { feedbacks = JSON.parse(fs.readFileSync(feedbackPath, 'utf8')) } catch {}
  feedbacks.push({ ...feedback, date: new Date().toISOString() })
  fs.writeFileSync(feedbackPath, JSON.stringify(feedbacks, null, 2))
  e.reply('feedback-sent', true)
})

// ── AUTO UPDATE ──
ipcMain.on('restart-app', () => { autoUpdater.quitAndInstall() })
ipcMain.on('check-update', () => { autoUpdater.checkForUpdates() })