import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { SortaCore, DEFAULT_SETTINGS, CancelledError } from '../src/core'
import { MIGRATIONS } from '../src/core/db'
import { MockTagger, MockEmbedder, solidImage } from '../src/core/ml/mock'

const TABLES = [
  'series',
  'affiliations',
  'characters',
  'images',
  'image_characters',
  'embeddings',
  'clusters',
  'cluster_members',
  'action_log',
  'settings'
]

describe('db', () => {
  it('creates every table and records the schema version', () => {
    const core = new SortaCore(':memory:')
    const names = (core.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
      (r) => r.name
    )
    for (const t of TABLES) expect(names).toContain(t)
    expect(core.schemaVersion).toBe(MIGRATIONS.length)
    core.close()
  })

  it('creates the data folders and reopens an existing db without re-migrating', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sorta-'))
    try {
      const a = new SortaCore(dir)
      a.saveSettings({ organizeDir: 'X:/sorted' })
      a.close()
      expect(existsSync(join(dir, 'sorta.db'))).toBe(true)
      expect(existsSync(join(dir, 'thumbs'))).toBe(true)
      expect(existsSync(join(dir, 'models'))).toBe(true)
      const b = new SortaCore(dir)
      expect(b.settings().organizeDir).toBe('X:/sorted')
      expect(b.schemaVersion).toBe(MIGRATIONS.length)
      b.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('enforces rating values', () => {
    const core = new SortaCore(':memory:')
    const ins = core.db.prepare('INSERT INTO images (path, sha256, rating, imported_at) VALUES (?, ?, ?, ?)')
    expect(() => ins.run('a.png', 'h1', 'sensitive', 1)).not.toThrow()
    expect(() => ins.run('b.png', 'h2', 'nsfw', 1)).toThrow()
    core.close()
  })
})

describe('settings', () => {
  it('returns defaults, saves a patch and merges new threshold keys', () => {
    const core = new SortaCore(':memory:')
    expect(core.settings()).toEqual(DEFAULT_SETTINGS)
    const s = core.saveSettings({ theme: 'dark', thresholds: { ...DEFAULT_SETTINGS.thresholds, autoAccept: 0.9 } })
    expect(s.theme).toBe('dark')
    expect(s.thresholds.autoAccept).toBe(0.9)
    // A stored thresholds object missing a newer key still gets its default.
    core.db.prepare("UPDATE settings SET value_json = ? WHERE key = 'thresholds'").run(JSON.stringify({ autoAccept: 0.7 }))
    expect(core.settings().thresholds.candidateMin).toBe(DEFAULT_SETTINGS.thresholds.candidateMin)
    expect(core.settings().thresholds.autoAccept).toBe(0.7)
    core.close()
  })
})

describe('queue', () => {
  it('runs jobs in order and reports progress', async () => {
    const core = new SortaCore(':memory:')
    const order: number[] = []
    const states: string[] = []
    core.queue.onProgress((e) => states.push(`${e.jobId}:${e.state}:${e.done}/${e.total}`))
    const a = core.queue.add('a', async ({ report }) => {
      report(1, 2)
      order.push(1)
      report(2, 2)
      return 'A'
    })
    const b = core.queue.add('b', async () => {
      order.push(2)
      return 'B'
    })
    expect(await a.done).toBe('A')
    expect(await b.done).toBe('B')
    expect(order).toEqual([1, 2])
    expect(states).toContain(`${a.id}:running:2/2`)
    expect(states).toContain(`${a.id}:done:2/2`)
    core.close()
  })

  it('cancels queued and running jobs', async () => {
    const core = new SortaCore(':memory:')
    const running = core.queue.add('long', ({ signal }) => new Promise((res) => signal.addEventListener('abort', () => res(1))))
    const queued = core.queue.add('next', async () => 2)
    expect(core.queue.cancel(queued.id)).toBe(true)
    await expect(queued.done).rejects.toBeInstanceOf(CancelledError)
    core.queue.cancel(running.id)
    await expect(running.done).rejects.toBeInstanceOf(CancelledError)
    expect(core.queue.size).toBe(0)
    core.close()
  })

  it('reports a failed job and keeps going', async () => {
    const core = new SortaCore(':memory:')
    const bad = core.queue.add('bad', async () => {
      throw new Error('boom')
    })
    const ok = core.queue.add('ok', async () => 'fine')
    await expect(bad.done).rejects.toThrow('boom')
    expect(await ok.done).toBe('fine')
    core.close()
  })
})

describe('action log', () => {
  it('undoes the newest action first, once', async () => {
    const core = new SortaCore(':memory:')
    const undone: number[] = []
    core.log.register<{ n: number }>('test', (p) => {
      undone.push(p.n)
    })
    core.log.record('test', { n: 1 })
    core.log.record('test', { n: 2 })
    expect((await core.log.undo())?.payload).toEqual({ n: 2 })
    expect((await core.log.undo())?.payload).toEqual({ n: 1 })
    expect(await core.log.undo()).toBeNull()
    expect(undone).toEqual([2, 1])
    core.close()
  })

  it('keeps the action when its undo fails', async () => {
    const core = new SortaCore(':memory:')
    core.log.register('flaky', () => {
      throw new Error('locked')
    })
    core.log.record('flaky', {})
    await expect(core.log.undo()).rejects.toThrow('locked')
    expect(core.log.recent()).toHaveLength(1)
    core.close()
  })
})

describe('mock models', () => {
  it('scripted tagger answers per dummy color', async () => {
    const red = solidImage(4, 4, [255, 0, 0])
    const tagger = new MockTagger({
      '255,0,0': {
        rating: { general: 0.1, sensitive: 0.1, questionable: 0.3, explicit: 0.5 },
        characters: [{ tag: 'char_a_(game_x)', score: 0.92 }],
        general: []
      }
    })
    const r = await tagger.tag(red)
    expect(r.characters[0].tag).toBe('char_a_(game_x)')
    expect((await tagger.tag(solidImage(4, 4, [0, 0, 255]))).characters).toHaveLength(0)
  })

  it('embedder returns unit vectors, identical for identical input', async () => {
    const e = new MockEmbedder(8)
    const a = await e.embed(solidImage(2, 2, [10, 20, 30]))
    const b = await e.embed(solidImage(3, 3, [10, 20, 30]))
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0))
    expect(norm).toBeCloseTo(1, 5)
    expect(Array.from(a)).toEqual(Array.from(b))
  })
})

