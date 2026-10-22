// 분류 정보 파일: <정리 폴더>/.sorta/library.sortapack keeps what Sorta knows
// about the organized pictures — games, 소속 조직도, characters, (optionally)
// 학습 데이터, and every picture's 분류 결과 (pack v2 `files`, paths relative to
// the organize folder). Sorta rewrites it after changes; a fresh install, the
// same folder on another PC (or the mobile app later) reads it back, so the
// pictures show up already classified without running the models.
//
// Restoring only adds: pictures I already have (same sha256) keep my
// classification — only a lost path is pointed at the file's location. The
// whole restore is one undo step. A manual .sortapack export with pictures
// restores the same way (relative to my organize folder).
import { existsSync, promises as fsp } from 'fs'
import { dirname, join } from 'path'
import type { Db } from './db'
import type { ActionLog } from './actionLog'
import type { JobContext } from './queue'
import { decodeVector, planImport, undoPackImport } from './pack'
import type { ImportPayload, Pack, PackFile } from './pack'
import { sha256File } from './pipeline/scan'
import { gray32, probe, writeThumb } from './pipeline/imageio'
import { phashFromGray32 } from './pipeline/phash'

export const LIB_DIR = '.sorta'
export const LIB_FILE = 'library.sortapack'
export const RESTORE_ACTION = 'library.restore'

export const libFilePath = (root: string): string => join(root, LIB_DIR, LIB_FILE)

export interface RestoreResult {
  added: number // pictures registered from the file
  relinked: number // pictures I had whose path was lost → the file's location
  kept: number // pictures I already had (my classification kept)
  missing: number // listed in the file but not in the folder
  changed: number // the file on disk is not the one the entry describes
}

interface RestorePayload {
  label: string
  pack: ImportPayload
  images: number[] // registered by the restore
  relinked: { id: number; path: string; organized_path: string | null }[]
  groups: number[] // picture groups created
}

export function registerRestoreUndo(log: ActionLog, db: Db): void {
  log.register<RestorePayload>(RESTORE_ACTION, (p) => {
    db.transaction(() => {
      const del = (table: string, ids: number[]): void => {
        for (let i = 0; i < ids.length; i += 500) {
          const part = ids.slice(i, i + 500)
          db.prepare(`DELETE FROM ${table} WHERE id IN (${part.map(() => '?').join(',')})`).run(...part)
        }
      }
      del('images', p.images) // cascades: characters, embeddings, refs, groups
      const back = db.prepare('UPDATE images SET path = ?, organized_path = ? WHERE id = ?')
      for (const r of p.relinked) back.run(r.path, r.organized_path, r.id)
      del('fav_groups', p.groups)
    })()
    undoPackImport(db, p.pack)
  })
}

