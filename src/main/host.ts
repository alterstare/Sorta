// Sorta's main-process side, embeddable: the standalone app (./index.ts) and
// Halftone both call initSorta() with a small host (how to reach the window).
// Owns the core, the sorta-img:// protocol, the IPC handlers, the watch-folder
// watchers and the background jobs. The data folder is shared between the two
// apps, so it is locked while one of them uses it.
import { BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, protocol, shell } from 'electron'
import type { CustomScheme, OpenDialogOptions, SaveDialogOptions } from 'electron'
import { mkdirSync, readFileSync, unlinkSync, watch, writeFileSync, type FSWatcher } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { SortaCore, CancelledError } from '../core'
import { NewerDataError } from '../core/db'
import { isInside } from '../core/pipeline/scan'
import { IPC } from '../shared/ipc'
import type { JobSummary, SortaStatus } from '../shared/ipc'
import type { LibraryFilter, ModelId, PackExportOptions, Rating, RatingPick, ReviewKind, Settings } from '../shared/types'

export interface SortaHostOptions {
  dataDir: string
  appName: string // shown to the other app while this one holds the data folder
  appVersion: string
  embedded?: boolean
  // Open the data folder only when the Sorta screen first asks (Halftone: the
  // standalone app stays usable until Sorta is opened inside Halftone).
  lazy?: boolean
  window: () => BrowserWindow | null // parent for dialogs
  send: (channel: string, payload: unknown) => void // to the Sorta renderer
  onTheme?: (theme: Settings['theme']) => void
  onSettingsSaved?: (patch: Partial<Settings>, s: Settings) => void
}

let opts: SortaHostOptions
let core: SortaCore
let status: SortaStatus = { ready: false }

// sorta-img://f/<base64url path> — serves originals and thumbnails, but only
// files Sorta knows: inside a registered folder (sources / organize / thumb
// cache) or an image already in the DB (its source folder may since have been
// removed from the list). Register before app ready.
export const SORTA_SCHEME: CustomScheme = {
  scheme: 'sorta-img',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
}

const send = (channel: string, payload?: unknown): void => opts.send(channel, payload)
const dlgOpen = (o: OpenDialogOptions): Promise<Electron.OpenDialogReturnValue> => {
  const w = opts.window()
  return w ? dialog.showOpenDialog(w, o) : dialog.showOpenDialog(o)
}
const dlgSave = (o: SaveDialogOptions): Promise<Electron.SaveDialogReturnValue> => {
  const w = opts.window()
  return w ? dialog.showSaveDialog(w, o) : dialog.showSaveDialog(o)
}

function allowedRoots(): string[] {
  const s = core.settings()
  return [...s.sourceDirs, s.organizeDir, core.paths.thumbsDir].filter(Boolean)
}

