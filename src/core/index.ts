// Sorta engine entry. Pure Node (no Electron imports) so the standalone app,
// Halftone and the tests all drive the same code.
import { mkdirSync } from 'fs'
import { join } from 'path'
import type {
  CharacterHit,
  ImageItem,
  LibraryFilter,
  LibraryTree,
  ModelId,
  ModelInfo,
  Rating,
  ReviewItem,
  ReviewKind,
  Settings,
  UndoResult
} from '../shared/types'
import { openDb, schemaVersion } from './db'
import type { Db } from './db'
import { loadSettings, saveSettings } from './settings'
import { JobQueue } from './queue'
import { ActionLog } from './actionLog'
import type { Tagger } from './ml/types'
import { CAMIE_SPEC, MODEL_SPECS, PIXAI_SPEC, TAGGER_SPEC, deleteModel, downloadModel, modelStatus } from './ml/models'
import type { AssistTagger } from './ml/assist'
import { importImages } from './pipeline/importer'
import type { ImportResult } from './pipeline/importer'
import { assistPending, classifyPending, redecideAll } from './pipeline/classify'
import type { ClassifyResult, DecideOptions } from './pipeline/classify'
import { libraryTree, listImages } from './library'
import * as review from './review'

// Bump when classification output changes meaning (forces a re-tag on start).
// 2: tagger pre-processing fix (inputs were cropped/garbled).
// 3: also drop the stale automatic labels left by rev 1 and re-tag on start.
// 4: per-tag decisions (no 1st/2nd margin), ignored tags, autoAccept 0.75.
// 5: store raw tagger scores (tag_json) for instant re-decisions.
// 6: game table + assist results stored with the scores.
// 7: outfit versions merge with / nest under their base character.
// 8/9: fix version links (a single "(game)" group is not a version).
export const PIPELINE_REV = 9

export interface CorePaths {
  dataDir: string
  dbPath: string
  thumbsDir: string
  modelsDir: string
}

export interface CoreOptions {
  // Override how the tagger is created (tests inject a mock).
  taggerFactory?: (modelsDir: string, useGpu: boolean) => Promise<Tagger>
  assistFactory?: () => Promise<AssistTagger[]>
  seriesMap?: Map<string, string>
}

export class SortaCore {
  readonly db: Db
  readonly queue = new JobQueue(1)
  readonly log: ActionLog
  readonly paths: CorePaths
  private tagger: Promise<Tagger> | null = null
  private assist: Promise<AssistTagger[]> | null = null
  private seriesMap: Promise<Map<string, string>> | null = null
  // True when the stored results predate the current pipeline and were reset
  // on this start (the shell then re-runs classification).
  resetOnStart = false
  // Decision rules changed but stored scores are still valid → re-decide on start.
  redecideOnStart = false
  private taggerKey = ''

  // dataDir ':memory:' → in-memory DB, no folders (tests).
  constructor(
    dataDir: string,
    private opts: CoreOptions = {}
  ) {
    const mem = dataDir === ':memory:'
    this.paths = {
      dataDir,
      dbPath: mem ? ':memory:' : join(dataDir, 'sorta.db'),
      thumbsDir: mem ? '' : join(dataDir, 'thumbs'),
      modelsDir: mem ? '' : join(dataDir, 'models')
    }
    if (!mem) {
      for (const d of [dataDir, this.paths.thumbsDir, this.paths.modelsDir]) mkdirSync(d, { recursive: true })
    }
    this.db = openDb(this.paths.dbPath)
    this.log = new ActionLog(this.db)
    review.registerReviewUndo(this.log, this.db)
    this.checkPipelineRev()
  }

  // Results from an older (buggy) pipeline revision are re-queued for the
  // tagger once. User decisions survive (applyTagResult keeps them).
  private checkPipelineRev(): void {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'pipelineRev'").get() as
      | { value_json: string }
      | undefined
    const rev = row ? Number(JSON.parse(row.value_json)) : 0
    if (rev === PIPELINE_REV) return
    if (rev < 5) {
      this.markAllForReclassify()
      this.resetOnStart = !!this.db.prepare('SELECT 1 FROM images WHERE classified_at IS NULL LIMIT 1').get()
    } else if (rev < PIPELINE_REV) this.redecideOnStart = true // stored scores still valid
    this.db
      .prepare("INSERT INTO settings (key, value_json) VALUES ('pipelineRev', ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json")
      .run(JSON.stringify(PIPELINE_REV))
  }

  // Queue every image for the tagger again. Old automatic results are dropped
  // right away (so stale labels don't linger until the re-run); anything the
  // user decided is kept.
  markAllForReclassify(): number {
    return this.db.transaction(() => {
      this.db.prepare("DELETE FROM image_characters WHERE source = 'auto'").run()
      return this.db.prepare('UPDATE images SET classified_at = NULL WHERE classified_at IS NOT NULL').run().changes
    })()
  }

  get schemaVersion(): number {
    return schemaVersion(this.db)
  }

  settings(): Settings {
    return loadSettings(this.db)
  }

  saveSettings(patch: Partial<Settings>): Settings {
    const s = saveSettings(this.db, patch)
    if (patch.useGpu !== undefined || patch.assistMode !== undefined) this.resetModels() // reload with the new provider / set
    return s
  }

  // ---- models ----

  async models(): Promise<ModelInfo[]> {
    const ids: ModelId[] = ['wd', 'series', 'pixai', 'camie']
    return Promise.all(ids.map((id) => modelStatus(this.paths.modelsDir, MODEL_SPECS[id])))
  }

  downloadModel(id: ModelId): { id: number; done: Promise<void> } {
    const spec = MODEL_SPECS[id]
    return this.queue.add(`모델 받기 · ${spec.label}`, async (ctx) => {
      await downloadModel(this.paths.modelsDir, spec, ctx)
      this.resetModels()
    })
  }

