import { describe, expect, it } from 'vitest'
import { SortaCore } from '../src/core'
import { cleanValue, pickTitle, readAffiliations, templates } from '../src/core/pipeline/wiki'
import { targetDir } from '../src/core/organize'
import { DEFAULT_THRESHOLDS } from '../src/shared/defaults'

const names = (core: SortaCore, series: string): Record<string, string | null> => {
  const c = core.orgChart(series)
  const byId = new Map(c.nodes.map((n) => [n.id, n]))
  return Object.fromEntries(c.characters.map((x) => [x.name, x.affiliationId ? byId.get(x.affiliationId)!.name : null]))
}

describe('소속 조직도', () => {
  it('add / nest / move / rename / delete, each one undo step', async () => {
    const core = new SortaCore(':memory:')
    const hoshino = core.createCharacter('Hoshino', 'Blue Archive')
    const hina = core.createCharacter('Hina', 'Blue Archive')
    const abydos = core.addAffiliation('Blue Archive', 'Abydos', null)
    const task = core.addAffiliation('Blue Archive', 'Countermeasure', abydos)
    const gehenna = core.addAffiliation('Blue Archive', 'Gehenna', null)
    expect(() => core.addAffiliation('Blue Archive', 'Abydos', null)).toThrow()
    core.placeCharacters([hoshino], task)
    core.placeCharacters([hina], gehenna)
    expect(names(core, 'Blue Archive')).toEqual({ Hina: 'Gehenna', Hoshino: 'Countermeasure' })

    // reorder: Gehenna first among top-level
    core.moveAffiliation(gehenna, null, 0)
    const top = (): string[] =>
      core
        .orgChart('Blue Archive')
        .nodes.filter((n) => n.parentId === null)
        .sort((a, b) => a.order - b.order)
        .map((n) => n.name)
    expect(top()).toEqual(['Gehenna', 'Abydos'])
    expect(() => core.moveAffiliation(abydos, task)).toThrow() // under its own child

    core.renameAffiliation(abydos, '아비도스')
    expect(core.orgChart('Blue Archive').nodes.find((n) => n.id === abydos)!.aliases).toEqual(['Abydos'])

    // delete Countermeasure → Hoshino moves up to 아비도스
    core.deleteAffiliation(task)
    expect(names(core, 'Blue Archive').Hoshino).toBe('아비도스')
    await core.undo()
    expect(names(core, 'Blue Archive').Hoshino).toBe('Countermeasure')
    await core.undo() // rename
    expect(core.orgChart('Blue Archive').nodes.find((n) => n.id === abydos)!.name).toBe('Abydos')
    core.close()
  })

  it('wiki paths reuse names/aliases and create the missing levels', async () => {
    const core = new SortaCore(':memory:')
    const a = core.createCharacter('Hu Tao', 'Genshin Impact')
    const b = core.createCharacter('Zhongli', 'Genshin Impact')
    const liyue = core.addAffiliation('Genshin Impact', '리월', null)
    core.renameAffiliation(liyue, '璃月') // '리월' becomes an alias
    core.renameAffiliation(liyue, '리월')
    core.renameAffiliation(liyue, 'Liyue Region')
    // 'Liyue' unknown, '리월' alias → reused
    const n = core.applyAffiliations('Genshin Impact', [
      { characterId: a, path: ['리월', 'Wangsheng Funeral Parlor'] },
      { characterId: b, path: ['리월', 'Wangsheng Funeral Parlor'] }
    ])
    expect(n).toBe(2)
    const chart = core.orgChart('Genshin Impact')
    expect(chart.nodes.map((x) => x.name).sort()).toEqual(['Liyue Region', 'Wangsheng Funeral Parlor'])
    expect(names(core, 'Genshin Impact')).toEqual({ 'Hu Tao': 'Wangsheng Funeral Parlor', Zhongli: 'Wangsheng Funeral Parlor' })
    await core.undo()
    expect(core.orgChart('Genshin Impact').nodes).toHaveLength(1)
    expect(names(core, 'Genshin Impact')).toEqual({ 'Hu Tao': null, Zhongli: null })
    core.close()
  })

  it('wiki lookup: finds the wiki, the page and the infobox path (name only)', async () => {
    const asked: string[] = []
    const core = new SortaCore(':memory:', {
      wikiGapMs: 0,
      wikiGet: async (url) => {
        asked.push(url)
        const u = new URL(url)
        if (u.searchParams.get('meta') === 'siteinfo')
          return { query: { statistics: { articles: u.hostname.startsWith('bluearchive') ? 900 : 3 } } }
        if (u.searchParams.get('list') === 'search')
          return { query: { search: [{ title: 'Takanashi Hoshino (Swimsuit ver.)/Audio' }, { title: 'Takanashi Hoshino/Gallery' }] } }
        expect(u.searchParams.get('titles')).toBe('Takanashi Hoshino')
        return {
          query: {
            pages: {
              '2': {
                title: 'Takanashi Hoshino',
                revisions: [{ slots: { main: { '*': '{{Parent Tab|tab1=x}}\n{{Character\n | name = Takanashi Hoshino\n | school = ABYDOS\n | club = COUNTERMEASURE\n | city = 1\n}}' } } }]
              }
            }
          }
        }
      }
    })
    core.saveSettings({ allowWebLookup: true })
    core.createCharacter('Hoshino', 'Blue Archive')
    const r = await core.wikiLookup('Blue Archive').done
    expect(r.wiki).toBe('bluearchive.fandom.com')
    expect(r.suggestions[0]).toMatchObject({ page: 'Takanashi Hoshino', path: ['Abydos', 'Countermeasure'] })
    expect(core.orgChart('Blue Archive').wiki).toBe('bluearchive.fandom.com')
    expect(asked.every((u) => !/\.(png|jpe?g|webp)/i.test(u))).toBe(true)
    core.close()
  })
})

