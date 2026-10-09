// In-process background job queue. Heavy work (import, inference, moves) runs
// here, never in an IPC handler. Jobs report progress through `onProgress`;
// a job can be cancelled while queued or (cooperatively) while running.
import type { ProgressEvent } from '../../shared/types'

export interface JobContext {
  signal: AbortSignal
  report: (done: number, total: number, label?: string, unit?: 'bytes') => void
}

export type JobFn<T> = (ctx: JobContext) => Promise<T>

interface Entry {
  id: number
  label: string
  fn: JobFn<unknown>
  ctrl: AbortController
  resolve: (v: unknown) => void
  reject: (e: unknown) => void
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
    this.name = 'CancelledError'
  }
}

export class JobQueue {
  private seq = 0
  private waiting: Entry[] = []
  private running = new Map<number, Entry>()
  private listeners = new Set<(e: ProgressEvent) => void>()

  constructor(private concurrency = 1) {}

  onProgress(cb: (e: ProgressEvent) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  private emit(e: ProgressEvent): void {
    for (const l of this.listeners) l(e)
  }

  // Queue a job; the promise settles with its result (rejects with
  // CancelledError when cancelled).
  add<T>(label: string, fn: JobFn<T>): { id: number; done: Promise<T> } {
    const id = ++this.seq
    let resolve!: (v: unknown) => void
    let reject!: (e: unknown) => void
    const done = new Promise<T>((res, rej) => {
      resolve = res as (v: unknown) => void
      reject = rej
    })
    this.waiting.push({ id, label, fn: fn as JobFn<unknown>, ctrl: new AbortController(), resolve, reject })
    this.emit({ jobId: id, label, done: 0, total: 0, state: 'queued' })
    this.pump()
    return { id, done }
  }

  cancel(id: number): boolean {
    const i = this.waiting.findIndex((e) => e.id === id)
    if (i >= 0) {
      const [e] = this.waiting.splice(i, 1)
      this.emit({ jobId: id, label: e.label, done: 0, total: 0, state: 'cancelled' })
      e.reject(new CancelledError())
      return true
    }
    const r = this.running.get(id)
    if (r) {
      r.ctrl.abort()
      return true
    }
    return false
  }

  get size(): number {
    return this.waiting.length + this.running.size
  }

  private pump(): void {
    while (this.running.size < this.concurrency && this.waiting.length) {
      const e = this.waiting.shift()!
      this.running.set(e.id, e)
      void this.run(e)
    }
  }

  private async run(e: Entry): Promise<void> {
    let last: { done: number; total: number; unit?: 'bytes' } = { done: 0, total: 0 }
    const report = (done: number, total: number, label?: string, unit?: 'bytes'): void => {
      last = { done, total, unit }
      this.emit({ jobId: e.id, label: label ?? e.label, done, total, unit, state: 'running' })
    }
    this.emit({ jobId: e.id, label: e.label, done: 0, total: 0, state: 'running' })
    try {
      const v = await e.fn({ signal: e.ctrl.signal, report })
      if (e.ctrl.signal.aborted) throw new CancelledError()
      this.emit({ jobId: e.id, label: e.label, ...last, state: 'done' })
      e.resolve(v)
    } catch (err) {
      const cancelled = e.ctrl.signal.aborted || err instanceof CancelledError
      this.emit({
        jobId: e.id,
        label: e.label,
        ...last,
        state: cancelled ? 'cancelled' : 'failed',
        error: cancelled ? undefined : String((err as Error)?.message ?? err)
      })
      e.reject(cancelled ? new CancelledError() : err)
    } finally {
      this.running.delete(e.id)
      this.pump()
    }
  }
}
