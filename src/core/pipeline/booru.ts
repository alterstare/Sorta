// 캐릭터 학습 from Danbooru (through the bypass tunnel, see booruNet.ts) or
// Safebooru (its all-ages mirror, reachable directly but rating:general only).
// Only character names are sent; the fetched pictures are embedded and
// dropped — just the vectors and post ids are kept.
import sharp from 'sharp'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { Db } from '../db'
import type { JobContext } from '../queue'
import type { RgbImage } from '../ml/types'
import { csvRow } from '../ml/csv'
import { embedCrops } from './knn'
import type { LearnModels } from './knn'
import { ensureCharacter } from './classify'
import { netGet } from './booruNet'

const UA = 'Sorta/0.1 (+https://github.com/alterstare/Sorta)'

export interface BooruSource {
  base: string
  tunnel: boolean // route through the SNI-bypass tunnel
  ratings: string // rating metatag for usable pictures
}

// Danbooru: all-ages + sensitive (swimsuits etc. are mostly "sensitive").
export const DANBOORU = (sensitive: boolean): BooruSource => ({
  base: 'https://danbooru.donmai.us',
  tunnel: true,
  ratings: sensitive ? 'rating:g,s' : 'rating:g'
})
// Safebooru serves rating:general only.
export const SAFEBOORU: BooruSource = { base: 'https://safebooru.donmai.us', tunnel: false, ratings: 'rating:g' }
// Danbooru asks for ~1 request/second for longer sessions (10/s is only a
// burst limit). Image downloads come from the CDN and aren't counted here.
const GAP_MS = 1000
// 429 (throttled) / 503: wait and retry, then give up on that request.
const RETRY_WAITS = [5000, 15000, 30000]

export interface BooruTag {
  name: string
  post_count: number
}

export interface LearnPlan {
  seriesTag: string
  learn: BooruTag[] // to fetch now
  known: number // a tagger already knows them
  learned: number // learned before
  tooFew: number // fewer solo pictures than needed
  // The same, by name (the 학습 screen lists them)
  knownTags: string[]
  learnedTags: string[]
  tooFewTags: BooruTag[] // post_count = usable pictures found (or total posts when pre-filtered)
}

let last = 0
const sleep = (ms: number, signal?: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => (clearTimeout(t), reject(new Error('cancelled'))), { once: true })
  })

async function getJson<T>(src: BooruSource, path: string, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = last + GAP_MS - Date.now()
    if (wait > 0) await sleep(wait, signal)
    last = Date.now()
    const res = await netGet(src.base + path, { 'User-Agent': UA }, src.tunnel, signal)
    if (res.ok) return (await res.json()) as T
    if ((res.status === 429 || res.status === 503) && attempt < RETRY_WAITS.length) {
      await sleep(RETRY_WAITS[attempt], signal)
      continue
    }
    throw new Error(`${new URL(src.base).hostname} ${res.status}${res.status === 429 ? ' (요청 과다)' : ''}`)
  }
}

// Is the source reachable? (Danbooru through the tunnel can fail on some networks.)
export async function reachable(src: BooruSource): Promise<boolean> {
  try {
    await getJson(src, '/counts/posts.json?tags=solo')
    return true
  } catch {
    return false
  }
}

const q = encodeURIComponent

// Character tag autocomplete.
export async function searchTags(src: BooruSource, text: string): Promise<BooruTag[]> {
  const t = text.trim().toLowerCase().replace(/\s+/g, '_')
  if (!t) return []
  return getJson<BooruTag[]>(
    src,
    `/tags.json?search[name_matches]=${q(`*${t}*`)}&search[category]=4&search[order]=count&limit=20&only=name,post_count`
  )
}

