// 캐릭터 학습 from Danbooru (through the bypass tunnel, see booruNet.ts),
// Gelbooru (tunnel too; its API needs the user's API key) or Safebooru
// (Danbooru's all-ages mirror, reachable directly but rating:general only).
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
import { ChallengeError, netGet } from './booruNet'

const UA = 'Sorta/0.1 (+https://github.com/alterstare/Sorta)'

export interface BooruSource {
  api: 'danbooru' | 'gelbooru' // Safebooru speaks Danbooru's API
  base: string
  tunnel: boolean // route through the SNI-bypass tunnel
  // Rating metatags for usable pictures, tried in order: the next (wider) one
  // only for a character with too few pictures in the one before ('' = any).
  ratings: string[]
  auth?: string // Gelbooru: &api_key=…&user_id=…
  referer?: string // sent with picture downloads
}

// Danbooru: all-ages + sensitive (swimsuits etc. are mostly "sensitive"),
// then questionable, then explicit for characters short of pictures.
export const DANBOORU = (sensitive: boolean): BooruSource => ({
  api: 'danbooru',
  base: 'https://danbooru.donmai.us',
  tunnel: true,
  ratings: [...(sensitive ? [] : ['rating:g']), 'rating:g,s', 'rating:g,s,q', '']
})
// Safebooru serves rating:general only.
export const SAFEBOORU: BooruSource = { api: 'danbooru', base: 'https://safebooru.donmai.us', tunnel: false, ratings: ['rating:g'] }
// Gelbooru: SNI-blocked here like Danbooru; its API answers 401 without a key
// (free account → 계정 설정 › API Access Credentials). Its "or" syntax
// ({a ~ b}, ~a ~b) finds nothing next to other tags, so general + sensitive
// is written as "not questionable / explicit".
export const GELBOORU = (sensitive: boolean, userId: string, apiKey: string): BooruSource => ({
  api: 'gelbooru',
  base: 'https://gelbooru.com',
  tunnel: true,
  ratings: [...(sensitive ? [] : ['rating:general']), '-rating:questionable -rating:explicit', '-rating:explicit', ''],
  auth: `&api_key=${encodeURIComponent(apiKey)}&user_id=${encodeURIComponent(userId)}`,
  // Its image servers answer a request from outside the site (no Referer)
  // with an "Image View" HTML page instead of the picture (hotlink block).
  referer: 'https://gelbooru.com/'
})
// The rating steps above in words (progress messages).
const RATING_NAMES: Record<string, string> = {
  'rating:g': '일반',
  'rating:general': '일반',
  'rating:g,s': '일반 · 민감',
  '-rating:questionable -rating:explicit': '일반 · 민감',
  'rating:g,s,q': 'R-18(questionable)까지',
  '-rating:explicit': 'R-18(questionable)까지',
  '': '모든 등급(explicit 포함)'
}
const ratingName = (r: string): string => RATING_NAMES[r] ?? r

// Progress inside a job: done / total and the current step.
type Progress = Pick<JobContext, 'report' | 'step'> & { signal?: AbortSignal }

// Gelbooru's one API endpoint (s = post / tag). JSON answers carry an
// "@attributes" header ({limit, offset, count}) and the rows, missing when none.
const gel = (src: BooruSource, params: string): string => `/index.php?page=dapi&q=index&json=1&${params}${src.auth ?? ''}`
interface GelTag {
  name: string
  count: number
  type: number | string // 4 = character
}
// Gelbooru sends tag names HTML-escaped (kal&#039;tsit_(arknights)).
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeHtml = (t: string): string =>
  t.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e.toLowerCase()] ?? m)
  )
const gelCharacters = (rows: GelTag[] | undefined): BooruTag[] =>
  (rows ?? []).filter((r) => Number(r.type) === 4).map((r) => ({ name: unescapeHtml(r.name), post_count: Number(r.count) }))

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

