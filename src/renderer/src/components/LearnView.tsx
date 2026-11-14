// 캐릭터 학습 (Phase 3): teach Sorta characters its taggers don't know, from
// Safebooru reference pictures — a whole game at once (only the characters
// still missing) or one character. User-confirmed pictures are added as
// references automatically.
import { useEffect, useMemo, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { blocking, useStore } from '../store'
import { useKept, useKeptScroll } from '../keep'
import type { GameOption, LearnedCharacter, LearnPlanInfo, ProgressEvent } from '../../../shared/types'
import { ComboInput } from './Combo'
import CharacterPicker from './CharacterPicker'
import type { PickedCharacter } from './CharacterPicker'
import { CheckIcon, CloseIcon, DeleteIcon, DownloadIcon, FolderOpenIcon, KeyboardArrowDownIcon, PlayIcon, RestartIcon, SearchIcon } from './icons'
import { arrowText } from '../arrowText'

export default function LearnView({ tabs }: { tabs?: ReactNode }): JSX.Element {
  const pageRef = useKeptScroll<HTMLDivElement>('learn')
  const { settings, saveSettings, models, refreshModels, showToast, jobs } = useStore()
  const [games, setGames] = useKept<GameOption[]>('learn.games', [])
  const [game, setGame] = useKept('learn.game', '')
  const [plan, setPlan] = useKept<LearnPlanInfo | null>('learn.plan', null)
  const [planning, setPlanning] = useKept('learn.planning', false)
  // 이격(복장 버전) 제외: skip outfit/version tags (name_(outfit)_(game)) when learning a game.
  const [noOutfits, setNoOutfits] = useKept('learn.noOutfits', false)
  const [learned, setLearned] = useKept<LearnedCharacter[]>('learn.learned', [])
  const [q, setQ] = useKept('learn.q', '')
  const [hits, setHits] = useState<{ name: string; post_count: number }[]>([])
  // 캐릭터 검색: 'idle' | 'wait' (typing) | 'busy' (asking the site) | 'done' | error message
  const [search, setSearch] = useState<'idle' | 'wait' | 'busy' | 'done' | { error: string }>('idle')
  const [learnedSort, setLearnedSort] = useKept<'recent' | 'game'>('learn.sort', 'recent')
  const running = blocking(jobs)
  const ccip = models.find((m) => m.id === 'ccip')
  const ready = !!ccip?.installed && !!settings?.allowWebLookup
  const libraryVersion = useStore((s) => s.libraryVersion)

  useEffect(() => {
    void window.api.games().then(setGames)
    void window.api.learned().then(setLearned)
  }, [libraryVersion])
  useEffect(() => {
    if (!ready || !q.trim()) {
      setHits([])
      setSearch('idle')
      return
    }
    let live = true
    setSearch('wait')
    const t = setTimeout(() => {
      setSearch('busy')
      void window.api
        .booruTags(q)
        .then((h) => live && (setHits(h), setSearch('done')))
        .catch((e) => live && (setHits([]), setSearch({ error: String((e as Error).message ?? e) })))
    }, 300)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, ready])
  // The learning jobs of this screen (shown in the card that started them).
  const jobList = Object.values(jobs)
  const planJob = jobList.find((j) => j.name === '학습할 캐릭터 확인')
  const learnJob = jobList.find((j) => j.name === '캐릭터 학습')
  const folderJob = jobList.find((j) => j.name === '직접 학습')
  // 직접 학습: a folder of the user's own pictures of one character
  const [folderDir, setFolderDir] = useKept('learn.folderDir', '')
  const [folderChar, setFolderChar] = useKept<PickedCharacter | null>('learn.folderChar', null)
  const [folderNew, setFolderNew] = useState(false)
  const learnFromFolder = async (): Promise<void> => {
    if (!folderDir || !folderChar) return
    showToast(await window.api.learnFolder(folderDir, folderChar.id))
    setLearned(await window.api.learned())
  }
  // 학습한 캐릭터: searched, then grouped by game (folded games kept)
  const [learnedQ, setLearnedQ] = useKept('learn.learnedQ', '')
  const [folded, setFolded] = useKept<string[]>('learn.folded', [])
  const learnedGroups = useMemo(() => {
    const t = learnedQ.trim().toLowerCase()
    const hit = (c: LearnedCharacter): boolean => !t || [c.name, c.series, c.tag].some((s) => s.toLowerCase().includes(t))
    const sorted = learnedSort === 'recent' ? [...learned].sort((a, b) => b.learnedAt - a.learnedAt) : learned // core: by game, then name
    const m = new Map<string, LearnedCharacter[]>()
    for (const c of sorted) if (hit(c)) m.set(c.series, [...(m.get(c.series) ?? []), c])
    return [...m]
  }, [learned, learnedQ, learnedSort])

  const gameTag = games.find((g) => g.name === game || g.tag === game)?.tag ?? game.trim().toLowerCase().replace(/\s+/g, '_')
  const makePlan = async (): Promise<void> => {
    setPlanning(true)
    setPlan(null)
    setExcluded([])
    setPlanTab('learn')
    try {
      setPlan(await window.api.learnPlan(gameTag))
    } catch (e) {
      showToast({ ok: false, message: String((e as Error).message ?? e) })
    } finally {
      setPlanning(false)
    }
  }
  const isOutfit = (tag: string): boolean => (tag.match(/\(/g) ?? []).length >= 2
  const planList = plan ? plan.learn.filter((t) => !noOutfits || !isOutfit(t.name)) : []
  // Characters taken out of the plan by the user (default: everyone selected).
  const [excluded, setExcluded] = useKept<string[]>('learn.excluded', [])
  const [planTab, setPlanTab] = useKept<'learn' | 'known' | 'learned' | 'tooFew'>('learn.planTab', 'learn')
  const chosen = planList.filter((t) => !excluded.includes(t.name)).map((t) => t.name)
  const outfitCount = plan ? plan.learn.filter((t) => isOutfit(t.name)).length : 0
  // Which card started the running 학습 (its progress shows there).
  const [learnFrom, setLearnFrom] = useKept<'game' | 'one' | 'list'>('learn.from', 'game')
  const learn = async (tags: string[], from: 'game' | 'one' | 'list'): Promise<void> => {
    setLearnFrom(from)
    showToast(await window.api.learn(tags))
    setPlan(null)
    setLearned(await window.api.learned())
  }

  if (!settings) return <div className="page" />
  return (
    <div ref={pageRef} className="page learn">
      <div className="page-head stack">
        <h1>관리</h1>
        {tabs}
      </div>
      <p className="hint">
        태거 모델이 모르는 캐릭터를 Danbooru(차단 우회 내장) 또는 Safebooru의 참고 그림으로 학습합니다. 검토에서 직접 확정한 그림도 자동으로 참고 그림이
        됩니다.
      </p>

      {!ready && (
        <section className="card warn-card">
          <h2>준비</h2>
          <div className="row">
            <div className="row-text">
              <div className="row-title">{ccip?.label ?? '캐릭터 학습 모델'}</div>
              <div className="row-desc">
                {ccip?.installed ? '설치 완료' : `약 ${Math.round((ccip?.totalBytes ?? 0) / 1048576)}MB · ${ccip?.license ?? ''}`}
              </div>
            </div>
            {!ccip?.installed && (
              <div className="flat-group">
                <button
                  className="mini"
                  disabled={running}
                  onClick={() => void window.api.downloadModel('ccip').then((r) => (showToast(r), refreshModels()))}
                >
                  <DownloadIcon />
                  받기
                </button>
              </div>
            )}
          </div>
          <div className="row">
            <div className="row-text">
              <div className="row-title">외부 조회 허용</div>
              <div className="row-desc">캐릭터 이름으로 Safebooru에서 참고 그림을 받습니다. 내 그림은 밖으로 보내지 않습니다.</div>
            </div>
            <div className="flat-group">
              {[true, false].map((v) => (
                <button key={String(v)} className={`mini ${settings.allowWebLookup === v ? 'on' : ''}`} onClick={() => void saveSettings({ allowWebLookup: v })}>
                  {v ? '허용' : '차단'}
                </button>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <h2>게임 단위 학습</h2>
        <div className="row-desc">
          게임을 고르면 그 게임 캐릭터 중 모델이 이미 아는 캐릭터와 이미 학습한 캐릭터를 빼고 남은 캐릭터만 학습합니다. 새 캐릭터가
          나오면 다시 누르세요 — 추가된 캐릭터만 학습합니다.
        </div>
        <div className="learn-row">
          <ComboInput
            className="learn-game"
            value={game}
            options={games.map((g) => g.name)}
            placeholder="게임 (예: Blue Archive)"
            onChange={(v) => (setGame(v), setPlan(null))}
            onEnter={() => ready && game.trim() && void makePlan()}
          />
          <div className="flat-group">
            <button className="mini" disabled={!ready || !game.trim() || planning} onClick={() => void makePlan()}>
              <SearchIcon />
              {planning ? '확인 중…' : '학습할 캐릭터 확인'}
            </button>
          </div>
        </div>
        {planJob && <JobProgress job={planJob} unit="명" />}
        {learnJob && learnFrom === 'game' && <JobProgress job={learnJob} unit="명" />}
        {plan && (
          <div className="learn-plan">
            <div className="flat-group learn-tabs">
              {(
                [
                  ['learn', `새로 학습 ${planList.length}`],
                  ['known', `모델이 아는 캐릭터 ${plan.known}`],
                  ['learned', `학습 완료 ${plan.learned}`],
                  ['tooFew', `그림 부족 ${plan.tooFew}`]
                ] as const
              ).map(([k, l]) => (
                <button key={k} className={`mini ${planTab === k ? 'on' : ''}`} onClick={() => setPlanTab(k)}>
                  {l}
                </button>
              ))}
              {plan.source && <span className="hint">출처 {plan.source}</span>}
            </div>
            {planTab === 'learn' && (
              <>
                <div className="learn-sel-bar">
                  {outfitCount > 0 && (
                    <div className="flat-group">
                      <button className={`mini ${!noOutfits ? 'on' : ''}`} onClick={() => setNoOutfits(false)}>
                        이격 포함
                      </button>
                      <button className={`mini ${noOutfits ? 'on' : ''}`} onClick={() => setNoOutfits(true)}>
                        이격 제외 (기본 캐릭터만)
                      </button>
                    </div>
                  )}
                  <div className="flat-group">
                    <button className="mini" onClick={() => setExcluded([])}>
                      전체 선택
                    </button>
                    <button className="mini" onClick={() => setExcluded(planList.map((t) => t.name))}>
                      전체 선택 해제
                    </button>
                    <button className="mini" onClick={() => setExcluded(planList.filter((t) => !excluded.includes(t.name)).map((t) => t.name))}>
                      선택 반전
                    </button>
                  </div>
                  <span className="hint">
                    {chosen.length} / {planList.length}명 선택 · 눌러서 빼거나 넣기
                  </span>
                </div>
                <div className="chip-row learn-chips">
                  {planList.map((t) => {
                    const on = !excluded.includes(t.name)
                    return (
                      <button
                        key={t.name}
                        className={`tag-chip pick ${on ? 'on' : ''}`}
                        onClick={() => setExcluded((x) => (on ? [...x, t.name] : x.filter((n) => n !== t.name)))}
                      >
                        {on && <CheckIcon />}
                        {t.name}
                        {t.post_count > 0 && <span className="hint"> {t.post_count}</span>}
                      </button>
                    )
                  })}
                  {planList.length === 0 && <span className="row-desc">새로 학습할 캐릭터가 없습니다.</span>}
                </div>
                {chosen.length > 0 && (
                  <>
                    <div className="row-desc">
                      캐릭터당 그림 {settings.learnPerCharacter}장 · 예상 다운로드 약 {Math.round((chosen.length * settings.learnPerCharacter * 60) / 1024)}MB · 약{' '}
                      {Math.ceil((chosen.length * 10) / 60)}분
                    </div>
                    <button className="btn primary" disabled={running} onClick={() => void learn(chosen, 'game')}>
                      <PlayIcon />
                      {chosen.length}명 학습 시작
                    </button>
                  </>
                )}
              </>
            )}
            {planTab !== 'learn' && (
              <>
                <div className="row-desc">
                  {planTab === 'known' && '태거 모델이 이미 알아서 학습하지 않아도 되는 캐릭터입니다.'}
                  {planTab === 'learned' && '이미 학습한 캐릭터입니다. 아래 "학습한 캐릭터"에서 다시 학습할 수 있습니다.'}
                  {planTab === 'tooFew' &&
                    `혼자 나온 그림이 최소 그림 수(${settings.learnMinPosts}장)보다 적어 건너뛰는 캐릭터입니다. 설정에서 최소 그림 수를 낮추면 학습할 수 있습니다. 숫자 = 찾은 그림 수.`}
                </div>
                <div className="chip-row learn-chips">
                  {(planTab === 'known' ? plan.knownTags : planTab === 'learned' ? plan.learnedTags : []).map((n) => (
                    <span key={n} className="tag-chip static">
                      {n}
                    </span>
                  ))}
                  {planTab === 'tooFew' &&
                    plan.tooFewTags.map((t) => (
                      <span key={t.name} className="tag-chip static">
                        {t.name}
                        <span className="hint"> {t.post_count}</span>
                      </span>
                    ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>개별 캐릭터 학습</h2>
        <div className="row-desc">미확인·작품 미상 그림의 캐릭터 이름을 찾아 하나만 학습합니다.</div>
        <div className="picker learn-search">
          <div className="picker-box">
            <SearchIcon />
            <input value={q} disabled={!ready} placeholder="캐릭터 이름 (영문 태그, 예: aoi)" onChange={(e) => setQ(e.target.value)} />
            {(search === 'wait' || search === 'busy') && <span className="learn-search-state">{search === 'busy' ? '검색 중…' : ''}</span>}
          </div>
          {search === 'busy' && hits.length === 0 && (
            <div className="picker-list">
              <div className="picker-sec learn-search-msg">
                <div className="bar indeterminate">
                  <div className="bar-fill" />
                </div>
                사이트에서 찾는 중… 처음 검색은 출처 확인 때문에 오래 걸릴 수 있습니다.
              </div>
            </div>
          )}
          {search === 'done' && hits.length === 0 && (
            <div className="picker-list">
              <div className="picker-sec learn-search-msg">찾는 캐릭터가 없습니다.</div>
            </div>
          )}
          {learnJob && learnFrom === 'one' && <JobProgress job={learnJob} unit="명" />}
          {typeof search === 'object' && (
            <div className="picker-list">
              <div className="picker-sec learn-search-msg err">검색 실패: {arrowText(search.error)}</div>
            </div>
          )}
          {hits.length > 0 && (
            <div className="picker-list">
              {hits.map((h) => (
                <button
                  key={h.name}
                  className="picker-opt"
                  disabled={running}
                  onClick={() => {
                    setQ('')
                    void learn([h.name], 'one')
                  }}
                >
                  <span className="picker-name">{h.name}</span>
                  <span className="picker-n">그림 {h.post_count}장 · 학습</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <h2>직접 학습</h2>
        <div className="row-desc">
          직접 분류해 둔 폴더의 그림으로 캐릭터를 학습합니다(하위 폴더 포함). 그림은 옮기거나 복사하지 않고 특징만 저장하며, 밖으로
          보내지 않습니다. 같은 폴더를 다시 학습하면 새로 넣은 그림만 더합니다.
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">폴더</div>
            <div className="row-desc selectable">{folderDir || '고른 폴더가 없습니다'}</div>
          </div>
          <div className="flat-group">
            <button className="mini" disabled={!!folderJob} onClick={() => void window.api.pickFolder().then((d) => d && setFolderDir(d))}>
              <FolderOpenIcon />
              {folderDir ? '바꾸기' : '폴더 고르기'}
            </button>
          </div>
        </div>
        <div className="row">
          <div className="row-text">
            <div className="row-title">캐릭터</div>
            <div className="row-desc">{folderChar ? `${folderChar.name} · ${folderChar.series}` : '학습할 캐릭터를 찾거나 새로 등록하세요'}</div>
          </div>
          {folderChar && (
            <div className="flat-group">
              <button className="mini" disabled={!!folderJob} onClick={() => setFolderChar(null)}>
                <CloseIcon />
                바꾸기
              </button>
            </div>
          )}
        </div>
        {/* the character search with the start button on its right */}
        <div className="learn-folder-row">
          {!folderChar && (
            <div className="learn-folder-picker">
              <CharacterPicker placeholder="캐릭터 이름 · 별칭 · 게임으로 찾기" newMode={folderNew} onNewModeChange={setFolderNew} onPick={(c) => (setFolderChar(c), setFolderNew(false))} />
            </div>
          )}
          {!folderJob && (
            <button
              className="btn primary learn-folder-go"
              disabled={!ccip?.installed || !folderDir || !folderChar || running}
              title={!ccip?.installed ? '설정 → 모델에서 캐릭터 학습 모델(CCIP)을 받아야 합니다' : undefined}
              onClick={() => void learnFromFolder()}
            >
              <PlayIcon />
              학습 시작
            </button>
          )}
        </div>
        {folderJob && <JobProgress job={folderJob} unit="장" />}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>학습한 캐릭터 {learned.length}명</h2>
          <div className="flat-group">
            <button className={`mini ${learnedSort === 'recent' ? 'on' : ''}`} onClick={() => setLearnedSort('recent')}>
              최근 학습순
            </button>
            <button className={`mini ${learnedSort === 'game' ? 'on' : ''}`} onClick={() => setLearnedSort('game')}>
              게임순
            </button>
          </div>
          <div className="flat-group">
            <button className="mini" disabled={running || !ccip?.installed} onClick={() => void window.api.learnRefresh().then(showToast)}>
              <RestartIcon />
              지금 다시 비교
            </button>
          </div>
        </div>
        {learned.length === 0 && <div className="row-desc">아직 학습한 캐릭터가 없습니다.</div>}
        {learnJob && learnFrom === 'list' && <JobProgress job={learnJob} unit="명" />}
        {learned.length > 0 && (
          <div className="picker-box learn-learned-search">
            <SearchIcon />
            <input value={learnedQ} placeholder="이름 · 게임 · 태그로 찾기" onChange={(e) => setLearnedQ(e.target.value)} />
          </div>
        )}
        {learned.length > 0 && learnedGroups.length === 0 && <div className="row-desc">찾는 캐릭터가 없습니다.</div>}
        {learnedGroups.map(([series, chars]) => {
          // searching shows every hit, folded games too
          const open = !!learnedQ.trim() || !folded.includes(series)
          return (
            <div key={series} className="manage-game learn-series">
              <div className="manage-game-title" onClick={() => setFolded((f) => (f.includes(series) ? f.filter((x) => x !== series) : [...f, series]))}>
                {series}
                <span className="dim">{chars.length}</span>
                <span className="spacer" />
                <KeyboardArrowDownIcon className={`caret ${open ? 'up' : ''}`} />
              </div>
              {open &&
                chars.map((c) => (
                  <div className="row" key={c.characterId}>
                    <div className="row-text">
                      <div className="row-title">{c.name}</div>
                      <div className="row-desc">
                        참고 그림 {c.refs}장{c.userRefs ? ` + 직접 확정 ${c.userRefs}장` : ''} · {new Date(c.learnedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="flat-group">
                      {/* learned only from folders (no Danbooru tag): nothing to fetch again */}
                      {c.tag && (
                        <button className="mini" disabled={!ready || running} title="새 그림만 더 받기" onClick={() => void learn([c.tag], 'list')}>
                          <RestartIcon />
                          다시 학습
                        </button>
                      )}
                      <button
                        className="mini"
                        disabled={running}
                        onClick={() => void window.api.forgetLearned(c.characterId).then(async () => setLearned(await window.api.learned()))}
                      >
                        <DeleteIcon />
                        지우기
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          )
        })}
      </section>
    </div>
  )
}

// A running learning job in its card: what it's doing, how far overall
// (characters) and in the current step (pictures …).
function JobProgress({ job, unit }: { job: ProgressEvent; unit: string }): JSX.Element {
  const pct = (d: number, t: number): number => Math.round((d / t) * 100)
  return (
    <div className="learn-progress">
      <div className="learn-progress-head">
        <span className="row-title">{job.label}</span>
        {job.total > 0 && (
          <span className="hint">
            {job.done.toLocaleString()} / {job.total.toLocaleString()}
            {unit} 완료
          </span>
        )}
        <button className="mini" title="취소" onClick={() => void window.api.cancelJob(job.jobId)}>
          취소
        </button>
      </div>
      <div className={`bar ${job.total > 0 ? '' : 'indeterminate'}`}>
        <div className="bar-fill" style={job.total > 0 ? { width: `${pct(job.done, job.total)}%` } : undefined} />
      </div>
      <div className="learn-progress-step">
        <span className="row-desc">{job.state === 'queued' ? '다른 작업이 끝나기를 기다리는 중' : (job.detail ?? '준비 중')}</span>
        {job.step && (
          <span className="hint">
            {job.step.done.toLocaleString()} / {job.step.total.toLocaleString()}
          </span>
        )}
      </div>
      {job.step && (
        <div className="bar thin">
          <div className="bar-fill" style={{ width: `${pct(job.step.done, job.step.total)}%` }} />
        </div>
      )}
    </div>
  )
}
