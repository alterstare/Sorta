// 가져오기 (CLAUDE.md §5.1): scan → sha256 → skip exact duplicates (or follow a
// moved file) → probe + thumbnail + pHash → mark near-duplicates. Read-only on
// the source files.
import { existsSync } from 'fs'
import { join } from 'path'
import type { Db } from '../db'
import type { JobContext } from '../queue'
import { scanImages, sha256File } from './scan'
import { gray32, probe, writeThumb } from './imageio'
import { hamming, phashFromGray32 } from './phash'

export interface ImportResult {
  scanned: number
  added: number
  moved: number // known file found at a new path → path updated
  skipped: number // exact duplicate of an existing image
  failed: { path: string; error: string }[]
}

export interface ImportOptions {
  sourceDirs: string[]
  exclude: string[] // e.g. the organize folder
  thumbsDir: string
  dupDistance?: number // pHash Hamming distance counted as near-duplicate
}

export async function importImages(db: Db, opts: ImportOptions, ctx: JobContext): Promise<ImportResult> {
  const res: ImportResult = { scanned: 0, added: 0, moved: 0, skipped: 0, failed: [] }
  ctx.report(0, 0, '이미지 찾는 중…')
  const files = await scanImages(opts.sourceDirs, opts.exclude, ctx.signal)
  res.scanned = files.length

  const byPath = db.prepare('SELECT id FROM images WHERE path = ?')
  const bySha = db.prepare('SELECT id, path FROM images WHERE sha256 = ?')
  const setPath = db.prepare('UPDATE images SET path = ? WHERE id = ?')
  const insert = db.prepare(
    `INSERT INTO images (path, sha256, phash, width, height, imported_at, thumbnail_path, error)
     VALUES (@path, @sha, @phash, @width, @height, @at, @thumb, @error)`
  )
  const allHashes = db.prepare('SELECT id, phash FROM images WHERE phash IS NOT NULL AND dup_of IS NULL').all() as {
    id: number
    phash: string
  }[]
  const setDup = db.prepare('UPDATE images SET dup_of = ? WHERE id = ?')
  const maxDist = opts.dupDistance ?? 6

  for (let i = 0; i < files.length; i++) {
    if (ctx.signal.aborted) break
    const path = files[i]
    ctx.report(i, files.length, '가져오는 중')
    if (byPath.get(path)) continue // already imported at this path
    try {
      const sha = await sha256File(path)
      const known = bySha.get(sha) as { id: number; path: string } | undefined
      if (known) {
        if (!existsSync(known.path)) {
          setPath.run(path, known.id)
          res.moved++
        } else res.skipped++
        continue
      }
      let width: number | null = null
      let height: number | null = null
      let phash: string | null = null
      let thumb: string | null = null
      let error: string | null = null
      try {
        ;({ width, height } = await probe(path))
        thumb = join(opts.thumbsDir, `${sha}.webp`)
        if (!existsSync(thumb)) await writeThumb(path, thumb)
        phash = phashFromGray32(await gray32(path))
      } catch (e) {
        error = `decode: ${String((e as Error)?.message ?? e)}`
        res.failed.push({ path, error })
      }
      const r = insert.run({ path, sha, phash, width, height, at: Date.now(), thumb, error })
      const id = Number(r.lastInsertRowid)
      res.added++
      if (phash) {
        const near = allHashes.find((h) => hamming(h.phash, phash!) <= maxDist)
        if (near) setDup.run(near.id, id)
        else allHashes.push({ id, phash })
      }
    } catch (e) {
      res.failed.push({ path, error: String((e as Error)?.message ?? e) })
    }
  }
  ctx.report(files.length, files.length, '가져오기 완료')
  return res
}
