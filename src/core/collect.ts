// 즐겨찾기 · 평점 · 그룹: the user's own collections over the library.
// Nothing here touches files. Each change snapshots what it replaces so Ctrl+Z
// restores it exactly (group deletion included).
import type { Db } from './db'
import type { ActionLog } from './actionLog'

interface Snap {
  label: string
  images: { id: number; favorite: number; stars: number }[]
  memberships?: { imageIds: number[]; rows: { image_id: number; group_id: number; added_at: number }[] }
  groups?: { id: number; name: string; sort_order: number; created_at: number }[] // to re-create / rename back
  createdGroup?: number // undo of a creation: drop it
}

export const COLLECT_ACTION = 'collect.edit'

export function registerCollectUndo(log: ActionLog, db: Db): void {
  log.register<Snap>(COLLECT_ACTION, (s) =>
    db.transaction(() => {
      const up = db.prepare('UPDATE images SET favorite = ?, stars = ? WHERE id = ?')
      for (const i of s.images) up.run(i.favorite, i.stars, i.id)
      for (const g of s.groups ?? []) {
        db.prepare('INSERT OR REPLACE INTO fav_groups (id, name, sort_order, created_at) VALUES (@id, @name, @sort_order, @created_at)').run(g)
      }
      if (s.memberships) {
        const ids = s.memberships.imageIds
        if (ids.length) db.prepare(`DELETE FROM image_groups WHERE image_id IN (${ids.map(() => '?').join(',')})`).run(...ids)
        const ins = db.prepare('INSERT OR IGNORE INTO image_groups (image_id, group_id, added_at) VALUES (@image_id, @group_id, @added_at)')
        for (const r of s.memberships.rows) ins.run(r)
      }
      if (s.createdGroup) db.prepare('DELETE FROM fav_groups WHERE id = ?').run(s.createdGroup)
    })()
  )
}

const ph = (n: number): string => Array(n).fill('?').join(',') || 'NULL'

function imagesSnap(db: Db, ids: number[]): Snap['images'] {
  return db.prepare(`SELECT id, favorite, stars FROM images WHERE id IN (${ph(ids.length)})`).all(...ids) as Snap['images']
}
function membershipSnap(db: Db, ids: number[]): NonNullable<Snap['memberships']> {
  return {
    imageIds: ids,
    rows: db.prepare(`SELECT image_id, group_id, added_at FROM image_groups WHERE image_id IN (${ph(ids.length)})`).all(...ids) as NonNullable<
      Snap['memberships']
    >['rows']
  }
}

export function setFavorite(db: Db, log: ActionLog, ids: number[], on: boolean): void {
  if (!ids.length) return
  const snap: Snap = { label: on ? '즐겨찾기 추가' : '즐겨찾기 해제', images: imagesSnap(db, ids) }
  db.prepare(`UPDATE images SET favorite = ? WHERE id IN (${ph(ids.length)})`).run(on ? 1 : 0, ...ids)
  log.record(COLLECT_ACTION, snap)
}

export function setStars(db: Db, log: ActionLog, ids: number[], stars: number): void {
  if (!ids.length) return
  const n = Math.max(0, Math.min(5, Math.round(stars)))
  const snap: Snap = { label: n ? `평점 ${n}점` : '평점 지우기', images: imagesSnap(db, ids) }
  db.prepare(`UPDATE images SET stars = ? WHERE id IN (${ph(ids.length)})`).run(n, ...ids)
  log.record(COLLECT_ACTION, snap)
}

export function listGroups(db: Db): { id: number; name: string }[] {
  return db.prepare('SELECT id, name FROM fav_groups ORDER BY sort_order, id').all() as { id: number; name: string }[]
}

// New group; `ids` (optional) go straight into it — one undo step.
export function createGroup(db: Db, log: ActionLog, name: string, ids: number[] = []): number {
  const n = name.trim()
  if (!n) throw new Error('그룹 이름이 비어 있습니다')
  if (db.prepare('SELECT 1 FROM fav_groups WHERE name = ?').get(n)) throw new Error(`"${n}" 그룹이 이미 있습니다`)
  const order = (db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS o FROM fav_groups').get() as { o: number }).o
  const snap: Snap = { label: `그룹 "${n}" 만들기`, images: [], memberships: membershipSnap(db, ids) }
  const id = Number(db.prepare('INSERT INTO fav_groups (name, sort_order, created_at) VALUES (?, ?, ?)').run(n, order, Date.now()).lastInsertRowid)
  const ins = db.prepare('INSERT OR IGNORE INTO image_groups (image_id, group_id, added_at) VALUES (?, ?, ?)')
  for (const i of ids) ins.run(i, id, Date.now())
  snap.createdGroup = id
  log.record(COLLECT_ACTION, snap)
  return id
}

export function renameGroup(db: Db, log: ActionLog, id: number, name: string): void {
  const n = name.trim()
  if (!n) throw new Error('그룹 이름이 비어 있습니다')
  if (db.prepare('SELECT 1 FROM fav_groups WHERE name = ? AND id <> ?').get(n, id)) throw new Error(`"${n}" 그룹이 이미 있습니다`)
  const g = db.prepare('SELECT * FROM fav_groups WHERE id = ?').get(id) as NonNullable<Snap['groups']>[number]
  db.prepare('UPDATE fav_groups SET name = ? WHERE id = ?').run(n, id)
  log.record(COLLECT_ACTION, { label: '그룹 이름 변경', images: [], groups: [g] } satisfies Snap)
}

// Deleting a group only removes the grouping; the images stay.
export function deleteGroup(db: Db, log: ActionLog, id: number): void {
  const g = db.prepare('SELECT * FROM fav_groups WHERE id = ?').get(id) as NonNullable<Snap['groups']>[number] | undefined
  if (!g) return
  const ids = (db.prepare('SELECT image_id AS i FROM image_groups WHERE group_id = ?').all(id) as { i: number }[]).map((r) => r.i)
  const snap: Snap = { label: `그룹 "${g.name}" 삭제`, images: [], groups: [g], memberships: membershipSnap(db, ids) }
  db.prepare('DELETE FROM fav_groups WHERE id = ?').run(id)
  log.record(COLLECT_ACTION, snap)
}

export function setGroupMembership(db: Db, log: ActionLog, ids: number[], groupId: number, on: boolean): void {
  if (!ids.length) return
  const g = db.prepare('SELECT name FROM fav_groups WHERE id = ?').get(groupId) as { name: string } | undefined
  if (!g) throw new Error('그룹이 없습니다')
  const snap: Snap = { label: on ? `그룹 "${g.name}"에 추가` : `그룹 "${g.name}"에서 빼기`, images: [], memberships: membershipSnap(db, ids) }
  if (on) {
    const ins = db.prepare('INSERT OR IGNORE INTO image_groups (image_id, group_id, added_at) VALUES (?, ?, ?)')
    db.transaction(() => ids.forEach((i) => ins.run(i, groupId, Date.now())))()
  } else db.prepare(`DELETE FROM image_groups WHERE group_id = ? AND image_id IN (${ph(ids.length)})`).run(groupId, ...ids)
  log.record(COLLECT_ACTION, snap)
}
