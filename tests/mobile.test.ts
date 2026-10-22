import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gunzipSync } from 'zlib'
import sharp from 'sharp'
import { SortaCore } from '../src/core'
import { MockTagger } from '../src/core/ml/mock'
import type { TagResult } from '../src/core/ml/types'
import { libFilePath } from '../src/core/libfile'
import { mobileDir } from '../src/core/mobile'
import type { Pack } from '../src/core/pack'
import type { LibraryFilter } from '../src/shared/types'
import { MOBILE_FORMAT, MOBILE_VERSION } from '../src/shared/mobile'
import type { MobileEdit, MobileEditFile } from '../src/shared/mobile'

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
  dir = mkdtempSync(join(tmpdir(), 'sorta-mobile-'))
  src = join(dir, 'src')
  out = join(dir, 'sorted')
  mkdirSync(src, { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

// Hoshino (auto, organized) and a picture still in review in the source folder.
async function library(): Promise<SortaCore> {
  const core = new SortaCore(join(dir, 'data'), {
    taggerFactory: async () =>
      new MockTagger({
        '255,0,0': tags([['hoshino_(blue_archive)', 0.95]]),
        '0,255,0': tags([
          ['shiroko_(blue_archive)', 0.5],
          ['hoshino_(blue_archive)', 0.4]
        ])
      })
  })
  core.saveSettings({ sourceDirs: [src], organizeDir: out, moveAuto: true })
  await solid(join(src, 'hoshino.png'), [255, 0, 0])
  await solid(join(src, 'open.png'), [0, 255, 0])
  await core.runImport().done
  await core.runClassify().done
  await core.runOrganize().done
  return core
}

const readLib = (): Pack => JSON.parse(gunzipSync(readFileSync(libFilePath(out))).toString('utf8')) as Pack

function drop(edits: MobileEdit[], at = Date.now()): string {
  const f: MobileEditFile = { format: MOBILE_FORMAT, version: MOBILE_VERSION, device: 'phone', createdAt: at, basedOn: 0, edits }
  mkdirSync(mobileDir(out), { recursive: true })
  const file = join(mobileDir(out), `phone-${at}.json`)
  writeFileSync(file, JSON.stringify(f))
  return file
}

describe('Sorta 모바일', () => {
  it('the library file also lists source-folder pictures (for review) and keeps 미리 보기', async () => {
    const core = await library()
    expect(await core.writeLibFile('test')).toBe(true)
    const p = readLib()
    expect(p.roots).toEqual([src])
    const open = p.files!.find((f) => f.p === 'open.png')!
    expect(open.r).toBe(0)
    expect(open.chars.some((c) => c.st === 'pending')).toBe(true)
    expect(p.files!.find((f) => f.p.endsWith('hoshino.png'))!.r).toBeUndefined()
    const thumbs = readdirSync(join(out, '.sorta', 'thumbs'))
    expect(thumbs.sort()).toEqual(p.files!.map((f) => `${f.sha}.webp`).sort())
    core.close()
  })

  it('applies the phone changes and deletes the file', async () => {
    const core = await library()
    await core.writeLibFile('test')
    const p = readLib()
    const open = p.files!.find((f) => f.p === 'open.png')!
    const hoshino = p.files!.find((f) => f.p.endsWith('hoshino.png'))!
    const shiroko = p.series[0].characters.find((c) => c.name === 'Shiroko')!
    const file = drop([
      // review: Shiroko + a character typed on the phone
      {
        op: 'image',
        at: 1,
        sha: open.sha,
        label: '캐릭터 확정',
        set: {
          chars: [
            { c: { k: shiroko.key, name: 'Shiroko', series: 'Blue Archive' }, st: 'confirmed', src: 'user', conf: 1, cand: null },
            { c: { name: 'New Girl', series: 'Blue Archive' }, st: 'confirmed', src: 'user', conf: 1, cand: null }
          ],
          kind: 'character',
          go: 0,
          rating: { v: 'sensitive', src: 'user', rr: 0 }
        }
      },
      { op: 'image', at: 2, sha: hoshino.sha, label: '즐겨찾기', set: { fav: 1, stars: 5, groups: ['폰'] } },
      { op: 'place', at: 3, char: { k: shiroko.key, name: 'Shiroko', series: 'Blue Archive' }, path: ['Abydos', 'Foreclosure Task Force'] },
      { op: 'image', at: 4, sha: 'nope', label: 'x', set: { fav: 1 } }
    ])
    const files = await core.pendingMobileEdits()
    expect(files).toEqual([file])
    const r = await core.runMobileEdits(files).done
    expect(r).toEqual({ files: 1, applied: 3, skipped: 1 })
    expect(existsSync(file)).toBe(false)

    const o = byName(core, 'open.png')
    expect(o.characters.map((c) => [c.name, c.status]).sort()).toEqual([
      ['New Girl', 'confirmed'],
      ['Shiroko', 'confirmed']
    ])
    expect(o.rating).toBe('sensitive')
    const h = byName(core, 'hoshino.png')
    expect([h.favorite, h.stars]).toEqual([true, 5])
    expect(core.groups().map((g) => g.name)).toEqual(['폰'])
    expect(h.groups).toEqual([core.groups()[0].id])
    const chart = core.orgChart('Blue Archive')
    const task = chart.nodes.find((n) => n.name === 'Foreclosure Task Force')!
    expect(chart.nodes.find((n) => n.id === task.parentId)?.name).toBe('Abydos')
    expect(chart.characters.find((c) => c.name === 'Shiroko')?.affiliationId).toBe(task.id)

    // each change is a Ctrl+Z step: the review comes back last
    for (let i = 0; i < 8; i++) await core.undo()
    expect(byName(core, 'open.png').characters.some((c) => c.status === 'pending')).toBe(true)
    core.close()
  })
})
