// 소속 조직도 (CLAUDE.md §5.7): a game's affiliations as a tree (school →
// club …) the user edits — add, rename, delete, move under another, reorder —
// and characters placed in it. Each edit snapshots the game's affiliations and
// character placements, so Ctrl+Z restores them exactly.
import type { Db } from './db'
import type { ActionLog } from './actionLog'
import type { OrgChart, OrgImportNode, OrgImportPreview, OrgImportRow, OrgNode } from '../shared/types'
import { nameTaken as taken, renameShown, seriesIdByName, shown } from './names'

// ---- snapshot / undo ----

interface OrgSnap {
  label: string
  seriesId: number
  wiki: string | null
  affiliations: Record<string, unknown>[]
  // names / aliases too (조직도 불러오기 with 한글 번역 renames characters);
  // snapshots from before have only the placement
  placements: { id: number; affiliation_id: number | null; name?: string; aliases?: string; display_name?: string | null }[]
}

function snapshot(db: Db, seriesId: number, label: string): OrgSnap {
  return {
    label,
    seriesId,
    wiki: (db.prepare('SELECT wiki FROM series WHERE id = ?').get(seriesId) as { wiki: string | null }).wiki,
    affiliations: db.prepare('SELECT * FROM affiliations WHERE series_id = ?').all(seriesId) as Record<string, unknown>[],
    placements: db.prepare('SELECT id, affiliation_id, name, aliases, display_name FROM characters WHERE series_id = ?').all(seriesId) as OrgSnap['placements']
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
    const up = db.prepare('UPDATE characters SET affiliation_id = ?, name = COALESCE(?, name), aliases = COALESCE(?, aliases) WHERE id = ?')
    const disp = db.prepare('UPDATE characters SET display_name = ? WHERE id = ?')
    for (const p of s.placements) {
      up.run(p.affiliation_id, p.name ?? null, p.aliases ?? null, p.id)
      if (p.display_name !== undefined) disp.run(p.display_name, p.id)
    }
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
  const r = { id: seriesIdByName(db, series) }
  if (r.id === undefined) throw new Error(`게임 "${series}"이(가) 없습니다`)
  return r.id
}

const seriesOfAff = (db: Db, id: number): number => {
  const r = db.prepare('SELECT series_id FROM affiliations WHERE id = ?').get(id) as { series_id: number } | undefined
  if (!r) throw new Error('소속이 없습니다')
  return r.series_id
}

export function orgChart(db: Db, series: string): OrgChart {
  const sid = seriesIdOf(db, series)
  const s = db.prepare(`SELECT ${shown('s')} AS name, s.name AS systemName, s.wiki FROM series s WHERE s.id = ?`).get(sid) as {
    name: string
    systemName: string
    wiki: string | null
  }
  const nodes = (
    db
      .prepare(
        `SELECT a.id, ${shown('a')} AS name, a.name AS systemName, a.aliases, a.parent_id AS parentId, a.sort_order AS "order"
         FROM affiliations a WHERE a.series_id = ? ORDER BY a.sort_order, a.id`
      )
      .all(sid) as (Omit<OrgNode, 'aliases'> & { aliases: string })[]
  ).map((n) => ({ ...n, aliases: JSON.parse(n.aliases) as string[] }))
  const characters = db
    .prepare(
      `SELECT c.id, ${shown('c')} AS name, c.name AS systemName, c.affiliation_id AS affiliationId,
         (SELECT COUNT(DISTINCT ic.image_id) FROM image_characters ic JOIN characters v ON v.id = ic.character_id
           WHERE (v.id = c.id OR v.parent_id = c.id) AND ic.status IN ('auto','confirmed')) AS images
       FROM characters c WHERE c.series_id = ? AND c.parent_id IS NULL ORDER BY name COLLATE NOCASE`
    )
    .all(sid) as OrgChart['characters']
  return { series: s.name, seriesSystemName: s.systemName, wiki: s.wiki, nodes, characters }
}

// Full path (top first) of every affiliation, by shown names — folder names.
export function affiliationPaths(db: Db): Map<number, string[]> {
  const rows = db.prepare(`SELECT a.id, ${shown('a')} AS name, a.parent_id AS parent FROM affiliations a`).all() as { id: number; name: string; parent: number | null }[]
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
  return taken(db, 'affiliations', name, except, sid)
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

// The name on screen: the shown name once translated, else the system name
// (the old one stays as an alias — later wiki answers in that spelling match).
export function renameAffiliation(db: Db, log: ActionLog, id: number, name: string): void {
  const sid = seriesOfAff(db, id)
  const n = name.trim()
  if (!n) throw new Error('이름이 비어 있습니다')
  if (nameTaken(db, sid, n, id)) throw new Error(`"${n}" 소속이 이미 있습니다`)
  const cur = db.prepare(`SELECT ${shown('a')} AS name FROM affiliations a WHERE a.id = ?`).get(id) as { name: string }
  if (cur.name === n) return
  edit(db, log, sid, '소속 이름 변경', () => renameShown(db, 'affiliations', id, n))
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
      for (const a of db.prepare('SELECT id, name, display_name, aliases FROM affiliations WHERE series_id = ?').all(sid) as {
        id: number
        name: string
        display_name: string | null
        aliases: string
      }[]) {
        const all = [a.name, a.display_name ?? '', ...(JSON.parse(a.aliases) as string[])].filter(Boolean).map((x) => x.toLowerCase())
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

// 조직도 불러오기: put the game's affiliations in the shape of `tree` (from a
// wiki page or a picture). Each node is found by its name, any alias or its
// `match` — anywhere in the game — or created; found ones move under the
// node's parent (top-level nodes to the top), new names join the aliases,
// siblings take the tree's order (others after them). Characters named in a
// node are placed in it. Affiliations the tree doesn't name stay as they are.
// `translate` (picture read with 한글 번역): found affiliations and characters
// take the tree's name, the old one kept as an alias. `write` false = only
// the preview; true = applied as one undo step.
export function importTree(
  db: Db,
  log: ActionLog,
  series: string,
  source: string,
  tree: OrgImportNode[],
  write: boolean,
  translate = false
): OrgImportPreview {
  const sid = seriesIdOf(db, series)
  // name = shown, sys = system name
  type Aff = { id: number; name: string; sys: string; aliases: string[]; parent: number | null }
  const affs: Aff[] = (
    db.prepare(`SELECT a.id, ${shown('a')} AS name, a.name AS sys, a.aliases, a.parent_id AS parent FROM affiliations a WHERE a.series_id = ?`).all(sid) as {
      id: number
      name: string
      sys: string
      aliases: string
      parent: number | null
    }[]
  ).map((a) => ({ ...a, aliases: JSON.parse(a.aliases) as string[] }))
  type Char = { id: number; name: string; sys: string; aliases: string[]; tag: string | null }
  const chars: Char[] = (
    db
      .prepare(`SELECT c.id, ${shown('c')} AS name, c.name AS sys, c.aliases, c.danbooru_tag AS tag FROM characters c WHERE c.series_id = ? AND c.parent_id IS NULL`)
      .all(sid) as {
      id: number
      name: string
      sys: string
      aliases: string
      tag: string | null
    }[]
  ).map((c) => ({ ...c, aliases: JSON.parse(c.aliases) as string[] }))
  const charKeys = (c: Char): string[] => [c.name, c.sys, ...c.aliases, c.tag ?? ''].filter(Boolean).map(key)
  const preview: OrgImportPreview = { source, tree, rows: [], created: 0, moved: 0, placed: 0, renamed: 0, unknown: [], translate }
  const nameOf = (id: number | null): string => (id === null ? '최상위' : (affs.find((a) => a.id === id)?.name ?? ''))
  let fresh = -1 // ids of affiliations the preview would create
  const run = (): void => {
    const walk = (list: OrgImportNode[], parent: number | null, depth: number): void => {
      const order: number[] = []
      for (const n of list) {
        const names = [n.match ?? '', n.name, ...n.aliases].filter(Boolean).map(key)
        let a = affs.find((x) => [x.name, x.sys, ...x.aliases].some((y) => names.includes(key(y))))
        const row: OrgImportRow = { depth, name: n.name, status: 'same', aliases: [], characters: [] }
        if (!a) {
          const id = write ? insertAff(db, sid, n.name, parent) : fresh--
          a = { id, name: n.name, sys: n.name, aliases: [], parent }
          affs.push(a)
          row.status = 'new'
          preview.created++
        } else if (a.parent !== parent) {
          row.status = 'moved'
          row.from = nameOf(a.parent)
          a.parent = parent
          preview.moved++
          if (write) db.prepare('UPDATE affiliations SET parent_id = ? WHERE id = ?').run(parent, a.id)
        }
        const found = a
        // 한글 번역: the tree's name becomes the shown name (the system name stays)
        if (
          translate &&
          row.status !== 'new' &&
          key(n.name) !== key(found.name) &&
          !affs.some((x) => x !== found && (key(x.name) === key(n.name) || key(x.sys) === key(n.name)))
        ) {
          row.renamed = found.name
          found.name = n.name
          preview.renamed++
          if (write) db.prepare('UPDATE affiliations SET display_name = ? WHERE id = ?').run(found.name === found.sys ? null : found.name, found.id)
        }
        const known = new Set([found.name, found.sys, ...found.aliases].map(key))
        const added = [n.name, ...n.aliases].filter((x) => !known.has(key(x)))
        if (added.length) found.aliases.push(...added)
        if (added.length) {
          if (row.status !== 'new') row.aliases = added
          if (write) db.prepare('UPDATE affiliations SET aliases = ? WHERE id = ?').run(JSON.stringify(found.aliases), found.id)
        }
        for (const cn of n.characters) {
          const want = [cn.match ?? '', cn.name].filter(Boolean).map(key)
          const c = chars.find((x) => charKeys(x).some((k) => want.includes(k)))
          const entry: OrgImportRow['characters'][number] = { name: cn.name, found: !!c }
          row.characters.push(entry)
          if (!c) {
            preview.unknown.push(cn.name)
            continue
          }
          preview.placed++
          if (write) db.prepare('UPDATE characters SET affiliation_id = ? WHERE (id = ? OR parent_id = ?) AND series_id = ?').run(found.id, c.id, c.id, sid)
          if (translate && key(cn.name) !== key(c.name) && !chars.some((x) => x !== c && (key(x.name) === key(cn.name) || key(x.sys) === key(cn.name)))) {
            entry.renamed = c.name
            c.name = cn.name
            preview.renamed++
            if (write) db.prepare('UPDATE characters SET display_name = ? WHERE id = ?').run(c.name === c.sys ? null : c.name, c.id)
          }
        }
        preview.rows.push(row)
        order.push(found.id)
        walk(n.children, found.id, depth + 1)
      }
      if (!write) return
      // the tree's order first, the siblings it doesn't name after them
      const others = (
        db.prepare('SELECT id FROM affiliations WHERE series_id = ? AND parent_id IS ? ORDER BY sort_order, id').all(sid, parent) as { id: number }[]
      )
        .map((r) => r.id)
        .filter((id) => !order.includes(id))
      const up = db.prepare('UPDATE affiliations SET sort_order = ? WHERE id = ?')
      ;[...order, ...others].forEach((id, i) => up.run(i, id))
    }
    walk(tree, null, 0)
  }
  if (write) edit(db, log, sid, `조직도 불러오기 (${source})`, run)
  else run()
  return preview
}

// Name matching: case and spaces / underscores ignored.
const key = (s: string): string => s.toLowerCase().replace(/[_\s]+/g, ' ').trim()
