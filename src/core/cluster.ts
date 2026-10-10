// 미확인 묶음 (CLAUDE.md §5.6): group unknown images whose main person looks
// alike (CCIP vectors), so one name can settle a whole group. Linkage: two
// images join when their similarity ≥ `minSimilarity`; groups are connected
// components (DBSCAN with min 2 points, in effect).
import type { Db } from './db'
import type { Rating, UnknownCluster } from '../shared/types'
import { cosine } from './ml/ccip'

const fromBlob = (b: Buffer): Float32Array => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))

export function unknownClusters(db: Db, minSimilarity: number): { clusters: UnknownCluster[]; loose: number; notEmbedded: number } {
  // Unknown = classified, not 캐릭터 아님, nothing sorted or in review.
  const imgs = db
    .prepare(
      `SELECT i.id, i.path, i.thumbnail_path AS thumb, i.rating, i.embedded_at FROM images i
       WHERE i.classified_at IS NOT NULL AND i.kind <> 'other' AND i.group_only = 0 AND i.set_aside = 0
         AND NOT EXISTS (SELECT 1 FROM image_characters ic WHERE ic.image_id = i.id AND ic.status IN ('auto','confirmed','pending'))
       ORDER BY i.id`
    )
    .all() as { id: number; path: string; thumb: string | null; rating: Rating; embedded_at: number | null }[]
  const firstVec = db.prepare('SELECT vector FROM embeddings WHERE image_id = ? ORDER BY id LIMIT 1') // largest person first
  const items: { id: number; path: string; thumb: string | null; rating: Rating; v: Float32Array }[] = []
  let notEmbedded = 0
  for (const i of imgs) {
    const r = firstVec.get(i.id) as { vector: Buffer } | undefined
    if (!r) notEmbedded++
    else items.push({ id: i.id, path: i.path, thumb: i.thumb, rating: i.rating, v: fromBlob(r.vector) })
  }
  // Union-find over pairs above the threshold.
  const parent = items.map((_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const best = new Float32Array(items.length) // strongest link, to order groups
  for (let a = 0; a < items.length; a++) {
    for (let b = a + 1; b < items.length; b++) {
      const s = cosine(items[a].v, items[b].v)
      if (s >= minSimilarity) {
        parent[find(a)] = find(b)
        best[a] = Math.max(best[a], s)
        best[b] = Math.max(best[b], s)
      }
    }
  }
  const groups = new Map<number, number[]>()
  items.forEach((_, i) => {
    const r = find(i)
    groups.set(r, [...(groups.get(r) ?? []), i])
  })
  const clusters: UnknownCluster[] = []
  let loose = 0
  for (const members of groups.values()) {
    if (members.length < 2) {
      loose++
      continue
    }
    clusters.push({
      key: members.map((m) => items[m].id).join(','),
      images: members.map((m) => ({ id: items[m].id, path: items[m].path, thumb: items[m].thumb, rating: items[m].rating })),
      similarity: Math.min(...members.map((m) => best[m]))
    })
  }
  clusters.sort((a, b) => b.images.length - a.images.length)
  return { clusters, loose, notEmbedded }
}
