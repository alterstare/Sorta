// 소속 조직도: one game's affiliations as an org chart. Drag a box onto
// another to put it under it (top / bottom edge = before / after it), drag
// characters between boxes, add / rename / delete boxes. The game's wiki can
// suggest affiliations (by character name); suggestions apply only when the
// user accepts them. Every change is one Ctrl+Z step.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, JSX, ReactNode } from 'react'
import { useStore } from '../store'
import { useKept, useKeptScroll } from '../keep'
import type { WikiRow } from '../store'
import type { OrgChart, OrgCharacter, OrgNode, WikiSuggestion } from '../../../shared/types'
import { AddIcon, CheckIcon, CloseIcon, DeleteIcon, EditIcon, OpenInNewIcon, PersonIcon, SearchIcon } from './icons'

type Drag = { kind: 'aff'; id: number } | { kind: 'chars'; ids: number[] }
type Drop = 'before' | 'inside' | 'after'
const MIME = 'application/x-sorta-org'
const LAST_GAME = 'sorta.org.game'

const readDrag = (e: DragEvent): Drag | null => {
  try {
    return JSON.parse(e.dataTransfer.getData(MIME)) as Drag
  } catch {
    return null
  }
}

// What a suggestion row can apply: the suggested path, its top level alone,
// or any other affiliation-like value found on the page.
function options(s: WikiSuggestion): string[][] {
  const out: string[][] = []
  const add = (p: string[]): void => {
    if (p.length && !out.some((o) => o.join('\u0000') === p.join('\u0000'))) out.push(p)
  }
  add(s.path)
  if (s.path.length > 1) add([s.path[0]])
  for (const f of s.fields) add(s.path.length && f.value !== s.path[0] && !s.path.includes(f.value) ? [s.path[0], f.value] : [f.value])
  return out
}

