// 중복 정리: near-identical pictures (perceptual hash within a distance)
// grouped so the user keeps one and sets the others aside. "Setting aside"
// moves the original into <정리 폴더>/중복 (never deletes) and hides it from
// the library; Ctrl+Z moves it back. "중복 아님" remembers a group as distinct.
import { existsSync } from 'fs'
import { basename, join } from 'path'
import type { Db } from './db'
import type { ActionLog } from './actionLog'
import type { DupGroup, Rating } from '../shared/types'
import { moveFile, uniqueTarget } from './organize'

export const DUP_DIR = '중복'
export const DUP_ACTION = 'dup.edit'

// 64-bit hex hash → two 32-bit halves; distance = popcount of the XOR.
const pop = (x: number): number => {
  x = x - ((x >>> 1) & 0x55555555)
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}
const halves = (h: string): [number, number] => [parseInt(h.slice(0, 8), 16) >>> 0, parseInt(h.slice(8, 16), 16) >>> 0]

// 64×64 grayscale of an image's thumbnail (or the original) for the detail
// check; null when it can't be read.
export type GrayLoader = (id: number, file: string) => Promise<Uint8Array | null>
const grayCache = new Map<string, Uint8Array | null>()
export const loadGray: GrayLoader = async (id, file) => {
  const k = `${id}:${file}`
  if (!grayCache.has(k)) {
    const sharp = (await import('sharp')).default
    const buf = await sharp(file, { failOn: 'none' })
      .greyscale()
      .resize(64, 64, { fit: 'fill' })
      .raw()
      .toBuffer()
      .catch(() => null)
    grayCache.set(k, buf ? new Uint8Array(buf) : null)
  }
  return grayCache.get(k) ?? null
}

// Largest mean difference over the 64 areas (8×8 px each) of two 64×64
// grays. Re-encoded / resized copies stay low everywhere; 차분 (another
// expression, censor bars, a speech bubble) stand out in some area.
export function maxAreaDiff(a: Uint8Array, b: Uint8Array): number {
  let max = 0
  for (let by = 0; by < 8; by++)
    for (let bx = 0; bx < 8; bx++) {
      let s = 0
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) s += Math.abs(a[(by * 8 + y) * 64 + bx * 8 + x] - b[(by * 8 + y) * 64 + bx * 8 + x])
      max = Math.max(max, s / 64)
    }
  return max
}