// Every character tag of a game: "*_(game)" tags plus the ones the game
// table assigns to it.
async function gameCharacters(
  src: BooruSource,
  seriesTag: string,
  seriesMap: Map<string, string>,
  signal?: AbortSignal
): Promise<BooruTag[]> {
  const out = new Map<string, number>()
  for (let page = 1; page <= 3; page++) {
    const rows = await getJson<BooruTag[]>(
      src,
      `/tags.json?search[name_matches]=${q(`*_(${seriesTag})`)}&search[category]=4&search[order]=count&limit=1000&page=${page}&only=name,post_count`,
      signal
    )
    for (const r of rows) out.set(r.name, r.post_count)
    if (rows.length < 1000) break
  }
  for (const [tag, ip] of seriesMap) if (ip === seriesTag && !out.has(tag)) out.set(tag, -1) // count unknown
  return [...out].map(([name, post_count]) => ({ name, post_count }))
}

// Character tags the installed taggers already know (no need to learn them).
export async function knownVocab(modelsDir: string, withPixai: boolean, withCamie: boolean): Promise<Set<string>> {
  const known = new Set<string>()
  const csv = async (file: string, iName: number, iCat: number): Promise<void> => {
    try {
      const lines = (await fs.readFile(join(modelsDir, file), 'utf8')).split(/\r?\n/).slice(1)
      for (const l of lines) {
        const c = csvRow(l)
        if (c[iCat] === '4') known.add(c[iName])
      }
    } catch {
      /* not installed */
    }
  }
  await csv('wd-swinv2-v3-tags.csv', 1, 2)
  if (withPixai) await csv('pixai-tags.csv', 2, 3)
  if (withCamie) {
    try {
      const m = JSON.parse(await fs.readFile(join(modelsDir, 'camie-meta.json'), 'utf8')).dataset_info.tag_mapping
      for (const [t, cat] of Object.entries(m.tag_to_category as Record<string, string>)) if (cat === 'character') known.add(t)
    } catch {
      /* not installed */
    }
  }
  return known
}

// Pictures we can actually use: solo AND all-ages. A tag's post_count counts
// every rating, but Safebooru only serves rating:general — a swimsuit outfit
// with 900 posts may have a single usable one.
const usable = (src: BooruSource, tag: string): string => `${tag} solo ${src.ratings}`

export async function usableCount(src: BooruSource, tag: string, signal?: AbortSignal): Promise<number> {
  const r = await getJson<{ counts: { posts: number } }>(src, `/counts/posts.json?tags=${q(usable(src, tag))}`, signal)
  return r.counts?.posts ?? 0
}

export async function planGame(
  src: BooruSource,
  db: Db,
  seriesTag: string,
  known: Set<string>,
  ignored: string[],
  seriesMap: Map<string, string>,
  minPosts: number,
  ctx?: { signal?: AbortSignal; report?: (done: number, total: number, label?: string) => void }
): Promise<LearnPlan> {
  const learnedTags = new Set((db.prepare('SELECT tag FROM learned').all() as { tag: string }[]).map((r) => r.tag))
  const plan: LearnPlan = { seriesTag, learn: [], known: 0, learned: 0, tooFew: 0, knownTags: [], learnedTags: [], tooFewTags: [] }
  const todo: BooruTag[] = []
  for (const t of await gameCharacters(src, seriesTag, seriesMap, ctx?.signal)) {
    if (ignored.includes(t.name)) continue
    if (known.has(t.name)) (plan.known++, plan.knownTags.push(t.name))
    else if (learnedTags.has(t.name)) (plan.learned++, plan.learnedTags.push(t.name))
    // Cheap pre-filter: fewer posts in total than needed can't have enough usable ones.
    else if (t.post_count >= 0 && t.post_count < minPosts) (plan.tooFew++, plan.tooFewTags.push(t))
    else todo.push(t)
  }
  // The real check: how many usable (solo, all-ages) pictures each one has.
  for (let i = 0; i < todo.length; i++) {
    if (ctx?.signal?.aborted) break
    ctx?.report?.(i, todo.length, `그림 수 확인 · ${todo[i].name}`)
    const n = await usableCount(src, todo[i].name, ctx?.signal)
    if (n < minPosts) (plan.tooFew++, plan.tooFewTags.push({ name: todo[i].name, post_count: n }))
    else plan.learn.push({ name: todo[i].name, post_count: n })
  }
  plan.learn.sort((a, b) => b.post_count - a.post_count)
  plan.tooFewTags.sort((a, b) => b.post_count - a.post_count)
  plan.knownTags.sort()
  plan.learnedTags.sort()
  return plan
}

