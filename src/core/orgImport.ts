// 조직도 불러오기: an affiliation tree from a wiki page listing them (link) or
// from a picture of an org chart (LLM). Nothing is changed here — the tree
// goes to org.importTree, which previews it and, once the user accepts,
// applies it as one undo step.
import sharp from 'sharp'
import type { OrgImportNode, Settings } from '../shared/types'
import type { JsonGet } from './pipeline/wiki'
import { visionJson } from './llm'

// ---- wiki page (link) ----

// Sections that are never a list of affiliations.
const SKIP = /^(see also|references?|gallery|trivia|navigation|external links?|notes?|sources?|history|general information|관련 문서|각주|외부 링크)$/i

const node = (name: string, aliases: string[] = []): OrgImportNode => ({ name, aliases, characters: [], children: [] })

// One heading / list item → its name and other names. [[Target|A/B]] → A (B
// and Target as aliases); notes after the link ("(Student Council)") drop.
export function itemName(raw: string): { name: string; aliases: string[] } | null {
  const text = raw
    .replace(/<ref[^>]*\/>|<ref[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/'{2,}/g, '')
  if (/\[\[(file|image|category|파일|분류):/i.test(text)) return null
  const link = text.match(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/)
  let shown: string
  let target: string | null = null
  if (link) {
    target = link[1].split('#')[0].trim()
    shown = (link[2] ?? link[1]).trim()
  } else shown = text.replace(/<[^>]+>/g, '').replace(/\s*\([^)]*\)\s*$/, '').trim()
  const parts = shown
    .split('/')
    .map((x) => x.trim())
    .filter(Boolean)
  if (!parts.length) return null
  const [name, ...rest] = parts
  const aliases = [...rest, ...(target && !parts.includes(target) ? [target] : [])]
  return { name, aliases: [...new Set(aliases)] }
}

// Headings and list items as a tree: a heading holds the items under it,
// "**" items nest under the "*" before them. A heading that isn't a link
// ("Club List") only groups other headings and is left out; sections with no
// list items under them at all are dropped.
export function parseOrgWikitext(text: string): OrgImportNode[] {
  type H = { level: number; n: OrgImportNode }
  const top: OrgImportNode[] = []
  const heads: H[] = []
  let items: OrgImportNode[] = [] // the current list's item per depth
  let skipping = 0 // level of a skipped section (0 = none)
  const meta = new Map<OrgImportNode, { item: boolean; plain: boolean }>()
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^(={2,6})\s*(.+?)\s*\1\s*$/)
    if (h) {
      const level = h[1].length
      items = []
      if (skipping && level > skipping) continue
      skipping = 0
      while (heads.length && heads[heads.length - 1].level >= level) heads.pop()
      const it = itemName(h[2])
      if (!it || SKIP.test(it.name)) {
        skipping = level
        continue
      }
      const n = node(it.name, it.aliases)
      meta.set(n, { item: false, plain: !/\[\[/.test(h[2]) })
      ;(heads.length ? heads[heads.length - 1].n.children : top).push(n)
      heads.push({ level, n })
      continue
    }
    if (skipping) continue
    const b = line.match(/^([*#]+)\s*(.+)$/)
    if (!b) continue
    const depth = b[1].length
    const it = itemName(b[2])
    if (!it) continue
    const n = node(it.name, it.aliases)
    meta.set(n, { item: true, plain: false })
    const parent = depth > 1 ? items[depth - 2] : heads[heads.length - 1]?.n
    ;(parent ? parent.children : top).push(n)
    items = [...items.slice(0, depth - 1), n]
  }
  // drop branches without list items; plain headings that only group headings go
  const prune = (list: OrgImportNode[]): OrgImportNode[] => {
    const out: OrgImportNode[] = []
    for (const n of list) {
      n.children = prune(n.children)
      const m = meta.get(n)!
      if (!m.item && !n.children.length) continue
      if (m.plain && n.children.every((c) => !meta.get(c)!.item)) out.push(...n.children)
      else out.push(n)
    }
    return out
  }
  return tidy(prune(top))
}

// A page address → its wikitext, through the wiki's MediaWiki API
// (Fandom: /api.php, Wikipedia-style: /w/api.php).
export async function fetchWikiPage(url: string, get: JsonGet, signal?: AbortSignal): Promise<{ title: string; text: string }> {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    throw new Error('주소가 올바르지 않습니다')
  }
  const title = u.searchParams.get('title') ?? decodeURIComponent(u.pathname.replace(/^\/(wiki|w)\//, '').replace(/^\//, '')).replace(/_/g, ' ')
  if (!title) throw new Error('주소에서 문서 이름을 찾지 못했습니다')
  const q = new URLSearchParams({ action: 'query', titles: title, prop: 'revisions', rvprop: 'content', rvslots: 'main', redirects: '1', format: 'json' })
  let last: unknown = null
  for (const path of ['/api.php', '/w/api.php']) {
    try {
      const j = (await get(`${u.origin}${path}?${q}`, signal)) as {
        query?: { pages?: Record<string, { title: string; missing?: string; revisions?: { slots: { main: { '*': string } } }[] }> }
      }
      const page = Object.values(j.query?.pages ?? {})[0]
      if (!page) continue
      if (page.missing !== undefined) throw new Error(`"${title}" 문서가 없습니다`)
      return { title: page.title, text: page.revisions?.[0]?.slots.main['*'] ?? '' }
    } catch (e) {
      if (signal?.aborted) throw e
      last = e
    }
  }
  throw last instanceof Error ? last : new Error('위키 문서를 읽지 못했습니다')
}

// ---- picture (LLM) ----

export async function treeFromImage(
  s: Settings,
  series: string,
  data: Buffer,
  known: { affiliations: string[]; characters: string[] },
  translate: boolean,
  signal?: AbortSignal
): Promise<OrgImportNode[]> {
  // big enough for small print, small enough for every provider's limit
  const jpeg = await sharp(data, { animated: false }).rotate().flatten({ background: '#ffffff' }).resize(2048, 2048, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer()
  const list = (xs: string[]): string => JSON.stringify(xs.slice(0, 800))
  const shape = translate
    ? '{"tree":[{"name":"group","match":"","aliases":[],"characters":[{"name":"character","match":""}],"children":[ …same shape… ]}]}'
    : '{"tree":[{"name":"group","aliases":[],"characters":[{"name":"character"}],"children":[ …same shape… ]}]}'
  const naming = translate
    ? `- Write every group and character name in Korean, as written in the picture (if the picture has none for one, its usual Korean name).
- When a group or character is one of these of mine, also set "match" to my name exactly as listed:
  groups: ${list(known.affiliations)}
  characters: ${list(known.characters)}`
    : `- When a group or character is the same as one in these lists, write it exactly as in the list:
  groups: ${list(known.affiliations)}
  characters: ${list(known.characters)}
- Otherwise write names as they appear in the picture.`
  const prompt = `This picture is an organization chart from the game "${series}": groups (schools, clubs, units, teams, factions …) and maybe the characters in them.
Return only JSON, no explanation:
${shape}
Rules:
- Top-level nodes are the outermost groups; "children" are the groups inside a group, as deep as the chart goes.
- Characters go only in "characters" of the group they belong to, never as groups.
- A group shown with two names (e.g. "A / B", or a translation) → "name" = one, "aliases" = the other.
${naming}
- Leave out anything that isn't a group or a character.`
  const j = (await visionJson(s, { data: jpeg, mime: 'image/jpeg' }, prompt, signal)) as { tree?: unknown }
  if (!Array.isArray(j.tree)) throw new Error('LLM이 조직도를 읽지 못했습니다')
  const read = (v: unknown): OrgImportNode | null => {
    const o = v as Partial<Record<keyof OrgImportNode, unknown>>
    const name = typeof o?.name === 'string' ? o.name.trim() : ''
    if (!name) return null
    const strs = (x: unknown): string[] => (Array.isArray(x) ? x.filter((y): y is string => typeof y === 'string').map((y) => y.trim()).filter(Boolean) : [])
    const str = (x: unknown): string | undefined => (typeof x === 'string' && x.trim() ? x.trim() : undefined)
    const people = (Array.isArray(o.characters) ? o.characters : [])
      .map((c: unknown) => (typeof c === 'string' ? { name: c.trim() } : { name: str((c as { name?: unknown })?.name) ?? '', match: str((c as { match?: unknown })?.match) }))
      .filter((c) => c.name)
    return {
      name,
      aliases: strs(o.aliases),
      ...(str(o.match) ? { match: str(o.match) } : {}),
      characters: people,
      children: (Array.isArray(o.children) ? o.children : []).map(read).filter((n): n is OrgImportNode => !!n)
    }
  }
  return tidy(j.tree.map(read).filter((n): n is OrgImportNode => !!n))
}

// Same-named siblings merged; a node's aliases never repeat its name.
export function tidy(list: OrgImportNode[]): OrgImportNode[] {
  const out: OrgImportNode[] = []
  for (const n of list) {
    const same = out.find((o) => o.name.toLowerCase() === n.name.toLowerCase())
    if (same) {
      same.aliases.push(...n.aliases)
      same.characters.push(...n.characters)
      same.children.push(...n.children)
    } else out.push({ ...n, aliases: [...n.aliases], characters: [...n.characters], children: [...n.children] })
  }
  for (const n of out) {
    n.aliases = [...new Set(n.aliases)].filter((a) => a.toLowerCase() !== n.name.toLowerCase())
    n.characters = n.characters.filter((c, i) => n.characters.findIndex((d) => d.name === c.name) === i)
    n.children = tidy(n.children)
  }
  return out
}
