// Electron shell for the standalone app: window, data folder, image protocol,
// IPC wiring. All sorting logic lives in ../core.
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, protocol, shell } from 'electron'
import { watch, type FSWatcher } from 'fs'
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
  learnRefreshSoon(500)
  return summarize(core.runClassify().done, (r) =>
    r === null ? '모델이 없어 분류를 건너뛰었습니다. 설정에서 모델을 받으세요.' : `${r.classified}장 분류${r.failed ? `, ${r.failed}장 실패` : ''}`
  )
}

// Re-decide from stored scores; a failure shows as a toast instead of vanishing.
async function redecideJob(): Promise<void> {
  const r = await summarize(core.runRedecide().done, () => '')
  if (!r.ok) win?.webContents.send(IPC.toast, { ok: false, message: `기준 다시 적용 실패: ${r.message}` })
  void reorganizeJob()
}

// Organized images follow classification changes (moved to their new folder).
async function reorganizeJob(): Promise<void> {
  if (!core.settings().organizeDir) return
  const r = await summarize(core.runReorganize().done, (x) => (x.moved ? `정리 폴더 갱신: ${x.moved}장 이동` : ''))
  if (r.message) win?.webContents.send(IPC.toast, r)
}

// Embed / rebuild references / compare with learned characters. Coalesced:
// review clicks in a row trigger one refresh a moment later.
let refreshTimer: NodeJS.Timeout | null = null
function learnRefreshSoon(ms = 2500): void {
  if (refreshTimer) clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => void learnRefreshJob(), ms)
}
async function learnRefreshJob(): Promise<JobSummary> {
  const r = await summarize(core.runLearnRefresh().done, (x) =>
    x === null ? '캐릭터 학습 모델이 없습니다. 설정 → 모델에서 받으세요.' : `학습한 캐릭터와 비교 완료 (참고 그림 ${x.refs}장)`
  )
  void reorganizeJob() // decisions may have changed
  return r
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

// Import new files, then classify when a model is installed.
async function importJob(): Promise<JobSummary> {
  const imp = await summarize(core.runImport().done, (r) => {
    const parts = [`${r.added}장 추가`]
    if (r.moved) parts.push(`${r.moved}장 위치 갱신`)
    if (r.skipped) parts.push(`중복 ${r.skipped}장 제외`)
    if (r.failed.length) parts.push(`${r.failed.length}장 실패`)
    return parts.join(', ')
  })
  if (!imp.ok) return imp
  const models = await core.models()
  if (!models.find((x) => x.id === 'wd')?.installed) return { ok: true, message: `${imp.message} · 모델이 없어 분류는 건너뛰었습니다` }
  const cls = await classifyJob()
  return { ok: cls.ok, message: `${imp.message} · ${cls.message}` }
}

// 감시 폴더: new files in the source folders are imported (→ classify →
// learned-character check → organized images follow). Bursts are coalesced.
let watchers: FSWatcher[] = []
let watchTimer: NodeJS.Timeout | null = null
function restartWatch(): void {
  for (const w of watchers) w.close()
  watchers = []
  const s = core.settings()
  if (!s.watch) return
  const skip = [s.organizeDir, core.paths.thumbsDir].filter(Boolean)
  for (const dir of s.sourceDirs) {
    try {
      const w = watch(dir, { recursive: true }, (_ev, name) => {
        if (name && skip.some((r) => isInside(join(dir, name.toString()), r))) return
        if (watchTimer) clearTimeout(watchTimer)
        watchTimer = setTimeout(() => {
          watchTimer = null
          void importJob().then((r) => win?.webContents.send(IPC.toast, { ...r, message: `감시 폴더: ${r.message}` }))
        }, 3000)
      })
      w.on('error', () => w.close())
      watchers.push(w)
    } catch {
      // folder missing — skipped until the settings change
    }
  }
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
    if ('watch' in patch || patch.sourceDirs || 'organizeDir' in patch) restartWatch()
    if (('splitByRating' in patch || 'moveAuto' in patch) && !patch.thresholds) void reorganizeJob()
    return s
  })
  ipcMain.handle(IPC.cancelJob, (_e, id: number) => core.queue.cancel(id))
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.runImport, () => importJob())
  ipcMain.handle(IPC.organizePlan, () => core.organizePlan())
  ipcMain.handle(IPC.organize, () =>
    summarize(core.runOrganize().done, (r) => `${r.moved}장 정리${r.failed.length ? `, ${r.failed.length}장 실패` : ''} · Ctrl+Z로 되돌리기`)
  )
  ipcMain.handle(IPC.characters, () => core.characters())
  ipcMain.handle(IPC.affiliations, (_e, s: string) => core.affiliations(s))
  ipcMain.handle(IPC.unknownClusters, () => core.unknownClusters())
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
      learnRefreshSoon() // confirmations become references
      return r
    }
  ipcMain.handle(IPC.reviewQueue, (_e, k: ReviewKind) => core.reviewQueue(k))
  ipcMain.handle(IPC.orgChart, (_e, s: string) => core.orgChart(s))
  ipcMain.handle(IPC.addAffiliation, mutate((s: string, n: string, p: number | null) => core.addAffiliation(s, n, p)))
  ipcMain.handle(IPC.renameAffiliation, mutate((id: number, n: string) => core.renameAffiliation(id, n)))
  ipcMain.handle(IPC.deleteAffiliation, mutate((id: number) => core.deleteAffiliation(id)))
  ipcMain.handle(IPC.moveAffiliation, mutate((id: number, p: number | null, i?: number) => core.moveAffiliation(id, p, i)))
  ipcMain.handle(IPC.placeCharacters, mutate((ids: number[], a: number | null) => core.placeCharacters(ids, a)))
  ipcMain.handle(IPC.setWiki, mutate((s: string, w: string | null) => core.setWiki(s, w)))
  ipcMain.handle(IPC.applyAffiliations, mutate((s: string, items: { characterId: number; path: string[] }[]) => core.applyAffiliations(s, items)))
  ipcMain.handle(IPC.wikiLookup, (_e, s: string, ids?: number[]) => core.wikiLookup(s, ids).done)
  // Wiki pages open in the user's browser (https only).
  ipcMain.handle(IPC.openUrl, (_e, u: string) => {
    if (/^https:\/\//.test(u)) void shell.openExternal(u)
  })
  ipcMain.handle(IPC.renameCharacter, mutate((id: number, n: string) => core.renameCharacter(id, n)))
  ipcMain.handle(IPC.setAliases, mutate((id: number, a: string[]) => core.setAliases(id, a)))
  ipcMain.handle(IPC.setSeries, mutate((ids: number[], s: string) => core.setSeries(ids, s)))
  ipcMain.handle(IPC.setAffiliation, mutate((ids: number[], n: string | null) => core.setAffiliation(ids, n)))
  ipcMain.handle(IPC.mergeCharacters, mutate((f: number[], i: number) => core.mergeCharacters(f, i)))
  ipcMain.handle(IPC.confirmCharacters, mutate((i: number[], c: number[]) => core.confirmCharacters(i, c)))
  ipcMain.handle(IPC.addCharacter, mutate((i: number, c: number) => core.addCharacter(i, c)))
  ipcMain.handle(IPC.markOther, mutate((i: number[]) => core.markOther(i)))
  ipcMain.handle(IPC.setRating, mutate((i: number[], r: Exclude<Rating, 'unknown'>) => core.setRating(i, r)))
  ipcMain.handle(IPC.createCharacter, (_e, n: string, s: string) => core.createCharacter(n, s))
  ipcMain.handle(IPC.searchCharacters, (_e, q: string) => core.searchCharacters(q))
  ipcMain.handle(IPC.characterFromTag, (_e, t: string) => core.characterFromTag(t))
  ipcMain.handle(IPC.seriesNames, () => core.seriesNames())
  ipcMain.handle(IPC.undo, async () => {
    const r = await core.undo()
    changed()
    learnRefreshSoon()
    return r
  })
  ipcMain.handle(IPC.learnRefresh, () => learnRefreshJob())
  ipcMain.handle(IPC.learnPlan, (_e, t: string) => core.learnPlan(t).done)
  ipcMain.handle(IPC.learn, async (_e, tags: string[]) => {
    const r = await summarize(core.runLearn(tags).done, (x) =>
      x === null
        ? '캐릭터 학습 모델이 없습니다. 설정 → 모델에서 받으세요.'
        : `${x.characters}명 학습 (참고 그림 ${x.refs}장)${x.skipped.length ? ` · 그림 부족으로 ${x.skipped.length}명 제외` : ''}${x.failed.length ? ` · 접속 문제로 ${x.failed.length}명 실패 (다시 학습하면 이어서 받습니다)` : ''}`
    )
    if (r.ok) void learnRefreshJob()
    return r
  })
  ipcMain.handle(IPC.booruTags, (_e, q: string) => core.searchBooruTags(q))
  ipcMain.handle(IPC.learned, () => core.learned())
  ipcMain.handle(IPC.forgetLearned, async (_e, id: number) => {
    core.forgetLearned(id)
    await learnRefreshJob()
  })
  ipcMain.handle(IPC.games, () => core.games())
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
    restartWatch()
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
    for (const w of watchers) w.close()
    core?.close()
    app.quit()
  })
}
