// Undo log (CLAUDE.md §7: every change is recorded and Ctrl+Z-able). Each
// action type registers how to revert itself; `undo()` reverts the newest
// action that hasn't been undone yet. A file move records both paths so it can
// be put back exactly.
//
// Redo: a type may also register `capture` — the current state over the same
// scope, in the payload's own shape, taken just before undoing. Redo then
// runs the same handler with that captured payload (which puts the undone
// change back) and makes the original row live again, so it can be undone
// once more. The redo stack lives in memory and is cleared by any new action;
// an undo of a type without `capture` clears it too.
import type { Db } from './db'

export interface LoggedAction<P = unknown> {
  id: number
  type: string
  payload: P
  createdAt: number
}

export type UndoHandler<P = unknown> = (payload: P) => void | Promise<void>
export type CaptureHandler<P = unknown> = (payload: P) => P

export class ActionLog {
  private handlers = new Map<string, UndoHandler<never>>()
  private captures = new Map<string, CaptureHandler<any>>() // eslint-disable-line @typescript-eslint/no-explicit-any
  private redoStack: { id: number; type: string; payload: unknown; label: string }[] = []

  constructor(private db: Db) {}

  register<P>(type: string, undo: UndoHandler<P>, capture?: CaptureHandler<P>): void {
    this.handlers.set(type, undo as UndoHandler<never>)
    if (capture) this.captures.set(type, capture)
  }

  record<P>(type: string, payload: P): number {
    this.redoStack = []
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
    const capture = this.captures.get(last.type) as CaptureHandler | undefined
    const after = capture?.(last.payload)
    await (h as UndoHandler)(last.payload)
    this.db.prepare('UPDATE action_log SET undone = 1 WHERE id = ?').run(last.id)
    const label = (last.payload as { label?: string })?.label ?? last.type
    if (capture) this.redoStack.push({ id: last.id, type: last.type, payload: after, label })
    else this.redoStack = []
    return last
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  // Put back the most recently undone action. Returns its label, or null.
  async redo(): Promise<string | null> {
    const r = this.redoStack[this.redoStack.length - 1]
    if (!r) return null
    await (this.handlers.get(r.type) as UndoHandler)(r.payload)
    this.redoStack.pop()
    this.db.prepare('UPDATE action_log SET undone = 0 WHERE id = ?').run(r.id)
    return r.label
  }
}
