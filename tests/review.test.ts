import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { SortaCore } from '../src/core'
import { MockTagger } from '../src/core/ml/mock'
import type { TagResult } from '../src/core/ml/types'

let dir: string
let src: string

const tags = (chars: [string, number][], adult = 0): TagResult => ({
  rating: { general: 1 - adult, sensitive: 0, questionable: adult / 2, explicit: adult / 2 },
  characters: chars.map(([tag, score]) => ({ tag, score })),
  general: []
})

async function solid(path: string, rgb: [number, number, number]): Promise<void> {
  await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toFile(path)
}

// r: confident Hoshino · g: pending Shiroko/Hoshino · b: nobody, borderline rating
async function setup(): Promise<SortaCore> {
  const core = new SortaCore(join(dir, 'data'), {
    taggerFactory: async () =>
      new MockTagger({
        '255,0,0': tags([['hoshino_(blue_archive)', 0.95]]),
        '0,255,0': tags([['shiroko_(blue_archive)', 0.6], ['hoshino_(blue_archive)', 0.4]]),
        '0,0,255': tags([], 0.45)
      })
  })
  core.saveSettings({ sourceDirs: [src] })
  await solid(join(src, 'r.png'), [255, 0, 0])
  await solid(join(src, 'g.png'), [0, 255, 0])
  await solid(join(src, 'b.png'), [0, 0, 255])
  await core.runImport().done
  await core.runClassify().done
  return core
}