describe('wikitext', () => {
  it('reads infobox fields into a path', () => {
    const t = `{{Character Infobox
|region           = Liyue
|affiliation      = [[Wangsheng Funeral Parlor]]<ref>x</ref>
|affiliation2     = Hu Family
|title2 = {{Relative|a|b}}
}}`
    expect(templates(t)[0].params.get('region')).toBe('Liyue')
    expect(readAffiliations(t)).toEqual({
      path: ['Liyue', 'Wangsheng Funeral Parlor'],
      fields: [
        { field: 'region', value: 'Liyue' },
        { field: 'affiliation', value: 'Wangsheng Funeral Parlor' },
        { field: 'affiliation2', value: 'Hu Family' }
      ]
    })
    expect(cleanValue('[[Penguin Logistics|PL]]')).toBe('PL')
    expect(cleanValue('ABYDOS_HIGH')).toBe('Abydos High')
    expect(cleanValue('* First\n* Second')).toBe('First')
  })

  it('picks the character page, not a lookalike', () => {
    expect(pickTitle('Hoshino', ['Pantalone'])).toBeNull()
    expect(pickTitle('Texas', ['Texas the Omertosa', 'Texas'])).toBe('Texas')
    expect(pickTitle('Ichika', ['Nakamasa Ichika (Swimsuit ver.)/Audio', 'Nakamasa Ichika/Audio'])).toBe('Nakamasa Ichika')
  })

  it('folders: nested affiliations nest; a group goes to the deepest shared one', () => {
    const chars = new Map([
      [1, { root: 1, name: 'A', series: 'G', affiliation: ['School', 'Club1'] }],
      [2, { root: 2, name: 'B', series: 'G', affiliation: ['School', 'Club2'] }]
    ])
    const s = { splitByRating: false, moveAuto: true, thresholds: DEFAULT_THRESHOLDS }
    const img = (ids: number[]) => ({ kind: 'character', rating: 'general' as const, rows: ids.map((id) => ({ character_id: id, status: 'auto' })) })
    expect(targetDir(img([1]), chars, s)!.split(/[\\/]/)).toEqual(['G', 'School', 'Club1', 'A'])
    expect(targetDir(img([1, 2]), chars, s)!.split(/[\\/]/)).toEqual(['G', 'School'])
  })
})

describe('library tree: 소속 levels', () => {
  it('nests 소속 under the game, counts group shots once, lists them under the 소속', () => {
    const core = new SortaCore(':memory:')
    const hoshino = core.createCharacter('Hoshino', 'Blue Archive')
    const shiroko = core.createCharacter('Shiroko', 'Blue Archive')
    const hina = core.createCharacter('Hina', 'Blue Archive')
    const abydos = core.addAffiliation('Blue Archive', 'Abydos', null)
    const club = core.addAffiliation('Blue Archive', 'Countermeasure', abydos)
    core.placeCharacters([hoshino], club)
    core.placeCharacters([shiroko], abydos)
    const img = core.db.prepare("INSERT INTO images (path, sha256, imported_at, rating) VALUES (?, ?, 1, 'general')")
    const tag = core.db.prepare("INSERT INTO image_characters (image_id, character_id, status, source) VALUES (?, ?, 'confirmed', 'user')")
    const add = (name: string, ...chars: number[]): void => {
      const id = Number(img.run(`C:/x/${name}`, name).lastInsertRowid)
      for (const c of chars) tag.run(id, c)
    }
    add('h.png', hoshino)
    add('duo.png', hoshino, shiroko) // group shot
    add('hina.png', hina)
    const s = core.tree().series[0]
    expect(s.characters.map((c) => c.name)).toEqual(['Hina'])
    expect(s.affiliations).toHaveLength(1)
    const ab = s.affiliations[0]
    expect([ab.name, ab.count]).toEqual(['Abydos', 2]) // h + duo, duo once
    expect(ab.characters.map((c) => c.name)).toEqual(['Shiroko'])
    expect([ab.children[0].name, ab.children[0].count, ab.children[0].characters[0].name]).toEqual(['Countermeasure', 2, 'Hoshino'])
    const names = (id: number): string[] =>
      core
        .images({ node: { type: 'affiliation', id }, ratings: ['general', 'sensitive', 'r18'], sort: 'name', dir: 'asc', q: '' })
        .map((i) => i.name)
    expect(names(abydos)).toEqual(['duo.png', 'h.png'])
    expect(names(club)).toEqual(['duo.png', 'h.png'])
    core.close()
  })
})

