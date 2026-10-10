// 삭제: the user's own choice to throw pictures away. The file goes to the OS
// recycle bin (restorable from there — the caller passes the platform's
// trash function, core has no Electron), and the picture leaves the library
// with everything derived from it (rows cascade, its thumbnail goes). Not an
// undo step: bring a file back from the recycle bin and import again.
import { existsSync, rmSync } from 'fs'
import { basename } from 'path'
import type { Db } from './db'
import { isInside } from './pipeline/scan'

export type TrashFn = (path: string) => Promise<void>

export async function trashImages(
  db: Db,
  ids: number[],
  trash: TrashFn,
  thumbsDir: string
): Promise<{ trashed: number; failed: string[] }> {
  const get = db.prepare('SELECT path, thumbnail_path FROM images WHERE id = ?')
  const del = db.prepare('DELETE FROM images WHERE id = ?')
  let trashed = 0
  const failed: string[] = []
  for (const id of ids) {
    const r = get.get(id) as { path: string; thumbnail_path: string | null } | undefined
    if (!r) continue
    try {
      if (existsSync(r.path)) await trash(r.path)
      del.run(id)
      if (r.thumbnail_path && thumbsDir && isInside(r.thumbnail_path, thumbsDir)) rmSync(r.thumbnail_path, { force: true })
      trashed++
    } catch (e) {
      failed.push(`${basename(r.path)}: ${String((e as Error).message ?? e)}`)
    }
  }
  return { trashed, failed }
}
