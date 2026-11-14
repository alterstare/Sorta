// 캐릭터 관리 (Phase 4): rename, aliases, move to another game, 세부 소속,
// merge duplicates. Every change is one Ctrl+Z step; organized originals
// follow (moved to the character's new folder).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { useStore } from '../store'
import { useKept, useKeptScroll } from '../keep'
import type { ManagedCharacter } from '../../../shared/types'
import {
  CheckIcon,
  CloseIcon,
  ImageIcon,
  KeyboardArrowDownIcon,
  MergeIcon,
  SaveAltIcon,
  SearchIcon,
  TranslateIcon,
  UploadIcon
} from './icons'
import { ExportDialog, ImportDialog } from './PackDialogs'
import KoNames from './KoNames'
import type { KoMode } from './KoNames'

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>

export default function ManageView({ tabs }: { tabs: ReactNode }): JSX.Element {
  // The scrolling area under the fixed top (its position kept across views).
  const keepScroll = useKeptScroll<HTMLDivElement>('manage')
  const listRef = useRef<HTMLDivElement>(null)
  const area = useRef<HTMLDivElement | null>(null)
  // one stable ref (a new function each render re-ran the scroll keeper: an update loop)
  const setArea = useCallback(
    (el: HTMLDivElement | null) => {
      keepScroll(el)
      area.current = el
    },
    [keepScroll]
  )
  // the area's height, for the side panel's max-height (CSS --area-h)
  useEffect(() => {
    const el = area.current
    if (!el) return
    const ro = new ResizeObserver(() => el.style.setProperty('--area-h', `${el.clientHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const { showToast, refreshLibrary } = useStore()
  const libraryVersion = useStore((s) => s.libraryVersion)
  const [list, setList] = useKept<ManagedCharacter[]>('manage.list', [])
  const [q, setQ] = useKept('manage.q', '')
  const [sel, setSel] = useKept<number[]>('manage.sel', [])
  const [packOpen, setPackOpen] = useState<'export' | null>(null)
  const [importFile, setImportFile] = useState<string | null>(null)
  // 한글 이름: from the game's data site / a roster picture / the LLM
  const [koMode, setKoMode] = useState<KoMode | null>(null)

  const reload = (): void => void window.api.characters().then(setList)
  useEffect(reload, [libraryVersion])

  // Edits reload the list; errors (name clash…) show as a toast.
  const act: Act = async (fn, done) => {
    try {
      await fn()
      if (done) showToast({ ok: true, message: `${done} · Ctrl+Z로 되돌리기` })
      reload()
      void refreshLibrary()
      return true
    } catch (e) {
      showToast({ ok: false, message: String((e as Error).message ?? e) })
      return false
    }
  }

  const byId = useMemo(() => new Map(list.map((c) => [c.id, c])), [list])
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase()
    const hit = (c: ManagedCharacter): boolean =>
      !t ||
      [c.name, c.systemName, c.series, c.seriesSystemName, c.affiliation ?? '', c.tag ?? '', ...c.aliases].some((s) => s.toLowerCase().includes(t))
    // Bases first, each followed by its outfit versions.
    const kids = new Map<number, ManagedCharacter[]>()
    for (const c of list) if (c.parentId) kids.set(c.parentId, [...(kids.get(c.parentId) ?? []), c])
    const m = new Map<string, ManagedCharacter[]>()
    for (const c of list) {
      if (c.parentId && byId.has(c.parentId)) continue
      const fam = [c, ...(kids.get(c.id) ?? [])]
      if (!fam.some(hit)) continue
      m.set(c.series, [...(m.get(c.series) ?? []), ...fam])
    }
    return [...m]
  }, [list, q, byId])

  const toggle = (id: number): void => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const picked = sel.map((id) => byId.get(id)).filter((c): c is ManagedCharacter => !!c)

  return (
    <div className="page manage">
      <div className="manage-top">
        <div className="page-head stack">
          <h1>관리</h1>
          {tabs}
        </div>
        <div className="manage-tools">
          <div className="flat-group">
            <button
              className="mini"
              disabled={!list.length}
              title="게임 데이터 사이트의 공식 한글 이름으로 캐릭터 · 소속 이름 바꾸기"
              onClick={() => setKoMode('data')}
            >
              <TranslateIcon />
              게임 데이터로 한글 이름
            </button>
            <button
              className="mini"
              disabled={!list.length}
              title="한글 이름이 적힌 명부 그림을 LLM으로 읽어 이름 바꾸기"
              onClick={() => setKoMode('roster')}
            >
              <ImageIcon />
              명부 이미지로 번역
            </button>
            <button className="mini" disabled={!list.length} title="번역하지 않은 게임 · 애니메이션 이름을 LLM으로 번역" onClick={() => setKoMode('titles')}>
              <TranslateIcon />
              게임 이름 번역
            </button>
            <button
              className="mini"
              disabled={!list.length}
              title="캐릭터가 몇 명 없는 게임은 게임 이름과 캐릭터 이름을 한 번에 LLM으로 번역"
              onClick={() => setKoMode('small')}
            >
              <TranslateIcon />
              캐릭터 적은 게임 번역
            </button>
          </div>
          <div className="flat-group">
            <button
              className="mini"
              title="소속 조직도 · 캐릭터 · 학습 데이터 · 그림별 분류 결과를 파일로 저장"
              onClick={() => setPackOpen('export')}
            >
              <SaveAltIcon />
              내보내기
            </button>
            <button
              className="mini"
              title="내보낸 파일(.sortapack)을 불러오기"
              onClick={() => void window.api.pickPack().then((f) => f && setImportFile(f))}
            >
              <UploadIcon />
              불러오기
            </button>
          </div>
        </div>
        <p className="hint">
          이름 · 별칭 · 게임 · 소속을 고치고, 같은 캐릭터가 둘로 나뉘었으면 합칩니다. 여러 명을 골라 게임이나 소속을 한 번에 바꿀 수
          있습니다. 정리한 그림은 바뀐 폴더로 옮겨집니다.
        </p>
      </div>
      {packOpen === 'export' && <ExportDialog list={list} onClose={() => setPackOpen(null)} />}
      {importFile && <ImportDialog file={importFile} onClose={() => setImportFile(null)} />}
      {koMode && (
        <KoNames
          mode={koMode}
          games={[...new Set(list.map((c) => c.series))]}
          game={picked[0]?.series ?? groups[0]?.[0] ?? list[0]?.series ?? ''}
          onClose={() => setKoMode(null)}
          onApply={(changes, source) => act(() => window.api.applyNames(changes, source), `한글 이름 ${changes.length}개 적용`)}
        />
      )}
      <div ref={setArea} className="manage-scroll">
        <div className="manage-body">
          <div ref={listRef} className="manage-list card">
            <ListSearch page={area} list={listRef} q={q} onQ={setQ} />
            <CardScrollbar area={area} card={listRef} />
            {groups.length === 0 && <div className="row-desc pad">캐릭터가 없습니다.</div>}
            {groups.map(([series, chars]) => (
              <div key={series} className="manage-game">
                <div className="manage-game-title">
                  {series}
                  {chars[0].seriesSystemName !== series && <span className="dim manage-sys">{chars[0].seriesSystemName}</span>}
                  <span className="dim">{chars.length}</span>
                </div>
                {chars.map((c) => (
                  <div
                    key={c.id}
                    className={`manage-row ${sel.includes(c.id) ? 'sel' : ''} ${c.parentId ? 'variant' : ''}`}
                    onClick={(e) =>
                      e.ctrlKey || e.metaKey || e.shiftKey ? toggle(c.id) : setSel(sel.length === 1 && sel[0] === c.id ? [] : [c.id])
                    }
                  >
                    <span className="manage-check" onClick={(e) => (e.stopPropagation(), toggle(c.id))}>
                      {sel.includes(c.id) && <CheckIcon />}
                    </span>
                    <span className="manage-name">{c.name}</span>
                    {c.affiliation && !c.parentId && <span className="tag-chip static">{c.affiliation}</span>}
                    <span className="spacer" />
                    <span className="dim">
                      {c.images.toLocaleString()}장{c.refs > 0 && ` · 참고 ${c.refs}`}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="manage-side">
            {picked.length === 0 && <div className="row-desc pad">왼쪽에서 캐릭터를 고르세요. Ctrl/Shift+클릭으로 여러 명.</div>}
            {picked.length > 0 && (
              <Editor key={`edit:${sel.join(',')}`} chars={picked} act={act} onDeselect={toggle} onMerged={(into) => setSel([into])} />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// The list's search box, stuck at the top while the area scrolls the list
// up. Once the list has gone up it folds into a round button that follows
// (pressed: it opens; the next scroll folds it again). Its own component
// listening to the area: a fold re-renders only this, not the rows.
// The area's scrollbar, drawn in the list card's right padding: its track is
// the card's straight side (inside the 28px corners) within the part of the
// card on screen; the thumb is the area's position, draggable. Fixed-positioned
// from the card's box; updated on scroll / resize without re-rendering the rows.
function CardScrollbar({ area, card }: { area: React.RefObject<HTMLDivElement | null>; card: React.RefObject<HTMLDivElement | null> }): JSX.Element | null {
  const [bar, setBar] = useState<{ left: number; top: number; height: number } | null>(null)
  const drag = useRef<{ y: number; scroll: number; per: number } | null>(null)
  const geo = useRef({ track: 0, thumb: 0 })
  useEffect(() => {
    const a = area.current
    const c = card.current
    if (!a || !c) return
    let frame = 0
    const measure = (): void => {
      frame = 0
      const ar = a.getBoundingClientRect()
      const cr = c.getBoundingClientRect()
      const range = a.scrollHeight - a.clientHeight
      const top = Math.max(ar.top, cr.top) + 28
      const bottom = Math.min(ar.bottom, cr.bottom) - 28
      const track = bottom - top
      if (range <= 0 || track < 40) return setBar(null)
      const thumb = Math.max(28, (track * a.clientHeight) / a.scrollHeight)
      geo.current = { track, thumb }
      setBar({ left: cr.right - 10, top: top + ((track - thumb) * a.scrollTop) / range, height: thumb })
    }
    const soon = (): void => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    measure()
    a.addEventListener('scroll', soon, { passive: true })
    window.addEventListener('resize', soon)
    const ro = new ResizeObserver(soon)
    ro.observe(a)
    ro.observe(c)
    return () => {
      a.removeEventListener('scroll', soon)
      window.removeEventListener('resize', soon)
      ro.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [area, card])
  if (!bar) return null
  return (
    <div
      className={`card-scrollbar ${drag.current ? 'drag' : ''}`}
      style={{ left: bar.left, top: bar.top, height: bar.height }}
      onPointerDown={(e) => {
        const a = area.current
        if (!a) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const { track, thumb } = geo.current
        drag.current = { y: e.clientY, scroll: a.scrollTop, per: (a.scrollHeight - a.clientHeight) / Math.max(1, track - thumb) }
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d && area.current) area.current.scrollTop = d.scroll + (e.clientY - d.y) * d.per
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    />
  )
}

function ListSearch({
  page,
  list,
  q,
  onQ
}: {
  page: React.RefObject<HTMLDivElement | null>
  list: React.RefObject<HTMLDivElement | null>
  q: string
  onQ: (v: string) => void
}): JSX.Element {
  const [down, setDown] = useState(false)
  const [open, setOpen] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const el = page.current
    if (!el) return
    let isDown = false
    const onScroll = (): void => {
      // how far the list's top has gone up past the page's top; two
      // thresholds: no fold / unfold flicker around one line
      const past = el.getBoundingClientRect().top - (list.current?.getBoundingClientRect().top ?? 0)
      const next = isDown ? past > 8 : past > 24
      if (next !== isDown) {
        isDown = next
        setDown(next)
        if (next && document.activeElement === input.current) input.current?.blur() // folded: no focus ring
      }
      setOpen(false)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [page, list])
  const folded = down && !open
  return (
    <div className={`manage-search ${folded ? 'folded' : ''}`}>
      <div
        className="search-box"
        title={folded ? '찾기' : undefined}
        onClick={() => {
          if (!folded) return
          setOpen(true)
          input.current?.focus({ preventScroll: true })
        }}
      >
        {folded ? <KeyboardArrowDownIcon /> : <SearchIcon />}
        <input
          ref={input}
          tabIndex={folded ? -1 : 0}
          value={q}
          placeholder="이름 · 별칭 · 게임 · 소속으로 찾기"
          onChange={(e) => onQ(e.target.value)}
        />
      </div>
    </div>
  )
}

// The side panel: one character = its name, aliases, game and 소속 (label,
// input and button on one line); several = who (✕ takes one out of the
// selection), then game / 소속 for all and 합치기.
function Editor({
  chars,
  act,
  onDeselect,
  onMerged
}: {
  chars: ManagedCharacter[]
  act: Act
  onDeselect: (id: number) => void
  onMerged: (into: number) => void
}): JSX.Element {
  const one = chars.length === 1 ? chars[0] : null
  const ids = chars.map((c) => c.id)
  const oneGame = new Set(chars.map((c) => c.series)).size === 1 ? chars[0].series : ''
  const [name, setName] = useState(one?.name ?? '')
  const [sysName, setSysName] = useState(one?.systemName ?? '')
  const [alias, setAlias] = useState('')
  const [series, setSeries] = useState(oneGame)
  const [allSeries, setAllSeries] = useState<string[]>([])
  const [aff, setAff] = useState(new Set(chars.map((c) => c.affiliation)).size === 1 ? (chars[0].affiliation ?? '') : '')
  const [affs, setAffs] = useState<string[]>([])
  const [into, setInto] = useState(chars[0].id)
  useEffect(() => setName(one?.name ?? ''), [one?.name])
  useEffect(() => setSysName(one?.systemName ?? ''), [one?.systemName])
  const translated = !!one && one.name !== one.systemName
  useEffect(() => void window.api.seriesNames().then(setAllSeries), [])
  useEffect(() => {
    if (oneGame) void window.api.affiliations(oneGame).then(setAffs)
    else setAffs([])
  }, [oneGame])
  const rename = (): void => {
    if (one && name.trim() && name !== one.name) void act(() => window.api.renameCharacter(one.id, name), '이름 변경')
  }
  const renameSystem = (): void => {
    if (one && sysName.trim() && sysName !== one.systemName) void act(() => window.api.setSystemName(one.id, sysName), '내부명 변경')
  }
  const addAlias = (): void => {
    const a = alias.trim()
    if (one && a && !one.aliases.includes(a))
      void act(() => window.api.setAliases(one.id, [...one.aliases, a])).then((ok) => ok && setAlias(''))
  }
  const target = chars.find((c) => c.id === into)

  return (
    <>
      <section className="card manage-edit">
        {one ? (
          <div className="me-head">
            <div className="me-name">{one.name}</div>
            <div className="dim">
              {one.series}
              {one.affiliation && ` · ${one.affiliation}`}
              {one.tag && ` · ${one.tag}`}
            </div>
          </div>
        ) : (
          <div className="me-head">
            <div className="me-name">{chars.length}명</div>
            <div className="chip-row">
              {chars.map((c) => (
                <span key={c.id} className="tag-chip">
                  {c.name}
                  <button title="선택에서 빼기" onClick={() => onDeselect(c.id)}>
                    <CloseIcon />
                  </button>
                </span>
              ))}
            </div>
          </div>
        )}
        {one && (
          <>
            <div
              className="me-row"
              title={translated ? '화면과 폴더 이름에 쓰는 한글 이름입니다' : '화면과 폴더 이름에 쓰입니다. 번역하기 전에는 내부명도 함께 바뀝니다'}
            >
              <span className="me-label">이름</span>
              <input
                className="tag-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && rename()}
              />
              <button className="mini" disabled={!name.trim() || name === one.name} onClick={rename}>
                저장
              </button>
            </div>
            <div className="me-row" title="태그 인식 · 위키 · LLM 조회에 쓰는 원래 이름입니다. 바꾸면 이전 이름은 별칭으로 남습니다">
              <span className="me-label">내부명</span>
              <input
                className="tag-input"
                value={sysName}
                onChange={(e) => setSysName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && renameSystem()}
              />
              <button className="mini" disabled={!sysName.trim() || sysName === one.systemName} onClick={renameSystem}>
                저장
              </button>
            </div>
            <div className="me-row" title="검색 · 직접 입력 · 태그 인식에 쓰는 다른 이름">
              <span className="me-label">별칭</span>
              <input
                className="tag-input"
                value={alias}
                placeholder="별칭 추가"
                onChange={(e) => setAlias(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addAlias()}
              />
              <button className="mini" disabled={!alias.trim()} onClick={addAlias}>
                추가
              </button>
            </div>
            {one.aliases.length > 0 && (
              <div className="chip-row me-chips">
                {one.aliases.map((a) => (
                  <span key={a} className="tag-chip">
                    {a}
                    <button
                      title="빼기"
                      onClick={() =>
                        void act(() =>
                          window.api.setAliases(
                            one.id,
                            one.aliases.filter((x) => x !== a)
                          )
                        )
                      }
                    >
                      <CloseIcon />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        <div className="me-row" title="다른 게임으로 옮기면 소속은 해제됩니다. 복장 버전도 함께 옮겨집니다.">
          <span className="me-label">게임</span>
          <input
            className="tag-input"
            list="manage-series"
            value={series}
            placeholder="게임 이름"
            onChange={(e) => setSeries(e.target.value)}
          />
          <datalist id="manage-series">
            {allSeries.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <button
            className="mini"
            disabled={!series.trim() || series === oneGame}
            onClick={() => void act(() => window.api.setSeries(ids, series), '게임 변경')}
          >
            이동
          </button>
        </div>
        <div
          className="me-row"
          title={
            oneGame
              ? '소속이 있으면 게임/소속/캐릭터 폴더가 되고, 같은 소속끼리 함께 있는 그림은 게임/소속 폴더로 갑니다.'
              : '같은 게임의 캐릭터만 함께 지정할 수 있습니다'
          }
        >
          <span className="me-label">소속</span>
          <input
            className="tag-input"
            list="manage-affs"
            value={aff}
            disabled={!oneGame}
            placeholder={oneGame ? '학교 · 동아리 · 유닛…' : '같은 게임끼리만 지정할 수 있습니다'}
            onChange={(e) => setAff(e.target.value)}
          />
          <datalist id="manage-affs">
            {affs.map((a) => (
              <option key={a} value={a} />
            ))}
          </datalist>
          <div className="flat-group">
            <button
              className="mini"
              disabled={!oneGame || !aff.trim()}
              onClick={() => void act(() => window.api.setAffiliation(ids, aff), '소속 지정')}
            >
              지정
            </button>
            <button
              className="mini"
              disabled={!oneGame || !chars.some((c) => c.affiliation)}
              onClick={() => void act(() => window.api.setAffiliation(ids, null), '소속 해제')}
            >
              해제
            </button>
          </div>
        </div>
      </section>
      {chars.length >= 2 && (
        <section className="card manage-edit">
          <div className="me-head" title="그림 · 참고 그림 · 복장 버전이 옮겨지고, 나머지 이름은 별칭이 됩니다">
            <div className="me-name">합치기</div>
            <div className="dim">같은 캐릭터가 나뉘었을 때 하나로 합칩니다. 남길 캐릭터를 고르세요.</div>
          </div>
          <div className="manage-merge" role="radiogroup">
            {chars.map((c) => (
              <button
                key={c.id}
                className={`cand ${into === c.id ? 'on' : ''}`}
                role="radio"
                aria-checked={into === c.id}
                onClick={() => setInto(c.id)}
              >
                <span className="cand-main">
                  <span className="cand-name">{c.name}</span>
                  <span className="cand-meta">
                    {c.series} · {c.images.toLocaleString()}장
                  </span>
                </span>
                <span className="cand-check">{into === c.id && <CheckIcon />}</span>
              </button>
            ))}
          </div>
          <div className="flat-group">
            <button
              className="mini"
              onClick={() => void act(() => window.api.mergeCharacters(ids, into), '캐릭터 합치기').then((ok) => ok && onMerged(into))}
            >
              <MergeIcon />
              {target?.name}(으)로 합치기
            </button>
          </div>
        </section>
      )}
    </>
  )
}