describe('shared data folder', () => {
  it('refuses a database made by a newer Sorta (does not migrate or touch it)', async () => {
    const { mkdtempSync, rmSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const Database = (await import('better-sqlite3')).default
    const { NewerDataError, MIGRATIONS } = await import('../src/core/db')
    const dir = mkdtempSync(join(tmpdir(), 'sorta-newer-'))
    const db = new Database(join(dir, 'sorta.db'))
    db.pragma(`user_version = ${MIGRATIONS.length + 1}`)
    db.close()
    expect(() => new SortaCore(dir)).toThrow(NewerDataError)
    const again = new Database(join(dir, 'sorta.db'))
    expect(again.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length + 1)
    again.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('redo (그룹)', () => {
  it('create / delete a group: undo, redo, undo', async () => {
    const core = new SortaCore(':memory:')
    const groups = (): string[] => core.tree(['general', 'sensitive', 'r18']).groups.map((g) => g.name)
    const id = core.createGroup('A')
    await core.undo()
    expect(groups()).toEqual([])
    await core.redo()
    expect(groups()).toEqual(['A'])
    core.deleteGroup(id)
    await core.undo()
    expect(groups()).toEqual(['A'])
    await core.redo()
    expect(groups()).toEqual([])
    core.close()
  })
})

describe('삭제 (휴지통)', () => {
  it('sends the file to the trash function and drops the picture; old undo steps skip it', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'sorta-'))
    try {
      const src = join(dir, 'src')
      const { mkdirSync } = await import('fs')
      mkdirSync(src)
      const core = new SortaCore(join(dir, 'data'), {
        taggerFactory: async () => new MockTagger({ '255,0,0': { rating: { general: 1, sensitive: 0, questionable: 0, explicit: 0 }, characters: [], general: [] } })
      })
      core.saveSettings({ sourceDirs: [src] })
      const sharp = (await import('sharp')).default
      await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toFile(join(src, 'a.png'))
      await core.runImport().done
      const all = (): { id: number; path: string }[] =>
        core.images({ node: { type: 'all' }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' })
      const [img] = all()
      core.setStars([img.id], 3)
      core.setRating([img.id], 'sensitive')
      const trashed: string[] = []
      const r = await core.runTrash([img.id], async (p) => void trashed.push(p)).done
      expect(r).toEqual({ trashed: 1, failed: [] })
      expect(trashed).toEqual([img.path])
      expect(all()).toHaveLength(0)
      // undoing the earlier edits on it doesn't get stuck
      await core.undo()
      await core.undo()
      expect(await core.undo()).toMatchObject({ label: null })
      core.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('queue: background jobs', () => {
  it('a background job makes way for another job and runs again after it', async () => {
    const { JobQueue } = await import('../src/core/queue')
    const q = new JobQueue()
    const order: string[] = []
    let runs = 0
    const bg = q.add(
      'bg',
      async (ctx) => {
        runs++
        order.push(`bg start ${runs}`)
        for (let i = 0; i < 20; i++) {
          await new Promise((r) => setTimeout(r, 5))
          if (ctx.signal.aborted) throw new CancelledError()
        }
        order.push('bg done')
        return 'ok'
      },
      { background: true }
    )
    await new Promise((r) => setTimeout(r, 15))
    const fg = q.add('fg', async () => {
      order.push('fg')
      return 1
    })
    expect(await fg.done).toBe(1)
    expect(await bg.done).toBe('ok')
    expect(order).toEqual(['bg start 1', 'fg', 'bg start 2', 'bg done'])
  })
})
