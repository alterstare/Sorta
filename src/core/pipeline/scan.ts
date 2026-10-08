// Find image files under the source folders (recursive), skipping the
// organize folder so sorted files are never re-imported.
import { promises as fs } from 'fs'
import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { extname, join, resolve, sep } from 'path'

// Anything sharp/libvips can usually decode. Files that still fail to decode
// are reported, not fatal (CLAUDE.md §5.1).
export const IMAGE_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.jfif', '.webp', '.avif', '.gif', '.bmp', '.tif', '.tiff',
  '.heic', '.heif', '.jxl', '.svg'
])

export function isImageFile(p: string): boolean {
  return IMAGE_EXTS.has(extname(p).toLowerCase())
}

// Path comparison is case-insensitive on Windows only.
const norm = (p: string): string => (process.platform === 'win32' ? resolve(p).toLowerCase() : resolve(p))

export function isInside(child: string, parent: string): boolean {
  const c = norm(child)
  const p = norm(parent)
  return c === p || c.startsWith(p.endsWith(sep) ? p : p + sep)
}

export async function scanImages(dirs: string[], exclude: string[] = [], signal?: AbortSignal): Promise<string[]> {
  const out: string[] = []
  const seen = new Set<string>()
  const walk = async (dir: string): Promise<void> => {
    if (signal?.aborted) return
    if (exclude.some((e) => e && isInside(dir, e))) return
    let entries: import('fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable folder → skip
    }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) await walk(p)
      else if (e.isFile() && isImageFile(p)) {
        const k = norm(p)
        if (!seen.has(k)) {
          seen.add(k)
          out.push(resolve(p))
        }
      }
    }
  }
  for (const d of dirs) if (d) await walk(d)
  return out
}

export function sha256File(path: string): Promise<string> {
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('error', rej)
      .on('end', () => res(h.digest('hex')))
  })
}
