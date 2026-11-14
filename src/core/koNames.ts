// 한글 이름: Korean names (표시 이름, names.ts) for games, characters and
// affiliations — from a game's data site (official translations, e.g.
// SchaleDB for Blue Archive), a roster picture the user gives, or the LLM in
// 설정 → LLM asked by name (game titles; small games' titles + characters).
// All only propose; applyNames sets the shown names the user keeps checked
// (system names stay: tag matching, wiki lookups) as one undo step.
import sharp from 'sharp'
import type { Db } from './db'
import type { ActionLog } from './actionLog'
import type { NameChange, NamePlan, Settings } from '../shared/types'
import type { JsonGet } from './pipeline/wiki'
import { textJson, visionJson } from './llm'
import { hangul, nameTaken, seriesIdByName } from './names'
import { UNKNOWN_SERIES } from './pipeline/classify'

// Names compared without case, spacing around "( )" or underscores.
export const nameKey = (s: string): string =>
  s
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)/g, ')')
    .replace(/\s+/g, ' ')
    .trim()

interface Mine {
  kind: NameChange['kind']
  id: number
  name: string // shown
  translated: boolean // has a shown name already, or the system name is Korean
  keys: string[] // every name it goes by
}

function mine(db: Db, series: string): Mine[] {
  const sid = seriesIdByName(db, series)
  if (sid === undefined) throw new Error(`게임 "${series}"이(가) 없습니다`)
  const chars = db.prepare('SELECT id, name, display_name AS shown, aliases, danbooru_tag AS tag FROM characters WHERE series_id = ?').all(sid) as {
    id: number
    name: string
    shown: string | null
    aliases: string
    tag: string | null
  }[]
  const affs = db.prepare('SELECT id, name, display_name AS shown, aliases FROM affiliations WHERE series_id = ?').all(sid) as {
    id: number
    name: string
    shown: string | null
    aliases: string
  }[]
  const row = (kind: NameChange['kind'], r: { id: number; name: string; shown: string | null; aliases: string }, extra: string[] = []): Mine => ({
    kind,
    id: r.id,
    name: r.shown ?? r.name,
    translated: r.shown !== null || hangul(r.name),
    keys: [r.name, r.shown ?? '', ...(JSON.parse(r.aliases) as string[]), ...extra].filter(Boolean).map(nameKey)
  })
  return [
    // the Danbooru tag without its "(game)": hoshino_(swimsuit)_(blue_archive) → hoshino (swimsuit)
    ...chars.map((c) => row('character', c, c.tag ? [c.tag.replace(/_\([^()]*\)$/, '')] : [])),
    ...affs.map((a) => row('affiliation', a))
  ]
}

// ---- game data sites ----

// English name (any of a few) → Korean, per kind.
interface Dict {
  characters: Map<string, string>
  affiliations: Map<string, string>
}

interface GameData {
  site: string
  load: (get: JsonGet, signal?: AbortSignal) => Promise<Dict>
}

