// Read-side queries for the Library screen: the series → character tree with
// counts (and the same counts under the rating filter), and the filtered,
// sorted image list.
import { promises as fs } from 'fs'
import type { Db } from './db'
import type { ImageItem, LibraryFilter, LibraryTree, MatchStatus, RatingPick, TreeAffiliation, TreeCounts } from '../shared/types'

// Images that count as "sorted" under a character: auto or user-confirmed.
const SORTED = "ic.status IN ('auto','confirmed')"
const ALL_RATINGS: RatingPick[] = ['general', 'sensitive', 'r18']

// A character's 소속 (outfit versions follow their base character).
const CHAR_AFF = 'COALESCE(c.affiliation_id, (SELECT p.affiliation_id FROM characters p WHERE p.id = c.parent_id))'

// Pictures per 소속, counting each picture once for every 소속 above its
// characters too (a group shot of two clubs counts for their school once).
function affiliationCounts(db: Db, cond: string, parentOf: Map<number, number | null>): Map<number, number> {
  const rows = db
    .prepare(
      `SELECT DISTINCT ic.image_id AS i, ${CHAR_AFF} AS a FROM image_characters ic
       JOIN characters c ON c.id = ic.character_id JOIN images i ON i.id = ic.image_id
       WHERE ${SORTED} AND ${cond} AND ${CHAR_AFF} IS NOT NULL`
    )
    .all() as { i: number; a: number }[]
  const seen = new Map<number, Set<number>>()
  for (const r of rows) {
    for (let a: number | null | undefined = r.a, guard = 0; a != null && guard < 50; a = parentOf.get(a), guard++) {
      let set = seen.get(a)
      if (!set) seen.set(a, (set = new Set()))
      set.add(r.i)
    }
  }
  return new Map([...seen].map(([a, set]) => [a, set.size]))
}

// SQL condition on images alias `i` for a rating selection ('' = no filter).
// Rating + group filter as one condition on `i` ('' = nothing filtered).
export function filterClause(ratings: RatingPick[], groups: number[] = []): string {
  const g = groups.filter((x) => Number.isInteger(x))
  const gc = g.length ? `EXISTS (SELECT 1 FROM image_groups ig WHERE ig.image_id = i.id AND ig.group_id IN (${g.join(',')}))` : ''
  return [ratingClause(ratings), gc].filter(Boolean).join(' AND ')
}

export function ratingClause(ratings: RatingPick[]): string {
  const r = ALL_RATINGS.filter((x) => ratings.includes(x))
  if (r.length === ALL_RATINGS.length) return ''
  if (!r.length) return '0'
  return `i.rating IN (${r.map((x) => `'${x}'`).join(',')})`
}

function treeCounts(db: Db, rc: string): {
  own: Map<number, number>
  root: Map<number, number>
  series: Map<number, number>
  groups: Map<number, number>
  counts: TreeCounts
} {
  // Set-aside duplicates are out of the library (except their own node).
  const cond = ['i.set_aside = 0', rc].filter(Boolean).join(' AND ')
  const and = ` AND ${cond}`
  const where = ` WHERE ${cond}`
  const map = (sql: string): Map<number, number> =>
    new Map((db.prepare(sql).all() as { k: number; n: number }[]).map((r) => [r.k, r.n]))
  const one = (sql: string): number => (db.prepare(sql).get() as { n: number }).n
  return {
    own: map(
      `SELECT ic.character_id AS k, COUNT(DISTINCT ic.image_id) AS n FROM image_characters ic JOIN images i ON i.id = ic.image_id
       WHERE ${SORTED}${and} GROUP BY ic.character_id`
    ),
    root: map(
      `SELECT COALESCE(c.parent_id, c.id) AS k, COUNT(DISTINCT ic.image_id) AS n
       FROM image_characters ic JOIN characters c ON c.id = ic.character_id JOIN images i ON i.id = ic.image_id
       WHERE ${SORTED}${and} GROUP BY k`
    ),
    series: map(
      `SELECT c.series_id AS k, COUNT(DISTINCT ic.image_id) AS n
       FROM image_characters ic JOIN characters c ON c.id = ic.character_id JOIN images i ON i.id = ic.image_id
       WHERE ${SORTED}${and} GROUP BY c.series_id`
    ),
    groups: map(`SELECT g.group_id AS k, COUNT(*) AS n FROM image_groups g JOIN images i ON i.id = g.image_id${where} GROUP BY g.group_id`),
    counts: {
      all: one(`SELECT COUNT(*) AS n FROM images i${where}`),
      favorite: one(`SELECT COUNT(*) AS n FROM images i WHERE i.favorite = 1${and}`),
      pending: one(
        `SELECT COUNT(*) AS n FROM images i
           WHERE EXISTS (SELECT 1 FROM image_characters ic WHERE ic.image_id = i.id AND ic.status = 'pending')${and}`
      ),
      ratingReview: one(`SELECT COUNT(*) AS n FROM images i WHERE i.rating_review = 1${and}`),
      unknown: one(
        `SELECT COUNT(*) AS n FROM images i WHERE i.classified_at IS NOT NULL AND i.kind <> 'other'
           AND NOT EXISTS (SELECT 1 FROM image_characters ic WHERE ic.image_id = i.id AND ic.status IN ('auto','confirmed','pending'))${and}`
      ),
      other: one(`SELECT COUNT(*) AS n FROM images i WHERE i.kind = 'other'${and}`),
      unclassified: one(`SELECT COUNT(*) AS n FROM images i WHERE i.classified_at IS NULL${and}`),
      setAside: one(`SELECT COUNT(*) AS n FROM images i WHERE i.set_aside = 1${rc ? ` AND ${rc}` : ''}`)
    }
  }
}

