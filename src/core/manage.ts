// 캐릭터 관리 (CLAUDE.md §7 Characters, Phase 4): rename, aliases, move to
// another game, affiliation, merge. Every change snapshots the rows it touches
// so Ctrl+Z restores them exactly.
import type { Db } from './db'
import type { ActionLog } from './actionLog'
import type { ManagedCharacter } from '../shared/types'

// ---- snapshot / undo ----

interface Snap {
  label: string
  characters: Record<string, unknown>[]
  imageRows: { imageIds: number[]; rows: Record<string, unknown>[] }
  refs: { id: number; character_id: number }[]
  learned: Record<string, unknown>[]
  learnedIds: number[]
  affiliations: Record<string, unknown>[]
}

function snapshot(db: Db, charIds: number[], label: string): Snap {
  const ids = [...new Set(charIds)]
  const ph = ids.map(() => '?').join(',') || 'NULL'
  const family = db.prepare(`SELECT * FROM characters WHERE id IN (${ph}) OR parent_id IN (${ph})`).all(...ids, ...ids) as Record<string, unknown>[]
  const imageIds = (
    db.prepare(`SELECT DISTINCT image_id FROM image_characters WHERE character_id IN (${ph})`).all(...ids) as { image_id: number }[]
  ).map((r) => r.image_id)
  const iph = imageIds.map(() => '?').join(',') || 'NULL'
  return {
    label,
    characters: family,
    imageRows: { imageIds, rows: db.prepare(`SELECT * FROM image_characters WHERE image_id IN (${iph})`).all(...imageIds) as Record<string, unknown>[] },
    refs: db.prepare(`SELECT id, character_id FROM refs WHERE character_id IN (${ph})`).all(...ids) as { id: number; character_id: number }[],
    learned: db.prepare(`SELECT * FROM learned WHERE character_id IN (${ph})`).all(...ids) as Record<string, unknown>[],
    learnedIds: ids,
    affiliations: db.prepare('SELECT * FROM affiliations').all() as Record<string, unknown>[]
  }
}

function insertRow(db: Db, table: string, row: Record<string, unknown>): void {
  const cols = Object.keys(row)
  db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(row)
}

function restore(db: Db, s: Snap): void {
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON')
    for (const a of s.affiliations) insertRow(db, 'affiliations', a)
    for (const c of s.characters) insertRow(db, 'characters', c)
    const iph = s.imageRows.imageIds.map(() => '?').join(',')
    if (iph) db.prepare(`DELETE FROM image_characters WHERE image_id IN (${iph})`).run(...s.imageRows.imageIds)
    for (const r of s.imageRows.rows) insertRow(db, 'image_characters', r)
    const up = db.prepare('UPDATE refs SET character_id = ? WHERE id = ?')
    for (const r of s.refs) up.run(r.character_id, r.id)
    const lph = s.learnedIds.map(() => '?').join(',')
    if (lph) db.prepare(`DELETE FROM learned WHERE character_id IN (${lph})`).run(...s.learnedIds)
    for (const l of s.learned) insertRow(db, 'learned', l)
  })()
}

export const MANAGE_ACTION = 'manage.edit'
export function registerManageUndo(log: ActionLog, db: Db): void {
  log.register<Snap>(MANAGE_ACTION, (s) => restore(db, s))
}

function edit(db: Db, log: ActionLog, charIds: number[], label: string, fn: () => void): void {
  const snap = snapshot(db, charIds, label)
  db.transaction(fn)()
  log.record<Snap>(MANAGE_ACTION, snap)
}

function seriesId(db: Db, name: string): number {
  const n = name.trim() || '작품 미상'
  db.prepare("INSERT OR IGNORE INTO series (name, aliases, created_at) VALUES (?, '[]', ?)").run(n, Date.now())
  return (db.prepare('SELECT id FROM series WHERE name = ?').get(n) as { id: number }).id
}

// ---- read ----

export function listCharacters(db: Db): ManagedCharacter[] {
  const rows = db
    .prepare(
      `SELECT c.id, c.name, c.aliases, c.danbooru_tag AS tag, c.parent_id AS parentId, s.id AS seriesId, s.name AS series,
         a.name AS affiliation,
         (SELECT COUNT(DISTINCT ic.image_id) FROM image_characters ic WHERE ic.character_id = c.id AND ic.status IN ('auto','confirmed')) AS images,
         (SELECT COUNT(*) FROM refs r WHERE r.character_id = c.id) AS refs
       FROM characters c JOIN series s ON s.id = c.series_id LEFT JOIN affiliations a ON a.id = c.affiliation_id
       ORDER BY s.name COLLATE NOCASE, c.name COLLATE NOCASE`
    )
    .all() as (Omit<ManagedCharacter, 'aliases'> & { aliases: string })[]
  return rows.map((r) => ({ ...r, aliases: JSON.parse(r.aliases) as string[] }))
}

