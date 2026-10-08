// 학습 루프 (CLAUDE.md §5.3–5.5, Phase 3): person crops → CCIP vectors →
// compare with reference vectors of learned characters (kNN).
//
// References come from two places:
//   • user-confirmed images (source 'user') — rebuilt from the decisions, so
//     undoing a confirmation also drops its reference;
//   • Safebooru pictures fetched when learning a character (source 'booru').
// Auto-confirmed images are never references (no error snowballing).
import type { Db } from '../db'
import type { JobContext } from '../queue'
import type { Box, Detector, Embedder, RgbImage } from '../ml/types'
import type { CharScore } from '../ml/assist'
import { crop, cosine } from '../ml/ccip'
import { applyTagResult } from './classify'
import type { DecideOptions, StoredTags } from './classify'
import { loadRgb } from './imageio'

export interface LearnModels {
  embedder: Embedder
  detector: Detector
}

const MAX_PEOPLE = 6
// A learned character needs this many reference pictures before a match alone
// may auto-confirm (fewer → review candidate only).
export const MIN_REFS_FOR_AUTO = 5

export interface CropVec {
  bbox: Box | null // null = whole image
  vec: Float32Array
}

// People in the picture (largest first), each embedded; no person → whole image.
export async function embedCrops(img: RgbImage, m: LearnModels): Promise<CropVec[]> {
  const people = (await m.detector.people(img)).sort((a, b) => b.w * b.h - a.w * a.h).slice(0, MAX_PEOPLE)
  if (!people.length) return [{ bbox: null, vec: await m.embedder.embed(img) }]
  const out: CropVec[] = []
  for (const b of people) out.push({ bbox: b, vec: await m.embedder.embed(await crop(img, b)) })
  return out
}

const toBlob = (v: Float32Array): Buffer => Buffer.from(v.buffer, v.byteOffset, v.byteLength)
const fromBlob = (b: Buffer): Float32Array => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))

function storeCrops(db: Db, imageId: number, crops: CropVec[]): void {
  db.transaction(() => {
    db.prepare('DELETE FROM embeddings WHERE image_id = ?').run(imageId)
    const ins = db.prepare('INSERT INTO embeddings (image_id, bbox, crop, vector) VALUES (?, ?, ?, ?)')
    for (const c of crops) ins.run(imageId, c.bbox ? JSON.stringify(c.bbox) : null, c.bbox ? 'person' : 'full', toBlob(c.vec))
    db.prepare('UPDATE images SET embedded_at = ? WHERE id = ?').run(Date.now(), imageId)
  })()
}

// Images that need vectors: confirmed by the user (→ references) or still
// open (pending / unknown) — the ones a learned character could settle.
export function imagesToEmbed(db: Db): { id: number; path: string }[] {
  return db
    .prepare(
      `SELECT i.id, i.path FROM images i
       WHERE i.embedded_at IS NULL AND i.thumbnail_path IS NOT NULL AND i.kind <> 'other' AND (
         EXISTS (SELECT 1 FROM image_characters ic WHERE ic.image_id = i.id AND (ic.source = 'user' OR ic.status IN ('pending','unknown')))
       )
       ORDER BY i.id`
    )
    .all() as { id: number; path: string }[]
}

export async function embedImages(
  db: Db,
  m: LearnModels,
  rows: { id: number; path: string }[],
  ctx: JobContext,
  load: (path: string) => Promise<RgbImage> = (p) => loadRgb(p)
): Promise<number> {
  let n = 0
  for (let i = 0; i < rows.length; i++) {
    if (ctx.signal.aborted) break
    ctx.report(i, rows.length, '그림 특징 계산')
    try {
      storeCrops(db, rows[i].id, await embedCrops(await load(rows[i].path), m))
      n++
    } catch (e) {
      db.prepare('UPDATE images SET error = ? WHERE id = ?').run(`embed: ${String((e as Error)?.message ?? e)}`, rows[i].id)
    }
  }
  return n
}

// ---- reference index ----

export interface RefIndex {
  chars: number[] // character id per reference
  vecs: Float32Array[]
}

export function loadRefs(db: Db): RefIndex {
  const rows = db.prepare('SELECT character_id, vector FROM refs').all() as { character_id: number; vector: Buffer }[]
  return { chars: rows.map((r) => r.character_id), vecs: rows.map((r) => fromBlob(r.vector)) }
}

// Similarity of one vector to each character: mean of its top-3 reference cosines.
export function scoreCharacters(v: Float32Array, idx: RefIndex): Map<number, number> {
  const per = new Map<number, number[]>()
  for (let i = 0; i < idx.vecs.length; i++) {
    const c = idx.chars[i]
    const arr = per.get(c) ?? []
    arr.push(cosine(v, idx.vecs[i]))
    per.set(c, arr)
  }
  const out = new Map<number, number>()
  for (const [c, arr] of per) {
    arr.sort((a, b) => b - a)
    const k = Math.min(3, arr.length)
    out.set(c, arr.slice(0, k).reduce((s, x) => s + x, 0) / k)
  }
  return out
}