  async deleteModel(id: ModelId): Promise<void> {
    this.resetModels()
    // PixAI's tag list is also the character → game table: keep it.
    await deleteModel(this.paths.modelsDir, MODEL_SPECS[id], id === 'pixai' ? ['pixai-tags.csv'] : [])
  }

  private resetModels(): void {
    this.tagger = null
    this.assist = null
    this.seriesMap = null
  }

  private async getTagger(): Promise<Tagger | null> {
    const useGpu = this.settings().useGpu
    const key = `${useGpu}`
    if (this.tagger && this.taggerKey === key) return this.tagger
    if (!this.opts.taggerFactory && !(await modelStatus(this.paths.modelsDir, TAGGER_SPEC)).installed) return null
    this.taggerKey = key
    const make =
      this.opts.taggerFactory ??
      (async (dir: string, gpu: boolean): Promise<Tagger> => (await import('./ml/wdTagger')).WdTagger.load(dir, gpu))
    this.tagger = make(this.paths.modelsDir, useGpu)
    this.tagger.catch(() => (this.tagger = null))
    return this.tagger
  }

  // Assist models for the current mode that are installed (loaded once).
  private async getAssist(): Promise<AssistTagger[]> {
    if (this.opts.assistFactory) return this.opts.assistFactory()
    const s = this.settings()
    if (s.assistMode === 'none') return []
    if (!this.assist) {
      this.assist = (async () => {
        const { PixaiTagger, CamieTagger } = await import('./ml/assist')
        const out: AssistTagger[] = []
        if ((await modelStatus(this.paths.modelsDir, PIXAI_SPEC)).installed) out.push(await PixaiTagger.load(this.paths.modelsDir, s.useGpu))
        if ((await modelStatus(this.paths.modelsDir, CAMIE_SPEC)).installed) out.push(await CamieTagger.load(this.paths.modelsDir, s.useGpu))
        return out
      })()
      this.assist.catch(() => (this.assist = null))
    }
    return this.assist
  }

  private async getSeriesMap(): Promise<Map<string, string>> {
    if (this.opts.seriesMap) return this.opts.seriesMap
    if (!this.seriesMap) this.seriesMap = (await import('./ml/assist')).loadSeriesMap(this.paths.modelsDir)
    return this.seriesMap
  }

  private async decideOptions(): Promise<DecideOptions> {
    const s = this.settings()
    return { t: s.thresholds, ignored: s.ignoredCharacterTags, assistMode: s.assistMode, seriesMap: await this.getSeriesMap() }
  }

  // ---- pipeline jobs ----

  runImport(): { id: number; done: Promise<ImportResult> } {
    return this.queue.add('가져오기', (ctx) => {
      const s = this.settings()
      return importImages(
        this.db,
        { sourceDirs: s.sourceDirs, exclude: [s.organizeDir], thumbsDir: this.paths.thumbsDir },
        ctx
      )
    })
  }

  // Tag every unclassified image. Resolves null when no model is installed.
  runClassify(): { id: number; done: Promise<ClassifyResult | null> } {
    return this.queue.add('분류', async (ctx) => {
      const tagger = await this.getTagger()
      if (!tagger) return null
      return classifyPending(this.db, { wd: tagger, assist: () => this.getAssist() }, await this.decideOptions(), ctx)
    })
  }

  // Ask the assist models about already-classified images that are still open
  // (after turning assist on or installing an assist model).
  runAssist(): { id: number; done: Promise<number> } {
    return this.queue.add('보조 모델 확인', async (ctx) => {
      const tagger = await this.getTagger()
      if (!tagger) return 0
      return assistPending(this.db, { wd: tagger, assist: () => this.getAssist() }, await this.decideOptions(), ctx)
    })
  }

  // Thresholds / ignored tags / assist mode / game table changed → re-decide
  // from stored scores.
  runRedecide(): { id: number; done: Promise<number> } {
    return this.queue.add('기준 다시 적용', async (ctx) => redecideAll(this.db, await this.decideOptions(), ctx))
  }

  // ---- review (user decisions; each is one undo step) ----

  reviewQueue(kind: ReviewKind): ReviewItem[] {
    return review.reviewQueue(this.db, kind, this.settings().thresholds.reviewMin)
  }

  confirmCharacters(imageIds: number[], characterIds: number[]): void {
    review.confirmCharacters(this.db, this.log, imageIds, characterIds)
  }

  addCharacter(imageId: number, characterId: number): void {
    review.addCharacter(this.db, this.log, imageId, characterId)
  }

  markOther(imageIds: number[]): void {
    review.markOther(this.db, this.log, imageIds)
  }

  setRating(imageIds: number[], rating: Exclude<Rating, 'unknown'>): void {
    review.setRating(this.db, this.log, imageIds, rating)
  }

  createCharacter(name: string, series: string): number {
    return review.createCharacter(this.db, name, series)
  }

  searchCharacters(q: string): CharacterHit[] {
    return review.searchCharacters(this.db, q)
  }

  seriesNames(): string[] {
    return review.seriesNames(this.db)
  }

  async undo(): Promise<UndoResult> {
    const a = await this.log.undo()
    return { ok: true, label: a ? ((a.payload as { label?: string }).label ?? a.type) : null }
  }

  // ---- library ----

  tree(): LibraryTree {
    return libraryTree(this.db)
  }

  images(f: LibraryFilter): ImageItem[] {
    return listImages(this.db, f)
  }

  close(): void {
    this.db.close()
  }
}

export { DEFAULT_SETTINGS } from './settings'
export { JobQueue, CancelledError } from './queue'
export { ActionLog } from './actionLog'
export type * from './ml/types'