async function decode(buf: Buffer): Promise<RgbImage> {
  const { data, info } = await sharp(buf, { pages: 1, failOn: 'none' })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) }
}

interface Post {
  id: number
  media_asset?: { variants?: { type: string; url: string }[] }
}

// Fetch up to `perCharacter` solo pictures of each tag, embed the main person,
// store them as references. Re-learning a tag adds only posts not seen yet.
export async function learnTags(
  src: BooruSource,
  db: Db,
  tags: string[],
  m: LearnModels,
  seriesMap: Map<string, string>,
  perCharacter: number,
  minRefs: number,
  ctx: JobContext
): Promise<{ characters: number; refs: number; skipped: string[]; failed: string[] }> {
  let refs = 0
  let chars = 0
  const skipped: string[] = []
  const failed: string[] = [] // network / throttling errors (try again later)
  const ins = db.prepare(
    "INSERT OR IGNORE INTO refs (character_id, source, post_id, vector, created_at) VALUES (?, 'booru', ?, ?, ?)"
  )
  for (let i = 0; i < tags.length; i++) {
    if (ctx.signal.aborted) break
    const tag = tags[i]
    ctx.report(i, tags.length, `캐릭터 학습 · ${tag}`)
    const id = ensureCharacter(db, tag, seriesMap)
    // rating:general in the query itself — otherwise Safebooru drops the
    // non-general posts from each page AFTER paging and we get only a few.
    let posts: Post[]
    try {
      posts = await getJson<Post[]>(src, `/posts.json?tags=${q(usable(src, tag))}&limit=${perCharacter}&only=id,media_asset`, ctx.signal)
    } catch (e) {
      if (ctx.signal.aborted) break
      failed.push(`${tag}: ${(e as Error).message}`)
      continue
    }
    let n = 0
    for (const p of posts) {
      if (ctx.signal.aborted) break
      const v = p.media_asset?.variants
      const url = (v?.find((x) => x.type === '720x720') ?? v?.find((x) => x.type === 'sample') ?? v?.find((x) => x.type === '360x360'))?.url
      if (!url) continue
      try {
        // The image CDN is usually reachable directly; fall back to the tunnel.
        let res = await netGet(url, { 'User-Agent': UA }, false, ctx.signal).catch(() => null)
        if (!res?.ok && src.tunnel) res = await netGet(url, { 'User-Agent': UA }, true, ctx.signal)
        if (!res?.ok) continue
        const crops = await embedCrops(await decode(await res.bytes()), m)
        // Solo pictures: the largest person (first) is the character.
        const vec = crops[0].vec
        if (ins.run(id, p.id, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength), Date.now()).changes) n++
      } catch {
        /* one bad picture doesn't stop the character */
      }
    }
    const total = (db.prepare("SELECT COUNT(*) AS n FROM refs WHERE character_id = ? AND source = 'booru'").get(id) as { n: number }).n
    // Too few usable pictures → not learned (its few references are dropped).
    if (total < minRefs) {
      db.prepare("DELETE FROM refs WHERE character_id = ? AND source = 'booru'").run(id)
      skipped.push(tag)
      continue
    }
    {
      db.prepare('INSERT OR REPLACE INTO learned (character_id, tag, refs, learned_at) VALUES (?, ?, ?, ?)').run(id, tag, total, Date.now())
      chars++
      refs += n
    }
  }
  ctx.report(tags.length, tags.length, '캐릭터 학습 완료')
  return { characters: chars, refs, skipped, failed }
}