// Rebuild the user references from the current confirmations: each confirmed
// character gets the crop that is its (one person / closest to its existing
// references); ambiguous multi-person cases are skipped.
export function refreshUserRefs(db: Db): number {
  const booru = loadRefs(db) // existing references guide multi-person assignment
  const images = db
    .prepare(
      `SELECT DISTINCT ic.image_id AS id FROM image_characters ic JOIN images i ON i.id = ic.image_id
       WHERE ic.source = 'user' AND ic.status = 'confirmed' AND i.embedded_at IS NOT NULL`
    )
    .all() as { id: number }[]
  const charsQ = db.prepare("SELECT character_id AS c FROM image_characters WHERE image_id = ? AND source = 'user' AND character_id IS NOT NULL")
  const cropsQ = db.prepare('SELECT bbox, vector FROM embeddings WHERE image_id = ?')
  const ins = db.prepare("INSERT OR REPLACE INTO refs (character_id, source, image_id, vector, created_at) VALUES (?, 'user', ?, ?, ?)")
  let n = 0
  db.transaction(() => {
    db.prepare("DELETE FROM refs WHERE source = 'user'").run()
    for (const { id } of images) {
      const chars = (charsQ.all(id) as { c: number }[]).map((r) => r.c)
      const crops = (cropsQ.all(id) as { bbox: string | null; vector: Buffer }[]).map((r) => ({
        area: r.bbox ? ((b: Box) => b.w * b.h)(JSON.parse(r.bbox) as Box) : Infinity,
        vec: fromBlob(r.vector)
      }))
      if (!chars.length || !crops.length) continue
      const used = new Set<number>()
      const assign = (c: number, k: number): void => {
        used.add(k)
        ins.run(c, id, toBlob(crops[k].vec), Date.now())
        n++
      }
      if (chars.length === 1) {
        // Closest crop to what we already know of the character, else the largest.
        const known = booru.chars.some((x) => x === chars[0])
        let k = 0
        if (known && crops.length > 1) {
          let best = -1
          crops.forEach((cr, i) => {
            const s = scoreCharacters(cr.vec, booru).get(chars[0]) ?? -1
            if (s > best) (best = s), (k = i)
          })
        } else crops.forEach((cr, i) => cr.area > crops[k].area && (k = i))
        assign(chars[0], k)
        continue
      }
      // Several characters: greedy by similarity to existing references.
      const pairs: { c: number; k: number; s: number }[] = []
      crops.forEach((cr, k) => {
        const sc = scoreCharacters(cr.vec, booru)
        for (const c of chars) {
          const s = sc.get(c)
          if (s !== undefined) pairs.push({ c, k, s })
        }
      })
      pairs.sort((a, b) => b.s - a.s)
      const done = new Set<number>()
      for (const p of pairs) if (!done.has(p.c) && !used.has(p.k)) done.add(p.c), assign(p.c, p.k)
      // One character and one crop left → they belong together.
      const restC = chars.filter((c) => !done.has(c))
      const restK = crops.map((_, k) => k).filter((k) => !used.has(k))
      if (restC.length === 1 && restK.length === 1) assign(restC[0], restK[0])
    }
  })()
  return n
}

// kNN over every embedded image that isn't decided by the user: per crop the
// best learned character (capped below knnAccept when the runner-up is too
// close), merged per image, stored in tag_json.knn and re-decided.
export function matchImages(db: Db, o: DecideOptions, ctx?: JobContext): number {
  const idx = loadRefs(db)
  const tagOf = new Map(
    (db.prepare('SELECT id, danbooru_tag AS t FROM characters').all() as { id: number; t: string | null }[]).map((r) => [
      r.id,
      r.t ?? `#${r.id}`
    ])
  )
  const rows = db
    .prepare(
      `SELECT i.id, i.tag_json FROM images i WHERE i.embedded_at IS NOT NULL AND i.tag_json IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM image_characters ic WHERE ic.image_id = i.id AND ic.source = 'user')`
    )
    .all() as { id: number; tag_json: string }[]
  const cropsQ = db.prepare('SELECT vector FROM embeddings WHERE image_id = ?')
  const refCount = new Map<number, number>()
  for (const c of idx.chars) refCount.set(c, (refCount.get(c) ?? 0) + 1)
  rows.forEach((r, i) => {
    if (ctx && i % 50 === 0) ctx.report(i, rows.length, '학습한 캐릭터와 비교')
    const st = JSON.parse(r.tag_json) as StoredTags
    const best = new Map<string, number>()
    if (idx.vecs.length) {
      for (const { vector } of cropsQ.all(r.id) as { vector: Buffer }[]) {
        const sc = [...scoreCharacters(fromBlob(vector), idx)].sort((a, b) => b[1] - a[1])
        sc.forEach(([c, s], rank) => {
          if (s < o.t.knnCandidate) return
          // Only the crop's clear winner may auto-confirm; a runner-up, or a
          // winner too close to it, stays a candidate.
          // …and only characters with enough references (one or two pictures
          // are too little to trust on their own).
          const capped = rank > 0 || s - (sc[1]?.[1] ?? 0) < o.t.knnMargin || (refCount.get(c) ?? 0) < MIN_REFS_FOR_AUTO
          const v = capped ? Math.min(s, o.t.knnAccept - 0.001) : s
          const key = tagOf.get(c) ?? `#${c}`
          best.set(key, Math.max(best.get(key) ?? 0, v))
        })
      }
    }
    const knn: CharScore[] = [...best].map(([tag, score]) => ({ tag, score })).sort((a, b) => b.score - a.score)
    if (JSON.stringify(knn) === JSON.stringify(st.knn ?? [])) return
    st.knn = knn.length ? knn : undefined
    applyTagResult(db, r.id, st, o)
  })
  ctx?.report(rows.length, rows.length, '학습한 캐릭터와 비교')
  return rows.length
}
