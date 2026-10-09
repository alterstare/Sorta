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
