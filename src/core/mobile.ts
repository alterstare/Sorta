// 모바일 변경 파일 (src/shared/mobile.ts): Sorta 모바일 reviews and edits on
// the phone and leaves its changes as files next to the 분류 정보 파일. They
// are applied here in order, each change through the same functions the
// screens use (so each one is a Ctrl+Z step), then the file is deleted.
// 삭제 on the phone = the PC's own 삭제: the original goes to the recycle bin.
import { promises as fsp } from 'fs'
import { join } from 'path'
import type { Db } from './db'
import type { ActionLog } from './actionLog'
import { LIB_DIR } from './libfile'
import { trashImages } from './trash'
import type { TrashFn } from './trash'
import * as review from './review'
import * as collect from './collect'
import * as org from './org'
import * as manage from './manage'
import { MOBILE_DIR, MOBILE_FORMAT, MOBILE_VERSION } from '../shared/mobile'
import type { CharRef, MobileEdit, MobileEditFile, MobileImageState } from '../shared/mobile'

export const mobileDir = (root: string): string => join(root, LIB_DIR, MOBILE_DIR)

export interface MobileResult {
  files: number
  applied: number
  skipped: number // picture / character / 소속 not found
}

// Change files waiting in the organize folder (oldest first).
export async function pendingMobileFiles(root: string): Promise<string[]> {
  try {
    return (await fsp.readdir(mobileDir(root)))
      .filter((n) => n.endsWith('.json'))
      .sort()
      .map((n) => join(mobileDir(root), n))
  } catch {
    return []
  }
}

export async function applyMobileFiles(
  db: Db,
  log: ActionLog,
  files: string[],
  trash?: { fn: TrashFn; thumbsDir: string }
): Promise<MobileResult> {
  const res: MobileResult = { files: 0, applied: 0, skipped: 0 }
  const batches: { file: string; f: MobileEditFile }[] = []
  for (const file of files) {
    try {
      const f = JSON.parse(await fsp.readFile(file, 'utf8')) as MobileEditFile
      if (f.format !== MOBILE_FORMAT || f.version > MOBILE_VERSION) continue // not ours / newer: leave it
      batches.push({ file, f })
    } catch {
      // half-written (the phone is still uploading) — next time
    }
  }
  batches.sort((a, b) => a.f.createdAt - b.f.createdAt)
  for (const { file, f } of batches) {
    for (const e of f.edits) {
      let ok = false
      try {
        if (e.op === 'trash') {
          const img = db.prepare('SELECT id FROM images WHERE sha256 = ? LIMIT 1').get(e.sha) as { id: number } | undefined
          ok = !!img && !!trash && (await trashImages(db, [img.id], trash.fn, trash.thumbsDir)).trashed > 0
        } else ok = applyEdit(db, log, e)
      } catch {
        ok = false
      }
      if (ok) res.applied++
      else res.skipped++
    }
    await fsp.unlink(file).catch(() => {})
    res.files++
  }
  return res
}

const lower = (s: string): string => s.trim().toLowerCase()

function seriesId(db: Db, name: string): number | null {
  for (const r of db.prepare('SELECT id, name, aliases FROM series').all() as { id: number; name: string; aliases: string }[]) {
    if ([r.name, ...(JSON.parse(r.aliases) as string[])].some((x) => lower(x) === lower(name))) return r.id
  }
  return null
}

// The pack key when it still names that character here, else by name / alias
// in its game, else a new character (typed on the phone).
function charId(db: Db, c: CharRef, create: boolean): number | null {
  const m = /^c(\d+)$/.exec(c.k ?? '')
  if (m) {
    const r = db.prepare('SELECT c.id, c.name, s.name AS series FROM characters c JOIN series s ON s.id = c.series_id WHERE c.id = ?').get(Number(m[1])) as
      | { id: number; name: string; series: string }
      | undefined
    if (r && lower(r.name) === lower(c.name)) return r.id
  }
  const sid = seriesId(db, c.series)
  if (sid !== null) {
    for (const r of db.prepare('SELECT id, name, aliases FROM characters WHERE series_id = ?').all(sid) as { id: number; name: string; aliases: string }[]) {
      if ([r.name, ...(JSON.parse(r.aliases) as string[])].some((x) => lower(x) === lower(c.name))) return r.id
    }
  }
  return create ? review.createCharacter(db, c.name, c.series) : null
}

function affByName(db: Db, sid: number, name: string): number | null {
  for (const a of db.prepare('SELECT id, name, aliases FROM affiliations WHERE series_id = ?').all(sid) as { id: number; name: string; aliases: string }[]) {
    if ([a.name, ...(JSON.parse(a.aliases) as string[])].some((x) => lower(x) === lower(name))) return a.id
  }
  return null
}

function groupId(db: Db, log: ActionLog, name: string): number {
  const g = db.prepare('SELECT id FROM fav_groups WHERE name = ?').get(name) as { id: number } | undefined
  return g ? g.id : collect.createGroup(db, log, name)
}

