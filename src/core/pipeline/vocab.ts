// Characters the installed taggers know (WD + PixAI + Camie tag lists), for
// the "직접 입력" autocomplete: a character never seen in the library (no
// image of them yet) can still be picked by name and is created on the spot.
import { parseCharacterTag } from './tags'
import { seriesOf } from './classify'

export interface VocabEntry {
  tag: string // danbooru tag, e.g. lux_(league_of_legends)
  name: string // Lux
  series: string // League of Legends
  hay: string // ' word word …' (lower-case tag words + name + game), searched by word start
  known: boolean // game known (Camie-only tags often have none)
}

export function buildVocab(tags: Iterable<string>, map?: Map<string, string>): VocabEntry[] {
  const out: VocabEntry[] = []
  for (const tag of tags) {
    const name = parseCharacterTag(tag).name
    const s = seriesOf(tag, map)
    const hay = ` ${tag} ${name} ${s.name}`.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')
    out.push({ tag, name, series: s.name, hay, known: s.tag !== null })
  }
  return out
}

// Every word of the query must start a word of the entry ("lux", "lux league";
// "럭스" won't — tags are English/romanized). Name-prefix matches first, then
// characters with a known game, then shorter tags.
export function searchVocab(vocab: VocabEntry[], q: string, skip: Set<string>, limit = 8): VocabEntry[] {
  const t = q.trim().toLowerCase()
  const words = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  if (!words.length) return []
  const rank = (e: VocabEntry): number => {
    const n = e.name.toLowerCase()
    if (n === t) return 0
    if (n.startsWith(t)) return 1
    if (n.split(/\s+/).some((w) => w.startsWith(words[0]))) return 2
    return 3
  }
  const hits: { e: VocabEntry; r: number }[] = []
  for (const e of vocab) {
    if (skip.has(e.tag) || !words.every((w) => e.hay.includes(` ${w}`))) continue
    hits.push({ e, r: rank(e) })
  }
  hits.sort((a, b) => a.r - b.r || Number(b.e.known) - Number(a.e.known) || a.e.tag.length - b.e.tag.length || a.e.tag.localeCompare(b.e.tag))
  return hits.slice(0, limit).map((h) => h.e)
}
