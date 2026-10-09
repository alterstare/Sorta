// 소속 위키 조회 (CLAUDE.md §5.7, opt-in via allowWebLookup): ask the game's
// Fandom wiki (MediaWiki API) about a character by NAME only — no image or
// image data leaves the PC — and read affiliation-like infobox fields
// (region/school → affiliation/club …) as a suggested path. Results are only
// suggestions; the user accepts them in the 조직도.
import type { JobContext } from '../queue'
import type { WikiSuggestion } from '../../shared/types'

export type JsonGet = (url: string, signal?: AbortSignal) => Promise<unknown>

export const fetchJson: JsonGet = async (url, signal) => {
  const r = await fetch(url, { signal, headers: { 'User-Agent': 'Sorta (character image sorter; affiliation lookup)' } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

const GAP_MS = 1000 // one request per second

// Infobox fields that name an affiliation, by level (0 = outermost).
const LEVELS: [number, RegExp][] = [
  [0, /^(region|nation|country|school|academy|homeworld|world|kingdom)$/],
  [1, /^(affiliations?\d*|faction\d*|organi[sz]ation\d*|company|team\d*|group\d*|unit\d*|club\d*|division|squad\d*|guild|clan|class_?name|department)$/]
]
const levelOf = (field: string): number | null => LEVELS.find(([, re]) => re.test(field))?.[0] ?? null

// ---- wikitext ----

// Top-level templates of a page: name + named params (nested {{ }} / [[ ]] kept).
export function templates(text: string): { name: string; params: Map<string, string> }[] {
  const out: { name: string; params: Map<string, string> }[] = []
  for (let i = 0; i < text.length; i++) {
    if (!text.startsWith('{{', i)) continue
    let depth = 0
    let j = i
    for (; j < text.length; j++) {
      if (text.startsWith('{{', j)) (depth++, j++)
      else if (text.startsWith('}}', j)) {
        depth--
        j++
        if (depth === 0) break
      }
    }
    const body = text.slice(i + 2, j - 1)
    // split on | at nesting level 0
    const parts: string[] = []
    let d = 0
    let cur = ''
    for (let k = 0; k < body.length; k++) {
      const two = body.slice(k, k + 2)
      if (two === '{{' || two === '[[') (d++, (cur += two), k++)
      else if (two === '}}' || two === ']]') (d--, (cur += two), k++)
      else if (body[k] === '|' && d === 0) (parts.push(cur), (cur = ''))
      else cur += body[k]
    }
    parts.push(cur)
    const params = new Map<string, string>()
    for (const p of parts.slice(1)) {
      const eq = p.indexOf('=')
      if (eq > 0) params.set(p.slice(0, eq).trim().toLowerCase(), p.slice(eq + 1).trim())
    }
    out.push({ name: parts[0].trim(), params })
    i = j
  }
  return out
}

// Plain first value of a field: links → their text, refs/comments/templates
// dropped, ALL_CAPS codes (Blue Archive wiki: ABYDOS) → "Abydos".
export function cleanValue(v: string): string {
  let s = v
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[\s\S]*?<\/ref>/gi, '')
  s = s.split(/<br\s*\/?>|\n|;/i).map((x) => x.replace(/^[*#:\s]+/, '').trim()).find((x) => x) ?? ''
  s = s
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]*)\]\]/g, '$1')
    .replace(/\{\{[\s\S]*?\}\}/g, '')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^[A-Z0-9_ -]+$/.test(s) && /[A-Z]{4}/.test(s)) { // short acronyms (PL) stay
    s = s
      .split(/[_ ]+/)
      .filter(Boolean)
      .map((w) => w[0] + w.slice(1).toLowerCase())
      .join(' ')
  }
  return s.length > 60 || /^[\d.,\s%-]*$/.test(s) ? '' : s // numbers are stats, not names
}

// Affiliation-like fields of a page and the path they suggest.
export function readAffiliations(text: string): { path: string[]; fields: { field: string; value: string }[] } {
  const fields: { field: string; value: string; level: number }[] = []
  for (const t of templates(text)) {
    for (const [k, v] of t.params) {
      const level = levelOf(k)
      if (level === null) continue
      const value = cleanValue(v)
      if (value && !fields.some((f) => f.value.toLowerCase() === value.toLowerCase())) fields.push({ field: k, value, level })
    }
    if (fields.length) break // the first infobox that has any is the character's
  }
  const path = [0, 1].map((l) => fields.find((f) => f.level === l)?.value).filter((x): x is string => !!x)
  return { path, fields: fields.map(({ field, value }) => ({ field, value })) }
}

