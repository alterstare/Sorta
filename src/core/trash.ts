// 삭제: the user's own choice to throw pictures away. The file goes to the OS
// recycle bin (restorable from there — the caller passes the platform's
// trash function, core has no Electron), and the picture leaves the library
// with everything derived from it (rows cascade, its thumbnail goes). Not an
// undo step: bring a file back from the recycle bin and import again.
//
// A NAS has no Windows recycle bin (a network file would be gone for good),
// so pictures on a network path — and everything deleted from Sorta 모바일 —
// are moved into <정리 폴더>/삭제됨 instead (same sub-folders as before).
import { existsSync, rmSync } from 'fs'
import { basename, join, relative } from 'path'
import type { Db } from './db'
import { isInside } from './pipeline/scan'
import { moveFile, uniqueTarget } from './organize'

export type TrashFn = (path: string) => Promise<void>

export const DELETED_DIR = '삭제됨'

export const isNetworkPath = (p: string): boolean => /^[\\/]{2}[^\\/]/.test(p)

// Move into <organizeDir>/삭제됨, keeping the path below the organize folder.
export function deletedFolder(organizeDir: string): TrashFn {
  const claimed = new Set<string>()
  return async (p) => {
    const rel = isInside(p, organizeDir) ? relative(organizeDir, p) : basename(p)
    const parts = rel.split(/[\\/]/)
    const dir = join(organizeDir, DELETED_DIR, ...parts.slice(0, -1))
    await moveFile(p, uniqueTarget(dir, parts[parts.length - 1], claimed))
  }
}

// The OS recycle bin, or 삭제됨 for network files / when `always`.
export function trashFor(organizeDir: string, osTrash: TrashFn, always = false): TrashFn {
  const folder = organizeDir ? deletedFolder(organizeDir) : null
  return (p) => (folder && (always || isNetworkPath(p)) ? folder(p) : osTrash(p))
}

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
