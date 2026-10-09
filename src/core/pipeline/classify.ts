// 분류 (CLAUDE.md §5.2–5.4). For each image not yet classified:
// WD tagger → rating + character candidates; when that leaves something open
// and assist models are enabled, ask PixAI (and Camie) too → per-character
// rows (see decide.ts). Raw scores are stored in images.tag_json so threshold
// changes re-decide without running any model again.
import type { Db } from '../db'
import type { JobContext } from '../queue'
import type { AssistMode, Thresholds } from '../../shared/types'
import type { TagResult, Tagger, RgbImage } from '../ml/types'
import type { AssistTagger, CharScore } from '../ml/assist'
import { decideRating } from './rating'
import { decideEnsemble, needsAssist } from './decide'
import { displayName, parseCharacterTag, variantBase } from './tags'
import { loadRgb } from './imageio'

// Series for character tags whose game can't be resolved.
export const UNKNOWN_SERIES = '작품 미상'

export interface ClassifyResult {
  classified: number
  failed: number
}

// What we keep per image (tag_json).
export interface StoredTags {
  rating: TagResult['rating']
  characters: CharScore[] // WD
  pixai?: CharScore[]
  camie?: CharScore[]
  knn?: CharScore[] // learned characters (tag, or "#<character id>" for tagless ones)
}

export interface DecideOptions {
  t: Thresholds
  ignored: string[]
  assistMode: AssistMode
  seriesMap?: Map<string, string> // character tag → series tag
}

function ensureSeries(db: Db, name: string, seriesTag: string | null): number {
  db.prepare('INSERT OR IGNORE INTO series (name, aliases, danbooru_copyright_tag, created_at) VALUES (?, ?, ?, ?)').run(
    name,
    JSON.stringify(seriesTag ? [seriesTag] : []),
    seriesTag,
    Date.now()
  )
  return (db.prepare('SELECT id FROM series WHERE name = ?').get(name) as { id: number }).id
}

// Game for a character tag: the character → game table, else its "(series)"
// suffix, else 작품 미상.
export function seriesOf(tag: string, map?: Map<string, string>): { name: string; tag: string | null } {
  const mapped = map?.get(tag)
  if (mapped) return { name: displayName(mapped), tag: mapped }
  const p = parseCharacterTag(tag)
  if (p.series) return { name: p.series, tag: p.seriesTag }
  return { name: UNKNOWN_SERIES, tag: null }
}

// Outfit/version characters hang under their base character (created if
// needed) — folders merge them, the library tree nests them.
export function linkVariant(db: Db, id: number, tag: string, map?: Map<string, string>): void {
  const sid = (db.prepare('SELECT series_id FROM characters WHERE id = ?').get(id) as { series_id: number }).series_id
  // Bare-name base only when it's a known character in the same game.
  const sameGame = (t: string): boolean =>
    !!db.prepare('SELECT 1 FROM characters WHERE danbooru_tag = ? AND series_id = ?').get(t, sid)
  const base = variantBase(tag, map, sameGame)
  const parent = base ? ensureCharacter(db, base, map) : null
  db.prepare('UPDATE characters SET parent_id = ? WHERE id = ? AND parent_id IS NOT ?').run(parent === id ? null : parent, id, parent === id ? null : parent)
}

export function ensureCharacter(db: Db, tag: string, map?: Map<string, string>): number {
  const id = ensureCharacterRow(db, tag, map)
  linkVariant(db, id, tag, map)
  return id
}

