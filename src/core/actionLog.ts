// Undo log (CLAUDE.md §7: every change is recorded and Ctrl+Z-able). Each
// action type registers how to revert itself; `undo()` reverts the newest
// action that hasn't been undone yet. A file move records both paths so it can
// be put back exactly.
import type { Db } from './db'

export interface LoggedAction<P = unknown> {
  id: number
  type: string
  payload: P
  createdAt: number
}

export type UndoHandler<P = unknown> = (payload: P) => void | Promise<void>

export class ActionLog {
  private handlers = new Map<string, UndoHandler<never>>()

  constructor(private db: Db) {}

  register<P>(type: string, undo: UndoHandler<P>): void {
    this.handlers.set(type, undo as UndoHandler<never>)
  }

  record<P>(type: string, payload: P): number {
    const r = this.db
      .prepare('INSERT INTO action_log (action_type, payload_json, created_at) VALUES (?, ?, ?)')
      .run(type, JSON.stringify(payload), Date.now())
    return Number(r.lastInsertRowid)
  }

  // Newest first, not yet undone.
  recent(limit = 50): LoggedAction[] {
    const rows = this.db
      .prepare('SELECT id, action_type, payload_json, created_at FROM action_log WHERE undone = 0 ORDER BY id DESC LIMIT ?')
      .all(limit) as { id: number; action_type: string; payload_json: string; created_at: number }[]
    return rows.map((r) => ({ id: r.id, type: r.action_type, payload: JSON.parse(r.payload_json), createdAt: r.created_at }))
  }

  // Revert the newest live action. Returns it, or null when nothing is left.
  // The row is only marked undone after its handler succeeded.
  async undo(): Promise<LoggedAction | null> {
    const [last] = this.recent(1)
    if (!last) return null
    const h = this.handlers.get(last.type)
    if (!h) throw new Error(`no undo handler for "${last.type}"`)
    await (h as UndoHandler)(last.payload)
    this.db.prepare('UPDATE action_log SET undone = 1 WHERE id = ?').run(last.id)
    return last
  }
}