function applyEdit(db: Db, log: ActionLog, e: MobileEdit): boolean {
  switch (e.op) {
    case 'image': {
      const img = db.prepare('SELECT id FROM images WHERE sha256 = ? ORDER BY set_aside, id LIMIT 1').get(e.sha) as { id: number } | undefined
      if (!img) return false
      applyImage(db, log, img.id, e.set, e.label)
      return true
    }
    case 'place': {
      const id = charId(db, e.char, false)
      if (id === null) return false
      const sid = (db.prepare('SELECT series_id FROM characters WHERE id = ?').get(id) as { series_id: number }).series_id
      const series = (db.prepare('SELECT name FROM series WHERE id = ?').get(sid) as { name: string }).name
      if (e.path === null || !e.path.length) org.placeCharacters(db, log, [id], null)
      else org.applyPaths(db, log, series, [{ characterId: id, path: e.path }])
      return true
    }
    case 'addAff': {
      const sid = seriesId(db, e.series)
      if (sid === null || !e.path.length) return false
      const series = (db.prepare('SELECT name FROM series WHERE id = ?').get(sid) as { name: string }).name
      let parent: number | null = null
      for (const raw of e.path) {
        const name = raw.trim()
        if (!name) continue
        parent = affByName(db, sid, name) ?? org.addAffiliation(db, log, series, name, parent)
      }
      return parent !== null
    }
    case 'renameAff': {
      const sid = seriesId(db, e.series)
      const id = sid === null ? null : affByName(db, sid, e.name)
      if (id === null) return false
      org.renameAffiliation(db, log, id, e.to)
      return true
    }
    case 'deleteAff': {
      const sid = seriesId(db, e.series)
      const id = sid === null ? null : affByName(db, sid, e.name)
      if (id === null) return false
      org.deleteAffiliation(db, log, id)
      return true
    }
    case 'renameChar': {
      const id = charId(db, e.char, false)
      if (id === null) return false
      manage.renameCharacter(db, log, id, e.to)
      return true
    }
    case 'trash':
      return false // handled by applyMobileFiles (needs the host's recycle bin)
    case 'group': {
      const g = db.prepare('SELECT id FROM fav_groups WHERE name = ?').get(e.name) as { id: number } | undefined
      if (e.action === 'create') {
        if (!g) collect.createGroup(db, log, e.name)
        return true
      }
      if (!g) return false
      if (e.action === 'delete') collect.deleteGroup(db, log, g.id)
      else if (e.to) collect.renameGroup(db, log, g.id, e.to)
      return true
    }
  }
  return false
}

function applyImage(db: Db, log: ActionLog, id: number, st: MobileImageState, label: string): void {
  const s: review.ImageState = {}
  if (st.chars) {
    s.rows = st.chars.map((r) => {
      const cand = r.cand
        ?.map((x) => ({ characterId: charId(db, x.c, false), score: x.score }))
        .filter((x): x is { characterId: number; score: number } => x.characterId !== null)
      return {
        character_id: r.c ? charId(db, r.c, true) : null,
        status: r.st,
        source: r.src,
        confidence: r.conf,
        candidates: cand?.length ? JSON.stringify(cand) : null
      }
    })
  }
  if (st.kind !== undefined) s.kind = st.kind
  if (st.go !== undefined) {
    s.groupOnly = st.go
    s.groupSeriesId = st.go && st.gs ? (seriesId(db, st.gs) ?? createSeries(db, st.gs)) : null
  }
  if (st.rating) s.rating = { rating: st.rating.v, source: st.rating.src, review: st.rating.rr }
  if (s.rows || s.kind !== undefined || s.groupOnly !== undefined || s.rating) review.setImageState(db, log, id, s, label)
  const cur = db.prepare('SELECT favorite, stars FROM images WHERE id = ?').get(id) as { favorite: number; stars: number }
  if (st.fav !== undefined && st.fav !== cur.favorite) collect.setFavorite(db, log, [id], !!st.fav)
  if (st.stars !== undefined && st.stars !== cur.stars) collect.setStars(db, log, [id], st.stars)
  if (st.groups) {
    const want = new Set(st.groups.map((n) => groupId(db, log, n)))
    const have = new Set((db.prepare('SELECT group_id AS g FROM image_groups WHERE image_id = ?').all(id) as { g: number }[]).map((r) => r.g))
    for (const g of want) if (!have.has(g)) collect.setGroupMembership(db, log, [id], g, true)
    for (const g of have) if (!want.has(g)) collect.setGroupMembership(db, log, [id], g, false)
  }
}

function createSeries(db: Db, name: string): number {
  db.prepare("INSERT OR IGNORE INTO series (name, aliases, created_at) VALUES (?, '[]', ?)").run(name.trim(), Date.now())
  return (db.prepare('SELECT id FROM series WHERE name = ?').get(name.trim()) as { id: number }).id
}
