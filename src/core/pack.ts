// 공유 파일 (.sortapack): games, 소속 조직도, characters and learned
// references, to hand to another Sorta user. gzip-compressed JSON. Learned
// references are CCIP feature vectors (float16) — never pictures. Vectors from
// the user's own confirmed pictures go in only when asked for.
//
// Import merges: games / 소속 / characters are matched by tag, name or
// earlier name; my placements win unless `overwrite`. One undo step.
import { gunzipSync, gzipSync } from 'zlib'
import type { Db } from './db'
import type { ActionLog } from './actionLog'
import type { PackExportOptions, PackPreview } from '../shared/types'

export const PACK_FORMAT = 'sorta-pack'
export const PACK_VERSION = 1
export const EMBED_MODEL = 'ccip-caformer-24-randaug-pruned'
export const PACK_ACTION = 'pack.import'

interface PackRef {
  src: 'booru' | 'user' | 'shared' // shared = came from another pack
  post?: number
  v: string // base64 float16
}
interface PackCharacter {
  key: string
  name: string
  aliases: string[]
  tag: string | null
  parent: string | null // base character key (outfit version)
  affiliation: string | null // affiliation key
  learned?: { tag: string; at: number; refs: PackRef[] }
}
interface PackAffiliation {
  key: string
  name: string
  aliases: string[]
  parent: string | null
  order: number
}
interface PackSeries {
  name: string
  aliases: string[]
  tag: string | null
  wiki: string | null
  affiliations: PackAffiliation[]
  characters: PackCharacter[]
}
export interface Pack {
  format: typeof PACK_FORMAT
  version: number
  app: string
  createdAt: number
  embedModel: string
  dim: number
  series: PackSeries[]
}

// ---- float16 ----

const f32 = new Float32Array(1)
const u32 = new Uint32Array(f32.buffer)
function toHalf(x: number): number {
  f32[0] = x
  const b = u32[0]
  const sign = (b >>> 16) & 0x8000
  const exp = ((b >>> 23) & 0xff) - 127 + 15
  const mant = b & 0x7fffff
  if (exp <= 0) return sign // tiny → 0 (feature values are never that small in a useful way)
  if (exp >= 31) return sign | 0x7c00
  return sign | (exp << 10) | (mant >>> 13)
}
function fromHalf(h: number): number {
  const sign = h & 0x8000 ? -1 : 1
  const exp = (h >>> 10) & 0x1f
  const mant = h & 0x3ff
  if (exp === 0) return sign * mant * 2 ** -24
  if (exp === 31) return mant ? NaN : sign * Infinity
  return sign * (1 + mant / 1024) * 2 ** (exp - 15)
}
export function encodeVector(buf: Buffer): string {
  const v = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4)
  const h = new Uint16Array(v.length)
  for (let i = 0; i < v.length; i++) h[i] = toHalf(v[i])
  return Buffer.from(h.buffer).toString('base64')
}
export function decodeVector(s: string): Buffer {
  const b = Buffer.from(s, 'base64')
  const h = new Uint16Array(b.buffer, b.byteOffset, b.byteLength / 2)
  const v = new Float32Array(h.length)
  for (let i = 0; i < h.length; i++) v[i] = fromHalf(h[i])
  return Buffer.from(v.buffer)
}
// Stable id for a reference vector without a Danbooru post (dedupes re-imports).
function vectorId(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return -((h >>> 0) % 2147483647) - 1
}

// ---- export ----

