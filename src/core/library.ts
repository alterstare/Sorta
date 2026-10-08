// Read-side queries for the Library screen: the series → character tree with
// counts, and the filtered image list.
import type { Db } from './db'
import type { ImageItem, LibraryFilter, LibraryTree, MatchStatus } from '../shared/types'

// Images that count as "sorted" under a character: auto or user-confirmed.
const SORTED = "ic.status IN ('auto','confirmed')"

export function libraryTree(db: Db): LibraryTree {
  const chars = db
    .prepare(
      `SELECT s.id AS sid, s.name AS sname, c.id AS cid, c.name AS cname, COUNT(DISTINCT ic.image_id) AS n
       FROM characters c
       JOIN series s ON s.id = c.series_id
       JOIN image_characters ic ON ic.character_id = c.id AND ${SORTED}
       GROUP BY c.id
       ORDER BY s.name COLLATE NOCASE, c.name COLLATE NOCASE`
    )
    .all() as { sid: number; sname: string; cid: number; cname: string; n: number }[]
  const seriesCounts = new Map(
    (
      db
        .prepare(
          `SELECT c.series_id AS sid, COUNT(DISTINCT ic.image_id) AS n
           FROM image_characters ic JOIN characters c ON c.id = ic.character_id
           WHERE ${SORTED} GROUP BY c.series_id`
        )
        .all() as { sid: number; n: number }[]
    ).map((r) => [r.sid, r.n])
  )
  const series: LibraryTree['series'] = []
  for (const r of chars) {
    let s = series[series.length - 1]
    if (!s || s.id !== r.sid) {
      s = { id: r.sid, name: r.sname, count: seriesCounts.get(r.sid) ?? 0, characters: [] }
      series.push(s)
    }
    s.characters.push({ id: r.cid, name: r.cname, count: r.n })
  }
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
  return {
    series,
    counts: {
      all: one('SELECT COUNT(*) AS n FROM images'),
      pending: one(
        `SELECT COUNT(*) AS n FROM images i
           WHERE EXISTS (SELECT 1 FROM image_characters ic WHERE ic.image_id = i.id AND ic.status = 'pending')`
      ),
      ratingReview: one('SELECT COUNT(*) AS n FROM images WHERE rating_review = 1'),
      unknown: one(
        `SELECT COUNT(*) AS n FROM images i WHERE i.classified_at IS NOT NULL AND i.kind <> 'other'
           AND NOT EXISTS (SELECT 1 FROM image_characters ic WHERE ic.image_id = i.id AND ic.status IN ('auto','confirmed','pending'))`
      ),
      other: one("SELECT COUNT(*) AS n FROM images WHERE kind = 'other'"),
      unclassified: one('SELECT COUNT(*) AS n FROM images WHERE classified_at IS NULL')
    }
  }
}

export function listImages(db: Db, f: LibraryFilter): ImageItem[] {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  const n = f.node
  if (n.type === 'series') {
    where.push(`EXISTS (SELECT 1 FROM image_characters ic JOIN characters c ON c.id = ic.character_id
                WHERE ic.image_id = i.id AND ${SORTED} AND c.series_id = @nid)`)
    params.nid = n.id
  } else if (n.type === 'character') {
    where.push(`EXISTS (SELECT 1 FROM image_characters ic WHERE ic.image_id = i.id AND ${SORTED} AND ic.character_id = @nid)`)
    params.nid = n.id
  } else if (n.type === 'pending') {
    where.push(`EXISTS (SELECT 1 FROM image_characters ic WHERE ic.image_id = i.id AND ic.status = 'pending')`)
  } else if (n.type === 'ratingReview') {
    where.push('i.rating_review = 1')
  } else if (n.type === 'unknown') {
    where.push(`i.classified_at IS NOT NULL AND i.kind <> 'other' AND NOT EXISTS (SELECT 1 FROM image_characters ic
                WHERE ic.image_id = i.id AND ic.status IN ('auto','confirmed','pending'))`)
  } else if (n.type === 'other') where.push("i.kind = 'other'")
  else if (n.type === 'unclassified') where.push('i.classified_at IS NULL')
  if (f.rating !== 'all') {
    where.push('i.rating = @rating')
    params.rating = f.rating
  }
  const q = f.q.trim().toLowerCase()
  if (q) {
    where.push(`(LOWER(i.path) LIKE @q OR EXISTS (SELECT 1 FROM image_characters ic JOIN characters c ON c.id = ic.character_id
                JOIN series s ON s.id = c.series_id WHERE ic.image_id = i.id
                AND (LOWER(c.name) LIKE @q OR LOWER(c.aliases) LIKE @q OR LOWER(s.name) LIKE @q OR LOWER(s.aliases) LIKE @q)))`)
    params.q = `%${q}%`
  }
  const rows = db
    .prepare(
      `SELECT i.id, i.path, i.thumbnail_path, i.width, i.height, i.rating, i.rating_review, i.kind, i.dup_of, i.error
       FROM images i ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY i.imported_at DESC, i.id DESC`
    )
    .all(params) as {
    id: number
    path: string
    thumbnail_path: string | null
    width: number | null
    height: number | null
    rating: ImageItem['rating']
    rating_review: number
    kind: ImageItem['kind']
    dup_of: number | null
    error: string | null
  }[]
  // Character labels for all listed images in one query.
  const labels = new Map<number, ImageItem['characters']>()
  if (rows.length) {
    const ic = db
      .prepare(
        `SELECT ic.image_id AS iid, c.name AS cname, s.name AS sname, ic.status, ic.confidence
         FROM image_characters ic LEFT JOIN characters c ON c.id = ic.character_id
         LEFT JOIN series s ON s.id = c.series_id ORDER BY ic.id`
      )
      .all() as { iid: number; cname: string | null; sname: string | null; status: MatchStatus; confidence: number | null }[]
    for (const r of ic) {
      const arr = labels.get(r.iid) ?? []
      arr.push({ name: r.cname, series: r.sname, status: r.status, confidence: r.confidence })
      labels.set(r.iid, arr)
    }
  }
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    thumb: r.thumbnail_path,
    width: r.width,
    height: r.height,
    rating: r.rating,
    ratingReview: !!r.rating_review,
    kind: r.kind,
    dupOf: r.dup_of,
    error: r.error,
    characters: labels.get(r.id) ?? []
  }))
}
