import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { SortaCore } from '../src/core'
import { MockDetector, MockEmbedder, MockTagger } from '../src/core/ml/mock'
import { DEFAULT_THRESHOLDS } from '../src/shared/defaults'
import { decideEnsemble } from '../src/core/pipeline/decide'

let dir: string
let src: string

async function solid(path: string, rgb: [number, number, number]): Promise<void> {
  await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toFile(path)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sorta-'))
  src = join(dir, 'src')
  mkdirSync(src, { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('kNN decision rules', () => {
  const st = (rows: ReturnType<typeof decideEnsemble>): string[] => rows.map((r) => `${r.status}:${r.tag ?? '-'}`)
  it('a learned match confirms at knnAccept, is a candidate above knnCandidate, and votes with a tagger', () => {
    expect(st(decideEnsemble({ wd: [], knn: [{ tag: 'aoi', score: 0.82 }] }, DEFAULT_THRESHOLDS))).toEqual(['auto:aoi'])
    expect(st(decideEnsemble({ wd: [], knn: [{ tag: 'aoi', score: 0.68 }] }, DEFAULT_THRESHOLDS))).toEqual(['pending:aoi'])
    expect(st(decideEnsemble({ wd: [{ tag: 'aoi', score: 0.55 }], knn: [{ tag: 'aoi', score: 0.68 }] }, DEFAULT_THRESHOLDS))).toEqual(['auto:aoi'])
  })
})

describe('learning from user confirmations', () => {
  it('a confirmed picture becomes a reference; look-alikes get sorted; undo removes it', async () => {
    // Same color = same character to the mock embedder.
    const core = new SortaCore(join(dir, 'data'), {
      taggerFactory: async () => new MockTagger({}),
      learnFactory: async () => ({
        embedder: new MockEmbedder(8, {
          '200,10,10': [1, 0.1, 0, 0, 0, 0, 0, 0],
          '201,10,10': [1, 0.15, 0.05, 0, 0, 0, 0, 0],
          '10,10,200': [0, 0, 1, 0.2, 0, 0, 0, 0]
        }),
        detector: new MockDetector()
      })
    })
    core.saveSettings({ sourceDirs: [src] })
    mkdirSync(join(src, 'a'))
    await solid(join(src, 'a', '1.png'), [200, 10, 10])
    await solid(join(src, 'a', '2.png'), [201, 10, 10]) // same "character", different file
    await solid(join(src, 'b.png'), [10, 10, 200])
    await core.runImport().done
    await core.runClassify().done
    expect(core.tree().counts.unknown).toBe(3)

    const imgs = core.images({ node: { type: 'all' }, rating: 'all', q: '' })
    const id1 = imgs.find((i) => i.path.endsWith('1.png'))!.id
    const aoi = core.createCharacter('Aoi', 'Blue Archive')
    core.confirmCharacters([id1], [aoi])
    expect(await core.runLearnRefresh().done).toEqual({ embedded: 3, refs: 1 })

    const label = (name: string): string =>
      core
        .images({ node: { type: 'all' }, rating: 'all', q: '' })
        .find((i) => i.path.endsWith(name))!
        .characters.map((c) => `${c.name}:${c.status}`)
        .join(',')
    // One reference picture: a candidate for review, not an auto-confirm.
    expect(label('2.png')).toBe('Aoi:pending')
    expect(label('b.png')).toBe('null:unknown')

    await core.undo()
    await core.runLearnRefresh().done
    expect(label('2.png')).toBe('null:unknown')
    core.close()
  })
})