export function exportPack(db: Db, appVersion: string, o: PackExportOptions): Buffer {
  const series = db
    .prepare(`SELECT id, name, aliases, danbooru_copyright_tag AS tag, wiki FROM series ${o.seriesIds ? `WHERE id IN (${o.seriesIds.map(() => '?').join(',') || 'NULL'})` : ''} ORDER BY name`)
    .all(...(o.seriesIds ?? [])) as { id: number; name: string; aliases: string; tag: string | null; wiki: string | null }[]
  const out: Pack = { format: PACK_FORMAT, version: PACK_VERSION, app: appVersion, createdAt: Date.now(), embedModel: EMBED_MODEL, dim: 768, series: [] }
  const affQ = db.prepare('SELECT id, name, aliases, parent_id, sort_order FROM affiliations WHERE series_id = ? ORDER BY sort_order, id')
  const charQ = db.prepare('SELECT id, name, aliases, danbooru_tag, parent_id, affiliation_id FROM characters WHERE series_id = ? ORDER BY id')
  const learnedQ = db.prepare('SELECT tag, learned_at FROM learned WHERE character_id = ?')
  const refsQ = db.prepare(`SELECT source, post_id, vector FROM refs WHERE character_id = ? ${o.includeUserRefs ? '' : "AND source = 'booru'"}`)
  for (const s of series) {
    const affs = affQ.all(s.id) as { id: number; name: string; aliases: string; parent_id: number | null; sort_order: number }[]
    const chars = charQ.all(s.id) as {
      id: number
      name: string
      aliases: string
      danbooru_tag: string | null
      parent_id: number | null
      affiliation_id: number | null
    }[]
    const charIds = new Set(chars.map((c) => c.id))
    const ps: PackSeries = {
      name: s.name,
      aliases: JSON.parse(s.aliases),
      tag: s.tag,
      wiki: s.wiki,
      affiliations: affs.map((a) => ({ key: `a${a.id}`, name: a.name, aliases: JSON.parse(a.aliases), parent: a.parent_id ? `a${a.parent_id}` : null, order: a.sort_order })),
      characters: []
    }
    for (const c of chars) {
      const pc: PackCharacter = {
        key: `c${c.id}`,
        name: c.name,
        aliases: JSON.parse(c.aliases),
        tag: c.danbooru_tag,
        parent: c.parent_id && charIds.has(c.parent_id) ? `c${c.parent_id}` : null,
        affiliation: c.affiliation_id ? `a${c.affiliation_id}` : null
      }
      if (o.includeLearned) {
        const refs = refsQ.all(c.id) as { source: string; post_id: number | null; vector: Buffer }[]
        const l = learnedQ.get(c.id) as { tag: string; learned_at: number } | undefined
        if (refs.length) {
          pc.learned = {
            tag: l?.tag ?? c.danbooru_tag ?? c.name,
            at: l?.learned_at ?? Date.now(),
            refs: refs.map((r) => ({
              src: r.source === 'user' ? 'user' : r.post_id !== null && r.post_id < 0 ? 'shared' : 'booru',
              post: r.post_id !== null && r.post_id > 0 ? r.post_id : undefined,
              v: encodeVector(r.vector)
            }))
          }
        }
      }
      ps.characters.push(pc)
    }
    out.series.push(ps)
  }
  return gzipSync(Buffer.from(JSON.stringify(out)))
}

export function readPack(buf: Buffer): Pack {
  let p: Pack
  try {
    p = JSON.parse(gunzipSync(buf).toString('utf8')) as Pack
  } catch {
    throw new Error('Sorta 공유 파일이 아닙니다')
  }
  if (p.format !== PACK_FORMAT) throw new Error('Sorta 공유 파일이 아닙니다')
  if (p.version > PACK_VERSION) throw new Error('더 새 버전의 Sorta에서 만든 파일입니다. Sorta를 업데이트하세요')
  return p
}

// ---- import ----

const lower = (s: string): string => s.trim().toLowerCase()

interface Plan {
  preview: PackPreview
  run: () => void
}

interface ImportPayload {
  label: string
  created: { series: number[]; affiliations: number[]; characters: number[] }
  refs: number[] // inserted ref ids
  before: {
    series: Record<string, unknown>[]
    affiliations: Record<string, unknown>[]
    characters: Record<string, unknown>[]
    learned: { character_id: number; row: Record<string, unknown> | null }[]
  }
}