describe('공유 파일 (.sortapack)', () => {
  it('exports games / 소속 / characters / learned refs and merges them into another library', async () => {
    const { mkdtempSync, rmSync } = await import('fs')
    const { tmpdir } = await import('os')
    const { join } = await import('path')
    const dir = mkdtempSync(join(tmpdir(), 'sorta-pack-'))
    const file = join(dir, 'ba.sortapack')
    const vec = (x: number): Buffer => Buffer.from(new Float32Array(768).fill(x).buffer)

    const a = new SortaCore(':memory:')
    const hoshino = a.createCharacter('Hoshino', 'Blue Archive')
    const swim = a.createCharacter('Hoshino (Swimsuit)', 'Blue Archive')
    a.db.prepare('UPDATE characters SET danbooru_tag = ?, parent_id = ? WHERE id = ?').run('hoshino_(swimsuit)_(blue_archive)', hoshino, swim)
    const hina = a.createCharacter('Hina', 'Blue Archive')
    a.applyAffiliations('Blue Archive', [
      { characterId: hoshino, path: ['Abydos', 'Countermeasure'] },
      { characterId: hina, path: ['Gehenna', 'Prefect Team'] }
    ])
    const ref = a.db.prepare('INSERT INTO refs (character_id, source, post_id, image_id, vector, created_at) VALUES (?, ?, ?, NULL, ?, 1)')
    ref.run(hoshino, 'booru', 101, vec(0.5))
    ref.run(hoshino, 'booru', 102, vec(0.25))
    ref.run(hoshino, 'user', null, vec(0.75)) // from my own picture: left out by default
    a.db.prepare("INSERT INTO learned (character_id, tag, refs, learned_at) VALUES (?, 'hoshino_(blue_archive)', 2, 5)").run(hoshino)
    await a.exportPack(file, '0.1.0', { includeLearned: true, includeUserRefs: false })

    // The receiver already has Hina, in Gehenna only.
    const b = new SortaCore(':memory:')
    const bHina = b.createCharacter('Hina', 'Blue Archive')
    const geh = b.addAffiliation('Blue Archive', 'Gehenna', null)
    b.placeCharacters([bHina], geh)
    const pv = await b.previewPack(file, { overwrite: false, learned: true })
    expect(pv).toMatchObject({ games: 1, newGames: 0, newCharacters: 2, learnedCharacters: 1, refs: 2, userRefs: 0, modelMismatch: false })
    expect(pv.newAffiliations).toBe(3) // Abydos, Countermeasure, Prefect Team
    expect(pv.conflicts).toEqual(['Hina: 내 소속 Gehenna · 파일 Prefect Team'])
    await b.importPack(file, { overwrite: false, learned: true })
    const chart = b.orgChart('Blue Archive')
    const name = (id: number | null): string | undefined => chart.nodes.find((n) => n.id === id)?.name
    const byName = (n: string) => chart.characters.find((c) => c.name === n)!
    expect(name(byName('Hoshino').affiliationId)).toBe('Countermeasure')
    expect(name(byName('Hina').affiliationId)).toBe('Gehenna') // mine kept
    expect(name(chart.nodes.find((n) => n.name === 'Countermeasure')!.parentId)).toBe('Abydos')
    const bHoshino = byName('Hoshino').id
    const refs = b.db.prepare('SELECT post_id, vector FROM refs WHERE character_id = ? ORDER BY post_id').all(bHoshino) as { post_id: number; vector: Buffer }[]
    expect(refs.map((r) => r.post_id)).toEqual([101, 102])
    expect(new Float32Array(refs[0].vector.buffer, refs[0].vector.byteOffset, 768)[0]).toBeCloseTo(0.5, 3)
    expect(b.learned().map((l) => [l.name, l.refs])).toEqual([['Hoshino', 2]])
    // variant link survives
    expect(b.db.prepare('SELECT parent_id FROM characters WHERE danbooru_tag = ?').get('hoshino_(swimsuit)_(blue_archive)')).toEqual({ parent_id: bHoshino })
    // importing again adds nothing new
    expect((await b.previewPack(file, { overwrite: false, learned: true })).newCharacters).toBe(0)
    // overwrite: Hina moves to the file's 소속
    await b.importPack(file, { overwrite: true, learned: true })
    expect(name(b.orgChart('Blue Archive').characters.find((c) => c.name === 'Hina')!.affiliationId)).toBe('Prefect Team')
    await b.undo()
    await b.undo() // whole first import gone
    const after = b.orgChart('Blue Archive')
    expect(after.characters.map((c) => c.name)).toEqual(['Hina'])
    expect(after.nodes.map((n) => n.name)).toEqual(['Gehenna'])
    expect(b.learned()).toEqual([])

    // with my own pictures' vectors
    await a.exportPack(file, '0.1.0', { includeLearned: true, includeUserRefs: true })
    expect((await b.previewPack(file, { overwrite: false, learned: true })).userRefs).toBe(1)
    a.close()
    b.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
