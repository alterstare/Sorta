// Sorta engine entry. Pure Node (no Electron imports) so the standalone app,
// Halftone and the tests all drive the same code.
import { mkdirSync } from 'fs'
import { join } from 'path'
import type {
  CharacterHit,
  ClusterResult,
  ManagedCharacter,
  OrganizePlan,
  PackExportOptions,
  PackPreview,
  DupGroup,
  RatingPick,
  OrgChart,
  WikiLookupResult,
  GameOption,
  LearnedCharacter,
  LearnPlanInfo,
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
import { CancelledError, JobQueue } from './queue'
import { ActionLog } from './actionLog'
import type { Tagger } from './ml/types'
import { CAMIE_SPEC, CCIP_SPEC, MODEL_SPECS, PIXAI_SPEC, TAGGER_SPEC, deleteModel, downloadModel, modelStatus } from './ml/models'
import type { AssistTagger } from './ml/assist'
import { importImages } from './pipeline/importer'
import type { ImportResult } from './pipeline/importer'
import { assistPending, classifyPending, redecideAll } from './pipeline/classify'
import type { ClassifyResult, DecideOptions } from './pipeline/classify'
import { fillFileStats, libraryTree, listImages } from './library'
import * as collect from './collect'
import * as dupes from './dupes'
import * as pack from './pack'
import { promises as fsp } from 'fs'
import type { GrayLoader } from './dupes'
import * as review from './review'
import * as organize from './organize'
import * as manage from './manage'
import { unknownClusters } from './cluster'
import * as org from './org'
import * as wiki from './pipeline/wiki'
import type { JsonGet } from './pipeline/wiki'
import * as booru from './pipeline/booru'
import { stopTunnel } from './pipeline/booruNet'
import { embedImages, imagesToEmbed, matchImages, refreshUserRefs } from './pipeline/knn'
import { trashImages } from './trash'
import type { TrashFn } from './trash'
import type { LearnModels } from './pipeline/knn'
import { displayName } from './pipeline/tags'
import { buildVocab, searchVocab } from './pipeline/vocab'
import type { VocabEntry } from './pipeline/vocab'
import { ensureCharacter } from './pipeline/classify'

// Bump when classification output changes meaning (forces a re-tag on start).
// 2: tagger pre-processing fix (inputs were cropped/garbled).
// 3: also drop the stale automatic labels left by rev 1 and re-tag on start.
// 4: per-tag decisions (no 1st/2nd margin), ignored tags, autoAccept 0.75.
// 5: store raw tagger scores (tag_json) for instant re-decisions.
// 6: game table + assist results stored with the scores.
// 7: outfit versions merge with / nest under their base character.
// 8/9: fix version links (a single "(game)" group is not a version).
// 10: R-18 = explicit only; questionable joins 민감 (re-decided from stored scores).
export const PIPELINE_REV = 10

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
  learnFactory?: () => Promise<LearnModels>
  seriesMap?: Map<string, string>
  wikiGet?: JsonGet // tests answer wiki requests
  wikiGapMs?: number
  vocabTags?: string[] // tests: what the taggers know
  grayLoader?: GrayLoader // tests: 64×64 grays for the duplicate detail check
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
    organize.registerOrganizeUndo(this.log, this.db)
    manage.registerManageUndo(this.log, this.db)
    org.registerOrgUndo(this.log, this.db)
    collect.registerCollectUndo(this.log, this.db)
    dupes.registerDupUndo(this.log, this.db)
    pack.registerPackUndo(this.log, this.db)
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
    const ids: ModelId[] = ['wd', 'series', 'pixai', 'camie', 'ccip']
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
    this.learnModels = null
    this.tagger = null
    this.assist = null
    this.seriesMap = null
    this.vocab = null
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
        { sourceDirs: s.sourceDirs, exclude: [s.organizeDir], thumbsDir: this.paths.thumbsDir, dupDistance: s.thresholds.dupDistance },
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

  markGroup(imageIds: number[], series: string | null = null): void {
    review.markGroup(this.db, this.log, imageIds, series)
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

  // Library characters first, then characters the taggers know but the
  // library doesn't have yet (picking one creates it — characterFromTag).
  async searchCharacters(q: string): Promise<CharacterHit[]> {
    const own = review.searchCharacters(this.db, q)
    const have = new Set(
      (this.db.prepare('SELECT danbooru_tag AS t FROM characters WHERE danbooru_tag IS NOT NULL').all() as { t: string }[]).map((r) => r.t)
    )
    for (const t of this.settings().ignoredCharacterTags) have.add(t)
    const more = searchVocab(await this.getVocab(), q, have).map((e) => ({ id: 0, name: e.name, series: e.series, n: 0, tag: e.tag }))
    return [...own, ...more]
  }

  // A model-known character → a library character (created once, with its
  // game from the character → game table; outfit versions link to the base).
  async characterFromTag(tag: string): Promise<CharacterHit> {
    const id = ensureCharacter(this.db, tag, await this.getSeriesMap())
    const r = this.db
      .prepare('SELECT c.name, s.name AS series FROM characters c JOIN series s ON s.id = c.series_id WHERE c.id = ?')
      .get(id) as { name: string; series: string }
    return { id, name: r.name, series: r.series, n: 0 }
  }

  private vocab: VocabEntry[] | null = null
  private async getVocab(): Promise<VocabEntry[]> {
    if (!this.vocab) {
      const tags = this.opts.vocabTags ?? (await booru.knownVocab(this.paths.modelsDir, true, true))
      this.vocab = buildVocab(tags, await this.getSeriesMap())
    }
    return this.vocab
  }

  seriesNames(): string[] {
    return review.seriesNames(this.db)
  }

  async undo(): Promise<UndoResult> {
    const a = await this.log.undo()
    return { ok: true, label: a ? ((a.payload as { label?: string }).label ?? a.type) : null }
  }

  // Put back what the last undo reverted (this session only).
  async redo(): Promise<UndoResult> {
    return { ok: true, label: await this.log.redo() }
  }

  // ---- character learning (Phase 3) ----

  private learnModels: Promise<LearnModels> | null = null

  private async getLearnModels(): Promise<LearnModels | null> {
    if (this.opts.learnFactory) return this.opts.learnFactory()
    if (!(await modelStatus(this.paths.modelsDir, CCIP_SPEC)).installed) return null
    if (!this.learnModels) {
      const gpu = this.settings().useGpu
      this.learnModels = (async () => {
        const { CcipEmbedder, PersonDetector } = await import('./ml/ccip')
        const [feat, person] = CCIP_SPEC.files.map((f) => join(this.paths.modelsDir, f.file))
        return { embedder: await CcipEmbedder.load(feat, gpu), detector: await PersonDetector.load(person, gpu) }
      })()
      this.learnModels.catch(() => (this.learnModels = null))
    }
    return this.learnModels
  }

  // Vectors for confirmed / open images → rebuild user references → compare
  // open images with the learned characters.
  runLearnRefresh(): { id: number; done: Promise<{ embedded: number; refs: number } | null> } {
    // background: never blocks the app or other jobs (they go first)
    return this.queue.add('학습한 캐릭터 비교', async (ctx) => {
      const sig = await this.learnInputs()
      const m = await this.getLearnModels()
      if (!m) {
        this.learnSig = sig
        return null
      }
      const embedded = await embedImages(this.db, m, imagesToEmbed(this.db), ctx)
      if (ctx.signal.aborted) throw new CancelledError() // made way for another job: starts over later
      const refs = await refreshUserRefs(this.db)
      await matchImages(this.db, await this.decideOptions(), ctx)
      if (ctx.signal.aborted) throw new CancelledError()
      this.learnSig = sig
      return { embedded, refs }
    }, { background: true })
  }

  // What the comparison depends on: pictures still to embed, the user's
  // confirmations (→ references), learned references, the model, the
  // thresholds. Unchanged since the last run → comparing again changes nothing.
  private learnSig = ''
  private async learnInputs(): Promise<string> {
    const q = (sql: string): unknown => this.db.prepare(sql).get()
    return JSON.stringify([
      imagesToEmbed(this.db).length,
      q(`SELECT COUNT(*) n, SUM(image_id) i, SUM(character_id) c FROM image_characters
         WHERE source = 'user' AND status = 'confirmed' AND character_id IS NOT NULL`),
      q("SELECT COUNT(*) n, SUM(character_id) c FROM refs WHERE source = 'booru'"),
      (await modelStatus(this.paths.modelsDir, CCIP_SPEC)).installed,
      await this.decideOptions()
    ])
  }
  async learnRefreshNeeded(): Promise<boolean> {
    return (await this.learnInputs()) !== this.learnSig
  }

  // Checks each candidate's usable picture count → runs as a job (progress).
  learnPlan(seriesTag: string): { id: number; done: Promise<LearnPlanInfo> } {
    return this.queue.add('학습할 캐릭터 확인', async (ctx) => {
      const s = this.settings()
      if (!s.allowWebLookup) throw new Error('설정에서 "외부 조회 허용"을 켜야 학습할 수 있습니다')
      const known = await booru.knownVocab(this.paths.modelsDir, s.assistMode !== 'none', s.assistMode === 'pixai+camie')
      const src = await this.booruSource()
      const plan = await booru.planGame(src, this.db, seriesTag, known, s.ignoredCharacterTags, await this.getSeriesMap(), s.learnMinPosts, ctx)
      return { ...plan, source: new URL(src.base).hostname }
    })
  }

  runLearn(tags: string[]): { id: number; done: Promise<{ characters: number; refs: number; skipped: string[]; failed: string[] } | null> } {
    return this.queue.add('캐릭터 학습', async (ctx) => {
      const s = this.settings()
      if (!s.allowWebLookup) throw new Error('설정에서 "외부 조회 허용"을 켜야 학습할 수 있습니다')
      const m = await this.getLearnModels()
      if (!m) return null
      return booru.learnTags(await this.booruSource(), this.db, tags, m, await this.getSeriesMap(), s.learnPerCharacter, s.learnMinPosts, ctx)
    })
  }

  async searchBooruTags(q: string): Promise<{ name: string; post_count: number }[]> {
    if (!this.settings().allowWebLookup) return []
    return booru.searchTags(await this.booruSource(), q)
  }

  // Danbooru (through the bypass tunnel) when chosen and reachable; otherwise
  // Safebooru. Checked once per session.
  private sourceCheck: Promise<booru.BooruSource> | null = null
  private sourceKey = ''
  private booruSource(): Promise<booru.BooruSource> {
    const s = this.settings()
    const key = `${s.booruSource}:${s.learnSensitive}`
    if (!this.sourceCheck || this.sourceKey !== key) {
      this.sourceKey = key
      this.sourceCheck = (async () => {
        if (s.booruSource === 'danbooru') {
          const d = booru.DANBOORU(s.learnSensitive)
          if (await booru.reachable(d)) return d
        }
        return booru.SAFEBOORU
      })()
    }
    return this.sourceCheck
  }

  learned(): LearnedCharacter[] {
    return this.db
      .prepare(
        `SELECT l.character_id AS characterId, c.name, s.name AS series, l.tag, l.refs, l.learned_at AS learnedAt,
           (SELECT COUNT(*) FROM refs r WHERE r.character_id = l.character_id AND r.source = 'user') AS userRefs
         FROM learned l JOIN characters c ON c.id = l.character_id JOIN series s ON s.id = c.series_id
         ORDER BY s.name COLLATE NOCASE, c.name COLLATE NOCASE`
      )
      .all() as LearnedCharacter[]
  }

  forgetLearned(characterId: number): void {
    this.db.prepare("DELETE FROM refs WHERE character_id = ? AND source = 'booru'").run(characterId)
    this.db.prepare('DELETE FROM learned WHERE character_id = ?').run(characterId)
  }

  // Games to offer for "게임 학습": known series with their danbooru tag.
  async games(): Promise<GameOption[]> {
    const out = new Map<string, string>()
    for (const r of this.db.prepare('SELECT name, danbooru_copyright_tag AS t FROM series WHERE danbooru_copyright_tag IS NOT NULL').all() as {
      name: string
      t: string
    }[])
      out.set(r.t, r.name)
    for (const ip of new Set((await this.getSeriesMap()).values())) if (!out.has(ip)) out.set(ip, displayName(ip))
    return [...out].map(([tag, name]) => ({ tag, name })).sort((a, b) => a.name.localeCompare(b.name))
  }

  // ---- organizing (Phase 4) ----

  organizePlan(): OrganizePlan {
    return organize.planOrganize(this.db, this.settings())
  }

  // Move every settled image into the organize folder (one undo step).
  runOrganize(): { id: number; done: Promise<{ moved: number; failed: { path: string; error: string }[] }> } {
    return this.queue.add('폴더 정리', async (ctx) => {
      const plan = organize.planOrganize(this.db, this.settings())
      return organize.executeMoves(this.db, this.log, plan.moves, ctx)
    })
  }

  // Images organized before follow their (changed) classification. Not an
  // undo step of its own: undoing the classification moves them back again.
  runReorganize(): { id: number; done: Promise<{ moved: number; failed: { path: string; error: string }[] }> } {
    return this.queue.add('정리 폴더 갱신', async (ctx) => {
      const plan = organize.planOrganize(this.db, this.settings(), true)
      return organize.executeMoves(this.db, null, plan.moves, ctx, '정리 폴더 갱신')
    })
  }

  // ---- character management (Phase 4; each change is one undo step) ----

  characters(): ManagedCharacter[] {
    return manage.listCharacters(this.db)
  }
  affiliations(series: string): string[] {
    return manage.affiliationNames(this.db, series)
  }
  renameCharacter(id: number, name: string): void {
    manage.renameCharacter(this.db, this.log, id, name)
  }
  setAliases(id: number, aliases: string[]): void {
    manage.setAliases(this.db, this.log, id, aliases)
  }
  setSeries(ids: number[], series: string): void {
    manage.setSeries(this.db, this.log, ids, series)
  }
  setAffiliation(ids: number[], name: string | null): void {
    manage.setAffiliation(this.db, this.log, ids, name)
  }
  mergeCharacters(from: number[], into: number): void {
    manage.mergeCharacters(this.db, this.log, from, into)
  }

  // ---- 소속 조직도 (each change is one undo step) ----

  orgChart(series: string): OrgChart {
    return org.orgChart(this.db, series)
  }
  addAffiliation(series: string, name: string, parentId: number | null): number {
    return org.addAffiliation(this.db, this.log, series, name, parentId)
  }
  renameAffiliation(id: number, name: string): void {
    org.renameAffiliation(this.db, this.log, id, name)
  }
  deleteAffiliation(id: number): void {
    org.deleteAffiliation(this.db, this.log, id)
  }
  moveAffiliation(id: number, parentId: number | null, index?: number): void {
    org.moveAffiliation(this.db, this.log, id, parentId, index)
  }
  placeCharacters(ids: number[], affiliationId: number | null): void {
    org.placeCharacters(this.db, this.log, ids, affiliationId)
  }
  setWiki(series: string, w: string | null): void {
    org.setWiki(this.db, this.log, series, w)
  }
  applyAffiliations(series: string, items: { characterId: number; path: string[] }[]): number {
    return org.applyPaths(this.db, this.log, series, items)
  }

  // Ask the game's wiki (by character name) for affiliations. `ids` = which
  // characters (default: the ones without an affiliation). Finds the wiki
  // first when the game has none set.
  wikiLookup(series: string, ids?: number[]): { id: number; done: Promise<WikiLookupResult> } {
    return this.queue.add('위키에서 소속 찾기', async (ctx) => {
      if (!this.settings().allowWebLookup) throw new Error('설정에서 "외부 조회"를 허용해야 위키를 찾을 수 있습니다')
      const get = this.opts.wikiGet ?? wiki.fetchJson
      const chart = org.orgChart(this.db, series)
      let w = chart.wiki
      if (!w) {
        w = await wiki.findWiki(series, get, ctx.signal)
        if (!w) throw new Error(`"${series}" 위키를 찾지 못했습니다. 조직도에서 위키 주소를 직접 넣어 주세요`)
        this.db.prepare('UPDATE series SET wiki = ? WHERE name = ?').run(w, series)
      }
      const chars = chart.characters.filter((c) => (ids ? ids.includes(c.id) : c.affiliationId === null))
      const suggestions = await wiki.lookupAll(w, chars, ctx, get, this.opts.wikiGapMs)
      return { wiki: w, suggestions }
    })
  }

  unknownClusters(): ClusterResult {
    return unknownClusters(this.db, this.settings().thresholds.clusterSimilarity)
  }

  // ---- library ----

  // `ratings`: the library's rating filter → each count also shown filtered.
  tree(ratings?: RatingPick[], groups?: number[]): LibraryTree {
    return libraryTree(this.db, ratings, this.dupCount(), groups, this.settings().ignoredCharacterTags)
  }

  // ---- 공유 파일 (.sortapack) ----

  async exportPack(file: string, appVersion: string, o: PackExportOptions): Promise<number> {
    const buf = pack.exportPack(this.db, appVersion, o)
    await fsp.writeFile(file, buf)
    return buf.length
  }
  // What importing `file` would do (nothing is changed).
  async previewPack(file: string, o: { overwrite: boolean; learned: boolean }): Promise<PackPreview> {
    return pack.planImport(this.db, pack.readPack(await fsp.readFile(file)), o).preview
  }
  async importPack(file: string, o: { overwrite: boolean; learned: boolean }): Promise<PackPreview> {
    return pack.importPack(this.db, this.log, pack.readPack(await fsp.readFile(file)), o)
  }

  // ---- 중복 정리 ----

  // Near-duplicate groups; cached until images / set-aside / 중복 아님 /
  // thresholds change. The first check reads thumbnails (a few seconds).
  private dupCache: { key: string; groups: DupGroup[] } | null = null
  private dupRun: { key: string; p: Promise<DupGroup[]> } | null = null
  private dupKey(): string {
    const k = this.db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM images) || ':' || (SELECT COALESCE(MAX(id), 0) FROM images) || ':' ||
                (SELECT COUNT(*) FROM images WHERE set_aside = 1) || ':' || (SELECT COUNT(*) FROM not_dup) || ':' ||
                (SELECT COALESCE(SUM(id), 0) FROM images WHERE phash IS NOT NULL) AS k`
      )
      .get() as { k: string }
    const t = this.settings().thresholds
    return `${k.k}:${t.dupDistance}:${t.dupDetail}`
  }
  async duplicates(): Promise<DupGroup[]> {
    const key = this.dupKey()
    if (this.dupCache?.key === key) return this.dupCache.groups
    if (this.dupRun?.key !== key) {
      const t = this.settings().thresholds
      const p = this.queue
        .add('중복 확인', () => dupes.duplicateGroups(this.db, t.dupDistance, t.dupDetail, this.opts.grayLoader))
        .done.then((groups) => ((this.dupCache = { key, groups }), groups))
      this.dupRun = { key, p }
    }
    return this.dupRun.p
  }
  // Images in duplicate groups, when known (the tree shows it).
  private dupCount(): number | null {
    return this.dupCache && this.dupCache.key === this.dupKey() ? this.dupCache.groups.reduce((n, g) => n + g.images.length, 0) : null
  }
  // Move duplicates to <정리 폴더>/중복 (hidden from the library). One undo step.
  // 삭제 → the OS recycle bin (`trash` from the host), out of the library.
  runTrash(ids: number[], trash: TrashFn): { id: number; done: Promise<{ trashed: number; failed: string[] }> } {
    return this.queue.add('휴지통으로 보내기', () => trashImages(this.db, ids, trash, this.paths.thumbsDir))
  }

  runSetAside(ids: number[]): { id: number; done: Promise<{ moved: number; failed: string[] }> } {
    return this.queue.add('중복 따로 두기', () => dupes.setAside(this.db, this.log, ids, this.settings().organizeDir))
  }
  notDuplicate(ids: number[]): void {
    dupes.markNotDuplicate(this.db, this.log, ids)
  }

  // File size / modified time of images that lack them (sorting by 크기 / 날짜).
  runFileStats(): { id: number; done: Promise<number> } {
    return this.queue.add('파일 정보 확인', () => fillFileStats(this.db))
  }

  // ---- 즐겨찾기 · 평점 · 그룹 (each change is one undo step) ----

  setFavorite(ids: number[], on: boolean): void {
    collect.setFavorite(this.db, this.log, ids, on)
  }
  setStars(ids: number[], stars: number): void {
    collect.setStars(this.db, this.log, ids, stars)
  }
  groups(): { id: number; name: string }[] {
    return collect.listGroups(this.db)
  }
  createGroup(name: string, ids?: number[]): number {
    return collect.createGroup(this.db, this.log, name, ids)
  }
  renameGroup(id: number, name: string): void {
    collect.renameGroup(this.db, this.log, id, name)
  }
  deleteGroup(id: number): void {
    collect.deleteGroup(this.db, this.log, id)
  }
  setGroupMembership(ids: number[], groupId: number, on: boolean): void {
    collect.setGroupMembership(this.db, this.log, ids, groupId, on)
  }

  images(f: LibraryFilter): ImageItem[] {
    return listImages(this.db, f)
  }

  close(): void {
    void stopTunnel()
    this.db.close()
  }
}

export { DEFAULT_SETTINGS } from './settings'
export { JobQueue, CancelledError } from './queue'
export { ActionLog } from './actionLog'
export type * from './ml/types'
