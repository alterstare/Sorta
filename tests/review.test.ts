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
  rating: { general: 1 - adult, sensitive: 0, questionable: 0, explicit: adult },
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
  core.images({ node: { type: 'all' }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' }).find((i) => i.path.endsWith(name))!.id

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
  it('단체 사진으로만 분류: out of review and 미확인, kept through re-decision, organized to 단체, undoable', async () => {
    const core = await setup()
    const g = idOf(core, 'g.png')
    core.markGroup([g])
    expect(core.reviewQueue('character')).toHaveLength(0)
    const tree = (): ReturnType<SortaCore['tree']>['counts'] => core.tree(['general', 'sensitive', 'r18']).counts
    expect(tree().groupShot).toBe(1)
    const shots = (): { id: number; kind: string }[] =>
      core.images({ node: { type: 'groupShot' }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' })
    expect(shots().map((i) => [i.id, i.kind])).toEqual([[g, 'group']])
    await core.runRedecide().done
    expect(core.reviewQueue('character')).toHaveLength(0)
    expect(core.images({ node: { type: 'unknown' }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' }).some((i) => i.id === g)).toBe(false)
    const { targetDir } = await import('../src/core/organize')
    expect(targetDir({ kind: 'character', rating: 'general', group_only: 1, rows: [] }, new Map(), { splitByRating: false, moveAuto: true, thresholds: core.settings().thresholds })).toBe('단체')
    expect(await core.undo()).toEqual({ ok: true, label: '단체 사진으로 분류' })
    expect(core.reviewQueue('character')).toHaveLength(1)
    expect(tree().groupShot).toBe(0)
    // with a game: 게임/단체, listed under the game
    core.markGroup([g], 'Blue Archive')
    const t = core.tree(['general', 'sensitive', 'r18'])
    const ba = t.series.find((x) => x.name === 'Blue Archive')!
    expect(ba.groupShots).toBe(1)
    expect(core.images({ node: { type: 'series', id: ba.id }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' }).some((i) => i.id === g)).toBe(true)
    expect(core.images({ node: { type: 'groupShot', id: ba.id }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' }).map((i) => i.groupSeries)).toEqual(['Blue Archive'])
    expect(
      targetDir({ kind: 'character', rating: 'general', group_only: 1, group_series: 'Blue Archive', rows: [] }, new Map(), { splitByRating: false, moveAuto: true, thresholds: core.settings().thresholds })!.replace(/\\/g, '/')
    ).toBe('Blue Archive/단체')
    await core.undo()
    expect(core.tree(['general', 'sensitive', 'r18']).series.find((x) => x.name === 'Blue Archive')!.groupShots).toBeUndefined()
    // confirming characters clears it
    core.markGroup([g])
    core.confirmCharacters([g], [core.reviewQueue('character').length ? 0 : core.characters()[0].id])
    expect(tree().groupShot).toBe(0)
    core.close()
  })

  it('confirm several characters, survive re-decision, undo restores', async () => {
    const core = await setup()
    const g = idOf(core, 'g.png')
    const [shiroko, hoshino] = core.reviewQueue('character')[0].candidates.map((c) => c.id)
    core.confirmCharacters([g], [shiroko, hoshino])
    expect(core.reviewQueue('character')).toHaveLength(0)
    const names = (): string[] =>
      core
        .images({ node: { type: 'all' }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' })
        .find((i) => i.id === g)!
        .characters.map((c) => `${c.name}:${c.status}`)
        .sort()
    expect(names()).toEqual(['Hoshino:confirmed', 'Shiroko:confirmed'])
    // A threshold change must not overwrite the user's decision.
    await core.runRedecide().done
    expect(names()).toEqual(['Hoshino:confirmed', 'Shiroko:confirmed'])
    expect(await core.undo()).toEqual({ ok: true, label: '캐릭터 확정' })
    expect(core.reviewQueue('character')).toHaveLength(1)
    // redo puts the decision back; it can be undone again
    expect(await core.redo()).toEqual({ ok: true, label: '캐릭터 확정' })
    expect(names()).toEqual(['Hoshino:confirmed', 'Shiroko:confirmed'])
    expect(await core.redo()).toEqual({ ok: true, label: null })
    await core.undo()
    expect(core.reviewQueue('character')).toHaveLength(1)
    // a new action drops what could be redone
    core.markOther([idOf(core, 'b.png')])
    expect(await core.redo()).toEqual({ ok: true, label: null })
    core.close()
  })

  it('캐릭터 아님 and rating are user decisions too', async () => {
    const core = await setup()
    const b = idOf(core, 'b.png')
    core.markOther([b])
    core.setRating([b], 'general')
    await core.runRedecide().done
    const img = core.images({ node: { type: 'other' }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' })
    expect(img.map((i) => [i.id, i.rating, i.ratingReview])).toEqual([[b, 'general', false]])
    expect(core.reviewQueue('rating')).toHaveLength(0)
    await core.undo() // rating
    expect(core.reviewQueue('rating')).toHaveLength(1)
    await core.undo() // 캐릭터 아님
    expect(core.images({ node: { type: 'other' }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' })).toHaveLength(0)
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
    const all = core.images({ node: { type: 'all' }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' })
    expect(all.find((i) => i.path.endsWith('r.png'))!.characters.map((c) => c.name)).toEqual(['Ako (Dress)'])
    const ba = core.tree().series.find((s) => s.name === 'Blue Archive')!
    expect(ba.characters.map((c) => [c.name, c.count, c.children?.map((v) => [v.name, v.count])])).toEqual([
      ['Ako', 2, [['Ako (Dress)', 1]]]
    ])
    const ako = ba.characters[0]
    expect(core.images({ node: { type: 'character', id: ako.id }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' })).toHaveLength(2)
    expect(core.images({ node: { type: 'character', id: ako.children![0].id }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' })).toHaveLength(1)
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
    const img = core.images({ node: { type: 'all' }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' })[0].id
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

describe('library: rating filter counts, sorting, favorites / stars / groups', () => {
  it('counts per node with the rating filter and undoes collection edits', async () => {
    const core = new SortaCore(':memory:')
    const ins = core.db.prepare(
      "INSERT INTO images (path, sha256, imported_at, rating, file_size, file_mtime, classified_at) VALUES (?, ?, ?, ?, ?, ?, 1)"
    )
    ins.run('C:/x/b.png', 'b', 1, 'general', 300, 30)
    ins.run('C:/x/a10.jpg', 'a10', 2, 'r18', 100, 10)
    ins.run('C:/x/a2.png', 'a2', 3, 'sensitive', 200, 20)
    const F = (o: object) => ({ node: { type: 'all' as const }, ratings: ['general', 'sensitive', 'r18'] as const, sort: 'name' as const, dir: 'asc' as const, q: '', ...o })
    const names = (o: object): string[] => core.images(F(o) as never).map((i) => i.name)
    expect(names({})).toEqual(['a2.png', 'a10.jpg', 'b.png']) // numeric name order
    expect(names({ sort: 'size', dir: 'desc' })).toEqual(['b.png', 'a2.png', 'a10.jpg'])
    expect(names({ sort: 'type' })).toEqual(['a10.jpg', 'a2.png', 'b.png'])
    expect(names({ ratings: ['general', 'sensitive'] })).toEqual(['a2.png', 'b.png'])
    const t = core.tree(['general'])
    expect(t.counts.all).toBe(3)
    expect(t.shown?.all).toBe(1)
    expect(core.tree().shown).toBeUndefined()

    const ids = core.images(F({}) as never).map((i) => i.id)
    core.setFavorite([ids[0]], true)
    core.setStars([ids[0], ids[1]], 4)
    const g = core.createGroup('최애', [ids[2]])
    core.setGroupMembership([ids[0]], g, true)
    expect(core.tree().counts.favorite).toBe(1)
    expect(core.tree().groups).toEqual([{ id: g, name: '최애', count: 2, shown: undefined }])
    expect(names({ node: { type: 'group', id: g } })).toEqual(['a2.png', 'b.png'])
    // 그룹 filter: only pictures in the checked groups, counts in parentheses follow
    expect(names({ groups: [g] })).toEqual(['a2.png', 'b.png'])
    expect(names({ groups: [g], ratings: ['general'] })).toEqual(['b.png'])
    expect(core.tree(['general', 'sensitive', 'r18'], [g]).shown?.all).toBe(2)
    expect(() => core.createGroup('최애')).toThrow()
    core.deleteGroup(g)
    expect(core.tree().groups).toHaveLength(0)
    await core.undo() // group back with its members
    expect(core.tree().groups[0]).toMatchObject({ name: '최애', count: 2 })
    await core.undo() // membership
    await core.undo() // creation
    expect(core.tree().groups).toHaveLength(0)
    await core.undo() // stars
    expect(core.images(F({}) as never).map((i) => i.stars)).toEqual([0, 0, 0])
    expect(core.images(F({}) as never)[0].favorite).toBe(true)
    core.close()
  })
})
