import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, renameSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { SortaCore, DEFAULT_SETTINGS } from '../src/core'
import { parseCharacterTag } from '../src/core/pipeline/tags'
import { decideRating } from '../src/core/pipeline/rating'
import { decideCharacters, decideEnsemble } from '../src/core/pipeline/decide'
import { hamming, phashFromGray32 } from '../src/core/pipeline/phash'
import { scanImages } from '../src/core/pipeline/scan'
import { MockTagger } from '../src/core/ml/mock'
import type { TagResult } from '../src/core/ml/types'

const T = DEFAULT_SETTINGS.thresholds

describe('character tag parsing', () => {
  it('splits name and series', () => {
    expect(parseCharacterTag('hoshino_(blue_archive)')).toMatchObject({ name: 'Hoshino', series: 'Blue Archive' })
    expect(parseCharacterTag('artoria_pendragon_(fate)')).toMatchObject({ name: 'Artoria Pendragon', series: 'Fate' })
  })
  it('uses the last group as the series', () => {
    expect(parseCharacterTag('hoshino_(swimsuit)_(blue_archive)')).toMatchObject({
      name: 'Hoshino (Swimsuit)',
      series: 'Blue Archive'
    })
  })
  it('handles nested parentheses and slashes', () => {
    expect(parseCharacterTag('amami_haruka_(idolmaster_(classic))')).toMatchObject({
      name: 'Amami Haruka',
      seriesTag: 'idolmaster_(classic)'
    })
    expect(parseCharacterTag('mash_kyrielight_(fate/grand_order)').series).toBe('Fate/grand Order')
  })
  it('leaves tags without a series', () => {
    expect(parseCharacterTag('hatsune_miku')).toMatchObject({ name: 'Hatsune Miku', series: null })
  })
})

describe('rating', () => {
  const r = (g: number, s: number, q: number, e: number): TagResult['rating'] => ({
    general: g,
    sensitive: s,
    questionable: q,
    explicit: e
  })
  it('clear cases', () => {
    expect(decideRating(r(0.9, 0.05, 0.02, 0.01), T)).toMatchObject({ rating: 'general', review: false })
    expect(decideRating(r(0.1, 0.8, 0.05, 0.01), T)).toMatchObject({ rating: 'sensitive', review: false })
    expect(decideRating(r(0, 0.1, 0.3, 0.6), T)).toMatchObject({ rating: 'r18', review: false })
  })
  it('borderline goes to the stricter rating and review', () => {
    expect(decideRating(r(0.4, 0.2, 0.25, 0.2), T)).toMatchObject({ rating: 'r18', review: true })
    expect(decideRating(r(0.5, 0.45, 0.02, 0), T)).toMatchObject({ rating: 'sensitive', review: true })
  })
})

describe('confidence branching (per tag)', () => {
  const st = (rows: ReturnType<typeof decideCharacters>): string[] => rows.map((r) => `${r.status}:${r.tag ?? '-'}`)
  it('each confident tag is a present character', () => {
    expect(st(decideCharacters([{ tag: 'a', score: 0.95 }, { tag: 'b', score: 0.3 }], T))).toEqual(['auto:a'])
    // Two high scores = both in the picture (no 1st/2nd margin rule).
    expect(st(decideCharacters([{ tag: 'a', score: 0.9 }, { tag: 'b', score: 0.84 }], T))).toEqual(['auto:a', 'auto:b'])
  })
  it('a lone mid score goes to review, not unknown', () => {
    expect(st(decideCharacters([{ tag: 'a', score: 0.7 }], T))).toEqual(['pending:a'])
    const [r] = decideCharacters([{ tag: 'a', score: 0.4 }, { tag: 'b', score: 0.33 }], T)
    expect(r.status).toBe('pending')
    expect(r.candidates.map((c) => c.tag)).toEqual(['a', 'b'])
  })
  it('weak leftovers next to a confident character are dropped', () => {
    expect(st(decideCharacters([{ tag: 'a', score: 0.95 }, { tag: 'b', score: 0.3 }], T))).toEqual(['auto:a'])
    expect(st(decideCharacters([{ tag: 'a', score: 0.95 }, { tag: 'b', score: 0.6 }], T))).toEqual(['auto:a', 'pending:b'])
  })
  it('unknown when nothing reaches candidateMin; ignored tags never count', () => {
    expect(st(decideCharacters([{ tag: 'a', score: 0.1 }], T))).toEqual(['unknown:-'])
    expect(st(decideCharacters([], T))).toEqual(['unknown:-'])
    expect(st(decideCharacters([{ tag: 'sensei', score: 0.99 }, { tag: 'a', score: 0.8 }], T, ['sensei']))).toEqual(['auto:a'])
  })
})

