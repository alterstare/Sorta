import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import sharp from 'sharp'
import { SortaCore } from '../src/core'
import { MockTagger } from '../src/core/ml/mock'
import type { TagResult } from '../src/core/ml/types'
import { libFilePath } from '../src/core/libfile'
import type { LibraryFilter } from '../src/shared/types'

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
const ALL: LibraryFilter = { node: { type: 'all' }, ratings: ['general', 'sensitive', 'r18'], sort: 'date', dir: 'desc', q: '' }
const byName = (core: SortaCore, name: string) => core.images(ALL).find((i) => i.path.endsWith(name))!

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sorta-lib-'))
  src = join(dir, 'src')
  out = join(dir, 'sorted')
  mkdirSync(src, { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// A classified, organized library: Hoshino (auto), Shiroko (confirmed by the
// user from the review queue), a 기타 picture; favorite, stars, a group, a 소속.
async function organized(): Promise<SortaCore> {
  const core = new SortaCore(join(dir, 'data'), {
    taggerFactory: async () =>
      new MockTagger({
        '255,0,0': tags([['hoshino_(blue_archive)', 0.95]]),
        '0,255,0': tags([['shiroko_(blue_archive)', 0.5]]),
        '0,0,255': tags([])
      })
  })
  core.saveSettings({ sourceDirs: [src], organizeDir: out, moveAuto: true })
  await solid(join(src, 'hoshino.png'), [255, 0, 0])
  await solid(join(src, 'shiroko.png'), [0, 255, 0])
  await solid(join(src, 'other.png'), [0, 0, 255])
  await core.runImport().done
  await core.runClassify().done
  const shiroko = byName(core, 'shiroko.png')
  const sid = core.characters().find((c) => c.name === 'Shiroko')!.id
  core.confirmCharacters([shiroko.id], [sid])
  core.markOther([byName(core, 'other.png').id])
  const hoshino = byName(core, 'hoshino.png')
  core.setFavorite([hoshino.id], true)
  core.setStars([hoshino.id], 4)
  core.createGroup('최애', [hoshino.id, shiroko.id])
  core.addAffiliation('Blue Archive', 'Abydos', null)
  core.setAffiliation([sid], 'Abydos')
  await core.runOrganize().done
  return core
}

describe('분류 정보 파일', () => {
  it('a new install reads the organize folder back already classified', async () => {
    const a = await organized()
    expect(a.libFileDirty()).toBe(true)
    expect(await a.writeLibFile('test')).toBe(true)
    expect(a.libFileDirty()).toBe(false)
    expect(existsSync(libFilePath(out))).toBe(true)
    expect(await a.pendingLibFile()).toBeNull() // my own file
    a.close()

    // another PC / reinstall: empty data folder, same organize folder
    const b = new SortaCore(join(dir, 'data2'))
    b.saveSettings({ organizeDir: out })
    const file = await b.pendingLibFile()
    expect(file).toBe(libFilePath(out))
    const r = await b.runRestore(file!, { learned: true }).done
    expect(r).toMatchObject({ added: 3, missing: 0, changed: 0 })
    const h = byName(b, 'hoshino.png')
    expect(h.path.startsWith(join(out, 'Blue Archive'))).toBe(true)
    expect(h.favorite).toBe(true)
    expect(h.stars).toBe(4)
    expect(b.groups().map((g) => g.name)).toEqual(['최애'])
    const chars = b.characters()
    expect(chars.find((c) => c.name === 'Shiroko')?.affiliation).toBe('Abydos')
    // statuses survive: Shiroko is the user's confirmation, 기타 stays 기타
    const st = (name: string) =>
      b.db
        .prepare('SELECT ic.status, ic.source FROM image_characters ic JOIN images i ON i.id = ic.image_id WHERE i.path LIKE ?')
        .all('%' + name) as { status: string; source: string }[]
    expect(st('shiroko.png')).toEqual([{ status: 'confirmed', source: 'user' }])
    expect(st('hoshino.png')).toEqual([{ status: 'auto', source: 'auto' }])
    expect(byName(b, 'other.png').kind).toBe('other')
    // read once: not offered again
    expect(await b.pendingLibFile()).toBeNull()

    // restoring again adds nothing; undo removes what the restore added
    const again = await b.runRestore(file!, { learned: true }).done
    expect(again).toMatchObject({ added: 0, kept: 3 })
    await b.undo() // the second (empty) restore
    await b.undo()
    expect(b.images(ALL)).toHaveLength(0)
    b.close()
  })

  it('off → nothing is written', async () => {
    const a = await organized()
    a.saveSettings({ libraryFile: false })
    expect(a.libFileDirty()).toBe(false)
    expect(await a.writeLibFile('test')).toBe(false)
    expect(existsSync(libFilePath(out))).toBe(false)
    a.close()
  })
})
