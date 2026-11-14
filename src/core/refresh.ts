// 라이브러리 갱신: pictures whose file is gone leave the library. Run after an
// import (which follows files moved inside the source folders by sha256);
// files moved inside the organize folder (never imported) are followed here
// the same way first. A file counts as gone only where its folder is there to
// look in — a registered folder that's missing, or a drive / NAS share that
// isn't connected, keeps its pictures. One listing of the folders instead of
// asking for every picture (on a NAS each ask is a round trip: 2,600 pictures
// took 6 s, the listing 0.5 s); only files the listing lacks are asked again.
import { existsSync } from 'fs'
import { join, parse } from 'path'
import type { Db } from './db'
import type { JobContext } from './queue'
import { isInside, normPath, scanImages, sha256File } from './pipeline/scan'
import { DELETED_DIR, trashImages } from './trash'
import { LIB_DIR } from './libfile'

export interface RefreshResult {
  relinked: number // found again at a new path inside the organize folder
  removed: number // file gone → out of the library
  kept: number // file not found but its folder / drive isn't reachable
}

export async function pruneMissing(
  db: Db,
  o: { roots: string[]; organizeDir: string; thumbsDir: string },
  ctx: JobContext
): Promise<RefreshResult> {
  const res: RefreshResult = { relinked: 0, removed: 0, kept: 0 }
  ctx.report(0, 0, '없어진 파일 찾는 중…')
  const roots = o.roots.filter(Boolean)
  const reachable = (p: string): boolean => {
    const root = roots.find((r) => isInside(p, r))
    return existsSync(root ?? parse(p).root)
  }
  const rows = db.prepare('SELECT id, path, sha256 AS sha FROM images').all() as { id: number; path: string; sha: string }[]
  const listing = await scanImages(roots.filter((r) => existsSync(r)), [], ctx.signal)
  if (ctx.signal.aborted) return res
  const listed = new Set(listing.map(normPath))
  // not in the listing (or outside every folder) → ask that one file
  let missing = rows.filter((r) => !listed.has(normPath(r.path)) && !existsSync(r.path))
  if (!missing.length) return res

  // Moved inside the organize folder: unknown files there, matched by sha256.
  if (o.organizeDir && existsSync(o.organizeDir)) {
    const known = new Set(rows.map((r) => normPath(r.path)))
    const skip = [join(o.organizeDir, LIB_DIR), join(o.organizeDir, DELETED_DIR)]
    const files = listing.filter((f) => isInside(f, o.organizeDir) && !skip.some((d) => isInside(f, d)) && !known.has(normPath(f)))
    const bySha = new Map<string, { id: number; path: string; sha: string }[]>()
    for (const m of missing) bySha.set(m.sha, [...(bySha.get(m.sha) ?? []), m])
    const setPath = db.prepare('UPDATE images SET path = ? WHERE id = ?')
    for (let i = 0; i < files.length && bySha.size; i++) {
      if (ctx.signal.aborted) return res
      ctx.report(i, files.length, '옮긴 파일 찾는 중')
      let sha: string
      try {
        sha = await sha256File(files[i])
      } catch {
        continue
      }
      const m = bySha.get(sha)?.shift()
      if (!m) continue
      setPath.run(files[i], m.id)
      res.relinked++
      missing = missing.filter((x) => x.id !== m.id)
    }
  }

  const gone = missing.filter((m) => reachable(m.path))
  res.kept = missing.length - gone.length
  res.removed = (await trashImages(db, gone.map((m) => m.id), async () => {}, o.thumbsDir)).trashed
  return res
}