// Blue Archive: SchaleDB (the game's own Korean names). Students by id in
// each language; schools / clubs in the localization file by the same keys.
const schale: GameData = {
  site: 'SchaleDB',
  async load(get, signal) {
    const url = (lang: string, f: string): string => `https://schaledb.com/data/${lang}/${f}.min.json`
    type Student = { Name: string; FamilyName?: string; PersonalName?: string }
    type Loc = Record<'School' | 'SchoolLong' | 'Club', Record<string, string>>
    const [enS, krS, enL, krL] = (await Promise.all([
      get(url('en', 'students'), signal),
      get(url('kr', 'students'), signal),
      get(url('en', 'localization'), signal),
      get(url('kr', 'localization'), signal)
    ])) as [Record<string, Student>, Record<string, Student>, Loc, Loc]
    const characters = new Map<string, string>()
    for (const [id, en] of Object.entries(enS)) {
      const kr = krS[id]
      if (!kr?.Name) continue
      characters.set(nameKey(en.Name), kr.Name)
      // the full name too, both orders (wikis write "Takanashi Hoshino")
      if (en.FamilyName && en.PersonalName && !/\(/.test(en.Name)) {
        characters.set(nameKey(`${en.FamilyName} ${en.PersonalName}`), kr.Name)
        characters.set(nameKey(`${en.PersonalName} ${en.FamilyName}`), kr.Name)
      }
    }
    const affiliations = new Map<string, string>()
    // long school names first: a club and a short school name never clash with them
    for (const group of ['SchoolLong', 'School', 'Club'] as const)
      for (const [k, en] of Object.entries(enL[group] ?? {})) {
        const kr = krL[group]?.[k] ?? (group === 'School' ? krL.SchoolLong?.[k] : undefined)
        if (kr && !affiliations.has(nameKey(en))) affiliations.set(nameKey(en), kr)
      }
    return { characters, affiliations }
  }
}

const SOURCES: { series: RegExp; data: GameData }[] = [{ series: /^(blue ?archive|블루 ?아카이브|ブルーアーカイブ)$/i, data: schale }]

// The data site a game has, if any (shown on the button).
export function gameDataSite(series: string): string | null {
  return SOURCES.find((s) => s.series.test(series.trim()))?.data.site ?? null
}

export async function planFromGameData(db: Db, series: string, get: JsonGet, signal?: AbortSignal): Promise<NamePlan> {
  const src = SOURCES.find((s) => s.series.test(series.trim()))
  if (!src) throw new Error(`"${series}"은(는) 아직 게임 데이터가 없습니다. 명부 이미지로 번역을 쓰세요`)
  const dict = await src.data.load(get, signal)
  const plan: NamePlan = { source: src.data.site, changes: [], unmatched: 0 }
  for (const m of mine(db, series)) {
    if (m.translated) continue // already Korean
    const map = m.kind === 'character' ? dict.characters : dict.affiliations
    const to = m.keys.map((k) => map.get(k)).find(Boolean)
    if (!to) {
      plan.unmatched++
      continue
    }
    if (nameKey(to) !== nameKey(m.name)) plan.changes.push({ kind: m.kind, id: m.id, from: m.name, to })
  }
  return plan
}

// ---- roster picture (LLM) ----

export async function planFromRoster(db: Db, s: Settings, series: string, data: Buffer, source: string, signal?: AbortSignal): Promise<NamePlan> {
  const list = mine(db, series)
  if (!list.length) throw new Error('이 게임에 캐릭터나 소속이 없습니다')
  const jpeg = await sharp(data, { animated: false }).rotate().flatten({ background: '#ffffff' }).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
  const show = (kind: NameChange['kind']): string =>
    JSON.stringify(
      list
        .filter((m) => m.kind === kind)
        .slice(0, 800)
        .map((m) => m.name)
    )
  const prompt = `This picture is a roster / list from the game "${series}" with names written in Korean (maybe beside pictures or names in other languages).
These are the characters and groups (schools, clubs, units …) I have, by their current names:
characters: ${show('character')}
groups: ${show('affiliation')}
For each one of mine that is in the picture, give its Korean name exactly as written in the picture.
Return only JSON, no explanation:
{"characters":[{"match":"my name, exactly as listed","name":"Korean name from the picture"}],"groups":[{"match":"…","name":"…"}]}
Leave out what you can't find in the picture; never make up a name that isn't written there.`
  const j = (await visionJson(s, { data: jpeg, mime: 'image/jpeg' }, prompt, signal)) as {
    characters?: { match?: unknown; name?: unknown }[]
    groups?: { match?: unknown; name?: unknown }[]
  }
  const plan: NamePlan = { source, changes: [], unmatched: 0 }
  const take = (rows: unknown, kind: NameChange['kind']): void => {
    for (const r of Array.isArray(rows) ? (rows as { match?: unknown; name?: unknown }[]) : []) {
      const match = typeof r?.match === 'string' ? nameKey(r.match) : ''
      const to = typeof r?.name === 'string' ? r.name.trim() : ''
      const m = list.find((x) => x.kind === kind && x.keys.includes(match))
      if (!m || !to || nameKey(to) === nameKey(m.name) || plan.changes.some((c) => c.kind === kind && c.id === m.id)) continue
      plan.changes.push({ kind, id: m.id, from: m.name, to })
    }
  }
  take(j.characters, 'character')
  take(j.groups, 'affiliation')
  plan.unmatched = list.length - plan.changes.length
  return plan
}

// ---- game titles / small games (LLM, text only) ----

const TITLE_RULES = `Use the official Korean title when the work was released in Korea; otherwise the name Korean fans commonly use; otherwise a natural Korean transliteration. Keep it short (no subtitle the original doesn't have).`
const NAME_RULES = `Character names: the official Korean name when there is one, else the usual Korean transliteration (Japanese names in hangul by their reading; a version / outfit stays in parentheses, translated: "Hoshino (Swimsuit)" → "호시노(수영복)").`
const CHUNK = 80

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

// Every game title not translated yet → Korean (sent in groups).
export async function planSeriesTitles(db: Db, s: Settings, signal?: AbortSignal): Promise<NamePlan> {
  const list = (
    db.prepare('SELECT id, name FROM series WHERE display_name IS NULL AND name <> ? ORDER BY name COLLATE NOCASE').all(UNKNOWN_SERIES) as {
      id: number
      name: string
    }[]
  ).filter((r) => !hangul(r.name))
  const plan: NamePlan = { source: 'LLM', changes: [], unmatched: 0 }
  for (let i = 0; i < list.length; i += CHUNK) {
    const part = list.slice(i, i + CHUNK)
    const prompt = `These are titles of games / anime / manga / other works (as tagged on Danbooru). Give each one's Korean title.
${TITLE_RULES}
Titles: ${JSON.stringify(part.map((r) => r.name))}
Return only JSON, no explanation: {"titles":[{"match":"the title exactly as listed","name":"Korean title"}]}
Leave out a title you don't know.`
    const j = (await textJson(s, prompt, signal)) as { titles?: { match?: unknown; name?: unknown }[] }
    for (const r of Array.isArray(j.titles) ? j.titles : []) {
      const m = part.find((x) => nameKey(x.name) === nameKey(str(r?.match)))
      const to = str(r?.name)
      if (!m || !to || nameKey(to) === nameKey(m.name) || plan.changes.some((c) => c.kind === 'series' && c.id === m.id)) continue
      plan.changes.push({ kind: 'series', id: m.id, from: m.name, to, series: to })
    }
  }
  plan.unmatched = list.length - plan.changes.length
  return plan
}

// Games with only a few characters: the title and its characters in one go.
export async function planSmallGames(db: Db, s: Settings, maxChars: number, signal?: AbortSignal): Promise<NamePlan> {
  const games = (
    db
      .prepare(
        `SELECT s.id, s.name, s.display_name AS shown,
           (SELECT COUNT(*) FROM characters c WHERE c.series_id = s.id AND c.parent_id IS NULL) AS chars
         FROM series s WHERE s.name <> ? ORDER BY s.name COLLATE NOCASE`
      )
      .all(UNKNOWN_SERIES) as { id: number; name: string; shown: string | null; chars: number }[]
  ).filter((g) => g.chars > 0 && g.chars <= maxChars)
  const charQ = db.prepare('SELECT id, name, display_name AS shown FROM characters WHERE series_id = ? ORDER BY id')
  type Game = { id: number; name: string; label: string; title: boolean; chars: { id: number; name: string }[] }
  const todo: Game[] = []
  for (const g of games) {
    const chars = (charQ.all(g.id) as { id: number; name: string; shown: string | null }[]).filter((c) => c.shown === null && !hangul(c.name))
    const title = g.shown === null && !hangul(g.name)
    if (title || chars.length) todo.push({ id: g.id, name: g.name, label: g.shown ?? g.name, title, chars: chars.map((c) => ({ id: c.id, name: c.name })) })
  }
  const plan: NamePlan = { source: 'LLM', changes: [], unmatched: 0 }
  let asked = 0
  for (let i = 0; i < todo.length; i += CHUNK) {
    const part = todo.slice(i, i + CHUNK)
    asked += part.reduce((n, g) => n + (g.title ? 1 : 0) + g.chars.length, 0)
    const prompt = `These are works (games / anime / manga …, as tagged on Danbooru) with some of their characters. Give the Korean title of each work and the Korean name of each character listed.
${TITLE_RULES}
${NAME_RULES}
Works: ${JSON.stringify(part.map((g) => ({ title: g.name, characters: g.chars.map((c) => c.name) })))}
Return only JSON, no explanation:
{"works":[{"match":"the title exactly as listed","name":"Korean title","characters":[{"match":"the character exactly as listed","name":"Korean name"}]}]}
Leave out what you don't know.`
    const j = (await textJson(s, prompt, signal)) as { works?: { match?: unknown; name?: unknown; characters?: { match?: unknown; name?: unknown }[] }[] }
    for (const w of Array.isArray(j.works) ? j.works : []) {
      const g = part.find((x) => nameKey(x.name) === nameKey(str(w?.match)))
      if (!g) continue
      const title = str(w?.name)
      const label = g.title && title ? title : g.label
      if (g.title && title && nameKey(title) !== nameKey(g.name)) plan.changes.push({ kind: 'series', id: g.id, from: g.name, to: title, series: label })
      for (const r of Array.isArray(w?.characters) ? w.characters : []) {
        const c = g.chars.find((x) => nameKey(x.name) === nameKey(str(r?.match)))
        const to = str(r?.name)
        if (!c || !to || nameKey(to) === nameKey(c.name) || plan.changes.some((x) => x.kind === 'character' && x.id === c.id)) continue
        plan.changes.push({ kind: 'character', id: c.id, from: c.name, to, series: label })
      }
    }
  }
  plan.unmatched = asked - plan.changes.length
  return plan
}

// ---- apply ----

interface Row {
  id: number
  display_name: string | null
}
interface Snap {
  label: string
  characters: Row[]
  affiliations: Row[]
  series?: Row[]
}

const TABLE = { character: 'characters', affiliation: 'affiliations', series: 'series' } as const

export const NAMES_ACTION = 'names.edit'
export function registerNamesUndo(log: ActionLog, db: Db): void {
  const restore = (s: Snap): void =>
    db.transaction(() => {
      const all: [string, Row[]][] = [
        ['characters', s.characters],
        ['affiliations', s.affiliations],
        ['series', s.series ?? []]
      ]
      for (const [table, rows] of all) {
        const up = db.prepare(`UPDATE ${table} SET display_name = ? WHERE id = ?`)
        for (const r of rows) up.run(r.display_name ?? null, r.id)
      }
    })()
  log.register<Snap>(NAMES_ACTION, restore, (s) =>
    snapshot(db, { character: s.characters.map((r) => r.id), affiliation: s.affiliations.map((r) => r.id), series: (s.series ?? []).map((r) => r.id) }, s.label)
  )
}

function snapshot(db: Db, ids: Record<NameChange['kind'], number[]>, label: string): Snap {
  const rows = (table: string, list: number[]): Row[] =>
    list.length ? (db.prepare(`SELECT id, display_name FROM ${table} WHERE id IN (${list.map(() => '?').join(',')})`).all(...list) as Row[]) : []
  return { label, characters: rows('characters', ids.character), affiliations: rows('affiliations', ids.affiliation), series: rows('series', ids.series) }
}

// Set the shown names (the system names stay). A name another one (of the
// game) already goes by is skipped. Returns how many were set.
export function applyNames(db: Db, log: ActionLog, changes: NameChange[], label: string): number {
  const ids: Record<NameChange['kind'], number[]> = { character: [], affiliation: [], series: [] }
  for (const c of changes) ids[c.kind].push(c.id)
  const snap = snapshot(db, ids, label)
  let n = 0
  db.transaction(() => {
    for (const c of changes) {
      const table = TABLE[c.kind]
      const to = c.to.trim()
      const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(c.id) as { name: string; display_name: string | null; series_id?: number } | undefined
      if (!row || !to || (row.display_name ?? row.name) === to) continue
      if (to !== row.name && nameTaken(db, table, to, c.id, row.series_id)) continue
      db.prepare(`UPDATE ${table} SET display_name = ? WHERE id = ?`).run(to === row.name ? null : to, c.id)
      n++
    }
  })()
  if (n) log.record<Snap>(NAMES_ACTION, snap)
  return n
}