export default function OrgView({ tabs }: { tabs: ReactNode }): JSX.Element {
  const pageRef = useKeptScroll<HTMLDivElement>('org')
  const { showToast, refreshLibrary, settings, saveSettings, jobs } = useStore()
  const libraryVersion = useStore((s) => s.libraryVersion)
  const [games, setGames] = useState<{ name: string; n: number }[]>([])
  const [game, setGame] = useState<string>(() => {
    try {
      return localStorage.getItem(LAST_GAME) ?? ''
    } catch {
      return ''
    }
  })
  const [chart, setChart] = useState<OrgChart | null>(null)
  const [wiki, setWiki] = useState('')
  const [sel, setSel] = useKept<number[]>('org.sel', []) // selected characters (Ctrl+click), dragged together
  const [editing, setEditing] = useState<{ mode: 'add' | 'rename'; id: number | null } | null>(null)
  const orgLookup = useStore((s) => s.orgLookup)
  const startOrgLookup = useStore((s) => s.startOrgLookup)
  const setOrgRows = useStore((s) => s.setOrgRows)
  const clearOrgLookup = useStore((s) => s.clearOrgLookup)
  // The lookup belongs to one game; another game's lookup stays in the store.
  const mine = orgLookup && orgLookup.series === chart?.series ? orgLookup : null
  const looking = !!orgLookup?.running
  const found = mine && mine.rows ? { wiki: mine.wiki ?? '', rows: mine.rows } : null
  const setFound = (f: { rows: WikiRow[] } | null): void => (f ? setOrgRows(f.rows) : clearOrgLookup())
  const running = Object.keys(jobs).length > 0

  useEffect(() => {
    void window.api.characters().then((cs) => {
      const m = new Map<string, number>()
      for (const c of cs) if (!c.parentId) m.set(c.series, (m.get(c.series) ?? 0) + 1)
      const list = [...m].map(([name, n]) => ({ name, n })).sort((a, b) => a.name.localeCompare(b.name))
      setGames(list)
      setGame((g) => (list.some((x) => x.name === g) ? g : (list.slice().sort((a, b) => b.n - a.n)[0]?.name ?? '')))
    })
  }, [libraryVersion])
  useEffect(() => {
    if (!game) return setChart(null)
    try {
      localStorage.setItem(LAST_GAME, game)
    } catch {
      // per-viewer convenience only
    }
    void window.api.orgChart(game).then((c) => {
      setChart(c)
      setWiki(c.wiki ?? '')
    })
  }, [game, libraryVersion])
  useEffect(() => {
    setSel([])
    setEditing(null)
  }, [game])
  // Search → jump: once the target's game is shown, scroll its box (or the
  // character's chip) into view and flash it.
  const [goto, setGoto] = useState<Hit | null>(null)
  useEffect(() => {
    if (!goto || !chart || chart.series !== goto.game) return
    const sel = goto.kind === 'aff' ? `[data-org-id="${goto.id}"]` : `[data-char-id="${goto.id}"]`
    const el = document.querySelector<HTMLElement>(`.page.org ${sel}`)
    setGoto(null)
    if (!el) return
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' })
    el.classList.remove('org-found-flash')
    void el.offsetWidth // restart the animation when the same target is picked again
    el.classList.add('org-found-flash')
    window.setTimeout(() => el.classList.remove('org-found-flash'), 1600)
  }, [goto, chart])
  const jump = useCallback(
    (h: Hit): void => {
      clearOrgLookup()
      setGoto(h)
      setGame(h.game)
    },
    [clearOrgLookup]
  )
  // A finished lookup for another game → show that game.
  useEffect(() => {
    if (orgLookup?.rows && orgLookup.series !== game && games.some((g) => g.name === orgLookup.series)) setGame(orgLookup.series)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgLookup?.rows, games])

  const act = async (fn: () => Promise<unknown>, done?: string): Promise<boolean> => {
    try {
      await fn()
      if (done) showToast({ ok: true, message: `${done} · Ctrl+Z로 되돌리기` })
      void refreshLibrary()
      return true
    } catch (e) {
      showToast({ ok: false, message: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      return false
    }
  }

  const kids = useMemo(() => {
    const m = new Map<number | null, OrgNode[]>()
    for (const n of chart?.nodes ?? []) m.set(n.parentId, [...(m.get(n.parentId) ?? []), n])
    for (const l of m.values()) l.sort((a, b) => a.order - b.order || a.id - b.id)
    return m
  }, [chart])
  const members = useMemo(() => {
    const m = new Map<number | null, OrgCharacter[]>()
    for (const c of chart?.characters ?? []) m.set(c.affiliationId, [...(m.get(c.affiliationId) ?? []), c])
    return m
  }, [chart])
  const unplaced = members.get(null) ?? []

  // ---- drag & drop ----
  const startChars = (e: DragEvent, id: number): void => {
    const ids = sel.includes(id) ? sel : [id]
    e.dataTransfer.setData(MIME, JSON.stringify({ kind: 'chars', ids } satisfies Drag))
    e.dataTransfer.effectAllowed = 'move'
  }
  const dropOn = (d: Drag, target: OrgNode | null, where: Drop): void => {
    if (d.kind === 'chars') {
      void act(() => window.api.placeCharacters(d.ids, target?.id ?? null)).then((ok) => ok && setSel([]))
      return
    }
    if (target && d.id === target.id) return
    if (!target || where === 'inside') void act(() => window.api.moveAffiliation(d.id, target?.id ?? null))
    else {
      const sibs = (kids.get(target.parentId) ?? []).filter((n) => n.id !== d.id)
      const i = sibs.findIndex((n) => n.id === target.id)
      void act(() => window.api.moveAffiliation(d.id, target.parentId, where === 'before' ? i : i + 1))
    }
  }

  // ---- wiki ----
  const lookup = (ids?: number[]): void => {
    if (chart) void startOrgLookup(chart.series, ids)
  }
  const apply = async (): Promise<void> => {
    if (!chart || !found) return
    const items = found.rows.filter((r) => r.on && options(r).length).map((r) => ({ characterId: r.characterId, path: options(r)[r.pick] }))
    if (await act(() => window.api.applyAffiliations(chart.series, items), `${items.length}명 소속 적용`)) clearOrgLookup()
  }

  const allowed = !!settings?.allowWebLookup

  return (
    <div ref={pageRef} className="page org">
      <div className="page-head">
        <h1>캐릭터</h1>
        {tabs}
      </div>
      <p className="hint">
        상자를 다른 상자 가운데로 끌면 그 아래 소속이 되고, 상자 위 · 아래 끝에 놓으면 순서가 바뀝니다. 캐릭터도 끌어서 옮깁니다 (Ctrl+클릭으로 여러
        명). 정리 폴더는 게임/상위 소속/하위 소속/캐릭터 형태가 됩니다.
      </p>

      <div className="org-bar">
        <select className="tag-input" value={game} onChange={(e) => setGame(e.target.value)}>
          {games.map((g) => (
            <option key={g.name} value={g.name}>
              {g.name} ({g.n}명)
            </option>
          ))}
        </select>
        <input
          className="tag-input org-wiki"
          value={wiki}
          placeholder="위키 주소 (예: bluearchive.fandom.com) · 비우면 자동으로 찾기"
          onChange={(e) => setWiki(e.target.value)}
          onBlur={() => chart && wiki.trim() !== (chart.wiki ?? '') && void act(() => window.api.setWiki(chart.series, wiki.trim() || null))}
        />
        <OrgSearch games={games} version={libraryVersion} onPick={jump} />
        <div className="flat-group">
          <button className="mini" disabled={!chart || !allowed || looking || running} onClick={() => lookup()}>
            <SearchIcon />
            {looking ? '찾는 중…' : `위키에서 소속 찾기 (${unplaced.length}명)`}
          </button>
          <button
            className="mini"
            disabled={!chart || !allowed || looking || running}
            title="소속이 이미 있는 캐릭터도 다시 찾기"
            onClick={() => lookup(chart?.characters.map((c) => c.id))}
          >
            전체 다시 찾기
          </button>
        </div>
      </div>
      {!allowed && (
        <div className="row-desc pad">
          위키 조회는 외부 조회 허용이 필요합니다 (캐릭터 이름만 보내고 그림은 보내지 않습니다).{' '}
          <button className="link-btn" onClick={() => void saveSettings({ allowWebLookup: true })}>
            허용하기
          </button>
        </div>
      )}
      {looking && (
        <div className="row-desc pad">
          {orgLookup?.series} 위키 조회 중 · 1초에 한 명씩 (진행률은 아래 상태 표시줄). 다른 화면으로 가도 계속되고, 끝나면 여기에 결과가 나옵니다.
        </div>
      )}

      {found && (
        <section className="card org-found">
          <div className="modal-head">
            <h2>위키 조회 결과 · {found.wiki}</h2>
            <span className="spacer" />
            <button className="btn primary" disabled={!found.rows.some((r) => r.on)} onClick={() => void apply()}>
              <CheckIcon />
              {found.rows.filter((r) => r.on).length}명 적용
            </button>
            <button className="icon-btn" title="적용하지 않고 닫기" onClick={() => setFound(null)}>
              <CloseIcon />
            </button>
          </div>
          <div className="row-desc">아직 적용 전입니다. 맞는 것만 체크하고 적용을 누르면 아래 미리 보기대로 조직도가 만들어집니다. 이미 있는 소속(이전 이름 포함)은 그대로 쓰고, 없으면 새로 만듭니다.</div>
          <div className="org-found-list">
            {found.rows.map((r, i) => {
              const opts = options(r)
              const set = (patch: Partial<(typeof found.rows)[number]>): void =>
                setFound({ ...found, rows: found.rows.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
              return (
                <div key={r.characterId} className={`org-found-row ${opts.length ? '' : 'none'}`}>
                  <span className="manage-check" onClick={() => opts.length && set({ on: !r.on })}>
                    {r.on && <CheckIcon />}
                  </span>
                  <span className="org-found-name">{r.name}</span>
                  {opts.length ? (
                    <select className="tag-input" value={r.pick} onChange={(e) => set({ pick: +e.target.value, on: true })}>
                      {opts.map((o, k) => (
                        <option key={k} value={k}>
                          {o.join(' › ')}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="dim">{r.error ? `조회 실패: ${r.error}` : r.page ? '문서에 소속 정보가 없습니다' : '문서를 찾지 못했습니다'}</span>
                  )}
                  <span className="spacer" />
                  {r.url && (
                    <button className="mini icon" title={`문서 열기 · ${r.page}`} onClick={() => void window.api.openUrl(r.url!)}>
                      <OpenInNewIcon />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
          <div className="modal-foot">
            <button className="btn primary" disabled={!found.rows.some((r) => r.on)} onClick={() => void apply()}>
              <CheckIcon />
              {found.rows.filter((r) => r.on).length}명 적용
            </button>
          </div>
        </section>
      )}

      {chart && found && <PreviewChart chart={chart} rows={found.rows} />}

      {chart && !found && (
        <div
          className="org-unplaced card"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            const d = readDrag(e)
            if (d?.kind === 'chars') dropOn(d, null, 'inside')
          }}
        >
          <div className="row-title">소속 미지정 · {unplaced.length}명</div>
          <div className="chip-row">
            {unplaced.map((c) => (
              <CharChip key={c.id} c={c} sel={sel} setSel={setSel} onDragStart={startChars} />
            ))}
            {unplaced.length === 0 && <span className="row-desc">모든 캐릭터에 소속이 있습니다.</span>}
          </div>
        </div>
      )}

      {chart && !found && (
        <div className="org-scroll">
          <ul className="org-chart">
            <li>
              <div
                className="org-box root"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  const d = readDrag(e)
                  if (d?.kind === 'aff') dropOn(d, null, 'inside')
                }}
              >
                <div className="org-head">
                  <span className="org-name">{chart.series}</span>
                  <span className="org-tools">
                    <button className="mini icon" title="소속 추가" onClick={() => setEditing({ mode: 'add', id: null })}>
                      <AddIcon />
                    </button>
                  </span>
                </div>
              </div>
              <Children
                parent={null}
                kids={kids}
                members={members}
                editing={editing}
                setEditing={setEditing}
                sel={sel}
                setSel={setSel}
                startChars={startChars}
                dropOn={dropOn}
                act={act}
                series={chart.series}
              />
            </li>
          </ul>
        </div>
      )}
    </div>
  )
}

type Hit = { kind: 'aff' | 'char'; id: number; game: string; name: string; path: string; alias?: string }

// Find an affiliation (by name or earlier name) or a character in any game
// and jump to it. Charts are loaded when the box is first focused.
function OrgSearch({ games, version, onPick }: { games: { name: string }[]; version: number; onPick: (h: Hit) => void }): JSX.Element {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [sel, setSel] = useState(0)
  const [index, setIndex] = useState<{ v: number; hits: Hit[] } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const loading = useRef(-1)
  const load = (): void => {
    if (index?.v === version || loading.current === version) return
    loading.current = version
    void Promise.all(games.map((g) => window.api.orgChart(g.name))).then((charts) => {
      const hits: Hit[] = []
      for (const c of charts) {
        const byId = new Map(c.nodes.map((n) => [n.id, n]))
        const path = (id: number | null): string => {
          const out: string[] = []
          for (let n = id === null ? undefined : byId.get(id); n; n = n.parentId === null ? undefined : byId.get(n.parentId)) out.unshift(n.name)
          return [c.series, ...out].join(' › ')
        }
        for (const n of c.nodes) hits.push({ kind: 'aff', id: n.id, game: c.series, name: n.name, path: path(n.parentId), alias: n.aliases.join(', ') })
        for (const ch of c.characters)
          hits.push({ kind: 'char', id: ch.id, game: c.series, name: ch.name, path: ch.affiliationId === null ? `${c.series} · 소속 미지정` : path(ch.affiliationId) })
      }
      setIndex({ v: version, hits })
    })
  }

  const hits = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t || !index) return []
    const score = (h: Hit): number => {
      const n = h.name.toLowerCase()
      if (n === t) return 0
      if (n.startsWith(t)) return 1
      if (n.includes(t)) return 2
      if (h.alias?.toLowerCase().includes(t)) return 3
      return -1
    }
    return index.hits
      .map((h) => ({ h, s: score(h) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => (a.h.kind === b.h.kind ? 0 : a.h.kind === 'aff' ? -1 : 1) || a.s - b.s || a.h.name.localeCompare(b.h.name))
      .slice(0, 40)
      .map((x) => x.h)
  }, [q, index])
  useEffect(() => setSel(0), [q])
  useEffect(() => {
    listRef.current?.querySelectorAll('.picker-opt')[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])

  const pick = (h: Hit | undefined): void => {
    if (!h) return
    onPick(h)
    setOpen(false)
  }

  return (
    <div className="picker org-search">
      <div className="picker-box">
        <SearchIcon />
        <input
          value={q}
          placeholder="소속 · 캐릭터 찾기"
          onFocus={() => {
            load()
            setOpen(true)
          }}
          onBlur={() => setOpen(false)}
          onChange={(e) => {
            load()
            setQ(e.target.value)
            setOpen(true)
          }}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((i) => Math.min(hits.length - 1, i + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((i) => Math.max(0, i - 1))
            } else if (e.key === 'Enter') pick(hits[sel])
            else if (e.key === 'Escape') {
              setQ('')
              setOpen(false)
            }
          }}
        />
      </div>
      {open && q.trim() && (
        <div className="picker-list" ref={listRef}>
          {!index && <div className="picker-sec">불러오는 중…</div>}
          {index && !hits.length && <div className="picker-sec">찾는 소속 · 캐릭터가 없습니다</div>}
          {hits.map((h, i) => (
            <button
              key={`${h.kind}${h.id}`}
              className={`picker-opt ${i === sel ? 'sel' : ''}`}
              onMouseEnter={() => setSel(i)}
              onMouseDown={(e) => e.preventDefault()} // keep focus: the blur would close the list before the click
              onClick={() => pick(h)}
            >
              {h.kind === 'char' && <PersonIcon />}
              <span className="picker-name">{h.name}</span>
              <span className="picker-series">{h.path}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function CharChip({
  c,
  sel,
  setSel,
  onDragStart
}: {
  c: OrgCharacter
  sel: number[]
  setSel: (f: (s: number[]) => number[]) => void
  onDragStart: (e: DragEvent, id: number) => void
}): JSX.Element {
  const on = sel.includes(c.id)
  return (
    <span
      className={`tag-chip org-char ${on ? 'confirmed' : ''}`}
      data-char-id={c.id}
      draggable
      title={`${c.images.toLocaleString()}장 · 끌어서 옮기기, Ctrl+클릭으로 여러 명 선택`}
      onDragStart={(e) => (e.stopPropagation(), onDragStart(e, c.id))}
      onClick={(e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) setSel((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]))
        else setSel((s) => (s.length === 1 && s[0] === c.id ? [] : [c.id]))
      }}
    >
      {c.name}
    </span>
  )
}

interface TreeProps {
  kids: Map<number | null, OrgNode[]>
  members: Map<number | null, OrgCharacter[]>
  editing: { mode: 'add' | 'rename'; id: number | null } | null
  setEditing: (e: { mode: 'add' | 'rename'; id: number | null } | null) => void
  sel: number[]
  setSel: (f: (s: number[]) => number[]) => void
  startChars: (e: DragEvent, id: number) => void
  dropOn: (d: Drag, target: OrgNode | null, where: Drop) => void
  act: (fn: () => Promise<unknown>, done?: string) => Promise<boolean>
  series: string
}

function Children(p: TreeProps & { parent: number | null }): JSX.Element | null {
  const list = p.kids.get(p.parent) ?? []
  const adding = p.editing?.mode === 'add' && p.editing.id === p.parent
  if (!list.length && !adding) return null
  return (
    <ul>
      {list.map((n) => (
        <li key={n.id}>
          <Box {...p} n={n} />
          <Children {...p} parent={n.id} />
        </li>
      ))}
      {adding && (
        <li>
          <div className="org-box">
            <NameInput
              initial=""
              placeholder="새 소속 이름"
              onDone={(name) => {
                p.setEditing(null)
                if (name) void p.act(() => window.api.addAffiliation(p.series, name, p.parent), '소속 추가')
              }}
            />
          </div>
        </li>
      )}
    </ul>
  )
}

function Box(p: TreeProps & { n: OrgNode }): JSX.Element {
  const { n } = p
  const [hint, setHint] = useState<Drop | null>(null)
  const chars = p.members.get(n.id) ?? []
  const renaming = p.editing?.mode === 'rename' && p.editing.id === n.id
  const where = (e: DragEvent): Drop => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    // siblings are stacked: top / bottom edge = before / after, middle = inside
    const y = (e.clientY - r.top) / r.height
    return y < 0.25 ? 'before' : y > 0.75 ? 'after' : 'inside'
  }
  return (
    <div
      className={`org-box ${chars.length ? '' : 'no-chars'} ${hint ? `drop-${hint}` : ''}`}
      data-org-id={n.id}
      draggable={!renaming}
      onDragStart={(e) => {
        e.dataTransfer.setData(MIME, JSON.stringify({ kind: 'aff', id: n.id } satisfies Drag))
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        // characters always go inside; boxes can also go before / after
        setHint(e.dataTransfer.types.includes(MIME) ? where(e) : null)
      }}
      onDragLeave={() => setHint(null)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setHint(null)
        const d = readDrag(e)
        if (d) p.dropOn(d, n, d.kind === 'chars' ? 'inside' : where(e))
      }}
    >
      <div className="org-head">
        {renaming ? (
          <NameInput
            initial={n.name}
            onDone={(name) => {
              p.setEditing(null)
              if (name && name !== n.name) void p.act(() => window.api.renameAffiliation(n.id, name), '소속 이름 변경')
            }}
          />
        ) : (
          <span className="org-name" title={n.aliases.length ? `이전 이름: ${n.aliases.join(', ')}` : undefined}>
            {n.name}
          </span>
        )}
        <span className="org-tools">
          <button className="mini icon" title="하위 소속 추가" onClick={() => p.setEditing({ mode: 'add', id: n.id })}>
            <AddIcon />
          </button>
          <button className="mini icon" title="이름 변경" onClick={() => p.setEditing({ mode: 'rename', id: n.id })}>
            <EditIcon />
          </button>
          <button
            className="mini icon"
            title="삭제 (하위 소속과 캐릭터는 한 단계 위로)"
            onClick={() => void p.act(() => window.api.deleteAffiliation(n.id), `"${n.name}" 삭제`)}
          >
            <DeleteIcon />
          </button>
        </span>
      </div>
      {chars.length > 0 && (
        <div className="chip-row">
          {chars.map((c) => (
            <CharChip key={c.id} c={c} sel={p.sel} setSel={p.setSel} onDragStart={p.startChars} />
          ))}
        </div>
      )}
    </div>
  )
}

function NameInput({ initial, placeholder, onDone }: { initial: string; placeholder?: string; onDone: (v: string) => void }): JSX.Element {
  const [v, setV] = useState(initial)
  const done = useRef(false) // Enter, then the blur from unmounting: report once
  const finish = (x: string): void => {
    if (done.current) return
    done.current = true
    onDone(x)
  }
  return (
    <input
      className="tag-input org-input"
      autoFocus
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(v.trim())
        if (e.key === 'Escape') finish('')
      }}
      onBlur={() => finish(v.trim())}
    />
  )
}

// What the chart will look like once the checked suggestions are applied —
// same matching as the apply step (name or earlier name, anywhere in the
// game; missing levels created). New boxes are dashed, moved characters marked.
function PreviewChart({ chart, rows }: { chart: OrgChart; rows: WikiRow[] }): JSX.Element {
  const { nodes, place, fresh } = useMemo(() => {
    type PNode = { key: string; name: string; parent: string | null; isNew: boolean; order: number }
    const nodes: PNode[] = chart.nodes.map((n) => ({ key: `n${n.id}`, name: n.name, parent: n.parentId === null ? null : `n${n.parentId}`, isNew: false, order: n.order }))
    const names = new Map<string, string>() // lower-case name / alias → key
    for (const n of chart.nodes) for (const x of [n.name, ...n.aliases]) names.set(x.toLowerCase(), `n${n.id}`)
    const place = new Map<number, string | null>(chart.characters.map((c) => [c.id, c.affiliationId === null ? null : `n${c.affiliationId}`]))
    const fresh = new Set<number>()
    let seq = 0
    for (const r of rows) {
      const path = r.on ? options(r)[r.pick] : undefined
      if (!path) continue
      let parent: string | null = null
      for (const raw of path) {
        const name = raw.trim()
        if (!name) continue
        let key = names.get(name.toLowerCase())
        if (!key) {
          key = `new${seq++}`
          nodes.push({ key, name, parent, isNew: true, order: 1e6 + seq })
          names.set(name.toLowerCase(), key)
        }
        parent = key
      }
      if (parent !== null) {
        place.set(r.characterId, parent)
        fresh.add(r.characterId)
      }
    }
    return { nodes, place, fresh }
  }, [chart, rows])
  const kids = new Map<string | null, typeof nodes>()
  for (const n of nodes) kids.set(n.parent, [...(kids.get(n.parent) ?? []), n])
  for (const l of kids.values()) l.sort((a, b) => a.order - b.order)
  const members = new Map<string | null, OrgCharacter[]>()
  for (const c of chart.characters) {
    const k = place.get(c.id) ?? null
    members.set(k, [...(members.get(k) ?? []), c])
  }
  const created = nodes.filter((n) => n.isNew).length
  const left = members.get(null) ?? []
  const chip = (c: OrgCharacter): JSX.Element => (
    <span key={c.id} className={`tag-chip ${fresh.has(c.id) ? 'confirmed' : 'static'}`}>
      {c.name}
    </span>
  )
  const branch = (parent: string | null): JSX.Element | null => {
    const list = kids.get(parent) ?? []
    if (!list.length) return null
    return (
      <ul>
        {list.map((n) => (
          <li key={n.key}>
            <div className={`org-box preview ${n.isNew ? 'new' : ''} ${(members.get(n.key) ?? []).length ? '' : 'no-chars'}`}>
              <div className="org-head">
                <span className="org-name">{n.name}</span>
              </div>
              {(members.get(n.key) ?? []).length > 0 && <div className="chip-row">{(members.get(n.key) ?? []).map(chip)}</div>}
            </div>
            {branch(n.key)}
          </li>
        ))}
      </ul>
    )
  }
  return (
    <>
      <div className="org-preview-title">
        <b>적용하면 만들어질 조직도</b>
        <span className="dim">
          {' '}
          · 새 소속 {created}개 (점선) · 소속이 정해지는 캐릭터 {fresh.size}명 (강조) · 소속 미지정으로 남는 캐릭터 {left.length}명
        </span>
      </div>
      <div className="org-scroll">
        <ul className="org-chart">
          <li>
            <div className="org-box root preview">
              <div className="org-head">
                <span className="org-name">{chart.series}</span>
              </div>
            </div>
            {branch(null)}
          </li>
        </ul>
      </div>
    </>
  )
}