function handleImages(): void {
  protocol.handle('sorta-img', async (req) => {
    if (!status.ready) return new Response('not ready', { status: 503 })
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

const changed = (): void => send(IPC.libraryChanged)

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
  if (!r.ok) send(IPC.toast, { ok: false, message: `기준 다시 적용 실패: ${r.message}` })
  void reorganizeJob()
}

// Organized images follow classification changes (moved to their new folder).
async function reorganizeJob(): Promise<void> {
  if (!core.settings().organizeDir) return
  const r = await summarize(core.runReorganize().done, (x) => (x.moved ? `정리 폴더 갱신: ${x.moved}장 이동` : ''))
  if (r.message) send(IPC.toast, r)
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
  void summarize(core.runFileStats().done, () => '') // size / date for sorting
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
          void importJob().then((r) => send(IPC.toast, { ...r, message: `감시 폴더: ${r.message}` }))
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
    version: opts.appVersion,
    embedded: !!opts.embedded,
    dataDir: core.paths.dataDir,
    dbPath: core.paths.dbPath,
    schemaVersion: core.schemaVersion
  }))
  ipcMain.handle(IPC.getSettings, () => core.settings())
  ipcMain.handle(IPC.saveSettings, (_e, patch: Partial<Settings>) => {
    const s = core.saveSettings(patch)
    opts.onTheme?.(s.theme)
    // New thresholds / ignored tags apply to everything already classified
    // (from the stored scores — no model run).
    if (patch.thresholds || patch.ignoredCharacterTags || patch.assistMode) void redecideJob()
    // Assist turned on → ask it about the images the main tagger left open.
    if (patch.assistMode && patch.assistMode !== 'none') void assistJob()
    if ('watch' in patch || patch.sourceDirs || 'organizeDir' in patch) restartWatch()
    opts.onSettingsSaved?.(patch, s)
    if (('splitByRating' in patch || 'moveAuto' in patch) && !patch.thresholds) void reorganizeJob()
    return s
  })
  ipcMain.handle(IPC.cancelJob, (_e, id: number) => core.queue.cancel(id))
  ipcMain.handle(IPC.pickFolder, async () => {
    const r = await dlgOpen({ properties: ['openDirectory'] })
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
  ipcMain.handle(IPC.tree, (_e, r?: RatingPick[], g?: number[]) => core.tree(r, g))
  // Collections change no classification: refresh the views only.
  const collect =
    <A extends unknown[], R>(fn: (...a: A) => R) =>
    (_e: unknown, ...a: A): R => {
      const r = fn(...a)
      changed()
      return r
    }
  ipcMain.handle(IPC.setFavorite, collect((ids: number[], on: boolean) => core.setFavorite(ids, on)))
  ipcMain.handle(IPC.setStars, collect((ids: number[], n: number) => core.setStars(ids, n)))
  ipcMain.handle(IPC.groups, () => core.groups())
  ipcMain.handle(IPC.createGroup, collect((n: string, ids?: number[]) => core.createGroup(n, ids)))
  ipcMain.handle(IPC.renameGroup, collect((id: number, n: string) => core.renameGroup(id, n)))
  ipcMain.handle(IPC.deleteGroup, collect((id: number) => core.deleteGroup(id)))
  ipcMain.handle(IPC.setGroupMembership, collect((ids: number[], g: number, on: boolean) => core.setGroupMembership(ids, g, on)))
  ipcMain.handle(IPC.exportPack, async (_e, o: PackExportOptions) => {
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const r = await dlgSave({
      title: 'Sorta 공유 파일로 내보내기',
      defaultPath: `sorta-${stamp}.sortapack`,
      filters: [{ name: 'Sorta 공유 파일', extensions: ['sortapack'] }]
    })
    if (r.canceled || !r.filePath) return null
    try {
      const n = await core.exportPack(r.filePath, opts.appVersion, o)
      return { ok: true, message: `내보내기 완료 · ${(n / 1048576).toFixed(1)}MB · ${r.filePath}` }
    } catch (e) {
      return { ok: false, message: String((e as Error).message ?? e) }
    }
  })
  ipcMain.handle(IPC.pickPack, async () => {
    const r = await dlgOpen({
      title: 'Sorta 공유 파일 불러오기',
      properties: ['openFile'],
      filters: [{ name: 'Sorta 공유 파일', extensions: ['sortapack'] }]
    })
    return r.canceled ? null : r.filePaths[0]
  })
  ipcMain.handle(IPC.previewPack, (_e, f: string, o: { overwrite: boolean; learned: boolean }) => core.previewPack(f, o))
  ipcMain.handle(IPC.importPack, async (_e, f: string, o: { overwrite: boolean; learned: boolean }) => {
    try {
      const p = await core.importPack(f, o)
      changed()
      learnRefreshSoon(500) // compare the library with the new references; organized pictures follow
      return {
        ok: true,
        message: `불러오기 완료 · 새 캐릭터 ${p.newCharacters}명 · 새 소속 ${p.newAffiliations}개${p.learnedCharacters ? ` · 학습 ${p.learnedCharacters}명` : ''} · Ctrl+Z로 되돌리기`
      }
    } catch (e) {
      return { ok: false, message: String((e as Error).message ?? e) }
    }
  })
  ipcMain.handle(IPC.duplicates, () => core.duplicates())
  ipcMain.handle(IPC.setAside, (_e, ids: number[]) =>
    summarize(core.runSetAside(ids).done, (r) => `${r.moved}장을 정리 폴더의 "중복" 폴더로 옮겼습니다${r.failed.length ? ` · ${r.failed.length}장 실패` : ''} · Ctrl+Z로 되돌리기`)
  )
  ipcMain.handle(IPC.notDuplicate, collect((ids: number[]) => core.notDuplicate(ids)))
  // Only images Sorta knows can be copied.
  ipcMain.handle(IPC.copyImage, async (_e, p: string) => {
    if (!core.db.prepare('SELECT 1 FROM images WHERE path = ?').get(p)) return false
    let img = nativeImage.createFromPath(p) // PNG / JPEG
    if (img.isEmpty()) {
      // webp / avif / gif …: decode with sharp (first frame) → PNG
      try {
        const sharp = (await import('sharp')).default
        img = nativeImage.createFromBuffer(await sharp(p, { animated: false }).png().toBuffer())
      } catch {
        return false
      }
    }
    if (img.isEmpty()) return false
    clipboard.writeImage(img)
    return true
  })
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
  core.queue.onProgress((e) => send(IPC.progress, e))
}


// ---- data-folder lock (one app at a time) ----

const lockFile = (): string => join(opts.dataDir, 'sorta.lock')
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM'
  }
}
function takeLock(): SortaStatus {
  mkdirSync(opts.dataDir, { recursive: true })
  try {
    const l = JSON.parse(readFileSync(lockFile(), 'utf8')) as { pid: number; app: string }
    if (l.pid !== process.pid && alive(l.pid)) return { ready: false, lockedBy: l.app }
  } catch {
    // no lock / unreadable → free
  }
  writeFileSync(lockFile(), JSON.stringify({ pid: process.pid, app: opts.appName }))
  return { ready: true }
}

