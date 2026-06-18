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
  'static.ads-twitter.com', 'analytics.twitter.com',
  'imasdk.googleapis.com', 'ads-twitter.com', 'adserver.com',
  'cdn.adnxs.com', 'ib.adnxs.com', 'secure.adnxs.com'
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

// ── THE KEY FIX: apply blocking to any session ──
function applyBlocking(sess) {
  sess.webRequest.onBeforeRequest((details, callback) => {
    const url = details.url

    if (malwareBlockEnabled) {
      const bad = MALICIOUS.some(m => url.includes(m))
      if (bad) {
        if (mainWindow) mainWindow.webContents.send('malware-detected', url)
        callback({ cancel: true })
        return
      }
    }

    const isTracker = TRACKERS.some(t => url.includes(t))
    if (isTracker) {
      blockedTrackers.push(url)
      if (mainWindow) mainWindow.webContents.send('tracker-detected', blockedTrackers.length)
      callback({ cancel: true })
      return
    }

    if (adBlockEnabled) {
      const isAd = ADS.some(a => url.includes(a))
      if (isAd) {
        callback({ cancel: true })
        return
      }
    }

    callback({ cancel: false })
  })
}

function setupDownloads(sess) {
  sess.on('will-download', (event, item) => {
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
      if (state === 'completed' && downloadScanEnabled) {
        const dangerousExts = ['.exe', '.bat', '.cmd', '.scr', '.vbs', '.msi']
        if (dangerousExts.includes(path.extname(fileName).toLowerCase())) {
          mainWindow.webContents.send('download-warning', fileName)
        }
      }
    })
  })
}

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1280,
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

  // Apply blocking to default session AND the webview partition session
  // This is what actually fixes the ad blocker!!
  applyBlocking(session.defaultSession)
  const wvSession = session.fromPartition('persist:fywebview')
  applyBlocking(wvSession)

  setupDownloads(session.defaultSession)
  setupDownloads(wvSession)

  // Auto Updater
  try {
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.checkForUpdatesAndNotify()
    autoUpdater.on('update-available', info => mainWindow.webContents.send('update-available', info.version))
    autoUpdater.on('update-not-available', () => mainWindow.webContents.send('update-not-available'))
    autoUpdater.on('download-progress', p => mainWindow.webContents.send('update-progress', Math.round(p.percent)))
    autoUpdater.on('update-downloaded', () => mainWindow.webContents.send('update-downloaded'))
  } catch (e) { console.log('Updater not available in dev mode') }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Window controls
ipcMain.on('minimize', () => mainWindow.minimize())
ipcMain.on('maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.on('close', () => mainWindow.close())

// Cookies
ipcMain.on('clear-cookies', async () => {
  await session.defaultSession.clearStorageData({ storages: ['cookies'] })
  await session.fromPartition('persist:fywebview').clearStorageData({ storages: ['cookies'] })
})

// Trackers
ipcMain.on('get-trackers', e => e.reply('tracker-list', blockedTrackers))
ipcMain.on('reset-trackers', () => {
  blockedTrackers = []
  mainWindow.webContents.send('tracker-detected', 0)
})

// Ad Blocker
ipcMain.on('toggle-adblock', (e, state) => {
  adBlockEnabled = state
  mainWindow.webContents.send('adblock-state', state)
})
ipcMain.on('get-adblock-state', e => e.reply('adblock-state', adBlockEnabled))

// Antivirus
ipcMain.on('toggle-malware', (e, state) => { malwareBlockEnabled = state })
ipcMain.on('get-malware-state', e => e.reply('malware-state', malwareBlockEnabled))
ipcMain.on('toggle-download-scan', (e, state) => { downloadScanEnabled = state })
ipcMain.on('get-scan-state', e => e.reply('scan-state', downloadScanEnabled))

// Files
ipcMain.on('open-file', (e, filePath) => shell.openPath(filePath))

// Network Booster
ipcMain.on('toggle-booster', (e, state) => {
  networkBoosterOn = state
  if (process.platform === 'win32') {
    if (state) {
      exec('netsh interface ip set dns "Wi-Fi" static 1.1.1.1')
      exec('netsh interface ip add dns "Wi-Fi" 8.8.8.8 index=2')
    } else {
      exec('netsh interface ip set dns "Wi-Fi" dhcp')
    }
  }
  mainWindow.webContents.send('booster-state', state)
})
ipcMain.on('get-booster-state', e => e.reply('booster-state', networkBoosterOn))

// VPN Proxy
ipcMain.on('toggle-vpn', (e, state) => {
  vpnProxyOn = state
  if (process.platform === 'win32') {
    if (state) exec('netsh winhttp set proxy proxy-server="socks=127.0.0.1:1080"')
    else exec('netsh winhttp reset proxy')
  }
  mainWindow.webContents.send('vpn-state', state)
})
ipcMain.on('get-vpn-state', e => e.reply('vpn-state', vpnProxyOn))

// Ping
ipcMain.on('ping-test', e => {
  const start = Date.now()
  const cmd = process.platform === 'win32' ? 'ping -n 1 1.1.1.1' : 'ping -c 1 1.1.1.1'
  exec(cmd, () => e.reply('ping-result', Date.now() - start))
})

// Screenshot
ipcMain.on('take-screenshot', async () => {
  try {
    const image = await mainWindow.webContents.capturePage()
    const savePath = path.join(app.getPath('pictures'), `fy-screenshot-${Date.now()}.png`)
    fs.writeFileSync(savePath, image.toPNG())
    shell.openPath(savePath)
    mainWindow.webContents.send('screenshot-saved', savePath)
  } catch (e) { console.log('Screenshot error:', e) }
})

// Feedback
ipcMain.on('send-feedback', (e, feedback) => {
  const feedbackPath = path.join(app.getPath('userData'), 'feedback.json')
  let feedbacks = []
  try { feedbacks = JSON.parse(fs.readFileSync(feedbackPath, 'utf8')) } catch {}
  feedbacks.push({ ...feedback, date: new Date().toISOString() })
  fs.writeFileSync(feedbackPath, JSON.stringify(feedbacks, null, 2))
  e.reply('feedback-sent', true)
})

// Auto Update
ipcMain.on('restart-app', () => { try { autoUpdater.quitAndInstall() } catch(e) {} })
ipcMain.on('check-update', () => { try { autoUpdater.checkForUpdates() } catch(e) {} })