const idOf = (core: SortaCore, name: string): number =>
  core.images({ node: { type: 'all' }, rating: 'all', q: '' }).find((i) => i.path.endsWith(name))!.id

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sorta-'))
  src = join(dir, 'src')
  mkdirSync(src, { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('review queue', () => {
  it('lists pending characters with candidates and references, and borderline ratings', async () => {
    const core = await setup()
    const q = core.reviewQueue('character')
    expect(q.map((i) => i.path.endsWith('g.png'))).toEqual([true])
    expect(q[0].candidates.map((c) => [c.name, c.low])).toEqual([
      ['Shiroko', false],
      ['Hoshino', true]
    ])
    // Hoshino already has a sorted image (r.png) → shown as a reference.
    expect(q[0].candidates[1].refs).toHaveLength(1)
    expect(core.reviewQueue('rating').map((i) => i.path.endsWith('b.png'))).toEqual([true])
    core.close()
  })
})

describe('decisions + undo', () => {
  it('confirm several characters, survive re-decision, undo restores', async () => {
    const core = await setup()
    const g = idOf(core, 'g.png')
    const [shiroko, hoshino] = core.reviewQueue('character')[0].candidates.map((c) => c.id)
    core.confirmCharacters([g], [shiroko, hoshino])
    expect(core.reviewQueue('character')).toHaveLength(0)
    const names = (): string[] =>
      core
        .images({ node: { type: 'all' }, rating: 'all', q: '' })
        .find((i) => i.id === g)!
        .characters.map((c) => `${c.name}:${c.status}`)
        .sort()
    expect(names()).toEqual(['Hoshino:confirmed', 'Shiroko:confirmed'])
    // A threshold change must not overwrite the user's decision.
    await core.runRedecide().done
    expect(names()).toEqual(['Hoshino:confirmed', 'Shiroko:confirmed'])
    expect(await core.undo()).toEqual({ ok: true, label: '캐릭터 확정' })
    expect(core.reviewQueue('character')).toHaveLength(1)
    core.close()
  })

  it('캐릭터 아님 and rating are user decisions too', async () => {
    const core = await setup()
    const b = idOf(core, 'b.png')
    core.markOther([b])
    core.setRating([b], 'general')
    await core.runRedecide().done
    const img = core.images({ node: { type: 'other' }, rating: 'all', q: '' })
    expect(img.map((i) => [i.id, i.rating, i.ratingReview])).toEqual([[b, 'general', false]])
    expect(core.reviewQueue('rating')).toHaveLength(0)
    await core.undo() // rating
    expect(core.reviewQueue('rating')).toHaveLength(1)
    await core.undo() // 캐릭터 아님
    expect(core.images({ node: { type: 'other' }, rating: 'all', q: '' })).toHaveLength(0)
    expect(await core.undo()).toEqual({ ok: true, label: null })
    core.close()
  })

  it('new characters and search', async () => {
    const core = await setup()
    const id = core.createCharacter('Aoi', 'Blue Archive')
    expect(core.createCharacter('Aoi', 'Blue Archive')).toBe(id)
    expect((await core.searchCharacters('ao')).map((c) => c.name)).toContain('Aoi')
    expect((await core.searchCharacters('hoshino')).map((c) => [c.name, c.series])).toEqual([['Hoshino', 'Blue Archive']])
    expect(core.seriesNames()).toContain('Blue Archive')
    core.close()
  })
})

describe('outfit versions', () => {
  it('parses the base character', async () => {
    const { variantBase } = await import('../src/core/pipeline/tags')
    expect(variantBase('hoshino_(swimsuit)_(blue_archive)')).toBe('hoshino_(blue_archive)')
    expect(variantBase('hoshino_(blue_archive)')).toBeNull()
    expect(variantBase('yae_miko_(fox)', new Map([['yae_miko_(fox)', 'genshin_impact'], ['yae_miko', 'genshin_impact']]))).toBe('yae_miko')
    expect(variantBase('asashio_(kancolle)', new Map([['asashio_(kancolle)', 'kantai_collection']]))).toBeNull()
    expect(variantBase('kazusa_(blue_archive)', new Map([['kazusa_(blue_archive)', 'blue_archive']]))).toBeNull()
  })

  it('several versions of one character in the same image collapse without errors', async () => {
    const { decideEnsemble } = await import('../src/core/pipeline/decide')
    const { DEFAULT_THRESHOLDS } = await import('../src/shared/defaults')
    const rows = decideEnsemble(
      {
        wd: [
          { tag: 'ako_(blue_archive)', score: 0.9 },
          { tag: 'ako_(dress)_(blue_archive)', score: 0.95 },
          { tag: 'ako_(swimsuit)_(blue_archive)', score: 0.3 }
        ]
      },
      DEFAULT_THRESHOLDS
    )
    expect(rows.map((r) => `${r.status}:${r.tag}`)).toEqual(['auto:ako_(dress)_(blue_archive)'])
  })

  it('version + base in one image = one person; tree nests versions; base node lists all', async () => {
    const core = new SortaCore(join(dir, 'data'), {
      taggerFactory: async () =>
        new MockTagger({
          '255,0,0': tags([['ako_(dress)_(blue_archive)', 0.95], ['ako_(blue_archive)', 0.97]]),
          '0,255,0': tags([['ako_(blue_archive)', 0.96]])
        })
    })
    core.saveSettings({ sourceDirs: [src] })
    await solid(join(src, 'r.png'), [255, 0, 0])
    await solid(join(src, 'g.png'), [0, 255, 0])
    await core.runImport().done
    await core.runClassify().done
    const all = core.images({ node: { type: 'all' }, rating: 'all', q: '' })
    expect(all.find((i) => i.path.endsWith('r.png'))!.characters.map((c) => c.name)).toEqual(['Ako (Dress)'])
    const ba = core.tree().series.find((s) => s.name === 'Blue Archive')!
    expect(ba.characters.map((c) => [c.name, c.count, c.children?.map((v) => [v.name, v.count])])).toEqual([
      ['Ako', 2, [['Ako (Dress)', 1]]]
    ])
    const ako = ba.characters[0]
    expect(core.images({ node: { type: 'character', id: ako.id }, rating: 'all', q: '' })).toHaveLength(2)
    expect(core.images({ node: { type: 'character', id: ako.children![0].id }, rating: 'all', q: '' })).toHaveLength(1)
    core.close()
  })
})

describe('version links stay inside the game', () => {
  it('a "(game)" tag is never a version of a same-named character', async () => {
    const { variantBase } = await import('../src/core/pipeline/tags')
    const map = new Map([['asuna_(blue_archive)', 'blue_archive']])
    expect(variantBase('asuna_(blue_archive)', map, () => true)).toBeNull()
    expect(variantBase('asuna_(bunny)_(blue_archive)', map)).toBe('asuna_(blue_archive)')
  })
})

describe('outfit candidates in review', () => {
  it('flags a candidate that is another outfit of a confirmed character', async () => {
    const core = new SortaCore(join(dir, 'data'), {
      taggerFactory: async () => new MockTagger({ '255,0,0': tags([['ako_(blue_archive)', 0.95]]) })
    })
    core.saveSettings({ sourceDirs: [src] })
    await solid(join(src, 'r.png'), [255, 0, 0])
    await core.runImport().done
    await core.runClassify().done
    const { ensureCharacter } = await import('../src/core/pipeline/classify')
    const dress = ensureCharacter(core.db, 'ako_(dress)_(blue_archive)')
    const img = core.images({ node: { type: 'all' }, rating: 'all', q: '' })[0].id
    core.db
      .prepare("INSERT INTO image_characters (image_id, character_id, status, source, confidence, candidates) VALUES (?, ?, 'pending', 'auto', 0.6, ?)")
      .run(img, dress, JSON.stringify([{ characterId: dress, score: 0.6 }]))
    const [q] = core.reviewQueue('character')
    expect(q.confirmed.map((c) => c.name)).toEqual(['Ako'])
    expect(q.candidates.map((c) => [c.name, c.relatedTo?.name])).toEqual([['Ako (Dress)', 'Ako']])
    core.close()
  })
})

describe('autocomplete: characters the taggers know', () => {
  it('lists model-known characters after library ones and creates them on pick', async () => {
    const core = new SortaCore(':memory:', {
      vocabTags: ['lux_(league_of_legends)', 'lux_(star_guardian)_(league_of_legends)', 'luxu_(blue_archive)', 'hoshino_(blue_archive)'],
      seriesMap: new Map([['lux_(league_of_legends)', 'league_of_legends']])
    })
    core.createCharacter('Hoshino', 'Blue Archive')
    const hits = await core.searchCharacters('lux')
    expect(hits.map((h) => [h.id, h.name, h.series])).toEqual([
      [0, 'Lux', 'League Of Legends'],
      [0, 'Luxu', 'Blue Archive'],
      [0, 'Lux (Star Guardian)', 'League Of Legends']
    ])
    expect((await core.searchCharacters('lux league')).map((h) => h.tag)).toEqual([
      'lux_(league_of_legends)',
      'lux_(star_guardian)_(league_of_legends)'
    ])
    const lux = await core.characterFromTag('lux_(league_of_legends)')
    expect(lux).toMatchObject({ name: 'Lux', series: 'League Of Legends' })
    expect(lux.id).toBeGreaterThan(0)
    // now a library character, listed once
    const again = await core.searchCharacters('lux')
    expect(again[0]).toMatchObject({ id: lux.id, name: 'Lux' })
    expect(again.filter((h) => h.name === 'Lux')).toHaveLength(1)
    core.close()
  })
})