export async function duplicateGroups(db: Db, maxDistance: number, maxDetail: number, load: GrayLoader = loadGray): Promise<DupGroup[]> {
  const rows = db
    .prepare(
      `SELECT id, path, thumbnail_path AS thumb, width, height, file_size AS size, rating, phash FROM images
       WHERE phash IS NOT NULL AND set_aside = 0 ORDER BY id`
    )
    .all() as { id: number; path: string; thumb: string | null; width: number | null; height: number | null; size: number | null; rating: Rating; phash: string }[]
  const hs = rows.map((r) => halves(r.phash))
  const ignore = new Set((db.prepare('SELECT a, b FROM not_dup').all() as { a: number; b: number }[]).map((p) => `${p.a}:${p.b}`))
  const parent = rows.map((_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  const gray = (i: number): Promise<Uint8Array | null> => load(rows[i].id, rows[i].thumb ?? rows[i].path)
  for (let a = 0; a < rows.length; a++) {
    const [a0, a1] = hs[a]
    for (let b = a + 1; b < rows.length; b++) {
      if (pop(a0 ^ hs[b][0]) + pop(a1 ^ hs[b][1]) > maxDistance) continue
      if (ignore.has(`${rows[a].id}:${rows[b].id}`)) continue
      const [ga, gb] = await Promise.all([gray(a), gray(b)])
      if (ga && gb && maxAreaDiff(ga, gb) > maxDetail) continue // 차분, not a copy
      parent[find(a)] = find(b)
    }
  }
  const byRoot = new Map<number, number[]>()
  rows.forEach((_, i) => byRoot.set(find(i), [...(byRoot.get(find(i)) ?? []), i]))
  const names = db.prepare(
    `SELECT DISTINCT c.name FROM image_characters ic JOIN characters c ON c.id = ic.character_id
     WHERE ic.image_id = ? AND ic.status IN ('auto','confirmed')`
  )
  const groups: DupGroup[] = []
  for (const members of byRoot.values()) {
    if (members.length < 2) continue
    const images = members
      .map((i) => rows[i])
      .map((r) => ({
        id: r.id,
        path: r.path,
        name: basename(r.path),
        thumb: r.thumb,
        width: r.width,
        height: r.height,
        size: r.size,
        rating: r.rating,
        characters: (names.all(r.id) as { name: string }[]).map((x) => x.name)
      }))
      // Best first (the suggested one to keep): more pixels, then bigger file.
      .sort((x, y) => (y.width ?? 0) * (y.height ?? 0) - (x.width ?? 0) * (x.height ?? 0) || (y.size ?? 0) - (x.size ?? 0))
    groups.push({ key: images.map((i) => i.id).join(','), images })
  }
  return groups.sort((a, b) => b.images.length - a.images.length || a.images[0].id - b.images[0].id)
}

interface DupPayload {
  label: string
  moved: { id: number; from: string; to: string }[]
  notDup?: [number, number][]
  dupOf?: { id: number; dup_of: number | null }[]
}

export function registerDupUndo(log: ActionLog, db: Db): void {
  log.register<DupPayload>(DUP_ACTION, async (p) => {
    for (const m of [...p.moved].reverse()) {
      if (existsSync(m.to) && !existsSync(m.from)) await moveFile(m.to, m.from)
      db.prepare('UPDATE images SET path = ?, set_aside = 0 WHERE id = ?').run(existsSync(m.from) ? m.from : m.to, m.id)
    }
    const del = db.prepare('DELETE FROM not_dup WHERE a = ? AND b = ?')
    for (const [a, b] of p.notDup ?? []) del.run(a, b)
    const back = db.prepare('UPDATE images SET dup_of = ? WHERE id = ?')
    for (const d of p.dupOf ?? []) back.run(d.dup_of, d.id)
  })
}

// Move the given images into <organizeDir>/중복 and hide them. One undo step.
export async function setAside(db: Db, log: ActionLog, ids: number[], organizeDir: string): Promise<{ moved: number; failed: string[] }> {
  if (!organizeDir) throw new Error('설정에서 정리 폴더를 먼저 정하세요 (따로 둔 그림은 정리 폴더/중복 으로 옮겨집니다)')
  const dir = join(organizeDir, DUP_DIR)
  const claimed = new Set<string>()
  const moved: DupPayload['moved'] = []
  const failed: string[] = []
  const up = db.prepare('UPDATE images SET path = ?, set_aside = 1 WHERE id = ?')
  for (const id of ids) {
    const r = db.prepare('SELECT path FROM images WHERE id = ?').get(id) as { path: string } | undefined
    if (!r) continue
    try {
      if (!existsSync(r.path)) throw new Error('원본이 없음')
      const to = uniqueTarget(dir, basename(r.path), claimed)
      await moveFile(r.path, to)
      up.run(to, id)
      moved.push({ id, from: r.path, to })
    } catch (e) {
      failed.push(`${basename(r.path)}: ${String((e as Error).message ?? e)}`)
    }
  }
  if (moved.length) log.record<DupPayload>(DUP_ACTION, { label: `중복 ${moved.length}장 따로 두기`, moved })
  return { moved: moved.length, failed }
}

// "중복 아님": every pair in the group is remembered as distinct.
export function markNotDuplicate(db: Db, log: ActionLog, ids: number[]): void {
  const pairs: [number, number][] = []
  const s = [...ids].sort((a, b) => a - b)
  for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) pairs.push([s[i], s[j]])
  const ins = db.prepare('INSERT OR IGNORE INTO not_dup (a, b) VALUES (?, ?)')
  const dupOf = db.prepare(`SELECT id, dup_of FROM images WHERE id IN (${s.map(() => '?').join(',')})`).all(...s) as NonNullable<DupPayload['dupOf']>
  db.transaction(() => pairs.forEach(([a, b]) => ins.run(a, b)))()
  db.prepare(`UPDATE images SET dup_of = NULL WHERE id IN (${s.map(() => '?').join(',')})`).run(...s)
  log.record<DupPayload>(DUP_ACTION, { label: '다른 그림으로 표시', moved: [], notDup: pairs, dupOf })
}
