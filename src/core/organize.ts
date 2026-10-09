// 폴더 정리 (CLAUDE.md §6): move settled originals into
//   <정리 폴더>/[등급/]게임/[소속/…/]캐릭터/   one character (versions → base;
//                                            nested affiliations nest folders)
//   <정리 폴더>/[등급/]게임/소속/              several, all in one affiliation
//                                            (the deepest one they share)
//   <정리 폴더>/[등급/]게임/단체/              several, same game (mixed / many)
//   <정리 폴더>/[등급/]단체/                   several games
//   <정리 폴더>/[등급/]기타/                   캐릭터 아닌 그림
// Only moves — file contents are never touched, nothing is deleted. A run is
// one undo step; images already organized follow later classification changes.
import { promises as fs, existsSync } from 'fs'
import { basename, dirname, extname, join, relative, resolve } from 'path'
import type { Db } from './db'
import type { ActionLog } from './actionLog'
import type { JobContext } from './queue'
import { affiliationPaths } from './org'
import type { OrganizeMove, OrganizePlan, Rating, Settings } from '../shared/types'

const RATING_DIR: Record<Rating, string> = { general: '일반', sensitive: '민감', r18: 'R-18', unknown: '미정' }
export const GROUP_DIR = '단체'
export const OTHER_DIR = '기타'

// Windows-safe folder name.
export function safeName(s: string): string {
  const t = s
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\s.]+$/g, '')
    .trim()
  return t || '_'
}

interface CharInfo {
  root: number
  name: string
  series: string
  affiliation: string[] // path, top first ([] = none)
}

function charInfo(db: Db): Map<number, CharInfo> {
  const rows = db
    .prepare(
      `SELECT c.id, COALESCE(c.parent_id, c.id) AS root,
         COALESCE(p.name, c.name) AS name, s.name AS series,
         COALESCE(p.affiliation_id, c.affiliation_id) AS aff
       FROM characters c LEFT JOIN characters p ON p.id = c.parent_id JOIN series s ON s.id = COALESCE(p.series_id, c.series_id)`
    )
    .all() as { id: number; root: number; name: string; series: string; aff: number | null }[]
  const paths = affiliationPaths(db)
  return new Map(rows.map((r) => [r.id, { root: r.root, name: r.name, series: r.series, affiliation: (r.aff && paths.get(r.aff)) || [] }]))
}

// Folder (relative to the organize root) an image belongs in, or null when it
// isn't settled (something still in review / unknown).
export function targetDir(
  img: { kind: string; rating: Rating; rows: { character_id: number | null; status: string }[] },
  chars: Map<number, CharInfo>,
  s: Pick<Settings, 'splitByRating' | 'thresholds' | 'moveAuto'>
): string | null {
  const top = s.splitByRating ? [RATING_DIR[img.rating]] : []
  if (img.kind === 'other') return join(...top, OTHER_DIR)
  const rows = img.rows
  if (!rows.length || rows.some((r) => r.status === 'pending' || r.status === 'unknown' || r.character_id === null)) return null
  if (!s.moveAuto && rows.some((r) => r.status === 'auto')) return null // wait for the user's confirmation
  // One entry per base character (outfit versions merge).
  const people = new Map<number, CharInfo>()
  for (const r of rows) {
    const c = chars.get(r.character_id!)
    if (c) people.set(c.root, c)
  }
  const list = [...people.values()]
  if (!list.length) return null
  if (list.length === 1) {
    const c = list[0]
    return join(...top, safeName(c.series), ...c.affiliation.map(safeName), safeName(c.name))
  }
  const games = new Set(list.map((c) => c.series))
  if (games.size > 1) return join(...top, GROUP_DIR)
  const game = safeName(list[0].series)
  // Deepest affiliation everyone shares (school for two clubs of one school).
  let shared = list[0].affiliation
  for (const c of list) {
    let n = 0
    while (n < shared.length && n < c.affiliation.length && shared[n] === c.affiliation[n]) n++
    shared = shared.slice(0, n)
  }
  if (shared.length && list.length < s.thresholds.groupThreshold) return join(...top, game, ...shared.map(safeName))
  return join(...top, game, GROUP_DIR)
}

function settledImages(db: Db, where: string): {
  id: number
  path: string
  kind: string
  rating: Rating
  organized_path: string | null
  rows: { character_id: number | null; status: string }[]
}[] {
  const imgs = db.prepare(`SELECT id, path, kind, rating, organized_path FROM images WHERE set_aside = 0 AND ${where}`).all() as {
    id: number
    path: string
    kind: string
    rating: Rating
    organized_path: string | null
  }[]
  const rowsQ = db.prepare('SELECT character_id, status FROM image_characters WHERE image_id = ?')
  return imgs.map((i) => ({ ...i, rows: rowsQ.all(i.id) as { character_id: number | null; status: string }[] }))
}