export function libraryTree(db: Db, ratings: RatingPick[] = ALL_RATINGS, dups: number | null = null, groupFilter: number[] = [], ignoredTags: string[] = []): LibraryTree {
  const all = treeCounts(db, '')
  const rc = filterClause(ratings, groupFilter)
  const f = rc ? treeCounts(db, rc) : null
  const chars = db
    .prepare(
      `SELECT s.id AS sid, s.name AS sname, c.id AS cid, c.name AS cname, c.parent_id AS pid, c.danbooru_tag AS tag
       FROM characters c JOIN series s ON s.id = c.series_id`
    )
    .all() as { sid: number; sname: string; cid: number; cname: string; pid: number | null; tag: string | null }[]
  const byId = new Map(chars.map((r) => [r.cid, r]))
  const affRows = db
    .prepare('SELECT id, series_id AS sid, name, parent_id AS parent FROM affiliations ORDER BY sort_order, id')
    .all() as { id: number; sid: number; name: string; parent: number | null }[]
  const parentOf = new Map(affRows.map((a) => [a.id, a.parent]))
  const affAll = affiliationCounts(db, 'i.set_aside = 0', parentOf)
  const affShown = rc ? affiliationCounts(db, `i.set_aside = 0 AND ${rc}`, parentOf) : null
  const charAff = new Map(
    (db.prepare(`SELECT c.id, ${CHAR_AFF} AS a FROM characters c`).all() as { id: number; a: number | null }[]).map((r) => [r.id, r.a])
  )
  const seriesMap = new Map<number, LibraryTree['series'][number]>()
  const nodes = new Map<number, LibraryTree['series'][number]['characters'][number]>()
  const sortByName = <T extends { name: string }>(a: T, b: T): number => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const shown = (m: keyof ReturnType<typeof treeCounts>, k: number): number | undefined =>
    f ? ((f[m] as Map<number, number>).get(k) ?? 0) : undefined
  // Roots first (characters without a parent), with at least one image in their family.
  for (const r of chars) {
    if (r.pid !== null && byId.has(r.pid)) continue
    const n = all.root.get(r.cid) ?? 0
    if (!n) continue
    let s = seriesMap.get(r.sid)
    if (!s) {
      s = { id: r.sid, name: r.sname, count: all.series.get(r.sid) ?? 0, shown: shown('series', r.sid), affiliations: [], characters: [] }
      seriesMap.set(r.sid, s)
    }
    const node = { id: r.cid, name: r.cname, tag: r.tag, count: n, shown: shown('root', r.cid), children: [] as LibraryTree['series'][number]['characters'] }
    nodes.set(r.cid, node)
    s.characters.push(node)
  }
  for (const r of chars) {
    const n = all.own.get(r.cid) ?? 0
    if (r.pid === null || !n) continue
    nodes.get(r.pid)?.children!.push({ id: r.cid, name: r.cname, tag: r.tag, count: n, shown: shown('own', r.cid) })
  }
  const series = [...seriesMap.values()].sort(sortByName)
  for (const s of series) {
    s.characters.sort(sortByName)
    for (const c of s.characters) c.children?.sort(sortByName)
  }
  // 소속 levels (조직도 order): a 소속 shows when it has pictures; its
  // characters move under it.
  const affNodes = new Map<number, TreeAffiliation>()
  for (const a of affRows) {
    const n = affAll.get(a.id) ?? 0
    if (!n) continue
    affNodes.set(a.id, { id: a.id, name: a.name, count: n, shown: affShown ? (affShown.get(a.id) ?? 0) : undefined, children: [], characters: [] })
  }
  for (const a of affRows) {
    const node = affNodes.get(a.id)
    if (!node) continue
    const up = a.parent !== null ? affNodes.get(a.parent) : undefined
    if (up) up.children.push(node)
    else seriesMap.get(a.sid)?.affiliations.push(node)
  }
  for (const s of series) {
    s.characters = s.characters.filter((c) => {
      const a = charAff.get(c.id)
      const node = a != null ? affNodes.get(a) : undefined
      if (!node) return true
      node.characters.push(c)
      return false
    })
  }
  const groups = (db.prepare('SELECT id, name FROM fav_groups ORDER BY sort_order, id').all() as { id: number; name: string }[]).map((g) => ({
    ...g,
    count: all.groups.get(g.id) ?? 0,
    shown: shown('groups', g.id)
  }))
  const byTag = new Map(chars.filter((c) => c.tag).map((c) => [c.tag!, c]))
  const ignored = ignoredTags.map((tag) => {
    const c = byTag.get(tag)
    return { tag, name: c?.cname ?? tag, series: c?.sname ?? null }
  })
  return { series, groups, counts: all.counts, shown: f?.counts, dups, ignored }
}