// Pictures of `pack.files` under `root` → the library (see the header).
export async function restoreFiles(
  db: Db,
  log: ActionLog,
  pack: Pack,
  root: string,
  thumbsDir: string,
  o: { learned: boolean; overwrite?: boolean; label: string },
  ctx: JobContext
): Promise<RestoreResult> {
  const res: RestoreResult = { added: 0, relinked: 0, kept: 0, missing: 0, changed: 0 }
  const plan = planImport(db, pack, { overwrite: !!o.overwrite, learned: o.learned })
  plan.run()
  const keys = plan.keys()
  const payload: RestorePayload = { label: o.label, pack: plan.payload(), images: [], relinked: [], groups: [] }

  // Picture groups by name (created when missing).
  const groupId = new Map<string, number>()
  for (const g of db.prepare('SELECT id, name FROM fav_groups').all() as { id: number; name: string }[]) groupId.set(g.name, g.id)
  for (const g of pack.groups ?? []) {
    if (groupId.has(g.name)) continue
    const id = Number(db.prepare('INSERT INTO fav_groups (name, sort_order, created_at) VALUES (?, ?, ?)').run(g.name, g.order, Date.now()).lastInsertRowid)
    groupId.set(g.name, id)
    payload.groups.push(id)
  }

  const bySha = db.prepare('SELECT id, path, organized_path FROM images WHERE sha256 = ?')
  const byPath = db.prepare('SELECT 1 FROM images WHERE path = ?')
  const relink = db.prepare('UPDATE images SET path = ?, organized_path = ? WHERE id = ?')
  const insImg = db.prepare(
    `INSERT INTO images (path, sha256, phash, width, height, rating, rating_score, rating_source, kind, imported_at,
       thumbnail_path, organized_path, classified_at, rating_review, tag_json, embedded_at, file_size, file_mtime,
       favorite, stars, set_aside, group_only, group_series_id, error)
     VALUES (@path, @sha, @phash, @width, @height, @rating, @score, @rs, @kind, @at, @thumb, @path, @classified, @rr, @tags,
       @embedded, @size, @mtime, @fav, @stars, @aside, @go, @gs, @error)`
  )
  const insChar = db.prepare(
    'INSERT INTO image_characters (image_id, character_id, status, source, confidence, bbox, candidates) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
  const insEmb = db.prepare('INSERT INTO embeddings (image_id, bbox, crop, vector, character_id, is_reference) VALUES (?, ?, ?, ?, ?, ?)')
  const insRef = db.prepare("INSERT OR IGNORE INTO refs (character_id, source, image_id, vector, created_at) VALUES (?, 'user', ?, ?, ?)")
  const insGroup = db.prepare('INSERT OR IGNORE INTO image_groups (image_id, group_id, added_at) VALUES (?, ?, ?)')
  const charOf = (k: string | null): number | null => (k === null ? null : (keys.chars.get(k) ?? null))

  const files = pack.files ?? []
  try {
    for (let i = 0; i < files.length; i++) {
      if (ctx.signal.aborted) break
      if (i % 20 === 0) ctx.report(i, files.length, '분류 정보 불러오는 중')
      const f = files[i]
      if (f.r !== undefined) continue // a source folder's picture: the next import finds it (by sha256)
      const path = join(root, ...f.p.split('/'))
      const known = bySha.get(f.sha) as { id: number; path: string; organized_path: string | null } | undefined
      if (known) {
        if (known.path !== path && !existsSync(known.path) && existsSync(path) && !byPath.get(path)) {
          payload.relinked.push({ id: known.id, path: known.path, organized_path: known.organized_path })
          relink.run(path, path, known.id)
          res.relinked++
        } else res.kept++
        continue
      }
      if (byPath.get(path)) {
        res.changed++ // another picture of mine sits at that path
        continue
      }
      let st: { size: number; mtimeMs: number }
      try {
        st = await fsp.stat(path)
      } catch {
        res.missing++
        continue
      }
      // Same size → trust the file's hash; otherwise check it was not replaced.
      if (f.size !== null && f.size !== st.size && (await sha256File(path)) !== f.sha) {
        res.changed++
        continue
      }
      await addPicture(f, path, st)
    }
  } finally {
    log.record<RestorePayload>(RESTORE_ACTION, payload)
  }
  ctx.report(files.length, files.length, '분류 정보 불러오기 완료')
  return res

  async function addPicture(f: PackFile, path: string, st: { size: number; mtimeMs: number }): Promise<void> {
    let width: number | null = null
    let height: number | null = null
    let phash: string | null = null
    let thumb: string | null = null
    let error: string | null = null
    try {
      ;({ width, height } = await probe(path))
      thumb = join(thumbsDir, `${f.sha}.webp`)
      if (!existsSync(thumb)) {
        await fsp.mkdir(dirname(thumb), { recursive: true })
        await writeThumb(path, thumb)
      }
      phash = phashFromGray32(await gray32(path))
    } catch (e) {
      error = `decode: ${String((e as Error)?.message ?? e)}`
    }
    const emb = o.learned ? (f.emb ?? []) : []
    db.transaction(() => {
      const id = Number(
        insImg.run({
          path,
          sha: f.sha,
          phash,
          width,
          height,
          rating: f.rating,
          score: f.score,
          rs: f.rs,
          kind: f.kind,
          at: Date.now(),
          thumb,
          classified: f.classified ? Date.now() : null,
          rr: f.rr,
          tags: f.tags === null || f.tags === undefined ? null : JSON.stringify(f.tags),
          embedded: emb.length ? Date.now() : null,
          size: st.size,
          mtime: Math.round(st.mtimeMs),
          fav: f.fav,
          stars: f.stars,
          aside: f.aside,
          go: f.go,
          gs: f.gs === null ? null : (keys.series[f.gs] ?? null),
          error
        }).lastInsertRowid
      )
      payload.images.push(id)
      for (const c of f.chars) {
        const cand = c.cand?.map((x) => ({ characterId: charOf(x.c), score: x.score })).filter((x) => x.characterId !== null) ?? null
        insChar.run(id, charOf(c.c), c.st, c.src, c.conf, c.bbox, cand?.length ? JSON.stringify(cand) : null)
      }
      const vecs = emb.map((e) => decodeVector(e.v))
      emb.forEach((e, k) => insEmb.run(id, e.bbox, e.crop, vecs[k], null, 0))
      for (const r of f.refs ?? []) {
        const c = charOf(r.c)
        if (c !== null && vecs[r.e]) insRef.run(c, id, vecs[r.e], Date.now())
      }
      for (const g of f.groups) {
        const gid = groupId.get(g)
        if (gid !== undefined) insGroup.run(id, gid, Date.now())
      }
    })()
    res.added++
  }
}

// 미리 보기 for the mobile app: <정리 폴더>/.sorta/thumbs/<sha256>.webp, copied
// from the thumbnail cache for every picture in the file (only the missing
// ones; those of pictures no longer in the file are removed). Returns the
// number copied.
export const THUMB_DIR = 'thumbs'
export async function syncThumbs(root: string, thumbs: { sha: string; path: string | null }[]): Promise<number> {
  const dir = join(root, LIB_DIR, THUMB_DIR)
  await fsp.mkdir(dir, { recursive: true })
  const have = new Set(await fsp.readdir(dir))
  const want = new Set<string>()
  let n = 0
  for (const t of thumbs) {
    const name = `${t.sha}.webp`
    want.add(name)
    if (have.has(name) || !t.path) continue
    try {
      await fsp.copyFile(t.path, join(dir, name + '.tmp'))
      await fsp.rename(join(dir, name + '.tmp'), join(dir, name))
      have.add(name)
      n++
    } catch {
      // thumbnail missing / folder busy — tried again on the next write
    }
  }
  for (const name of have) if (!want.has(name)) await fsp.unlink(join(dir, name)).catch(() => {})
  return n
}

// The organize folder's file, written next to the pictures. tmp → rename, so
// a crash mid-write keeps the previous file.
export async function writeLibFile(root: string, buf: Buffer): Promise<void> {
  const file = libFilePath(root)
  await fsp.mkdir(dirname(file), { recursive: true })
  const tmp = file + '.tmp'
  await fsp.writeFile(tmp, buf)
  await fsp.rename(tmp, file)
}
