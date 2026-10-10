// Electron shell for the standalone app: window, single instance, auto-update.
// Everything Sorta does on the main-process side lives in ./host (shared with
// Halftone, which embeds it); the sorting logic in ../core.
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, protocol } from 'electron'
import { existsSync } from 'fs'
import { join } from 'path'
import electronUpdater from 'electron-updater'
import { IPC } from '../shared/ipc'
import type { UpdateStatus } from '../shared/ipc'
import { SORTA_SCHEME, closeSorta, initSorta, sortaCore } from './host'

let win: BrowserWindow | null = null

protocol.registerSchemesAsPrivileged([SORTA_SCHEME])

// Window / taskbar icon: the multi-size .ico on Windows (each size drawn for
// itself, so the title bar's 16–24 px icon stays clean), a PNG elsewhere.
const DEV_ICON = join(__dirname, process.platform === 'win32' ? '../../build/icon.ico' : '../../build/icons/256x256.png')

function createWindow(theme: 'light' | 'dark'): void {
  Menu.setApplicationMenu(null)
  nativeTheme.themeSource = theme
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: theme === 'dark' ? '#0b0d13' : '#f4f5f8',
    ...(existsSync(DEV_ICON) ? { icon: DEV_ICON } : {}),
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.on('ready-to-show', () => win?.show())
  win.on('closed', () => (win = null))
  if (process.env['ELECTRON_RENDERER_URL']) void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

// 자동 업데이트 from GitHub Releases (publish config in electron-builder.yml).
// Packaged builds only. Downloads in the background; installs on quit or when
// the user picks "재시작해서 업데이트". Off in 설정 → no check, no download, and
// a downloaded update is not installed on quit. NSIS (win) and AppImage (linux)
// update themselves; zip / tar.gz don't.
let updateStatus: UpdateStatus = { state: app.isPackaged ? 'idle' : 'dev' }
let applyAutoUpdate: (on: boolean) => void = () => {}
function sendUpdate(s: UpdateStatus): void {
  updateStatus = s
  win?.webContents.send(IPC.updateStatus, s)
}
function setupAutoUpdate(enabled: boolean): void {
  if (!app.isPackaged) {
    ipcMain.handle(IPC.checkUpdate, () => updateStatus)
    return
  }
  const { autoUpdater } = electronUpdater
  let checked = false
  const check = (): void => {
    sendUpdate({ state: 'checking' })
    autoUpdater.checkForUpdates().catch((e) => sendUpdate({ state: 'error', error: String(e?.message ?? e) }))
  }
  applyAutoUpdate = (on) => {
    autoUpdater.autoDownload = on
    autoUpdater.autoInstallOnAppQuit = on
    if (on && !checked) {
      checked = true
      check()
    }
  }
  autoUpdater.on('update-available', (i) => sendUpdate({ state: 'available', version: i.version }))
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'none' }))
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', version: updateStatus.version, percent: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (i) => sendUpdate({ state: 'downloaded', version: i.version }))
  autoUpdater.on('error', (e) => sendUpdate({ state: 'error', error: String(e?.message ?? e) }))
  ipcMain.handle(IPC.checkUpdate, async () => {
    if (updateStatus.state !== 'downloading' && updateStatus.state !== 'downloaded') {
      autoUpdater.autoDownload = true // a manual check downloads even with auto-update off
      check()
    }
    return updateStatus
  })
  ipcMain.on(IPC.installUpdate, () => autoUpdater.quitAndInstall())
  applyAutoUpdate(enabled)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  void app.whenReady().then(() => {
    initSorta({
      dataDir: app.getPath('userData'),
      appName: 'Sorta',
      appVersion: app.getVersion(),
      icon: DEV_ICON,
      window: () => win,
      send: (ch, payload) => win?.webContents.send(ch, payload),
      onTheme: (t) => (nativeTheme.themeSource = t),
      onSettingsSaved: (patch, s) => {
        if ('autoUpdate' in patch) applyAutoUpdate(s.autoUpdate)
      }
    })
    const core = sortaCore()
    createWindow(core?.settings().theme ?? 'light')
    setupAutoUpdate(core?.settings().autoUpdate ?? true)
  })
  app.on('window-all-closed', () => {
    closeSorta()
    app.quit()
  })
}
