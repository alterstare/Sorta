// 검토 (CLAUDE.md §7 Review, Phase 2): the user's decisions — confirm
// characters, mark "캐릭터 아님", set the rating, create a character — and the
// read side the review screen needs. Every change snapshots the touched
// images first and logs it, so Ctrl+Z restores them exactly.
import type { Db } from './db'
import type { ActionLog } from './actionLog'
import type { CharacterHit, Rating, ReviewCandidate, ReviewItem, ReviewKind } from '../shared/types'

// ---- snapshot / undo ----

interface ImageSnap {
  id: number
  kind: string
  rating: string
  rating_source: string
  rating_review: number
  rows: {
    character_id: number | null
    status: string
    source: string
    confidence: number | null
    bbox: string | null
    candidates: string | null
  }[]
}

interface EditPayload {
  label: string
  before: ImageSnap[]
}

function snapshot(db: Db, ids: number[]): ImageSnap[] {
  const img = db.prepare('SELECT id, kind, rating, rating_source, rating_review FROM images WHERE id = ?')
  const rows = db.prepare(
    'SELECT character_id, status, source, confidence, bbox, candidates FROM image_characters WHERE image_id = ? ORDER BY id'
  )
  return ids.map((id) => ({ ...(img.get(id) as Omit<ImageSnap, 'rows'>), rows: rows.all(id) as ImageSnap['rows'] }))
}

function restore(db: Db, snaps: ImageSnap[]): void {
  db.transaction(() => {
    const upd = db.prepare('UPDATE images SET kind = ?, rating = ?, rating_source = ?, rating_review = ? WHERE id = ?')
    const del = db.prepare('DELETE FROM image_characters WHERE image_id = ?')
    const ins = db.prepare(
      'INSERT INTO image_characters (image_id, character_id, status, source, confidence, bbox, candidates) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    for (const s of snaps) {
      upd.run(s.kind, s.rating, s.rating_source, s.rating_review, s.id)
      del.run(s.id)
      for (const r of s.rows) ins.run(s.id, r.character_id, r.status, r.source, r.confidence, r.bbox, r.candidates)
    }
  })()
}

export const EDIT_ACTION = 'review.edit'

export function registerReviewUndo(log: ActionLog, db: Db): void {
  log.register<EditPayload>(EDIT_ACTION, (p) => restore(db, p.before))
}

// Run `fn` over the images as one undoable step.
function edit(db: Db, log: ActionLog, ids: number[], label: string, fn: () => void): void {
  const uniq = [...new Set(ids)]
  if (!uniq.length) return
  const before = snapshot(db, uniq)
  db.transaction(fn)()
  log.record<EditPayload>(EDIT_ACTION, { label, before })
}

// ---- actions ----

// The image shows exactly these characters (user decision; replaces any
// automatic result for it).
export function confirmCharacters(db: Db, log: ActionLog, imageIds: number[], characterIds: number[]): void {
  const chars = [...new Set(characterIds)]
  edit(db, log, imageIds, '캐릭터 확정', () => {
    const del = db.prepare('DELETE FROM image_characters WHERE image_id = ?')
    const ins = db.prepare(
      "INSERT INTO image_characters (image_id, character_id, status, source, confidence) VALUES (?, ?, 'confirmed', 'user', 1)"
    )
    for (const id of imageIds) {
      del.run(id)
      for (const c of chars) ins.run(id, c)
      db.prepare("UPDATE images SET kind = 'character' WHERE id = ?").run(id)
    }
  })
}

// Keep the confirmed characters, add one more (e.g. a second person the tagger missed).
export function addCharacter(db: Db, log: ActionLog, imageId: number, characterId: number): void {
  edit(db, log, [imageId], '캐릭터 추가', () => {
    db.prepare("DELETE FROM image_characters WHERE image_id = ? AND status IN ('pending','unknown')").run(imageId)
    db.prepare(
      "INSERT INTO image_characters (image_id, character_id, status, source, confidence) VALUES (?, ?, 'confirmed', 'user', 1)"
    ).run(imageId, characterId)
    db.prepare("UPDATE images SET kind = 'character' WHERE id = ?").run(imageId)
  })
}

// 캐릭터 아님 (→ 기타 when organizing).
export function markOther(db: Db, log: ActionLog, imageIds: number[]): void {
  edit(db, log, imageIds, '캐릭터 아닌 그림으로 지정', () => {
    const del = db.prepare('DELETE FROM image_characters WHERE image_id = ?')
    for (const id of imageIds) {
      del.run(id)
      db.prepare("UPDATE images SET kind = 'other' WHERE id = ?").run(id)
    }
  })
}

export function setRating(db: Db, log: ActionLog, imageIds: number[], rating: Exclude<Rating, 'unknown'>): void {
  edit(db, log, imageIds, '등급 변경', () => {
    const up = db.prepare("UPDATE images SET rating = ?, rating_source = 'user', rating_review = 0 WHERE id = ?")
    for (const id of imageIds) up.run(rating, id)
  })
}

