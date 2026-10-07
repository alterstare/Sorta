// Electron shell for the standalone app: window, data folder, IPC wiring.
// All sorting logic lives in ../core.
import { app, BrowserWindow, ipcMain, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import { SortaCore } from '../core'
import { IPC } from '../shared/ipc'
import type { Settings } from '../shared/types'

let core: SortaCore
let win: BrowserWindow | null = null

function createWindow(): void {
  Menu.setApplicationMenu(null)
  nativeTheme.themeSource = core.settings().theme
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: core.settings().theme === 'dark' ? '#0b0d13' : '#f4f5f8',
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

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    dataDir: core.paths.dataDir,
    dbPath: core.paths.dbPath,
    schemaVersion: core.schemaVersion
  }))
  ipcMain.handle(IPC.getSettings, () => core.settings())
  ipcMain.handle(IPC.saveSettings, (_e, patch: Partial<Settings>) => {
    const s = core.saveSettings(patch)
    nativeTheme.themeSource = s.theme
    return s
  })
  core.queue.onProgress((e) => win?.webContents.send(IPC.progress, e))
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
    core = new SortaCore(app.getPath('userData'))
    registerIpc()
    createWindow()
  })
  app.on('window-all-closed', () => {
    core?.close()
    app.quit()
  })
}
