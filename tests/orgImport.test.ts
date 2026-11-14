import { describe, expect, it } from 'vitest'
import { SortaCore } from '../src/core'
import { itemName, parseOrgWikitext } from '../src/core/orgImport'
import { importTree } from '../src/core/org'
import type { OrgImportNode } from '../src/shared/types'

// Shape of bluearchive.fandom.com/wiki/School_Club (trimmed)
const PAGE = `{{aligntop}}
[[File:MP Club.png|thumb|200px]]
School Clubs are extracurricular activities.

== General Information ==
School Clubs are generally the main groups of students.

== Club List ==
=== [[Kivotos]] ===
*[[General Student Council]]
*[[SCHALE]]

=== [[Abydos High School]] ===
*[[Countermeasures Committee|Countermeasures Committee/Foreclosure Task Force]] (Acting Student Council)
*[[Abydos Student Council]] (Disbanded Former Student Council)

=== [[Gehenna Academy]] ===
*[[Pandemonium Society]] (Student Council)
*[[Disciplinary Committee|Disciplinary Committee/Prefect Team]]
**[[Prefect Squad]]

== See also ==
*[[School]]
`

const shape = (ns: OrgImportNode[]): unknown => ns.map((n) => (n.children.length ? { [n.name]: shape(n.children) } : n.name))

describe('조직도 불러오기', () => {
  it('reads a wiki list page: headings hold their list, A/B = aliases, notes and non-lists dropped', () => {
    expect(itemName('[[Countermeasures Committee|Countermeasures Committee/Foreclosure Task Force]] (Acting)')).toEqual({
      name: 'Countermeasures Committee',
      aliases: ['Foreclosure Task Force']
    })
    expect(itemName('[[Handyman 68|Problem Solver 68]]')).toEqual({ name: 'Problem Solver 68', aliases: ['Handyman 68'] })
    const tree = parseOrgWikitext(PAGE)
    expect(shape(tree)).toEqual([
      { Kivotos: ['General Student Council', 'SCHALE'] },
      { 'Abydos High School': ['Countermeasures Committee', 'Abydos Student Council'] },
      { 'Gehenna Academy': ['Pandemonium Society', { 'Disciplinary Committee': ['Prefect Squad'] }] }
    ])
  })

  it('previews, then applies as one undo step: found by name or alias, moved, created, characters placed', async () => {
    const core = new SortaCore(':memory:')
    const hoshino = core.createCharacter('Hoshino', 'Blue Archive')
    // the user's chart: the club at the top level under its other name
    core.addAffiliation('Blue Archive', 'Foreclosure Task Force', null)
    core.addAffiliation('Blue Archive', 'Mine', null) // not in the import: untouched
    const tree: OrgImportNode[] = [
      {
        name: 'Abydos High School',
        aliases: [],
        characters: [],
        children: [{ name: 'Countermeasures Committee', aliases: ['Foreclosure Task Force'], characters: [{ name: 'hoshino' }, { name: 'Nobody' }], children: [] }]
      }
    ]
    const before = core.orgChart('Blue Archive')
    const preview = importTree(core.db, core.log, 'Blue Archive', 'test', tree, false)
    expect(preview.rows.map((r) => [r.name, r.status, r.from ?? ''])).toEqual([
      ['Abydos High School', 'new', ''],
      ['Countermeasures Committee', 'moved', '최상위']
    ])
    expect(preview).toMatchObject({ created: 1, moved: 1, placed: 1, unknown: ['Nobody'] })
    expect(core.orgChart('Blue Archive')).toEqual(before) // nothing written

    core.orgImportApply('Blue Archive', 'test', tree)
    const c = core.orgChart('Blue Archive')
    const byName = new Map(c.nodes.map((n) => [n.name, n]))
    const club = byName.get('Foreclosure Task Force')! // kept its name, gained the other as alias
    expect(club.aliases).toEqual(['Countermeasures Committee'])
    expect(club.parentId).toBe(byName.get('Abydos High School')!.id)
    expect(byName.get('Mine')!.parentId).toBe(null)
    expect(c.characters.find((x) => x.id === hoshino)!.affiliationId).toBe(club.id)

    await core.undo()
    expect(core.orgChart('Blue Archive')).toEqual(before)
    core.close()
  })
})
