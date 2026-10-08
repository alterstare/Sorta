// Electron shell for the standalone app: window, data folder, image protocol,
// IPC wiring. All sorting logic lives in ../core.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { SortaCore, CancelledError } from '../core'
import { isInside } from '../core/pipeline/scan'
import { IPC } from '../shared/ipc'
import type { JobSummary } from '../shared/ipc'
import type { LibraryFilter, ModelId, Rating, ReviewKind, Settings } from '../shared/types'

let core: SortaCore
let win: BrowserWindow | null = null

// sorta-img://f/<base64url path> — serves originals and thumbnails, but only
// files Sorta knows: inside a registered folder (sources / organize / thumb
// cache) or an image already in the DB (its source folder may since have been
// removed from the list).
protocol.registerSchemesAsPrivileged([
  { scheme: 'sorta-img', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function allowedRoots(): string[] {
  const s = core.settings()
  return [...s.sourceDirs, s.organizeDir, core.paths.thumbsDir].filter(Boolean)
}

function handleImages(): void {
  protocol.handle('sorta-img', async (req) => {
    try {
      const seg = new URL(req.url).pathname.replace(/^\//, '')
      const path = Buffer.from(seg, 'base64url').toString('utf-8')
      const known = allowedRoots().some((r) => isInside(path, r)) || !!core.db.prepare('SELECT 1 FROM images WHERE path = ? OR thumbnail_path = ?').get(path, path)
      if (!known) return new Response('forbidden', { status: 403 })
      const res = await net.fetch(pathToFileURL(path).toString())
      const headers = new Headers(res.headers)
      headers.set('Cache-Control', 'public, max-age=604800')
      return new Response(res.body, { status: res.status, headers })
    } catch {
      return new Response('bad request', { status: 400 })
    }
  })
}

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

const changed = (): void => win?.webContents.send(IPC.libraryChanged)

// Run a queued job and turn its outcome into a one-line summary.
async function summarize<T>(p: Promise<T>, ok: (v: T) => string): Promise<JobSummary> {
  try {
    const v = await p
    changed()
    return { ok: true, message: ok(v) }
  } catch (e) {
    changed()
    if (e instanceof CancelledError) return { ok: false, message: '취소했습니다.' }
    return { ok: false, message: String((e as Error)?.message ?? e) }
  }
}

function classifyJob(): Promise<JobSummary> {
  return summarize(core.runClassify().done, (r) =>
    r === null ? '모델이 없어 분류를 건너뛰었습니다. 설정에서 모델을 받으세요.' : `${r.classified}장 분류${r.failed ? `, ${r.failed}장 실패` : ''}`
  )
}

// Re-decide from stored scores; a failure shows as a toast instead of vanishing.
async function redecideJob(): Promise<void> {
  const r = await summarize(core.runRedecide().done, () => '')
  if (!r.ok) win?.webContents.send(IPC.toast, { ok: false, message: `기준 다시 적용 실패: ${r.message}` })
}

function assistJob(): Promise<JobSummary> {
  return summarize(core.runAssist().done, (n) => `보조 모델로 ${n}장 다시 확인`)
}

// A model was installed / removed: the game table re-places characters, an
// assist model can settle open images.
function afterModelChange(id: ModelId): void {
  if (id === 'wd') void core.downloadModel('series').done.then(() => redecideJob()).catch(() => {})
  if (id === 'series' || id === 'pixai') void redecideJob()
  if ((id === 'pixai' || id === 'camie') && core.settings().assistMode !== 'none') void assistJob()
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
    // New thresholds / ignored tags apply to everything already classified
    // (from the stored scores — no model run).
    if (patch.thresholds || patch.ignoredCharacterTags || patch.assistMode) void redecideJob()
    // Assist turned on → ask it about the images the main tagger left open.
    if (patch.assistMode && patch.assistMode !== 'none') void assistJob()
    return s
  })
  ipcMain.handle(IPC.cancelJob, (_e, id: number) => core.queue.cancel(id))
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.runImport, async () => {
    const imp = await summarize(core.runImport().done, (r) => {
      const parts = [`${r.added}장 추가`]
      if (r.moved) parts.push(`${r.moved}장 위치 갱신`)
      if (r.skipped) parts.push(`${r.skipped}장 중복 건너뜀`)
      if (r.failed.length) parts.push(`${r.failed.length}장 실패`)
      return parts.join(', ')
    })
    if (!imp.ok) return imp
    const models = await core.models()
    if (!models.find((x) => x.id === 'wd')?.installed) return { ok: true, message: `${imp.message} · 모델이 없어 분류는 건너뜀` }
    const cls = await classifyJob()
    return { ok: cls.ok, message: `${imp.message} · ${cls.message}` }
  })
  ipcMain.handle(IPC.runClassify, () => classifyJob())
  ipcMain.handle(IPC.reclassifyAll, () => {
    core.markAllForReclassify()
    return classifyJob()
  })
  ipcMain.handle(IPC.models, () => core.models())
  ipcMain.handle(IPC.downloadModel, async (_e, id: ModelId) => {
    const r = await summarize(core.downloadModel(id).done, () => '모델을 받았습니다.')
    if (r.ok) afterModelChange(id)
    return r
  })
  ipcMain.handle(IPC.deleteModel, async (_e, id: ModelId) => {
    await core.deleteModel(id)
    afterModelChange(id)
  })
  ipcMain.handle(IPC.runAssist, () => assistJob())
  ipcMain.handle(IPC.tree, () => core.tree())
  ipcMain.handle(IPC.images, (_e, f: LibraryFilter) => core.images(f))
  ipcMain.handle(IPC.showInFolder, (_e, p: string) => shell.showItemInFolder(p))
  // Review decisions: each refreshes the library views.
  const mutate =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (_e: unknown, ...a: A): R => {
      const r = fn(...a)
      changed()
      return r
    }
  ipcMain.handle(IPC.reviewQueue, (_e, k: ReviewKind) => core.reviewQueue(k))
  ipcMain.handle(IPC.confirmCharacters, mutate((i: number[], c: number[]) => core.confirmCharacters(i, c)))
  ipcMain.handle(IPC.addCharacter, mutate((i: number, c: number) => core.addCharacter(i, c)))
  ipcMain.handle(IPC.markOther, mutate((i: number[]) => core.markOther(i)))
  ipcMain.handle(IPC.setRating, mutate((i: number[], r: Exclude<Rating, 'unknown'>) => core.setRating(i, r)))
  ipcMain.handle(IPC.createCharacter, (_e, n: string, s: string) => core.createCharacter(n, s))
  ipcMain.handle(IPC.searchCharacters, (_e, q: string) => core.searchCharacters(q))
  ipcMain.handle(IPC.seriesNames, () => core.seriesNames())
  ipcMain.handle(IPC.undo, async () => {
    const r = await core.undo()
    changed()
    return r
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
    handleImages()
    registerIpc()
    createWindow()
    // Results were reset for a pipeline fix → re-classify in the background
    // (progress shows in the status bar; cancellable).
    void core.models().then(async (m) => {
      const has = (id: ModelId): boolean => !!m.find((x) => x.id === id)?.installed
      // The small character → game table comes with the main tagger.
      if (has('wd') && !has('series')) {
        await summarize(core.downloadModel('series').done, () => '')
        void redecideJob()
      }
      if (core.resetOnStart && has('wd')) void classifyJob()
      else if (core.redecideOnStart) void redecideJob()
    })
  })
  app.on('window-all-closed', () => {
    core?.close()
    app.quit()
  })
}