export function registerPackUndo(log: ActionLog, db: Db): void {
  log.register<ImportPayload>(PACK_ACTION, (p) =>
    db.transaction(() => {
      db.pragma('defer_foreign_keys = ON')
      const del = (table: string, ids: number[]): void => {
        if (ids.length) db.prepare(`DELETE FROM ${table} WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids)
      }
      del('refs', p.refs)
      for (const l of p.before.learned) {
        db.prepare('DELETE FROM learned WHERE character_id = ?').run(l.character_id)
        if (l.row) put(db, 'learned', l.row)
      }
      for (const r of p.before.characters) put(db, 'characters', r)
      for (const r of p.before.affiliations) put(db, 'affiliations', r)
      for (const r of p.before.series) put(db, 'series', r)
      // created rows: characters → affiliations → series (dependents first)
      db.prepare(`UPDATE characters SET affiliation_id = NULL WHERE affiliation_id IN (${p.created.affiliations.map(() => '?').join(',') || 'NULL'})`).run(
        ...p.created.affiliations
      )
      del('characters', p.created.characters)
      del('affiliations', p.created.affiliations)
      del('series', p.created.series)
    })()
  )
}

function put(db: Db, table: string, row: Record<string, unknown>): void {
  const cols = Object.keys(row)
  db.prepare(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${cols.map((c) => '@' + c).join(',')})`).run(row)
}

// Work out what an import would do; `run()` does it (inside one transaction).
export function planImport(db: Db, pack: Pack, o: { overwrite: boolean; learned: boolean }): Plan & { payload: () => ImportPayload } {
  const pv: PackPreview = {
    games: pack.series.length,
    newGames: 0,
    newAffiliations: 0,
    newCharacters: 0,
    learnedCharacters: 0,
    refs: 0,
    userRefs: pack.series.reduce((n, s) => n + s.characters.reduce((m, c) => m + (c.learned?.refs.filter((r) => r.src === 'user').length ?? 0), 0), 0),
    conflicts: [],
    modelMismatch: pack.embedModel !== EMBED_MODEL,
    app: pack.app,
    createdAt: pack.createdAt
  }
  const useLearned = o.learned && !pv.modelMismatch
  // Dry matching for the preview.
  const seriesByKey = (s: PackSeries): { id: number; name: string } | undefined => {
    const rows = db.prepare('SELECT id, name, aliases, danbooru_copyright_tag AS tag FROM series').all() as { id: number; name: string; aliases: string; tag: string | null }[]
    return rows.find(
      (r) =>
        lower(r.name) === lower(s.name) ||
        (s.tag && r.tag === s.tag) ||
        (JSON.parse(r.aliases) as string[]).some((a) => lower(a) === lower(s.name))
    )
  }
  const affByName = (sid: number, a: PackAffiliation): { id: number; parent_id: number | null; name: string } | undefined => {
    const rows = db.prepare('SELECT id, name, aliases, parent_id FROM affiliations WHERE series_id = ?').all(sid) as {
      id: number
      name: string
      aliases: string
      parent_id: number | null
    }[]
    const names = [a.name, ...a.aliases].map(lower)
    return rows.find((r) => [r.name, ...(JSON.parse(r.aliases) as string[])].some((x) => names.includes(lower(x))))
  }
  const charMatch = (sid: number | null, c: PackCharacter): { id: number; name: string; affiliation_id: number | null } | undefined => {
    if (c.tag) {
      const r = db.prepare('SELECT id, name, affiliation_id FROM characters WHERE danbooru_tag = ?').get(c.tag) as
        | { id: number; name: string; affiliation_id: number | null }
        | undefined
      if (r) return r
    }
    if (sid === null) return undefined
    const rows = db.prepare('SELECT id, name, aliases, affiliation_id FROM characters WHERE series_id = ?').all(sid) as {
      id: number
      name: string
      aliases: string
      affiliation_id: number | null
    }[]
    const names = [c.name, ...c.aliases].map(lower)
    return rows.find((r) => [r.name, ...(JSON.parse(r.aliases) as string[])].some((x) => names.includes(lower(x))))
  }
  for (const s of pack.series) {
    const ms = seriesByKey(s)
    if (!ms) pv.newGames++
    const affName = new Map(s.affiliations.map((a) => [a.key, a.name]))
    for (const a of s.affiliations) if (!ms || !affByName(ms.id, a)) pv.newAffiliations++
    for (const c of s.characters) {
      const mc = ms ? charMatch(ms.id, c) : c.tag ? charMatch(null, c) : undefined
      if (!mc) pv.newCharacters++
      else if (c.affiliation && mc.affiliation_id !== null) {
        const mine = (db.prepare('SELECT name FROM affiliations WHERE id = ?').get(mc.affiliation_id) as { name: string } | undefined)?.name
        const theirs = affName.get(c.affiliation)
        if (mine && theirs && lower(mine) !== lower(theirs)) pv.conflicts.push(`${c.name}: 내 소속 ${mine} · 파일 ${theirs}`)
      }
      if (useLearned && c.learned?.refs.length) {
        pv.learnedCharacters++
        pv.refs += c.learned.refs.length
      }
    }
  }

  const payload: ImportPayload = {
    label: '공유 파일 불러오기',
    created: { series: [], affiliations: [], characters: [] },
    refs: [],
    before: { series: [], affiliations: [], characters: [], learned: [] }
  }
  const snapped = { series: new Set<number>(), affiliations: new Set<number>(), characters: new Set<number>() }
  const snap = (table: 'series' | 'affiliations' | 'characters', id: number): void => {
    if (snapped[table].has(id)) return
    snapped[table].add(id)
    payload.before[table].push(db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown>)
  }
  const unionAliases = (table: 'series' | 'affiliations' | 'characters', id: number, extra: string[], own: string): void => {
    const r = db.prepare(`SELECT name, aliases FROM ${table} WHERE id = ?`).get(id) as { name: string; aliases: string }
    const cur = JSON.parse(r.aliases) as string[]
    const add = [...extra, own].filter((x) => x && lower(x) !== lower(r.name) && !cur.some((c) => lower(c) === lower(x)))
    if (!add.length) return
    snap(table, id)
    db.prepare(`UPDATE ${table} SET aliases = ? WHERE id = ?`).run(JSON.stringify([...cur, ...add]), id)
  }

  const run = (): void => {
    db.transaction(() => {
      for (const s of pack.series) {
        // game
        let sid = seriesByKey(s)?.id
        if (sid === undefined) {
          sid = Number(
            db
              .prepare('INSERT INTO series (name, aliases, danbooru_copyright_tag, wiki, created_at) VALUES (?, ?, ?, ?, ?)')
              .run(s.name, JSON.stringify(s.aliases), s.tag, s.wiki, Date.now()).lastInsertRowid
          )
          payload.created.series.push(sid)
        } else {
          const cur = db.prepare('SELECT wiki, danbooru_copyright_tag AS tag FROM series WHERE id = ?').get(sid) as { wiki: string | null; tag: string | null }
          if ((!cur.wiki && s.wiki) || (!cur.tag && s.tag)) {
            snap('series', sid)
            db.prepare('UPDATE series SET wiki = COALESCE(wiki, ?), danbooru_copyright_tag = COALESCE(danbooru_copyright_tag, ?) WHERE id = ?').run(s.wiki, s.tag, sid)
          }
          unionAliases('series', sid, s.aliases, s.name)
        }
        // 소속, parents first
        const affId = new Map<string, number>()
        const pending = [...s.affiliations]
        for (let guard = 0; pending.length && guard < 1000; guard++) {
          const a = pending.shift()!
          if (a.parent && !affId.has(a.parent) && pending.some((x) => x.key === a.parent)) {
            pending.push(a) // parent not placed yet
            continue
          }
          const parent = a.parent ? (affId.get(a.parent) ?? null) : null
          const m = affByName(sid, a)
          if (!m) {
            const id = Number(
              db
                .prepare('INSERT INTO affiliations (series_id, name, aliases, parent_id, sort_order) VALUES (?, ?, ?, ?, ?)')
                .run(sid, a.name, JSON.stringify(a.aliases), parent, a.order).lastInsertRowid
            )
            payload.created.affiliations.push(id)
            affId.set(a.key, id)
          } else {
            affId.set(a.key, m.id)
            unionAliases('affiliations', m.id, a.aliases, a.name)
            if (o.overwrite && m.parent_id !== parent && !isBelow(db, parent, m.id)) {
              snap('affiliations', m.id)
              db.prepare('UPDATE affiliations SET parent_id = ?, sort_order = ? WHERE id = ?').run(parent, a.order, m.id)
            }
          }
        }
        // characters (bases first so versions can point at them)
        const charId = new Map<string, number>()
        const ordered = [...s.characters].sort((x, y) => Number(!!x.parent) - Number(!!y.parent))
        for (const c of ordered) {
          const aff = c.affiliation ? (affId.get(c.affiliation) ?? null) : null
          const parent = c.parent ? (charId.get(c.parent) ?? null) : null
          let id = charMatch(sid, c)?.id
          if (id === undefined) {
            id = Number(
              db
                .prepare('INSERT INTO characters (series_id, affiliation_id, name, aliases, danbooru_tag, parent_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
                .run(sid, aff, uniqueName(db, sid, c.name), JSON.stringify(c.aliases), c.tag, parent, Date.now()).lastInsertRowid
            )
            payload.created.characters.push(id)
          } else {
            unionAliases('characters', id, c.aliases, c.name)
            const cur = db.prepare('SELECT affiliation_id, parent_id FROM characters WHERE id = ?').get(id) as { affiliation_id: number | null; parent_id: number | null }
            const setAff = aff !== null && (cur.affiliation_id === null || (o.overwrite && cur.affiliation_id !== aff))
            const setParent = parent !== null && cur.parent_id === null && parent !== id
            if (setAff || setParent) {
              snap('characters', id)
              if (setAff) db.prepare('UPDATE characters SET affiliation_id = ? WHERE id = ?').run(aff, id)
              if (setParent) db.prepare('UPDATE characters SET parent_id = ? WHERE id = ?').run(parent, id)
            }
          }
          charId.set(c.key, id)
          // learned references
          if (useLearned && c.learned?.refs.length) {
            const before = db.prepare('SELECT * FROM learned WHERE character_id = ?').get(id) as Record<string, unknown> | undefined
            payload.before.learned.push({ character_id: id, row: before ?? null })
            const ins = db.prepare("INSERT OR IGNORE INTO refs (character_id, source, post_id, vector, created_at) VALUES (?, 'booru', ?, ?, ?)")
            for (const r of c.learned.refs) {
              // Danbooru refs keep their post id; others get a stable negative id.
              const res = ins.run(id, r.post && r.src === 'booru' ? r.post : vectorId(r.v), decodeVector(r.v), Date.now())
              if (res.changes) payload.refs.push(Number(res.lastInsertRowid))
            }
            const total = (db.prepare("SELECT COUNT(*) AS n FROM refs WHERE character_id = ? AND source = 'booru'").get(id) as { n: number }).n
            db.prepare('INSERT OR REPLACE INTO learned (character_id, tag, refs, learned_at) VALUES (?, ?, ?, ?)').run(
              id,
              (before?.tag as string | undefined) ?? c.learned.tag,
              total,
              (before?.learned_at as number | undefined) ?? c.learned.at
            )
          }
        }
      }
    })()
  }
  return { preview: pv, run, payload: () => payload }
}

// Would putting `node` under `parent` create a loop?
function isBelow(db: Db, parent: number | null, node: number): boolean {
  for (let p = parent, guard = 0; p !== null && guard < 100; guard++) {
    if (p === node) return true
    p = (db.prepare('SELECT parent_id FROM affiliations WHERE id = ?').get(p) as { parent_id: number | null } | undefined)?.parent_id ?? null
  }
  return false
}

function uniqueName(db: Db, sid: number, name: string): string {
  for (let n = 1; ; n++) {
    const v = n === 1 ? name : `${name} (${n})`
    if (!db.prepare('SELECT 1 FROM characters WHERE series_id = ? AND name = ?').get(sid, v)) return v
  }
}

export function importPack(db: Db, log: ActionLog, pack: Pack, o: { overwrite: boolean; learned: boolean }): PackPreview {
  const p = planImport(db, pack, o)
  p.run()
  log.record<ImportPayload>(PACK_ACTION, p.payload())
  return p.preview
}