describe('phash', () => {
  it('identical input → distance 0, different pattern → large distance', () => {
    const grad = Array.from({ length: 1024 }, (_, i) => i % 32 * 8)
    const vert = Array.from({ length: 1024 }, (_, i) => Math.floor(i / 32) * 8)
    expect(hamming(phashFromGray32(grad), phashFromGray32(grad))).toBe(0)
    expect(hamming(phashFromGray32(grad), phashFromGray32(vert))).toBeGreaterThan(10)
  })
})

// ---- end-to-end on dummy images ----

let dir: string
let src: string
let sorted: string

async function solid(path: string, rgb: [number, number, number], w = 64, h = 48): Promise<void> {
  await sharp({ create: { width: w, height: h, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toFile(path)
}

// Patterned image (pHash needs real structure). `shift` nudges brightness
// slightly → a near-duplicate of the same pattern.
async function pattern(path: string, seed: number, shift = 0): Promise<void> {
  const w = 64
  const buf = Buffer.alloc(w * w * 3)
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const v = Math.round(127 + 100 * Math.sin((x * (seed + 1)) / 9) * Math.cos((y * (seed + 2)) / 11)) + shift
      buf.fill(Math.max(0, Math.min(255, v)), (y * w + x) * 3, (y * w + x) * 3 + 3)
    }
  await sharp(buf, { raw: { width: w, height: w, channels: 3 } }).png().toFile(path)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sorta-'))
  src = join(dir, 'src')
  sorted = join(src, 'sorted')
  mkdirSync(join(src, 'sub'), { recursive: true })
  mkdirSync(sorted, { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const tags = (chars: [string, number][], adult = 0): TagResult => ({
  rating: { general: 1 - adult, sensitive: 0, questionable: adult / 2, explicit: adult / 2 },
  characters: chars.map(([tag, score]) => ({ tag, score })),
  general: []
})

describe('import + classify', () => {
  it('scans recursively, skips the organize folder and non-images', async () => {
    await solid(join(src, 'a.png'), [255, 0, 0])
    await solid(join(src, 'sub', 'b.png'), [0, 255, 0])
    await solid(join(sorted, 'c.png'), [0, 0, 255])
    const files = await scanImages([src], [sorted])
    expect(files.map((f) => f.slice(src.length + 1).replace(/\\/g, '/')).sort()).toEqual(['a.png', 'sub/b.png'])
  })

  it('imports once, follows moved files, flags near-duplicates', async () => {
    const core = new SortaCore(join(dir, 'data'))
    core.saveSettings({ sourceDirs: [src], organizeDir: sorted })
    await pattern(join(src, 'a.png'), 1)
    await pattern(join(src, 'sub', 'b.png'), 1, 4) // near-identical to a
    await pattern(join(src, 'sub', 'c.png'), 5) // different
    let r = await core.runImport().done
    expect(r).toMatchObject({ added: 3, failed: [] })
    const imgs = core.images({ node: { type: 'all' }, rating: 'all', q: '' })
    expect(imgs.every((i) => i.thumb && existsSync(i.thumb))).toBe(true)
    expect(imgs.filter((i) => i.dupOf !== null)).toHaveLength(1)

    r = await core.runImport().done
    expect(r.added).toBe(0)

    renameSync(join(src, 'a.png'), join(src, 'sub', 'a-moved.png'))
    r = await core.runImport().done
    expect(r).toMatchObject({ added: 0, moved: 1 })
    expect(core.images({ node: { type: 'all' }, rating: 'all', q: 'a-moved' })).toHaveLength(1)
    core.close()
  })

  it('reports undecodable files without stopping', async () => {
    const core = new SortaCore(join(dir, 'data'))
    core.saveSettings({ sourceDirs: [src] })
    await solid(join(src, 'ok.png'), [1, 2, 3])
    writeFileSync(join(src, 'broken.jpg'), 'not an image')
    const r = await core.runImport().done
    expect(r.added).toBe(2)
    expect(r.failed.map((f) => f.path)).toEqual([join(src, 'broken.jpg')])
    core.close()
  })

  it('classifies with the tagger: rating, series/character, review and unknown', async () => {
    const script: Record<string, TagResult> = {
      '255,0,0': tags([['hoshino_(blue_archive)', 0.97]]), // auto
      '0,255,0': tags([['shiroko_(blue_archive)', 0.4], ['hoshino_(blue_archive)', 0.33]]), // pending
      '0,0,255': tags([], 0.9), // R-18, no character
      '255,255,0': tags([['hatsune_miku', 0.95], ['kagamine_rin', 0.9]]) // two present
    }
    const core = new SortaCore(join(dir, 'data'), { taggerFactory: async () => new MockTagger(script) })
    core.saveSettings({ sourceDirs: [src] })
    await solid(join(src, 'r.png'), [255, 0, 0])
    await solid(join(src, 'g.png'), [0, 255, 0])
    await solid(join(src, 'b.png'), [0, 0, 255])
    await solid(join(src, 'y.png'), [255, 255, 0])
    await core.runImport().done
    expect(core.tree().counts.unclassified).toBe(4)
    expect(await core.runClassify().done).toEqual({ classified: 4, failed: 0 })

    const tree = core.tree()
    expect(tree.counts).toMatchObject({ all: 4, unclassified: 0, pending: 1, unknown: 1 })
    const ba = tree.series.find((s) => s.name === 'Blue Archive')!
    expect(ba.characters.map((c) => [c.name, c.count])).toEqual([['Hoshino', 1]])
    expect(tree.series.find((s) => s.name === '작품 미상')!.characters.map((c) => c.name).sort()).toEqual([
      'Hatsune Miku',
      'Kagamine Rin'
    ])

    const pending = core.images({ node: { type: 'pending' }, rating: 'all', q: '' })
    expect(pending.map((i) => i.path.endsWith('g.png'))).toEqual([true])
    expect(core.images({ node: { type: 'all' }, rating: 'r18', q: '' }).map((i) => i.path.endsWith('b.png'))).toEqual([
      true
    ])
    expect(core.images({ node: { type: 'all' }, rating: 'all', q: 'blue arch' })).toHaveLength(2)
    core.close()
  })

  it('classify without a model does nothing', async () => {
    const core = new SortaCore(join(dir, 'data'))
    expect(await core.runClassify().done).toBeNull()
    core.close()
  })
})

describe('tagger pre-processing', () => {
  it('pads any aspect ratio to an exact 448×448 BGR input', async () => {
    const { prepare } = await import('../src/core/ml/wdTagger')
    for (const [w, h] of [
      [300, 900],
      [1200, 400],
      [448, 448]
    ]) {
      const data = new Uint8Array(w * h * 3)
      for (let i = 0; i < w * h; i++) data.set([200, 100, 50], i * 3) // R,G,B
      const x = await prepare({ width: w, height: h, data })
      expect(x.length).toBe(448 * 448 * 3)
      // Center pixel is the image (BGR order); a corner of the long-side pad is white.
      const c = (224 * 448 + 224) * 3
      expect([x[c], x[c + 1], x[c + 2]]).toEqual([50, 100, 200])
      if (w !== h) expect([x[0], x[1], x[2]]).toEqual([255, 255, 255])
    }
  })
})

describe('pipeline revision', () => {
  it('re-queues classified images when the revision changes', async () => {
    const d = join(dir, 'data')
    const core = new SortaCore(d, { taggerFactory: async () => new MockTagger({}) })
    core.saveSettings({ sourceDirs: [src] })
    await solid(join(src, 'r.png'), [255, 0, 0])
    await core.runImport().done
    await core.runClassify().done
    expect(core.tree().counts.unclassified).toBe(0)
    core.db.prepare("UPDATE settings SET value_json = '1' WHERE key = 'pipelineRev'").run()
    core.close()
    const again = new SortaCore(d)
    expect(again.tree().counts.unclassified).toBe(1)
    again.close()
  })
})

describe('re-deciding from stored scores', () => {
  it('threshold change re-sorts without running the tagger again', async () => {
    let calls = 0
    const script = { '255,0,0': tags([['hoshino_(blue_archive)', 0.8]]) }
    const core = new SortaCore(join(dir, 'data'), {
      taggerFactory: async () => {
        const m = new MockTagger(script)
        return { name: 'counting', tag: async (img) => (calls++, m.tag(img)) }
      }
    })
    core.saveSettings({ sourceDirs: [src] })
    await solid(join(src, 'r.png'), [255, 0, 0])
    await core.runImport().done
    await core.runClassify().done
    expect(calls).toBe(1)
    expect(core.tree().counts.pending).toBe(0) // 0.8 ≥ 0.75 → auto
    core.saveSettings({ thresholds: { ...DEFAULT_SETTINGS.thresholds, autoAccept: 0.9 } })
    await core.runRedecide().done
    expect(calls).toBe(1)
    expect(core.tree().counts.pending).toBe(1) // now below → review
    core.saveSettings({ ignoredCharacterTags: ['hoshino_(blue_archive)'] })
    await core.runRedecide().done
    expect(core.tree().counts).toMatchObject({ pending: 0, unknown: 1 })
    core.close()
  })
})

describe('ensemble (assist models)', () => {
  const st = (rows: ReturnType<typeof decideEnsemble>): string[] => rows.map((r) => `${r.status}:${r.tag ?? '-'}`)
  it('PixAI alone confirms only at assistAccept', () => {
    expect(st(decideEnsemble({ wd: [], pixai: [{ tag: 'aoi', score: 0.97 }] }, T))).toEqual(['auto:aoi'])
    expect(st(decideEnsemble({ wd: [], pixai: [{ tag: 'rin', score: 0.79 }] }, T))).toEqual(['pending:rin'])
  })
  it('Camie never confirms alone; weak Camie-only guesses are ignored', () => {
    expect(st(decideEnsemble({ wd: [], pixai: [], camie: [{ tag: 'okinami', score: 0.96 }] }, T))).toEqual(['pending:okinami'])
    expect(st(decideEnsemble({ wd: [], pixai: [], camie: [{ tag: 'hatoba', score: 0.55 }] }, T))).toEqual(['unknown:-'])
    // No Camie-only extra next to a confirmed character.
    expect(st(decideEnsemble({ wd: [{ tag: 'fubuki', score: 0.9 }], camie: [{ tag: 'jill', score: 0.85 }] }, T))).toEqual(['auto:fubuki'])
  })
  it('two models agreeing confirm', () => {
    expect(st(decideEnsemble({ wd: [{ tag: 'kazusa', score: 0.6 }], pixai: [{ tag: 'kazusa', score: 0.7 }] }, T))).toEqual(['auto:kazusa'])
    expect(st(decideEnsemble({ wd: [], pixai: [{ tag: 'aoi', score: 0.6 }], camie: [{ tag: 'aoi', score: 0.95 }] }, T))).toEqual([
      'auto:aoi'
    ])
  })
  it('disagreement goes to review with both names', () => {
    const [r] = decideEnsemble({ wd: [], pixai: [{ tag: 'chihiro', score: 0.8 }], camie: [{ tag: 'okinami', score: 0.96 }] }, T)
    expect(r.status).toBe('pending')
    expect(r.candidates.map((c) => c.tag).sort()).toEqual(['chihiro', 'okinami'])
  })
})

describe('game table + assist pass', () => {
  it('places untagged characters into their game and asks assist only for open images', async () => {
    const script = {
      '255,0,0': tags([['yae_miko', 0.95]]), // WD sure, no "(series)" in the tag
      '0,255,0': tags([]) // WD knows nobody
    }
    let assistCalls = 0
    const core = new SortaCore(join(dir, 'data'), {
      taggerFactory: async () => new MockTagger(script),
      seriesMap: new Map([['yae_miko', 'genshin_impact'], ['aoi_(blue_archive)', 'blue_archive']]),
      assistFactory: async () => [
        {
          id: 'pixai' as const,
          knows: () => true,
          characters: async () => (assistCalls++, [{ tag: 'aoi_(blue_archive)', score: 0.98 }])
        }
      ]
    })
    core.saveSettings({ sourceDirs: [src] })
    await solid(join(src, 'r.png'), [255, 0, 0])
    await solid(join(src, 'g.png'), [0, 255, 0])
    await core.runImport().done
    await core.runClassify().done
    let tree = core.tree()
    expect(tree.series.map((s) => [s.name, s.characters.map((c) => c.name)])).toEqual([['Genshin Impact', ['Yae Miko']]])
    expect(tree.counts.unknown).toBe(1)
    expect(assistCalls).toBe(0) // assist off
    core.saveSettings({ assistMode: 'pixai' })
    expect(await core.runAssist().done).toBe(1)
    expect(assistCalls).toBe(1) // only the open image
    tree = core.tree()
    expect(tree.counts.unknown).toBe(0)
    expect(tree.series.find((s) => s.name === 'Blue Archive')!.characters.map((c) => c.name)).toEqual(['Aoi'])
    // Turning assist off again re-decides from stored scores (no new calls).
    core.saveSettings({ assistMode: 'none' })
    await core.runRedecide().done
    expect(core.tree().counts.unknown).toBe(1)
    expect(assistCalls).toBe(1)
    core.close()
  })
})