async function getJson<T>(src: BooruSource, path: string, signal?: AbortSignal, retryWaits = RETRY_WAITS): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = last + GAP_MS - Date.now()
    if (wait > 0) await sleep(wait, signal)
    last = Date.now()
    const res = await netGet(src.base + path, { 'User-Agent': UA }, src.tunnel, signal)
    if (res.ok) return (await res.json()) as T
    if ((res.status === 429 || res.status === 503) && attempt < retryWaits.length) {
      await sleep(retryWaits[attempt], signal)
      continue
    }
    const why = res.status === 429 ? ' (요청 과다)' : res.status === 503 ? ' (사이트 점검 · 장애, 잠시 뒤 다시 시도)' : ''
    throw new Error(`${new URL(src.base).hostname} ${res.status}${why}`)
  }
}

// Is the source reachable? (Danbooru through the tunnel can fail on some networks.)
// No waiting on 503: Danbooru down for maintenance ("Downbooru") answers 503
// too, and the retries held the Safebooru fallback back for ~50 s.
export async function reachable(src: BooruSource): Promise<boolean> {
  try {
    await getJson(src, src.api === 'gelbooru' ? gel(src, 's=post&limit=0&tags=solo') : '/counts/posts.json?tags=solo', undefined, [])
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
  if (src.api === 'gelbooru') {
    const r = await getJson<{ tag?: GelTag[] }>(src, gel(src, `s=tag&name_pattern=${q(`%${t}%`)}&orderby=count&order=DESC&limit=100`))
    return gelCharacters(r.tag).slice(0, 20)
  }
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
  signal?: AbortSignal,
  step?: Progress['step']
): Promise<BooruTag[]> {
  const out = new Map<string, number>()
  for (let page = 1; page <= 3; page++) {
    step?.(`캐릭터 목록 받는 중 · ${page}쪽${out.size ? ` (지금까지 ${out.size}명)` : ''}`)
    if (src.api === 'gelbooru') {
      // No category filter in the query: rows are all tags, characters picked after.
      const r = await getJson<{ tag?: GelTag[] }>(
        src,
        gel(src, `s=tag&name_pattern=${q(`%_(${seriesTag})`)}&orderby=count&order=DESC&limit=1000&pid=${page - 1}`),
        signal
      )
      for (const c of gelCharacters(r.tag)) out.set(c.name, c.post_count)
      if ((r.tag?.length ?? 0) < 1000) break
      continue
    }
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

// Pictures we can actually use: solo, in the given ratings. A tag's post_count
// counts every rating, but Safebooru only serves rating:general — a swimsuit
// outfit with 900 posts may have a single usable one.
const usable = (tag: string, ratings: string): string => `${tag} solo ${ratings}`.trim()

async function countAt(src: BooruSource, tag: string, ratings: string, signal?: AbortSignal): Promise<number> {
  if (src.api === 'gelbooru') {
    const g = await getJson<{ '@attributes'?: { count: number } }>(src, gel(src, `s=post&limit=0&tags=${q(usable(tag, ratings))}`), signal)
    return Number(g['@attributes']?.count ?? 0)
  }
  const r = await getJson<{ counts: { posts: number } }>(src, `/counts/posts.json?tags=${q(usable(tag, ratings))}`, signal)
  return r.counts?.posts ?? 0
}

// Usable pictures in the narrowest ratings that have at least `enough`
// (or in the widest, when none does).
export async function usableCount(src: BooruSource, tag: string, enough: number, signal?: AbortSignal, step?: Progress['step']): Promise<number> {
  let n = 0
  for (let i = 0; i < src.ratings.length; i++) {
    if (i > 0) step?.(`${n}장뿐이라 ${ratingName(src.ratings[i])} 넓혀서 확인 중`)
    n = await countAt(src, tag, src.ratings[i], signal)
    if (n >= enough) break
  }
  return n
}

export async function planGame(
  src: BooruSource,
  db: Db,
  seriesTag: string,
  known: Set<string>,
  ignored: string[],
  seriesMap: Map<string, string>,
  minPosts: number,
  ctx?: Partial<Progress>
): Promise<LearnPlan> {
  const learnedTags = new Set((db.prepare('SELECT tag FROM learned').all() as { tag: string }[]).map((r) => r.tag))
  const plan: LearnPlan = { seriesTag, learn: [], known: 0, learned: 0, tooFew: 0, knownTags: [], learnedTags: [], tooFewTags: [] }
  const todo: BooruTag[] = []
  ctx?.report?.(0, 0, `학습할 캐릭터 확인 · ${seriesTag}`)
  for (const t of await gameCharacters(src, seriesTag, seriesMap, ctx?.signal, ctx?.step)) {
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
    const n = await usableCount(src, todo[i].name, minPosts, ctx?.signal, ctx?.step)
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

// A post's picture at a size worth embedding (~720 px; the full file only when
// there's nothing smaller — it's downscaled anyway).
interface Post {
  id: number
  url?: string
}

async function fetchPosts(src: BooruSource, tag: string, ratings: string, limit: number, signal?: AbortSignal): Promise<Post[]> {
  if (src.api === 'gelbooru') {
    // limit is capped at 100 there
    const r = await getJson<{ post?: { id: number; sample_url?: string; file_url?: string }[] }>(
      src,
      gel(src, `s=post&limit=${Math.min(limit, 100)}&tags=${q(usable(tag, ratings))}`),
      signal
    )
    return (r.post ?? []).map((p) => ({ id: p.id, url: p.sample_url || p.file_url || undefined }))
  }
  const rows = await getJson<{ id: number; media_asset?: { variants?: { type: string; url: string }[] } }[]>(
    src,
    `/posts.json?tags=${q(usable(tag, ratings))}&limit=${limit}&only=id,media_asset`,
    signal
  )
  return rows.map((p) => {
    const v = p.media_asset?.variants
    return { id: p.id, url: (v?.find((x) => x.type === '720x720') ?? v?.find((x) => x.type === 'sample') ?? v?.find((x) => x.type === '360x360'))?.url }
  })
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
    ctx.step?.(`그림 목록 받는 중 (${ratingName(src.ratings[0])})`)
    const id = ensureCharacter(db, tag, seriesMap)
    // rating:general in the query itself — otherwise Safebooru drops the
    // non-general posts from each page AFTER paging and we get only a few.
    // Too few in those ratings → the next, wider ones (R-18 only when needed).
    let posts: Post[] = []
    try {
      for (let k = 0; k < src.ratings.length; k++) {
        if (k > 0) ctx.step?.(`그림이 ${posts.length}장뿐이라 ${ratingName(src.ratings[k])} 넓혀서 찾는 중`)
        posts = await fetchPosts(src, tag, src.ratings[k], perCharacter, ctx.signal)
        if (posts.length >= Math.min(minRefs, perCharacter)) break
      }
    } catch (e) {
      if (ctx.signal.aborted) break
      if (e instanceof ChallengeError) throw e
      failed.push(`${tag}: ${(e as Error).message}`)
      continue
    }
    let n = 0
    let unfetched = 0 // pictures there but not downloaded (network, or not an image)
    for (let j = 0; j < posts.length; j++) {
      const p = posts[j]
      if (ctx.signal.aborted) break
      ctx.step?.(`그림 받아서 특징 뽑는 중${unfetched ? ` · 실패 ${unfetched}장` : ''}`, j, posts.length)
      const url = p.url
      if (!url) continue
      try {
        // The image CDN is usually reachable directly; fall back to the tunnel.
        const headers: Record<string, string> = { 'User-Agent': UA, ...(src.referer ? { Referer: src.referer } : {}) }
        let res = await netGet(url, headers, false, ctx.signal).catch(() => null)
        if (!res?.ok && src.tunnel) res = await netGet(url, headers, true, ctx.signal)
        if (!res?.ok) {
          unfetched++
          continue
        }
        const crops = await embedCrops(await decode(await res.bytes()), m)
        // Solo pictures: the largest person (first) is the character.
        const vec = crops[0].vec
        if (ins.run(id, p.id, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength), Date.now()).changes) n++
      } catch {
        unfetched++ // one bad picture doesn't stop the character
      }
    }
    const total = (db.prepare("SELECT COUNT(*) AS n FROM refs WHERE character_id = ? AND source = 'booru'").get(id) as { n: number }).n
    // Too few usable pictures → not learned (its few references are dropped).
    if (total < minRefs) {
      db.prepare("DELETE FROM refs WHERE character_id = ? AND source = 'booru'").run(id)
      // Enough pictures listed but they didn't come down: a download problem,
      // not "too few pictures" (tried again on the next 학습).
      if (posts.length >= minRefs && unfetched > 0) failed.push(`${tag}: 그림 ${unfetched}장을 받지 못했습니다`)
      else skipped.push(tag)
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
