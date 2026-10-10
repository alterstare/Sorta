// 소속 조직도 (CLAUDE.md §5.7): a game's affiliations as a tree (school →
// club …) the user edits — add, rename, delete, move under another, reorder —
// and characters placed in it. Each edit snapshots the game's affiliations and
// character placements, so Ctrl+Z restores them exactly.
import type { Db } from './db'
import type { ActionLog } from './actionLog'
import type { OrgChart, OrgNode } from '../shared/types'

// ---- snapshot / undo ----

interface OrgSnap {
  label: string
  seriesId: number
  wiki: string | null
  affiliations: Record<string, unknown>[]
  placements: { id: number; affiliation_id: number | null }[]
}

function snapshot(db: Db, seriesId: number, label: string): OrgSnap {
  return {
    label,
    seriesId,
    wiki: (db.prepare('SELECT wiki FROM series WHERE id = ?').get(seriesId) as { wiki: string | null }).wiki,
    affiliations: db.prepare('SELECT * FROM affiliations WHERE series_id = ?').all(seriesId) as Record<string, unknown>[],
    placements: db.prepare('SELECT id, affiliation_id FROM characters WHERE series_id = ?').all(seriesId) as OrgSnap['placements']
  }
}

function restore(db: Db, s: OrgSnap): void {
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON')
    db.prepare('UPDATE series SET wiki = ? WHERE id = ?').run(s.wiki, s.seriesId)
    const keep = new Set(s.affiliations.map((a) => a.id as number))
    for (const { id } of db.prepare('SELECT id FROM affiliations WHERE series_id = ?').all(s.seriesId) as { id: number }[]) {
      if (!keep.has(id)) db.prepare('DELETE FROM affiliations WHERE id = ?').run(id)
    }
    for (const a of s.affiliations) {
      const cols = Object.keys(a)
      db.prepare(`INSERT OR REPLACE INTO affiliations (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(a)
    }
    const up = db.prepare('UPDATE characters SET affiliation_id = ? WHERE id = ?')
    for (const p of s.placements) up.run(p.affiliation_id, p.id)
  })()
}

export const ORG_ACTION = 'org.edit'
export function registerOrgUndo(log: ActionLog, db: Db): void {
  log.register<OrgSnap>(
    ORG_ACTION,
    (s) => restore(db, s),
    (s) => snapshot(db, s.seriesId, s.label)
  )
}

function edit<T>(db: Db, log: ActionLog, seriesId: number, label: string, fn: () => T): T {
  const snap = snapshot(db, seriesId, label)
  const r = db.transaction(fn)()
  log.record<OrgSnap>(ORG_ACTION, snap)
  return r
}

// ---- read ----

export function seriesIdOf(db: Db, series: string): number {
  const r = db.prepare('SELECT id FROM series WHERE name = ?').get(series) as { id: number } | undefined
  if (!r) throw new Error(`게임 "${series}"이(가) 없습니다`)
  return r.id
}

const seriesOfAff = (db: Db, id: number): number => {
  const r = db.prepare('SELECT series_id FROM affiliations WHERE id = ?').get(id) as { series_id: number } | undefined
  if (!r) throw new Error('소속이 없습니다')
  return r.series_id
}

export function orgChart(db: Db, series: string): OrgChart {
  const sid = seriesIdOf(db, series)
  const s = db.prepare('SELECT name, wiki FROM series WHERE id = ?').get(sid) as { name: string; wiki: string | null }
  const nodes = (
    db
      .prepare('SELECT id, name, aliases, parent_id AS parentId, sort_order AS "order" FROM affiliations WHERE series_id = ? ORDER BY sort_order, id')
      .all(sid) as (Omit<OrgNode, 'aliases'> & { aliases: string })[]
  ).map((n) => ({ ...n, aliases: JSON.parse(n.aliases) as string[] }))
  const characters = db
    .prepare(
      `SELECT c.id, c.name, c.affiliation_id AS affiliationId,
         (SELECT COUNT(DISTINCT ic.image_id) FROM image_characters ic JOIN characters v ON v.id = ic.character_id
           WHERE (v.id = c.id OR v.parent_id = c.id) AND ic.status IN ('auto','confirmed')) AS images
       FROM characters c WHERE c.series_id = ? AND c.parent_id IS NULL ORDER BY c.name COLLATE NOCASE`
    )
    .all(sid) as OrgChart['characters']
  return { series: s.name, wiki: s.wiki, nodes, characters }
}

// Full path (top first) of every affiliation — folder names and wiki matching.
export function affiliationPaths(db: Db): Map<number, string[]> {
  const rows = db.prepare('SELECT id, name, parent_id AS parent FROM affiliations').all() as { id: number; name: string; parent: number | null }[]
  const byId = new Map(rows.map((r) => [r.id, r]))
  const out = new Map<number, string[]>()
  for (const r of rows) {
    const path: string[] = []
    const seen = new Set<number>()
    for (let n: typeof r | undefined = r; n && !seen.has(n.id); n = n.parent ? byId.get(n.parent) : undefined) {
      seen.add(n.id)
      path.unshift(n.name)
    }
    out.set(r.id, path)
  }
  return out
}

// ---- edits ----

function nameTaken(db: Db, sid: number, name: string, except = 0): boolean {
  return !!db.prepare('SELECT 1 FROM affiliations WHERE series_id = ? AND name = ? AND id <> ?').get(sid, name, except)
}

function nextOrder(db: Db, sid: number, parentId: number | null): number {
  const r = db
    .prepare('SELECT MAX(sort_order) AS m FROM affiliations WHERE series_id = ? AND parent_id IS ?')
    .get(sid, parentId) as { m: number | null }
  return (r.m ?? -1) + 1
}

function insertAff(db: Db, sid: number, name: string, parentId: number | null): number {
  const r = db
    .prepare("INSERT INTO affiliations (series_id, name, aliases, parent_id, sort_order) VALUES (?, ?, '[]', ?, ?)")
    .run(sid, name, parentId, nextOrder(db, sid, parentId))
  return Number(r.lastInsertRowid)
}

export function addAffiliation(db: Db, log: ActionLog, series: string, name: string, parentId: number | null): number {
  const sid = seriesIdOf(db, series)
  const n = name.trim()
  if (!n) throw new Error('이름이 비어 있습니다')
  if (nameTaken(db, sid, n)) throw new Error(`"${n}" 소속이 이미 있습니다`)
  return edit(db, log, sid, '소속 추가', () => insertAff(db, sid, n, parentId))
}

// The old name stays as an alias (later wiki answers in that spelling match).
export function renameAffiliation(db: Db, log: ActionLog, id: number, name: string): void {
  const sid = seriesOfAff(db, id)
  const n = name.trim()
  if (!n) throw new Error('이름이 비어 있습니다')
  if (nameTaken(db, sid, n, id)) throw new Error(`"${n}" 소속이 이미 있습니다`)
  const cur = db.prepare('SELECT name, aliases FROM affiliations WHERE id = ?').get(id) as { name: string; aliases: string }
  if (cur.name === n) return
  const aliases = [...new Set([...(JSON.parse(cur.aliases) as string[]), cur.name])].filter((a) => a !== n)
  edit(db, log, sid, '소속 이름 변경', () =>
    db.prepare('UPDATE affiliations SET name = ?, aliases = ? WHERE id = ?').run(n, JSON.stringify(aliases), id)
  )
}

// Delete: its sub-affiliations and characters move up one level.
export function deleteAffiliation(db: Db, log: ActionLog, id: number): void {
  const sid = seriesOfAff(db, id)
  const { parent_id } = db.prepare('SELECT parent_id FROM affiliations WHERE id = ?').get(id) as { parent_id: number | null }
  edit(db, log, sid, '소속 삭제', () => {
    for (const c of db.prepare('SELECT id FROM affiliations WHERE parent_id = ? ORDER BY sort_order, id').all(id) as { id: number }[]) {
      db.prepare('UPDATE affiliations SET parent_id = ?, sort_order = ? WHERE id = ?').run(parent_id, nextOrder(db, sid, parent_id), c.id)
    }
    db.prepare('UPDATE characters SET affiliation_id = ? WHERE affiliation_id = ?').run(parent_id, id)
    db.prepare('DELETE FROM affiliations WHERE id = ?').run(id)
  })
}

// Move under `parentId` (null = top level) at position `index` among its
// new siblings (default: last). Moving under itself / its own descendant is
// refused.
export function moveAffiliation(db: Db, log: ActionLog, id: number, parentId: number | null, index?: number): void {
  const sid = seriesOfAff(db, id)
  for (let p = parentId; p !== null; ) {
    if (p === id) throw new Error('자기 자신이나 하위 소속 아래로는 옮길 수 없습니다')
    const r = db.prepare('SELECT parent_id, series_id FROM affiliations WHERE id = ?').get(p) as { parent_id: number | null; series_id: number } | undefined
    if (!r || r.series_id !== sid) throw new Error('같은 게임의 소속 아래로만 옮길 수 있습니다')
    p = r.parent_id
  }
  edit(db, log, sid, '소속 위치 변경', () => {
    const sibs = (
      db.prepare('SELECT id FROM affiliations WHERE series_id = ? AND parent_id IS ? AND id <> ? ORDER BY sort_order, id').all(sid, parentId, id) as {
        id: number
      }[]
    ).map((r) => r.id)
    sibs.splice(Math.max(0, Math.min(index ?? sibs.length, sibs.length)), 0, id)
    const up = db.prepare('UPDATE affiliations SET parent_id = ?, sort_order = ? WHERE id = ?')
    sibs.forEach((sib, i) => up.run(parentId, i, sib))
  })
}

// Place characters (and their outfit versions) in an affiliation; null = none.
export function placeCharacters(db: Db, log: ActionLog, ids: number[], affiliationId: number | null): void {
  if (!ids.length) return
  const { series_id: sid } = db.prepare('SELECT series_id FROM characters WHERE id = ?').get(ids[0]) as { series_id: number }
  if (affiliationId !== null && seriesOfAff(db, affiliationId) !== sid) throw new Error('같은 게임의 소속만 지정할 수 있습니다')
  edit(db, log, sid, '소속 지정', () => {
    const up = db.prepare('UPDATE characters SET affiliation_id = ? WHERE (id = ? OR parent_id = ?) AND series_id = ?')
    for (const id of ids) up.run(affiliationId, id, id, sid)
  })
}

export function setWiki(db: Db, log: ActionLog, series: string, wiki: string | null): void {
  const sid = seriesIdOf(db, series)
  edit(db, log, sid, '위키 주소 변경', () => db.prepare('UPDATE series SET wiki = ? WHERE id = ?').run(wiki?.trim() || null, sid))
}

// Accept wiki suggestions: each path (top first) is found by name or alias —
// anywhere in the game, since names are unique per game — or created under
// the previous level; the character goes to the last one. One undo step.
export function applyPaths(db: Db, log: ActionLog, series: string, items: { characterId: number; path: string[] }[]): number {
  const sid = seriesIdOf(db, series)
  return edit(db, log, sid, `소속 적용 (${items.length}명)`, () => {
    const find = (name: string): number | null => {
      for (const a of db.prepare('SELECT id, name, aliases FROM affiliations WHERE series_id = ?').all(sid) as {
        id: number
        name: string
        aliases: string
      }[]) {
        const all = [a.name, ...(JSON.parse(a.aliases) as string[])].map((x) => x.toLowerCase())
        if (all.includes(name.toLowerCase())) return a.id
      }
      return null
    }
    let n = 0
    const up = db.prepare('UPDATE characters SET affiliation_id = ? WHERE (id = ? OR parent_id = ?) AND series_id = ?')
    for (const it of items) {
      let parent: number | null = null
      for (const raw of it.path) {
        const name = raw.trim()
        if (!name) continue
        parent = find(name) ?? insertAff(db, sid, name, parent)
      }
      if (parent === null) continue
      up.run(parent, it.characterId, it.characterId, sid)
      n++
    }
    return n
  })
}