// ---- wiki API ----

const api = (wiki: string, q: Record<string, string>): string =>
  `https://${wiki}/api.php?${new URLSearchParams({ format: 'json', ...q }).toString()}`

interface Page {
  title: string
  revisions?: { slots: { main: { '*': string } } }[]
}

// Which search result is the character: an exact title, else a title holding
// every word of the name ("Hoshino" → "Takanashi Hoshino"). Sub-pages count
// for their main page ("Nakamasa Ichika/Audio" → "Nakamasa Ichika"); outfit
// pages ("… (Swimsuit ver.)") never do.
export function pickTitle(name: string, titles: string[]): string | null {
  const words = name.toLowerCase().split(/[\s_]+/).filter(Boolean)
  const bases = [...new Set(titles.map((t) => t.split('/')[0].trim()))].filter((t) => !t.includes('('))
  return (
    bases.find((t) => t.toLowerCase() === name.toLowerCase()) ??
    bases.find((t) => {
      const tw = t.toLowerCase().split(/[\s_]+/)
      return words.every((w) => tw.includes(w))
    }) ??
    null
  )
}

export async function lookupCharacter(
  wiki: string,
  c: { id: number; name: string },
  get: JsonGet,
  signal?: AbortSignal
): Promise<WikiSuggestion> {
  const base: WikiSuggestion = { characterId: c.id, name: c.name, page: null, url: null, path: [], fields: [] }
  try {
    const found = (await get(api(wiki, { action: 'query', list: 'search', srsearch: c.name, srlimit: '10', srnamespace: '0', srprop: '' }), signal)) as {
      query?: { search?: { title: string }[] }
    }
    const title = pickTitle(c.name, (found.query?.search ?? []).map((r) => r.title))
    if (!title) return base
    const j = (await get(
      api(wiki, { action: 'query', titles: title, prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1' }),
      signal
    )) as { query?: { pages?: Record<string, Page> } }
    const page = Object.values(j.query?.pages ?? {})[0]
    const text = page?.revisions?.[0]?.slots.main['*'] ?? ''
    const t = page?.title ?? title
    return {
      ...base,
      page: t,
      url: `https://${wiki}/wiki/${encodeURIComponent(t.replace(/ /g, '_'))}`,
      ...readAffiliations(text)
    }
  } catch (e) {
    if (signal?.aborted) throw e
    return { ...base, error: String((e as Error).message ?? e) }
  }
}

// Guess a game's Fandom wiki: "Blue Archive" → bluearchive / blue-archive,
// keep the one with more articles.
export async function findWiki(series: string, get: JsonGet, signal?: AbortSignal): Promise<string | null> {
  const w = series.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim().split(/\s+/).filter(Boolean)
  if (!w.length) return null
  let best: { wiki: string; n: number } | null = null
  for (const slug of [...new Set([w.join(''), w.join('-')])]) {
    const wiki = `${slug}.fandom.com`
    try {
      const j = (await get(api(wiki, { action: 'query', meta: 'siteinfo', siprop: 'general|statistics' }), signal)) as {
        query?: { general?: { server?: string }; statistics?: { articles?: number } }
      }
      const n = j.query?.statistics?.articles ?? 0
      // a renamed wiki redirects: keep its real address
      const real = j.query?.general?.server ? new URL(j.query.general.server, 'https://x').hostname : wiki
      if (n > (best?.n ?? 0)) best = { wiki: real, n }
    } catch {
      if (signal?.aborted) throw new Error('cancelled')
    }
  }
  return best?.wiki ?? null
}

export async function lookupAll(
  wiki: string,
  chars: { id: number; name: string }[],
  ctx: JobContext,
  get: JsonGet = fetchJson,
  gapMs = GAP_MS
): Promise<WikiSuggestion[]> {
  const out: WikiSuggestion[] = []
  for (let i = 0; i < chars.length; i++) {
    if (ctx.signal.aborted) break
    ctx.report(i, chars.length, `위키에서 소속 찾기 · ${chars[i].name}`)
    if (i > 0 && gapMs) await new Promise((r) => setTimeout(r, gapMs))
    out.push(await lookupCharacter(wiki, chars[i], get, ctx.signal))
  }
  ctx.report(chars.length, chars.length)
  return out
}
