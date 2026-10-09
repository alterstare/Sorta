// 캐릭터 관리 (Phase 4): rename, aliases, move to another game, 세부 소속,
// merge duplicates. Every change is one Ctrl+Z step; organized originals
// follow (moved to the character's new folder).
import { useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { useStore } from '../store'
import { useKept, useKeptScroll } from '../keep'
import type { ManagedCharacter } from '../../../shared/types'
import { CheckIcon, CloseIcon, EditIcon, MergeIcon, SaveAltIcon, SearchIcon, UploadIcon } from './icons'
import { ExportDialog, ImportDialog } from './PackDialogs'

type Act = (fn: () => Promise<unknown>, done?: string) => Promise<boolean>

export default function ManageView({ tabs }: { tabs: ReactNode }): JSX.Element {
  const pageRef = useKeptScroll<HTMLDivElement>('manage')
  const listRef = useKeptScroll<HTMLDivElement>('manage.list')
  const { showToast, refreshLibrary } = useStore()
  const libraryVersion = useStore((s) => s.libraryVersion)
  const [list, setList] = useKept<ManagedCharacter[]>('manage.list', [])
  const [q, setQ] = useKept('manage.q', '')
  const [sel, setSel] = useKept<number[]>('manage.sel', [])
  const [packOpen, setPackOpen] = useState<'export' | null>(null)
  const [importFile, setImportFile] = useState<string | null>(null)

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
      showToast({ ok: false, message: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
      return false
    }
  }

  const byId = useMemo(() => new Map(list.map((c) => [c.id, c])), [list])
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase()
    const hit = (c: ManagedCharacter): boolean =>
      !t || [c.name, c.series, c.affiliation ?? '', c.tag ?? '', ...c.aliases].some((s) => s.toLowerCase().includes(t))
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
    <div ref={pageRef} className="page manage">
      <div className="page-head">
        <h1>캐릭터</h1>
        {tabs}
        <span className="spacer" />
        <div className="flat-group">
          <button className="mini" title="소속 조직도 · 캐릭터 · 학습 데이터를 공유 파일로 저장" onClick={() => setPackOpen('export')}>
            <SaveAltIcon />
            내보내기
          </button>
          <button
            className="mini"
            title="다른 사람이 내보낸 공유 파일(.sortapack)을 불러오기"
            onClick={() => void window.api.pickPack().then((f) => f && setImportFile(f))}
          >
            <UploadIcon />
            불러오기
          </button>
        </div>
      </div>
      {packOpen === 'export' && <ExportDialog list={list} onClose={() => setPackOpen(null)} />}
      {importFile && <ImportDialog file={importFile} onClose={() => setImportFile(null)} />}
      <p className="hint">
        이름 · 별칭 · 게임 · 소속을 고치고, 같은 캐릭터가 둘로 나뉘었으면 합칩니다. 여러 명을 골라 게임이나 소속을 한 번에 바꿀 수 있습니다.
        정리한 그림은 바뀐 폴더로 옮겨집니다.
      </p>
      <div className="manage-body">
        <div ref={listRef} className="manage-list card">
          <div className="search-box">
            <SearchIcon />
            <input value={q} placeholder="이름 · 별칭 · 게임 · 소속으로 찾기" onChange={(e) => setQ(e.target.value)} />
          </div>
          {groups.length === 0 && <div className="row-desc pad">캐릭터가 없습니다.</div>}
          {groups.map(([series, chars]) => (
            <div key={series} className="manage-game">
              <div className="manage-game-title">
                {series} <span className="dim">{chars.length}</span>
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
          {picked.length === 1 && <OneEditor key={picked[0].id} c={picked[0]} act={act} />}
          {picked.length > 0 && <BulkEditor key={sel.join(',')} chars={picked} act={act} onMerged={(into) => setSel([into])} />}
        </div>
      </div>
    </div>
  )
}

function OneEditor({ c, act }: { c: ManagedCharacter; act: Act }): JSX.Element {
  const [name, setName] = useState(c.name)
  const [alias, setAlias] = useState('')
  useEffect(() => setName(c.name), [c.name])
  const rename = (): void => {
    if (name.trim() && name !== c.name) void act(() => window.api.renameCharacter(c.id, name), '이름 변경')
  }
  const addAlias = (): void => {
    const a = alias.trim()
    if (a && !c.aliases.includes(a)) void act(() => window.api.setAliases(c.id, [...c.aliases, a])).then((ok) => ok && setAlias(''))
  }
  return (
    <section className="card">
      <h2>{c.name}</h2>
      <div className="row-desc">
        {c.series}
        {c.tag && ` · ${c.tag}`}
      </div>
      <div className="manage-field">
        <div className="row-title">이름</div>
        <div className="learn-row">
          <input className="tag-input" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename()} />
          <div className="flat-group">
            <button className="mini" disabled={!name.trim() || name === c.name} onClick={rename}>
              <EditIcon />
              바꾸기
            </button>
          </div>
        </div>
        <div className="row-desc">폴더 이름으로 쓰입니다.</div>
      </div>
      <div className="manage-field">
        <div className="row-title">별칭</div>
        <div className="chip-row">
          {c.aliases.map((a) => (
            <span key={a} className="tag-chip">
              {a}
              <button title="빼기" onClick={() => void act(() => window.api.setAliases(c.id, c.aliases.filter((x) => x !== a)))}>
                <CloseIcon />
              </button>
            </span>
          ))}
          {c.aliases.length === 0 && <span className="row-desc">별칭이 없습니다.</span>}
        </div>
        <div className="learn-row">
          <input
            className="tag-input"
            value={alias}
            placeholder="별칭 추가 (검색 · 직접 입력용)"
            onChange={(e) => setAlias(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addAlias()}
          />
          <div className="flat-group">
            <button className="mini" disabled={!alias.trim()} onClick={addAlias}>
              추가
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

// Game / affiliation for one or many; merge for two or more.
function BulkEditor({ chars, act, onMerged }: { chars: ManagedCharacter[]; act: Act; onMerged: (into: number) => void }): JSX.Element {
  const ids = chars.map((c) => c.id)
  const oneGame = new Set(chars.map((c) => c.series)).size === 1 ? chars[0].series : ''
  const [series, setSeries] = useState(oneGame)
  const [allSeries, setAllSeries] = useState<string[]>([])
  const [aff, setAff] = useState(new Set(chars.map((c) => c.affiliation)).size === 1 ? (chars[0].affiliation ?? '') : '')
  const [affs, setAffs] = useState<string[]>([])
  const [into, setInto] = useState(chars[0].id)
  useEffect(() => void window.api.seriesNames().then(setAllSeries), [])
  useEffect(() => {
    if (oneGame) void window.api.affiliations(oneGame).then(setAffs)
    else setAffs([])
  }, [oneGame])
  const who = chars.length === 1 ? '' : `${chars.length}명 · `
  const target = chars.find((c) => c.id === into)

  return (
    <>
      <section className="card">
        <h2>{who}게임 · 소속</h2>
        <div className="manage-field">
          <div className="row-title">게임</div>
          <div className="learn-row">
            <input className="tag-input" list="manage-series" value={series} placeholder="게임 이름" onChange={(e) => setSeries(e.target.value)} />
            <datalist id="manage-series">
              {allSeries.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            <div className="flat-group">
              <button
                className="mini"
                disabled={!series.trim() || series === oneGame}
                onClick={() => void act(() => window.api.setSeries(ids, series), '게임 변경')}
              >
                옮기기
              </button>
            </div>
          </div>
          <div className="row-desc">다른 게임으로 옮기면 소속은 해제됩니다. 복장 버전도 함께 옮겨집니다.</div>
        </div>
        <div className="manage-field">
          <div className="row-title">세부 소속</div>
          {oneGame ? (
            <>
              <div className="learn-row">
                <input className="tag-input" list="manage-affs" value={aff} placeholder="학교 · 동아리 · 유닛…" onChange={(e) => setAff(e.target.value)} />
                <datalist id="manage-affs">
                  {affs.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
                <div className="flat-group">
                  <button className="mini" disabled={!aff.trim()} onClick={() => void act(() => window.api.setAffiliation(ids, aff), '소속 지정')}>
                    지정
                  </button>
                  <button
                    className="mini"
                    disabled={!chars.some((c) => c.affiliation)}
                    onClick={() => void act(() => window.api.setAffiliation(ids, null), '소속 해제')}
                  >
                    해제
                  </button>
                </div>
              </div>
              <div className="row-desc">소속이 있으면 게임/소속/캐릭터 폴더가 되고, 같은 소속끼리 함께 있는 그림은 게임/소속 폴더로 갑니다.</div>
            </>
          ) : (
            <div className="row-desc">같은 게임의 캐릭터만 함께 지정할 수 있습니다.</div>
          )}
        </div>
      </section>
      {chars.length >= 2 && (
        <section className="card">
          <h2>합치기</h2>
          <div className="row-desc">
            같은 캐릭터가 둘 이상으로 나뉘었을 때 하나로 합칩니다. 그림 · 참고 그림 · 복장 버전이 옮겨지고, 나머지 이름은 별칭이 됩니다. 남길
            캐릭터를 고르세요.
          </div>
          <div className="manage-merge" role="radiogroup">
            {chars.map((c) => (
              <button key={c.id} className={`cand ${into === c.id ? 'on' : ''}`} role="radio" aria-checked={into === c.id} onClick={() => setInto(c.id)}>
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
