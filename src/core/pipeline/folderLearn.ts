// 직접 학습: teach a character from a folder of the user's own pictures of it
// (already sorted by hand). Like learning from Danbooru, only the features are
// kept — the pictures are not imported, moved or copied. The references are
// stored with the booru ones (source 'booru', negative post id from the file's
// sha256 like the ones shared through a pack), so they count as learned data:
// listed under 학습한 캐릭터, exported with it, dropped by 지우기.
import { basename } from 'path'
import type { Db } from '../db'
import type { JobContext } from '../queue'
import type { LearnModels, RefIndex } from './knn'
import { embedCrops, scoreCharacters } from './knn'
import { loadRgb } from './imageio'
import { scanImages, sha256File } from './scan'

export interface FolderLearnResult {
  added: number // new references
  known: number // pictures learned before (same file content)
  failed: number // unreadable pictures
  total: number // references of the character now
}

// Same space as pack.ts' shared references: negative, so never a real post id.
const fileId = (sha: string): number => -(parseInt(sha.slice(0, 12), 16) % 2147483647) - 1

const fromBlob = (b: Buffer): Float32Array => new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))

export async function learnFolder(db: Db, characterId: number, dir: string, m: LearnModels, ctx: JobContext): Promise<FolderLearnResult> {
  const ch = db.prepare('SELECT name, danbooru_tag AS tag FROM characters WHERE id = ?').get(characterId) as
    | { name: string; tag: string | null }
    | undefined
  if (!ch) throw new Error('캐릭터가 없습니다')
  ctx.report(0, 0, `직접 학습 · ${ch.name}`)
  ctx.step?.('폴더에서 그림 찾는 중')
  const files = await scanImages([dir], [], ctx.signal)
  if (!files.length) throw new Error('폴더에 그림이 없습니다')

  // The character's references so far: in a picture with several people, the
  // one most like them is the character (no references yet → the largest).
  const rows = db.prepare('SELECT vector FROM refs WHERE character_id = ?').all(characterId) as { vector: Buffer }[]
  const idx: RefIndex = { chars: rows.map(() => characterId), vecs: rows.map((r) => fromBlob(r.vector)) }
  const has = db.prepare("SELECT 1 FROM refs WHERE source = 'booru' AND character_id = ? AND post_id = ?")
  const ins = db.prepare("INSERT OR IGNORE INTO refs (character_id, source, post_id, vector, created_at) VALUES (?, 'booru', ?, ?, ?)")
  const res: FolderLearnResult = { added: 0, known: 0, failed: 0, total: 0 }
  for (let i = 0; i < files.length; i++) {
    if (ctx.signal.aborted) break
    ctx.report(i, files.length, `직접 학습 · ${ch.name}`)
    ctx.step?.(`특징 뽑는 중 · ${basename(files[i])}`)
    try {
      const id = fileId(await sha256File(files[i]))
      if (has.get(characterId, id)) {
        res.known++
        continue
      }
      const crops = await embedCrops(await loadRgb(files[i]), m)
      let vec = crops[0].vec
      if (crops.length > 1 && idx.vecs.length) {
        let best = -Infinity
        for (const c of crops) {
          const s = scoreCharacters(c.vec, idx).get(characterId) ?? -Infinity
          if (s > best) (best = s), (vec = c.vec)
        }
      }
      if (ins.run(characterId, id, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength), Date.now()).changes) {
        res.added++
        idx.chars.push(characterId)
        idx.vecs.push(vec)
      }
    } catch {
      res.failed++ // one bad picture doesn't stop the folder
    }
  }
  res.total = (db.prepare("SELECT COUNT(*) AS n FROM refs WHERE character_id = ? AND source = 'booru'").get(characterId) as { n: number }).n
  if (res.total > 0) {
    // Keep the Danbooru tag of a character learned there before; '' = learned
    // only from folders (no 다시 학습 from a site).
    const prev = db.prepare('SELECT tag FROM learned WHERE character_id = ?').get(characterId) as { tag: string } | undefined
    db.prepare('INSERT OR REPLACE INTO learned (character_id, tag, refs, learned_at) VALUES (?, ?, ?, ?)').run(
      characterId,
      prev?.tag || ch.tag || '',
      res.total,
      Date.now()
    )
  }
  ctx.report(files.length, files.length, `직접 학습 · ${ch.name}`)
  return res
}
