import { describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import { SortaCore } from '../src/core'
import { MIGRATIONS, migrate } from '../src/core/db'
import { applyNames, planFromGameData, planSeriesTitles, planSmallGames } from '../src/core/koNames'
import { importTree } from '../src/core/org'

// SchaleDB-shaped answers (trimmed)
const DATA: Record<string, unknown> = {
  'en/students': {
    '10000': { Name: 'Hoshino', FamilyName: 'Takanashi', PersonalName: 'Hoshino' },
    '10001': { Name: 'Hoshino (Swimsuit)', FamilyName: 'Takanashi', PersonalName: 'Hoshino' },
    '10002': { Name: 'Aru', FamilyName: 'Rikuhachima', PersonalName: 'Aru' }
  },
  'kr/students': {
    '10000': { Name: '호시노' },
    '10001': { Name: '호시노(수영복)' },
    '10002': { Name: '아루' }
  },
  'en/localization': {
    School: { Abydos: 'Abydos', Gehenna: 'Gehenna' },
    SchoolLong: { Abydos: 'Abydos High School', Gehenna: 'Gehenna Academy' },
    Club: { Countermeasure: 'Foreclosure Task Force', Kohshinjo68: 'Problem Solver 68' }
  },
  'kr/localization': {
    School: { Abydos: '아비도스', Gehenna: '게헨나' },
    SchoolLong: { Abydos: '아비도스 고등학교', Gehenna: '게헨나 학원' },
    Club: { Countermeasure: '대책위원회', Kohshinjo68: '흥신소 68' }
  }
}
const get = async (url: string): Promise<unknown> => DATA[url.replace(/^.*\/data\//, '').replace('.min.json', '')]

describe('한글 이름', () => {
  it('game data: characters (outfits too, by tag) and affiliations (by name or alias) → Korean; applied as one undo step', async () => {
    const core = new SortaCore(':memory:')
    const hoshino = core.createCharacter('Hoshino', 'Blue Archive')
    const swim = core.createCharacter('Hoshino (Swimsuit)', 'Blue Archive')
    core.createCharacter('호시노 (드레스)', 'Blue Archive') // already Korean: left alone
    const nobody = core.createCharacter('Nobody', 'Blue Archive')
    const abydos = core.addAffiliation('Blue Archive', 'Abydos High School', null)
    const club = core.addAffiliation('Blue Archive', 'Handyman 68', abydos)
    core.renameAffiliation(club, 'Problem Solver 68') // old name kept as alias
    const plan = await planFromGameData(core.db, 'Blue Archive', get)
    expect(plan.source).toBe('SchaleDB')
    expect(plan.changes.map((c) => [c.kind, c.from, c.to])).toEqual([
      ['character', 'Hoshino', '호시노'],
      ['character', 'Hoshino (Swimsuit)', '호시노(수영복)'],
      ['affiliation', 'Abydos High School', '아비도스 고등학교'],
      ['affiliation', 'Problem Solver 68', '흥신소 68']
    ])
    expect(plan.unmatched).toBe(1) // Nobody

    expect(applyNames(core.db, core.log, plan.changes, 'SchaleDB')).toBe(4)
    const c = core.characters()
    // shown names change; system names (tags, wiki) stay
    expect(c.find((x) => x.id === hoshino)).toMatchObject({ name: '호시노', systemName: 'Hoshino', aliases: [] })
    expect(c.find((x) => x.id === swim)!.name).toBe('호시노(수영복)')
    expect(c.find((x) => x.id === nobody)!.name).toBe('Nobody')
    const nodes = core.orgChart('Blue Archive').nodes
    expect(nodes.find((n) => n.id === club)).toMatchObject({ name: '흥신소 68', systemName: 'Problem Solver 68', aliases: ['Handyman 68'] })
    // translated names aren't proposed again
    expect((await planFromGameData(core.db, 'Blue Archive', get)).changes).toEqual([])

    await core.undo()
    expect(core.characters().find((x) => x.id === hoshino)).toMatchObject({ name: 'Hoshino', systemName: 'Hoshino', aliases: [] })
    expect(core.orgChart('Blue Archive').nodes.find((n) => n.id === club)!.name).toBe('Problem Solver 68')
    core.close()
  })

  it('org picture with 한글 번역: matched boxes and characters show the Korean names, undo restores', async () => {
    const core = new SortaCore(':memory:')
    const hoshino = core.createCharacter('Hoshino', 'Blue Archive')
    const abydos = core.addAffiliation('Blue Archive', 'Abydos', null)
    const tree = [{ name: '아비도스', match: 'Abydos', aliases: [], characters: [{ name: '호시노', match: 'Hoshino' }], children: [] }]
    const pv = importTree(core.db, core.log, 'Blue Archive', 'test', tree, false, true)
    expect(pv.rows[0]).toMatchObject({ name: '아비도스', status: 'same', renamed: 'Abydos' })
    expect(pv.rows[0].characters).toEqual([{ name: '호시노', found: true, renamed: 'Hoshino' }])
    expect(pv.renamed).toBe(2)

    core.orgImportApply('Blue Archive', 'test', tree, true)
    expect(core.orgChart('Blue Archive').nodes.find((n) => n.id === abydos)).toMatchObject({ name: '아비도스', systemName: 'Abydos', aliases: [] })
    expect(core.characters().find((x) => x.id === hoshino)).toMatchObject({ name: '호시노', systemName: 'Hoshino', aliases: [], affiliation: '아비도스' })
    await core.undo()
    expect(core.characters().find((x) => x.id === hoshino)).toMatchObject({ name: 'Hoshino', affiliation: null })
    core.close()
  })

  it('renames: untranslated = the system name too, translated = the shown name only; 시스템 이름 by itself', () => {
    const core = new SortaCore(':memory:')
    const id = core.createCharacter('Hoshno', 'Blue Archive')
    core.renameCharacter(id, 'Hoshino')
    expect(core.characters()[0]).toMatchObject({ name: 'Hoshino', systemName: 'Hoshino', aliases: ['Hoshno'] })
    applyNames(core.db, core.log, [{ kind: 'character', id, from: 'Hoshino', to: '호시노' }], 'test')
    core.renameCharacter(id, '타카나시 호시노')
    expect(core.characters()[0]).toMatchObject({ name: '타카나시 호시노', systemName: 'Hoshino' })
    core.setSystemName(id, 'Takanashi Hoshino')
    expect(core.characters()[0]).toMatchObject({ name: '타카나시 호시노', systemName: 'Takanashi Hoshino', aliases: ['Hoshno', 'Hoshino'] })
    // found by either name
    expect(core.createCharacter('타카나시 호시노', 'Blue Archive')).toBe(id)
    expect(core.createCharacter('Takanashi Hoshino', 'Blue Archive')).toBe(id)
    // a game by its shown name
    const ba = core.characters()[0].seriesId
    applyNames(core.db, core.log, [{ kind: 'series', id: ba, from: 'Blue Archive', to: '블루 아카이브' }], 'test')
    expect(core.characters()[0]).toMatchObject({ series: '블루 아카이브', seriesSystemName: 'Blue Archive' })
    expect(core.orgChart('블루 아카이브').seriesSystemName).toBe('Blue Archive')
    core.createCharacter('Aru', '블루 아카이브')
    expect(core.characters().filter((c) => c.seriesId === ba)).toHaveLength(2)
    core.close()
  })

  it('names translated in place before 표시 이름 get their system name back', () => {
    const db = new Database(':memory:')
    for (let v = 0; v < 11; v++) {
      const m = MIGRATIONS[v]
      if (typeof m === 'string') db.exec(m)
    }
    db.pragma('user_version = 11')
    db.prepare("INSERT INTO series (id, name, aliases, created_at) VALUES (1, 'Blue Archive', '[]', 0)").run()
    const ins = db.prepare('INSERT INTO characters (series_id, name, aliases, danbooru_tag, created_at) VALUES (1, ?, ?, ?, 0)')
    ins.run('호시노', JSON.stringify(['hoshino_(blue_archive)', 'Hoshino']), 'hoshino_(blue_archive)')
    ins.run('나만의 캐릭터', '[]', null)
    migrate(db)
    expect(db.prepare('SELECT name, display_name AS d, aliases FROM characters ORDER BY id').all()).toEqual([
      { name: 'Hoshino', d: '호시노', aliases: JSON.stringify(['hoshino_(blue_archive)']) },
      { name: '나만의 캐릭터', d: null, aliases: '[]' }
    ])
    db.close()
  })

  it('LLM: game titles; small games with their characters in one plan', async () => {
    const core = new SortaCore(':memory:')
    core.createCharacter('Hoshino', 'Blue Archive')
    core.createCharacter('Aru', 'Blue Archive')
    core.createCharacter('Shiroko', 'Blue Archive')
    const frieren = core.createCharacter('Frieren', 'Sousou no Frieren')
    core.createCharacter('Unknown Girl', '작품 미상')
    const s = { ...core.settings(), llmProvider: 'gemini' as const, llmModel: 'm', llmKeys: { gemini: 'k' } }
    const asked: string[] = []
    const answer = (o: unknown): Response => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(o) }] } }] }))
    vi.stubGlobal('fetch', async (_u: string, init: { body: string }) => {
      const prompt = JSON.parse(init.body).contents[0].parts.at(-1).text as string
      asked.push(prompt)
      return prompt.includes('"works"')
        ? answer({ works: [{ match: 'Sousou no Frieren', name: '장송의 프리렌', characters: [{ match: 'Frieren', name: '프리렌' }] }] })
        : answer({ titles: [{ match: 'Blue Archive', name: '블루 아카이브' }, { match: 'Sousou no Frieren', name: '장송의 프리렌' }] })
    })
    try {
      const titles = await planSeriesTitles(core.db, s)
      expect(titles.changes.map((c) => [c.kind, c.from, c.to])).toEqual([
        ['series', 'Blue Archive', '블루 아카이브'],
        ['series', 'Sousou no Frieren', '장송의 프리렌']
      ])
      expect(asked[0]).not.toContain('작품 미상')
      // Blue Archive has 3 characters: not a small game at ≤ 2
      const small = await planSmallGames(core.db, s, 2)
      expect(asked[1]).not.toContain('Shiroko')
      expect(small.changes.map((c) => [c.kind, c.from, c.to, c.series])).toEqual([
        ['series', 'Sousou no Frieren', '장송의 프리렌', '장송의 프리렌'],
        ['character', 'Frieren', '프리렌', '장송의 프리렌']
      ])
      expect(applyNames(core.db, core.log, small.changes, 'LLM')).toBe(2)
      expect(core.characters().find((c) => c.id === frieren)).toMatchObject({ name: '프리렌', systemName: 'Frieren', series: '장송의 프리렌' })
    } finally {
      vi.unstubAllGlobals()
      core.close()
    }
  })
})