const sameDir = (a: string, b: string): boolean =>
  process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)

// Unique file name in `dir`, also avoiding names already claimed by this plan.
export function uniqueTarget(dir: string, file: string, claimed: Set<string>): string {
  const ext = extname(file)
  const stem = basename(file, ext)
  for (let n = 1; ; n++) {
    const name = n === 1 ? file : `${stem} (${n})${ext}`
    const p = join(dir, name)
    const key = process.platform === 'win32' ? p.toLowerCase() : p
    if (!claimed.has(key) && !existsSync(p)) {
      claimed.add(key)
      return p
    }
  }
}

// What a run would do. `onlyOrganized` = re-place images organized before
// (after a classification change) instead of the whole library.
export function planOrganize(db: Db, s: Settings, onlyOrganized = false): OrganizePlan {
  const root = s.organizeDir
  const plan: OrganizePlan = { moves: [], unsettled: 0, already: 0, byFolder: [] }
  if (!root) return plan
  const chars = charInfo(db)
  const claimed = new Set<string>()
  const counts = new Map<string, number>()
  for (const img of settledImages(db, onlyOrganized ? 'organized_path IS NOT NULL' : '1 = 1')) {
    const rel = targetDir(img, chars, s)
    if (rel === null) {
      plan.unsettled++
      continue
    }
    const dir = join(root, rel)
    if (sameDir(dirname(img.path), dir)) {
      plan.already++
      continue
    }
    const to = uniqueTarget(dir, basename(img.path), claimed)
    plan.moves.push({ id: img.id, from: img.path, to })
    counts.set(rel, (counts.get(rel) ?? 0) + 1)
  }
  plan.byFolder = [...counts].map(([folder, n]) => ({ folder, n })).sort((a, b) => b.n - a.n)
  return plan
}

// Move one file; across drives: copy, verify size, then remove the source.
export async function moveFile(from: string, to: string): Promise<void> {
  await fs.mkdir(dirname(to), { recursive: true })
  try {
    await fs.rename(from, to)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await fs.copyFile(from, to)
    const [a, b] = await Promise.all([fs.stat(from), fs.stat(to)])
    if (a.size !== b.size) throw new Error(`복사 확인 실패: ${to}`)
    await fs.unlink(from)
  }
}

export const MOVE_ACTION = 'organize.move'
interface MovePayload {
  label: string
  moves: { id: number; from: string; to: string; prevOrganized: string | null }[]
}

export function registerOrganizeUndo(log: ActionLog, db: Db): void {
  log.register<MovePayload>(MOVE_ACTION, async (p) => {
    // Back to where each file came from (newest first); skip files that are gone.
    for (const m of [...p.moves].reverse()) {
      if (!existsSync(m.to) || existsSync(m.from)) continue
      await moveFile(m.to, m.from)
      db.prepare('UPDATE images SET path = ?, organized_path = ? WHERE id = ?').run(m.from, m.prevOrganized, m.id)
    }
  })
}

export async function executeMoves(
  db: Db,
  log: ActionLog | null,
  moves: OrganizeMove[],
  ctx: JobContext,
  label = '폴더 정리'
): Promise<{ moved: number; failed: { path: string; error: string }[] }> {
  const done: MovePayload['moves'] = []
  const failed: { path: string; error: string }[] = []
  const prevQ = db.prepare('SELECT organized_path FROM images WHERE id = ?')
  const upd = db.prepare('UPDATE images SET path = ?, organized_path = ? WHERE id = ?')
  for (let i = 0; i < moves.length; i++) {
    if (ctx.signal.aborted) break
    const m = moves[i]
    ctx.report(i, moves.length, label)
    try {
      if (!existsSync(m.from)) throw new Error('원본 파일이 없습니다')
      const prev = (prevQ.get(m.id) as { organized_path: string | null } | undefined)?.organized_path ?? null
      await moveFile(m.from, m.to)
      upd.run(m.to, m.to, m.id)
      done.push({ ...m, prevOrganized: prev })
    } catch (e) {
      failed.push({ path: m.from, error: String((e as Error).message ?? e) })
    }
  }
  if (log && done.length) log.record<MovePayload>(MOVE_ACTION, { label: `${label} (${done.length}장)`, moves: done })
  ctx.report(moves.length, moves.length, label)
  return { moved: done.length, failed }
}

export const relTo = (root: string, p: string): string => relative(root, p)