// Set up the IPC; open the data folder unless another app holds it (the
// renderer then shows "used by …" with a retry). Call once, after app ready.
export function initSorta(o: SortaHostOptions): SortaStatus {
  opts = o
  ipcMain.handle(IPC.status, () => (status.ready ? status : open()))
  ipcMain.handle(IPC.retryLock, () => (status.ready ? status : open()))
  ipcMain.handle(IPC.start, () => startSorta())
  // The image protocol is there from the start (a handler added only once
  // the data folder opens missed the first images in an embedding frame).
  handleImages()
  return o.lazy ? status : open()
}

let opened = false
function open(): SortaStatus {
  status = takeLock()
  if (!status.ready || opened) return status
  try {
    core = new SortaCore(opts.dataDir)
  } catch (e) {
    releaseLock()
    // A newer Sorta (standalone or in Halftone) made this data: don't touch it.
    if (e instanceof NewerDataError) return (status = { ready: false, newerData: true })
    throw e
  }
  opened = true
  registerIpc()
  return status
}

export const sortaCore = (): SortaCore | null => (status.ready ? core : null)

// Background work once the Sorta screen is shown (idempotent): watch folders
// and the start-up jobs.
let started = false
export function startSorta(): void {
  if (!status.ready || started) return
  started = true
  restartWatch()
  // Results were reset for a pipeline fix → re-classify in the background
  // (progress shows in the status bar; cancellable).
  void summarize(core.runFileStats().done, () => '') // images imported before sizes were kept
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
}

export function closeSorta(): void {
  for (const w of watchers) w.close()
  if (!status.ready) return
  core.close()
  releaseLock()
}

function releaseLock(): void {
  try {
    const l = JSON.parse(readFileSync(lockFile(), 'utf8')) as { pid: number }
    if (l.pid === process.pid) unlinkSync(lockFile())
  } catch {
    // already gone
  }
}
