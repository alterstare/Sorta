// 표시 이름 (display_name): games, 소속 and characters keep their system name
// (`name`, usually English from the tags — tag matching, wiki / LLM lookups,
// other PCs) and may have a name shown instead (Korean, from 한글 이름).
// Everything on screen and the 정리 폴더 names use the shown one; anything
// that takes a name from the screen accepts either.
import type { Db } from './db'

// SQL: the name shown for table alias `a` (series s / characters c / affiliations a).
export const shown = (a: string): string => `COALESCE(${a}.display_name, ${a}.name)`

export const hangul = (s: string): boolean => /[가-힣]/.test(s)

// A game by the name on screen (shown or system name).
export function seriesIdByName(db: Db, name: string): number | undefined {
  const n = name.trim()
  return (db.prepare('SELECT id FROM series WHERE name = ? OR display_name = ? ORDER BY name = ? DESC LIMIT 1').get(n, n, n) as { id: number } | undefined)?.id
}

// The game's name on screen → its id, made (with that as the system name) when missing.
export function ensureSeriesByName(db: Db, name: string): number {
  const n = name.trim() || '작품 미상'
  const id = seriesIdByName(db, n)
  if (id !== undefined) return id
  return Number(db.prepare("INSERT INTO series (name, aliases, created_at) VALUES (?, '[]', ?)").run(n, Date.now()).lastInsertRowid)
}

type Table = 'series' | 'characters' | 'affiliations'

// Is `name` already some other row's system or shown name (in the same game)?
export function nameTaken(db: Db, table: Table, name: string, except: number, seriesId?: number): boolean {
  const scope = table === 'series' ? '' : ' AND series_id = @sid'
  return !!db
    .prepare(`SELECT 1 FROM ${table} WHERE (name = @n OR display_name = @n) AND id <> @id${scope}`)
    .get({ n: name, id: except, sid: seriesId ?? null })
}

// Rename from the screen: a translated row changes its shown name, an
// untranslated one its system name (the old one kept as an alias).
export function renameShown(db: Db, table: Table, id: number, to: string): void {
  const r = db.prepare(`SELECT name, display_name, aliases FROM ${table} WHERE id = ?`).get(id) as { name: string; display_name: string | null; aliases: string }
  if (r.display_name !== null) {
    db.prepare(`UPDATE ${table} SET display_name = ? WHERE id = ?`).run(to === r.name ? null : to, id)
    return
  }
  const aliases = [...new Set([...(JSON.parse(r.aliases) as string[]), r.name])].filter((a) => a !== to)
  db.prepare(`UPDATE ${table} SET name = ?, aliases = ? WHERE id = ?`).run(to, JSON.stringify(aliases), id)
}

// v12 data fix: names translated before 표시 이름 existed were renamed in
// place (old name appended to the aliases). Give the system name back and
// show the Korean one.
export function splitTranslatedNames(db: Db): void {
  for (const table of ['characters', 'affiliations'] as const) {
    const rows = db.prepare(`SELECT id, series_id AS sid, name, aliases FROM ${table} WHERE display_name IS NULL`).all() as {
      id: number
      sid: number
      name: string
      aliases: string
    }[]
    for (const r of rows) {
      if (!hangul(r.name)) continue
      const aliases = JSON.parse(r.aliases) as string[]
      const old = [...aliases].reverse().find((a) => !hangul(a) && !a.includes('_')) // not a Danbooru tag
      if (!old || db.prepare(`SELECT 1 FROM ${table} WHERE series_id = ? AND name = ? AND id <> ?`).get(r.sid, old, r.id)) continue
      db.prepare(`UPDATE ${table} SET name = ?, display_name = ?, aliases = ? WHERE id = ?`).run(
        old,
        r.name,
        JSON.stringify(aliases.filter((a) => a !== old)),
        r.id
      )
    }
  }
}