export function affiliationNames(db: Db, series: string): string[] {
  return (
    db
      .prepare('SELECT a.name FROM affiliations a JOIN series s ON s.id = a.series_id WHERE s.name = ? ORDER BY a.name COLLATE NOCASE')
      .all(series) as { name: string }[]
  ).map((r) => r.name)
}

// ---- edits ----

export function renameCharacter(db: Db, log: ActionLog, id: number, name: string): void {
  const n = name.trim()
  if (!n) throw new Error('이름이 비어 있습니다')
  const cur = db.prepare('SELECT series_id, name FROM characters WHERE id = ?').get(id) as { series_id: number; name: string }
  if (db.prepare('SELECT 1 FROM characters WHERE series_id = ? AND name = ? AND id <> ?').get(cur.series_id, n, id)) {
    throw new Error(`같은 게임에 "${n}"이(가) 이미 있습니다 — 합치기를 쓰세요`)
  }
  edit(db, log, [id], '이름 변경', () => db.prepare('UPDATE characters SET name = ? WHERE id = ?').run(n, id))
}

export function setAliases(db: Db, log: ActionLog, id: number, aliases: string[]): void {
  const clean = [...new Set(aliases.map((a) => a.trim()).filter(Boolean))]
  edit(db, log, [id], '별칭 변경', () => db.prepare('UPDATE characters SET aliases = ? WHERE id = ?').run(JSON.stringify(clean), id))
}

// Move characters (and their outfit versions) to another game.
export function setSeries(db: Db, log: ActionLog, ids: number[], series: string): void {
  const sid = seriesId(db, series)
  edit(db, log, ids, '게임 변경', () => {
    for (const id of ids) {
      const c = db.prepare('SELECT name FROM characters WHERE id = ?').get(id) as { name: string }
      if (db.prepare('SELECT 1 FROM characters WHERE series_id = ? AND name = ? AND id <> ?').get(sid, c.name, id)) {
        throw new Error(`"${series}"에 "${c.name}"이(가) 이미 있습니다 — 합치기를 쓰세요`)
      }
      db.prepare('UPDATE characters SET series_id = ?, affiliation_id = NULL WHERE id = ? OR parent_id = ?').run(sid, id, id)
    }
  })
}

// 세부 소속 (null = none). Created in each character's game if missing.
export function setAffiliation(db: Db, log: ActionLog, ids: number[], name: string | null): void {
  edit(db, log, ids, '소속 지정', () => {
    for (const id of ids) {
      const { series_id } = db.prepare('SELECT series_id FROM characters WHERE id = ?').get(id) as { series_id: number }
      let aid: number | null = null
      if (name && name.trim()) {
        db.prepare("INSERT OR IGNORE INTO affiliations (series_id, name, aliases) VALUES (?, ?, '[]')").run(series_id, name.trim())
        aid = (db.prepare('SELECT id FROM affiliations WHERE series_id = ? AND name = ?').get(series_id, name.trim()) as { id: number }).id
      }
      db.prepare('UPDATE characters SET affiliation_id = ? WHERE id = ? OR parent_id = ?').run(aid, id, id)
    }
  })
}

// Merge `from` characters into `into`: images, references, learned log,
// outfit versions move over; names/tags become aliases.
export function mergeCharacters(db: Db, log: ActionLog, from: number[], into: number): void {
  const src = from.filter((f) => f !== into)
  if (!src.length) return
  edit(db, log, [...src, into], '캐릭터 합치기', () => {
    const target = db.prepare('SELECT aliases FROM characters WHERE id = ?').get(into) as { aliases: string }
    const aliases = new Set<string>(JSON.parse(target.aliases))
    for (const f of src) {
      const c = db.prepare('SELECT name, aliases, danbooru_tag FROM characters WHERE id = ?').get(f) as {
        name: string
        aliases: string
        danbooru_tag: string | null
      }
      for (const a of [c.name, ...(JSON.parse(c.aliases) as string[]), ...(c.danbooru_tag ? [c.danbooru_tag] : [])]) aliases.add(a)
      // Images: point at the target; one row per image and character.
      for (const r of db.prepare('SELECT id, image_id FROM image_characters WHERE character_id = ?').all(f) as { id: number; image_id: number }[]) {
        if (db.prepare('SELECT 1 FROM image_characters WHERE image_id = ? AND character_id = ?').get(r.image_id, into)) {
          db.prepare('DELETE FROM image_characters WHERE id = ?').run(r.id)
        } else db.prepare('UPDATE image_characters SET character_id = ? WHERE id = ?').run(into, r.id)
      }
      db.prepare('UPDATE refs SET character_id = ? WHERE character_id = ?').run(into, f)
      db.prepare('UPDATE characters SET parent_id = ? WHERE parent_id = ?').run(into, f)
      db.prepare('DELETE FROM learned WHERE character_id = ?').run(f)
      db.prepare('DELETE FROM characters WHERE id = ?').run(f)
    }
    db.prepare('UPDATE characters SET aliases = ? WHERE id = ?').run(JSON.stringify([...aliases]), into)
  })
}