// New (or existing) character by display name in a game (created if missing).
export function createCharacter(db: Db, name: string, series: string): number {
  const n = name.trim()
  const s = series.trim() || '작품 미상'
  if (!n) throw new Error('캐릭터 이름이 비어 있습니다')
  db.prepare("INSERT OR IGNORE INTO series (name, aliases, created_at) VALUES (?, '[]', ?)").run(s, Date.now())
  const sid = (db.prepare('SELECT id FROM series WHERE name = ?').get(s) as { id: number }).id
  db.prepare("INSERT OR IGNORE INTO characters (series_id, name, aliases, created_at) VALUES (?, ?, '[]', ?)").run(sid, n, Date.now())
  return (db.prepare('SELECT id FROM characters WHERE series_id = ? AND name = ?').get(sid, n) as { id: number }).id
}

// ---- read side ----

export function searchCharacters(db: Db, q: string, limit = 12): CharacterHit[] {
  const t = q.trim().toLowerCase()
  if (!t) return []
  const like = `%${t.replace(/\s+/g, '%')}%`
  const tagLike = `%${t.replace(/\s+/g, '_')}%`
  return db
    .prepare(
      `SELECT c.id, c.name, s.name AS series,
         (SELECT COUNT(*) FROM image_characters ic WHERE ic.character_id = c.id AND ic.status IN ('auto','confirmed')) AS n
       FROM characters c JOIN series s ON s.id = c.series_id
       WHERE LOWER(c.name) LIKE @like OR LOWER(c.aliases) LIKE @tag OR LOWER(c.aliases) LIKE @like OR LOWER(s.name) LIKE @like
       ORDER BY (LOWER(c.name) LIKE @prefix) DESC, n DESC, c.name COLLATE NOCASE
       LIMIT @limit`
    )
    .all({ like, tag: tagLike, prefix: `${t}%`, limit }) as CharacterHit[]
}

export function seriesNames(db: Db): string[] {
  return (db.prepare('SELECT name FROM series ORDER BY name COLLATE NOCASE').all() as { name: string }[]).map((r) => r.name)
}

// Up to `n` thumbnails of images already sorted under the character (confirmed first).
function references(db: Db, characterId: number, excludeImage: number, n = 4): string[] {
  return (
    db
      .prepare(
        `SELECT i.thumbnail_path AS t FROM image_characters ic JOIN images i ON i.id = ic.image_id
         WHERE ic.character_id = ? AND ic.status IN ('confirmed','auto') AND i.id <> ? AND i.thumbnail_path IS NOT NULL
         ORDER BY ic.status = 'confirmed' DESC, i.id DESC LIMIT ?`
      )
      .all(characterId, excludeImage, n) as { t: string }[]
  ).map((r) => r.t)
}

export function reviewQueue(db: Db, kind: ReviewKind, lowConfidence: number): ReviewItem[] {
  const where =
    kind === 'character'
      ? "EXISTS (SELECT 1 FROM image_characters ic WHERE ic.image_id = i.id AND ic.status = 'pending')"
      : 'i.rating_review = 1'
  // set-aside duplicates are out of the queue
  const rows = db
    .prepare(
      `SELECT i.id, i.path, i.thumbnail_path, i.width, i.height, i.rating, i.rating_score FROM images i
       WHERE i.set_aside = 0 AND ${where} ORDER BY i.id`
    )
    .all() as {
    id: number
    path: string
    thumbnail_path: string | null
    width: number | null
    height: number | null
    rating: Rating
    rating_score: number | null
  }[]
  const icq = db.prepare(
    `SELECT ic.character_id, ic.status, ic.confidence, ic.candidates, c.name, s.name AS series
     FROM image_characters ic LEFT JOIN characters c ON c.id = ic.character_id LEFT JOIN series s ON s.id = c.series_id
     WHERE ic.image_id = ? ORDER BY ic.id`
  )
  const charQ = db.prepare('SELECT c.name, s.name AS series FROM characters c JOIN series s ON s.id = c.series_id WHERE c.id = ?')
  // Base character + outfit versions share one family (root id).
  const rootQ = db.prepare('SELECT COALESCE(parent_id, id) AS r FROM characters WHERE id = ?')
  const root = (id: number): number => (rootQ.get(id) as { r: number } | undefined)?.r ?? id
  return rows.map((r) => {
    const ics = icq.all(r.id) as {
      character_id: number | null
      status: string
      confidence: number | null
      candidates: string | null
      name: string | null
      series: string | null
    }[]
    const confirmed = ics
      .filter((x) => (x.status === 'auto' || x.status === 'confirmed') && x.character_id !== null)
      .map((x) => ({ id: x.character_id!, name: x.name ?? '', series: x.series ?? '' }))
    const cands: ReviewCandidate[] = []
    for (const x of ics.filter((y) => y.status === 'pending')) {
      const list = x.candidates ? (JSON.parse(x.candidates) as { characterId: number; score: number }[]) : []
      for (const c of list) {
        if (cands.some((k) => k.id === c.characterId)) continue
        const info = charQ.get(c.characterId) as { name: string; series: string } | undefined
        if (!info) continue
        const rel = confirmed.find((k) => k.id !== c.characterId && root(k.id) === root(c.characterId))
        cands.push({
          relatedTo: rel ? { id: rel.id, name: rel.name } : undefined,
          id: c.characterId,
          name: info.name,
          series: info.series,
          score: c.score,
          low: c.score < lowConfidence,
          refs: references(db, c.characterId, r.id)
        })
      }
    }
    return {
      id: r.id,
      path: r.path,
      thumb: r.thumbnail_path,
      width: r.width,
      height: r.height,
      rating: r.rating,
      ratingScore: r.rating_score,
      confirmed,
      candidates: cands.slice(0, 3)
    }
  })
}
