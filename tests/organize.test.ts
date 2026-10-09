import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, existsSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join, relative } from 'path'
import sharp from 'sharp'
import { SortaCore } from '../src/core'
import { MockTagger } from '../src/core/ml/mock'
import type { TagResult } from '../src/core/ml/types'
import { safeName } from '../src/core/organize'

let dir: string
let src: string
let out: string

const tags = (chars: [string, number][]): TagResult => ({
  rating: { general: 1, sensitive: 0, questionable: 0, explicit: 0 },
  characters: chars.map(([tag, score]) => ({ tag, score })),
  general: []
})
async function solid(path: string, rgb: [number, number, number]): Promise<void> {
  await sharp({ create: { width: 40, height: 40, channels: 3, background: { r: rgb[0], g: rgb[1], b: rgb[2] } } })
    .png()
    .toFile(path)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sorta-'))
  src = join(dir, 'src')
  out = join(dir, 'sorted')
  mkdirSync(src, { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

async function setup(): Promise<SortaCore> {
  const core = new SortaCore(join(dir, 'data'), {
    taggerFactory: async () =>
      new MockTagger({
        '255,0,0': tags([['hoshino_(blue_archive)', 0.95]]),
        '0,255,0': tags([['shiroko_(blue_archive)', 0.5]]), // pending
        '0,0,255': tags([]), // → 캐릭터 아님
        '255,255,0': tags([['hoshino_(blue_archive)', 0.95], ['shiroko_(blue_archive)', 0.9]]),
        '0,255,255': tags([['hoshino_(blue_archive)', 0.95], ['hu_tao_(genshin_impact)', 0.9]]),
        '255,0,255': tags([['ako_(dress)_(blue_archive)', 0.95]])
      })
  })
  core.saveSettings({ sourceDirs: [src], organizeDir: out })
  await solid(join(src, 'hoshino.png'), [255, 0, 0])
  await solid(join(src, 'pending.png'), [0, 255, 0])
  await solid(join(src, 'other.png'), [0, 0, 255])
  await solid(join(src, 'duo.png'), [255, 255, 0])
  await solid(join(src, 'cross.png'), [0, 255, 255])
  await solid(join(src, 'dress.png'), [255, 0, 255])
  await core.runImport().done
  await core.runClassify().done
  const other = core.images({ node: { type: 'all' }, rating: 'all', q: '' }).find((i) => i.path.endsWith('other.png'))!
  core.markOther([other.id])
  return core
}

const where = (core: SortaCore, name: string): string => {
  const p = core.images({ node: { type: 'all' }, rating: 'all', q: '' }).find((i) => i.path.endsWith(name))!.path
  return relative(dir, p).replace(/\\/g, '/')
}

describe('folder organizing', () => {
  it('plans the folders from the rules, moves, and undoes exactly', async () => {
    const core = await setup()
    const plan = core.organizePlan()
    expect(plan.unsettled).toBe(1) // pending.png
    expect(plan.byFolder.map((f) => f.folder.replace(/\\/g, '/')).sort()).toEqual([
      'Blue Archive/Ako',
      'Blue Archive/Hoshino',
      'Blue Archive/단체',
      '기타',
      '단체'
    ])
    const r = await core.runOrganize().done
    expect(r).toEqual({ moved: 5, failed: [] })
    expect(where(core, 'hoshino.png')).toBe('sorted/Blue Archive/Hoshino/hoshino.png')
    expect(where(core, 'dress.png')).toBe('sorted/Blue Archive/Ako/dress.png') // version → base folder
    expect(where(core, 'pending.png')).toBe('src/pending.png')
    expect(existsSync(join(out, 'Blue Archive', 'Hoshino', 'hoshino.png'))).toBe(true)
    expect(existsSync(join(src, 'hoshino.png'))).toBe(false)
    // Second run: nothing left to do.
    expect(core.organizePlan().moves).toHaveLength(0)
    expect(await core.undo()).toMatchObject({ label: '폴더 정리 (5장)' })
    expect(where(core, 'hoshino.png')).toBe('src/hoshino.png')
    expect(existsSync(join(src, 'hoshino.png'))).toBe(true)
    core.close()
  })

  it('organized images follow a classification change; name clashes get a suffix', async () => {
    const core = await setup()
    mkdirSync(join(out, 'Blue Archive', 'Hoshino'), { recursive: true })
    writeFileSync(join(out, 'Blue Archive', 'Hoshino', 'hoshino.png'), 'someone else')
    await core.runOrganize().done
    expect(where(core, 'hoshino (2).png')).toBe('sorted/Blue Archive/Hoshino/hoshino (2).png')
    const id = core.images({ node: { type: 'all' }, rating: 'all', q: '' }).find((i) => i.path.endsWith('hoshino (2).png'))!.id
    const aoi = core.createCharacter('Aoi', 'Blue Archive')
    core.confirmCharacters([id], [aoi])
    await core.runReorganize().done
    expect(where(core, 'hoshino (2).png')).toBe('sorted/Blue Archive/Aoi/hoshino (2).png')
    core.close()
  })

  it('moveAuto off: only user-confirmed images move', async () => {
    const core = await setup()
    core.saveSettings({ moveAuto: false })
    const plan = core.organizePlan()
    // Every picture here is auto-confirmed except 기타 (user marked it).
    expect(plan.moves.map((m) => basename(m.from))).toEqual(['other.png'])
    const id = core.images({ node: { type: 'all' }, rating: 'all', q: '' }).find((i) => i.path.endsWith('hoshino.png'))!.id
    const hoshino = core.characters().find((c) => c.name === 'Hoshino')!
    core.confirmCharacters([id], [hoshino.id])
    expect(core.organizePlan().moves).toHaveLength(2)
    core.close()
  })

  it('folder names are Windows-safe', () => {
    expect(safeName('Fate/Grand Order: "X"?')).toBe('Fate_Grand Order_ _X__')
    expect(safeName('dots...')).toBe('dots')
  })
})

describe('character management', () => {
  it('affiliation and game changes shape the folders; merge + undo', async () => {
    const core = await setup()
    const list = (): ReturnType<SortaCore['characters']> => core.characters()
    const hoshino = list().find((c) => c.name === 'Hoshino')!
    const shiroko = list().find((c) => c.name === 'Shiroko')!
    core.setAffiliation([hoshino.id, shiroko.id], 'Abydos')
    // duo.png: Hoshino + Shiroko, both Abydos → 게임/소속
    const plan = core.organizePlan()
    const dest = (n: string): string =>
      relative(out, plan.moves.find((m) => m.from.endsWith(n))!.to).split('\\').join('/')
    expect(dest('duo.png')).toBe('Blue Archive/Abydos/duo.png')
    expect(dest('hoshino.png')).toBe('Blue Archive/Abydos/Hoshino/hoshino.png')

    core.renameCharacter(hoshino.id, '호시노')
    expect(list().find((c) => c.id === hoshino.id)!.name).toBe('호시노')
    expect(() => core.renameCharacter(hoshino.id, 'Shiroko')).toThrow()

    // Merge Shiroko into Hoshino: duo.png now shows one character.
    core.mergeCharacters([shiroko.id], hoshino.id)
    expect(list().some((c) => c.id === shiroko.id)).toBe(false)
    expect(list().find((c) => c.id === hoshino.id)!.aliases).toContain('Shiroko')
    const duo = (): string[] =>
      core
        .images({ node: { type: 'all' }, rating: 'all', q: '' })
        .find((i) => i.path.endsWith('duo.png'))!
        .characters.map((c) => c.name ?? '')
    expect(duo()).toEqual(['호시노'])
    expect(await core.undo()).toMatchObject({ label: '캐릭터 합치기' })
    expect(duo().sort()).toEqual(['Shiroko', '호시노'])
    expect(list().find((c) => c.id === shiroko.id)!.affiliation).toBe('Abydos')

    core.setSeries([hoshino.id], 'Other Game')
    expect(list().find((c) => c.id === hoshino.id)!.series).toBe('Other Game')
    core.close()
  })
})