function ensureCharacterRow(db: Db, tag: string, map?: Map<string, string>): number {
  const found = db
    .prepare('SELECT c.id, s.name AS sname FROM characters c JOIN series s ON s.id = c.series_id WHERE c.danbooru_tag = ?')
    .get(tag) as { id: number; sname: string } | undefined
  if (found) {
    // A character first seen without a known game moves once the table knows it.
    if (found.sname === UNKNOWN_SERIES) {
      const s = seriesOf(tag, map)
      if (s.name !== UNKNOWN_SERIES) {
        db.prepare('UPDATE characters SET series_id = ? WHERE id = ?').run(ensureSeries(db, s.name, s.tag), found.id)
      }
    }
    return found.id
  }
  const p = parseCharacterTag(tag)
  const s = seriesOf(tag, map)
  const sid = ensureSeries(db, s.name, s.tag)
  // Same display name already in this series (e.g. created by hand) → link the tag to it.
  const same = db.prepare('SELECT id, aliases FROM characters WHERE series_id = ? AND name = ?').get(sid, p.name) as
    | { id: number; aliases: string }
    | undefined
  if (same) {
    const aliases = new Set<string>(JSON.parse(same.aliases))
    aliases.add(tag)
    db.prepare('UPDATE characters SET danbooru_tag = COALESCE(danbooru_tag, ?), aliases = ? WHERE id = ?').run(
      tag,
      JSON.stringify([...aliases]),
      same.id
    )
    return same.id
  }
  const r = db
    .prepare('INSERT INTO characters (series_id, name, aliases, danbooru_tag, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(sid, p.name, JSON.stringify([tag]), tag, Date.now())
  return Number(r.lastInsertRowid)
}

// A decision key → character id: a danbooru tag, or "#<id>" for characters
// without one (user-created, matched by learned references).
export function characterFor(db: Db, key: string, map?: Map<string, string>): number {
  return key.startsWith('#') ? Number(key.slice(1)) : ensureCharacter(db, key, map)
}

// Assist results only count for the enabled mode.
function scoresFor(
  st: StoredTags,
  mode: AssistMode
): { wd: CharScore[]; pixai?: CharScore[]; camie?: CharScore[]; knn?: CharScore[] } {
  return {
    wd: st.characters,
    knn: st.knn,
    pixai: mode !== 'none' ? st.pixai : undefined,
    camie: mode === 'pixai+camie' ? st.camie : undefined
  }
}

// Write the decision for one image from its stored scores (replaces earlier
// auto rows; keeps anything the user decided).
export function applyTagResult(db: Db, imageId: number, st: StoredTags, o: DecideOptions): void {
  const r = decideRating(st.rating, o.t)
  db.transaction(() => {
    const userRating =
      (db.prepare('SELECT rating_source FROM images WHERE id = ?').get(imageId) as { rating_source: string }).rating_source === 'user'
    if (!userRating) {
      db.prepare('UPDATE images SET rating = ?, rating_score = ?, rating_review = ? WHERE id = ?').run(
        r.rating,
        r.score,
        r.review ? 1 : 0,
        imageId
      )
    }
    db.prepare("DELETE FROM image_characters WHERE image_id = ? AND source = 'auto'").run(imageId)
    // User decisions win: confirmed characters, or "캐릭터 아님".
    const hasUser =
      db.prepare("SELECT 1 FROM image_characters WHERE image_id = ? AND source = 'user'").get(imageId) ||
      (db.prepare('SELECT kind FROM images WHERE id = ?').get(imageId) as { kind: string }).kind === 'other'
    const rows = decideEnsemble(scoresFor(st, o.assistMode), o.t, o.ignored)
    if (!hasUser) {
      const ins = db.prepare(
        `INSERT INTO image_characters (image_id, character_id, status, source, confidence, candidates)
         VALUES (?, ?, ?, 'auto', ?, ?)`
      )
      for (const row of rows) {
        const cands = row.candidates.map((c) => ({ characterId: characterFor(db, c.tag, o.seriesMap), score: c.score }))
        ins.run(
          imageId,
          row.tag ? characterFor(db, row.tag, o.seriesMap) : null,
          row.status,
          row.confidence,
          cands.length ? JSON.stringify(cands) : null
        )
      }
    }
    const kind = rows.some((x) => x.tag) ? 'character' : 'unknown'
    db.prepare(
      `UPDATE images SET kind = CASE WHEN kind = 'other' THEN kind ELSE ? END, tag_json = ?,
       classified_at = COALESCE(classified_at, ?), error = NULL WHERE id = ?`
    ).run(kind, JSON.stringify(st), Date.now(), imageId)
  })()
}

export interface Models {
  wd: Tagger
  // Loaded lazily, only when an image needs a second opinion.
  assist: () => Promise<AssistTagger[]>
}

// Ask the enabled assist models about one image (skips results already stored).
async function runAssist(st: StoredTags, img: () => Promise<RgbImage>, models: Models, mode: AssistMode): Promise<boolean> {
  if (mode === 'none') return false
  const want = (await models.assist()).filter((m) => (m.id === 'pixai' ? !st.pixai : mode === 'pixai+camie' && !st.camie))
  if (!want.length) return false
  const rgb = await img()
  for (const m of want) st[m.id] = await m.characters(rgb)
  return true
}

const openAfterMain = (st: StoredTags, o: DecideOptions): boolean => needsAssist(decideEnsemble({ wd: st.characters }, o.t, o.ignored))

export async function classifyPending(
  db: Db,
  models: Models,
  o: DecideOptions,
  ctx: JobContext,
  load: (path: string) => Promise<RgbImage> = (p) => loadRgb(p)
): Promise<ClassifyResult> {
  const rows = db
    .prepare('SELECT id, path FROM images WHERE classified_at IS NULL AND thumbnail_path IS NOT NULL ORDER BY id')
    .all() as { id: number; path: string }[]
  const res: ClassifyResult = { classified: 0, failed: 0 }
  for (let i = 0; i < rows.length; i++) {
    if (ctx.signal.aborted) break
    ctx.report(i, rows.length, '분류하는 중')
    try {
      let rgb: RgbImage | null = null
      const img = async (): Promise<RgbImage> => (rgb ??= await load(rows[i].path))
      const tags = await models.wd.tag(await img())
      const st: StoredTags = { rating: tags.rating, characters: tags.characters }
      if (openAfterMain(st, o)) await runAssist(st, img, models, o.assistMode)
      db.prepare('UPDATE images SET classified_at = NULL WHERE id = ?').run(rows[i].id)
      applyTagResult(db, rows[i].id, st, o)
      res.classified++
    } catch (e) {
      db.prepare('UPDATE images SET error = ? WHERE id = ?').run(`classify: ${String((e as Error)?.message ?? e)}`, rows[i].id)
      res.failed++
    }
  }
  ctx.report(rows.length, rows.length, '분류 완료')
  return res
}

// Assist pass over already-classified images whose main result is still open
// and that lack the enabled assist scores (e.g. assist turned on later).
export async function assistPending(
  db: Db,
  models: Models,
  o: DecideOptions,
  ctx: JobContext,
  load: (path: string) => Promise<RgbImage> = (p) => loadRgb(p)
): Promise<number> {
  if (o.assistMode === 'none') return 0
  const rows = (
    db.prepare('SELECT id, path, tag_json FROM images WHERE tag_json IS NOT NULL').all() as {
      id: number
      path: string
      tag_json: string
    }[]
  ).filter((r) => {
    const st = JSON.parse(r.tag_json) as StoredTags
    if (!openAfterMain(st, o)) return false
    return !st.pixai || (o.assistMode === 'pixai+camie' && !st.camie)
  })
  let n = 0
  for (let i = 0; i < rows.length; i++) {
    if (ctx.signal.aborted) break
    ctx.report(i, rows.length, '보조 모델 확인')
    try {
      const st = JSON.parse(rows[i].tag_json) as StoredTags
      if (await runAssist(st, () => load(rows[i].path), models, o.assistMode)) {
        applyTagResult(db, rows[i].id, st, o)
        n++
      }
    } catch (e) {
      db.prepare('UPDATE images SET error = ? WHERE id = ?').run(`assist: ${String((e as Error)?.message ?? e)}`, rows[i].id)
    }
  }
  ctx.report(rows.length, rows.length, '보조 모델 확인 완료')
  return n
}

// Re-apply the current thresholds / ignored tags / assist mode / game table to
// every image from its stored scores (no inference). User decisions are kept.
export function redecideAll(db: Db, o: DecideOptions, ctx?: JobContext): number {
  const rows = db.prepare('SELECT id, tag_json FROM images WHERE tag_json IS NOT NULL').all() as { id: number; tag_json: string }[]
  rows.forEach((r, i) => {
    if (ctx && i % 200 === 0) ctx.report(i, rows.length, '기준 다시 적용')
    applyTagResult(db, r.id, JSON.parse(r.tag_json) as StoredTags, o)
  })
  // (Re)link outfit versions — also repairs links made by older rules.
  for (const c of db.prepare('SELECT id, danbooru_tag AS t FROM characters WHERE danbooru_tag IS NOT NULL').all() as {
    id: number
    t: string
  }[])
    linkVariant(db, c.id, c.t, o.seriesMap)
  // Characters created earlier without a game: place them now if the table knows them.
  if (o.seriesMap?.size) {
    const orphans = db
      .prepare(
        'SELECT c.danbooru_tag AS t FROM characters c JOIN series s ON s.id = c.series_id WHERE s.name = ? AND c.danbooru_tag IS NOT NULL'
      )
      .all(UNKNOWN_SERIES) as { t: string }[]
    for (const x of orphans) ensureCharacter(db, x.t, o.seriesMap)
  }
  ctx?.report(rows.length, rows.length, '기준 다시 적용')
  return rows.length
}