const baseName = (p: string): string => p.split(/[\\/]/).pop() ?? p
const extOf = (p: string): string => {
  const n = baseName(p)
  const i = n.lastIndexOf('.')
  return i > 0 ? n.slice(i + 1).toLowerCase() : ''
}
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function listImages(db: Db, f: LibraryFilter): ImageItem[] {
  const where: string[] = []
  const params: Record<string, unknown> = {}
  const n = f.node
  if (n.type === 'series') {
    where.push(`EXISTS (SELECT 1 FROM image_characters ic JOIN characters c ON c.id = ic.character_id
                WHERE ic.image_id = i.id AND ${SORTED} AND c.series_id = @nid)`)
    params.nid = n.id
  } else if (n.type === 'character') {
    // A base character includes its outfit versions.
    where.push(`EXISTS (SELECT 1 FROM image_characters ic WHERE ic.image_id = i.id AND ${SORTED}
                AND ic.character_id IN (SELECT id FROM characters WHERE id = @nid OR parent_id = @nid))`)
    params.nid = n.id
  } else if (n.type === 'affiliation') {
    // Any picture with a character of this 소속 or one below it (group shots included).
    where.push(`EXISTS (SELECT 1 FROM image_characters ic JOIN characters c ON c.id = ic.character_id
                WHERE ic.image_id = i.id AND ${SORTED} AND ${CHAR_AFF} IN (
                  WITH RECURSIVE sub(id) AS (SELECT @nid UNION SELECT a.id FROM affiliations a JOIN sub ON a.parent_id = sub.id)
                  SELECT id FROM sub))`)
    params.nid = n.id
  } else if (n.type === 'favorite') where.push('i.favorite = 1')
  else if (n.type === 'group') {
    where.push('EXISTS (SELECT 1 FROM image_groups g WHERE g.image_id = i.id AND g.group_id = @nid)')
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
  where.push(n.type === 'setAside' ? 'i.set_aside = 1' : 'i.set_aside = 0')
  const rc = filterClause(f.ratings, f.groups)
  if (rc) where.push(rc)
  const q = f.q.trim().toLowerCase()
  if (q) {
    where.push(`(LOWER(i.path) LIKE @q OR EXISTS (SELECT 1 FROM image_characters ic JOIN characters c ON c.id = ic.character_id
                JOIN series s ON s.id = c.series_id WHERE ic.image_id = i.id
                AND (LOWER(c.name) LIKE @q OR LOWER(c.aliases) LIKE @q OR LOWER(s.name) LIKE @q OR LOWER(s.aliases) LIKE @q)))`)
    params.q = `%${q}%`
  }
  const rows = db
    .prepare(
      `SELECT i.id, i.path, i.thumbnail_path, i.width, i.height, i.rating, i.rating_review, i.kind, i.dup_of, i.error,
              i.file_size, i.file_mtime, i.imported_at, i.favorite, i.stars
       FROM images i ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`
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
    file_size: number | null
    file_mtime: number | null
    imported_at: number
    favorite: number
    stars: number
  }[]
  // Character labels and groups for all listed images in one query each.
  const labels = new Map<number, ImageItem['characters']>()
  const groups = new Map<number, number[]>()
  if (rows.length) {
    const ic = db
      .prepare(
        `SELECT ic.image_id AS iid, ic.character_id AS cid, c.name AS cname, s.name AS sname, c.danbooru_tag AS tag, ic.status, ic.confidence
         FROM image_characters ic LEFT JOIN characters c ON c.id = ic.character_id
         LEFT JOIN series s ON s.id = c.series_id ORDER BY ic.id`
      )
      .all() as { iid: number; cid: number | null; cname: string | null; sname: string | null; tag: string | null; status: MatchStatus; confidence: number | null }[]
    for (const r of ic) {
      const arr = labels.get(r.iid) ?? []
      arr.push({ id: r.cid, name: r.cname, series: r.sname, tag: r.tag, status: r.status, confidence: r.confidence })
      labels.set(r.iid, arr)
    }
    for (const g of db.prepare('SELECT image_id AS i, group_id AS g FROM image_groups').all() as { i: number; g: number }[]) {
      groups.set(g.i, [...(groups.get(g.i) ?? []), g.g])
    }
  }
  const items: ImageItem[] = rows.map((r) => ({
    id: r.id,
    path: r.path,
    name: baseName(r.path),
    thumb: r.thumbnail_path,
    width: r.width,
    height: r.height,
    rating: r.rating,
    ratingReview: !!r.rating_review,
    kind: r.kind,
    dupOf: r.dup_of,
    error: r.error,
    fileSize: r.file_size,
    mtime: r.file_mtime,
    importedAt: r.imported_at,
    favorite: !!r.favorite,
    stars: r.stars,
    groups: groups.get(r.id) ?? [],
    characters: labels.get(r.id) ?? []
  }))
  return sortImages(items, f.sort, f.dir, f.seed)
}

// Explorer-like sorting; ties fall back to the name.
export function sortImages(items: ImageItem[], key: LibraryFilter['sort'], dir: LibraryFilter['dir'], seed = 0): ImageItem[] {
  const byName = (a: ImageItem, b: ImageItem): number => collator.compare(a.name, b.name)
  if (key === 'random') {
    // A stable shuffle: each picture's place comes from its id and the seed.
    const h = (id: number): number => {
      let x = (id ^ seed) >>> 0
      x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
      x = Math.imul(x ^ (x >>> 16), 0x45d9f3b)
      return (x ^ (x >>> 16)) >>> 0
    }
    return items.sort((a, b) => h(a.id) - h(b.id))
  }
  const cmp: Record<Exclude<LibraryFilter['sort'], 'random'>, (a: ImageItem, b: ImageItem) => number> = {
    name: byName,
    date: (a, b) => (a.mtime ?? a.importedAt) - (b.mtime ?? b.importedAt) || byName(a, b),
    type: (a, b) => collator.compare(extOf(a.path), extOf(b.path)) || byName(a, b),
    size: (a, b) => (a.fileSize ?? 0) - (b.fileSize ?? 0) || byName(a, b)
  }
  const s = dir === 'asc' ? 1 : -1
  return items.sort((a, b) => s * cmp[key](a, b))
}

// File size / modified time for images that don't have them yet (sorting).
// Missing files are skipped (they get found again by sha256 on import).
export async function fillFileStats(db: Db): Promise<number> {
  const rows = db.prepare('SELECT id, path FROM images WHERE file_size IS NULL').all() as { id: number; path: string }[]
  const up = db.prepare('UPDATE images SET file_size = ?, file_mtime = ? WHERE id = ?')
  let n = 0
  for (let i = 0; i < rows.length; i += 64) {
    const batch = rows.slice(i, i + 64)
    const stats = await Promise.all(batch.map((r) => fs.stat(r.path).catch(() => null)))
    db.transaction(() => {
      batch.forEach((r, k) => {
        const st = stats[k]
        if (st) (up.run(st.size, Math.round(st.mtimeMs), r.id), n++)
      })
    })()
  }
  return n
}
