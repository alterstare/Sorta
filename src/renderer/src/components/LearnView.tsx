// 캐릭터 학습 (Phase 3): teach Sorta characters its taggers don't know, from
// Safebooru reference pictures — a whole game at once (only the characters
// still missing) or one character. User-confirmed pictures are added as
// references automatically.
import { useEffect, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { blocking, useStore } from '../store'
import { useKept, useKeptScroll } from '../keep'
import type { GameOption, LearnedCharacter, LearnPlanInfo } from '../../../shared/types'
import { CheckIcon, DeleteIcon, DownloadIcon, PlayIcon, RestartIcon, SearchIcon } from './icons'

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
  const running = blocking(jobs)
  const ccip = models.find((m) => m.id === 'ccip')
  const ready = !!ccip?.installed && !!settings?.allowWebLookup
  const libraryVersion = useStore((s) => s.libraryVersion)

  useEffect(() => {
    void window.api.games().then(setGames)
    void window.api.learned().then(setLearned)
  }, [libraryVersion])
  useEffect(() => {
    if (!ready || !q.trim()) return setHits([])
    const t = setTimeout(() => void window.api.booruTags(q).then(setHits).catch(() => setHits([])), 300)
    return () => clearTimeout(t)
  }, [q, ready])

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
  const learn = async (tags: string[]): Promise<void> => {
    showToast(await window.api.learn(tags))
    setPlan(null)
    setLearned(await window.api.learned())
  }

  if (!settings) return <div className="page" />
  return (
    <div ref={pageRef} className="page learn">
      <div className="page-head">
        <h1>캐릭터</h1>
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
          <input
            className="tag-input"
            list="sorta-games"
            value={game}
            placeholder="게임 (예: Blue Archive)"
            onChange={(e) => (setGame(e.target.value), setPlan(null))}
            onKeyDown={(e) => e.key === 'Enter' && ready && void makePlan()}
          />
          <datalist id="sorta-games">
            {games.map((g) => (
              <option key={g.tag} value={g.name} />
            ))}
          </datalist>
          <div className="flat-group">
            <button className="mini" disabled={!ready || !game.trim() || planning} onClick={() => void makePlan()}>
              <SearchIcon />
              {planning ? '확인 중…' : '학습할 캐릭터 확인'}
            </button>
          </div>
        </div>
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
                    <button className="btn primary" disabled={running} onClick={() => void learn(chosen)}>
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
        <h2>캐릭터 하나 학습</h2>
        <div className="row-desc">미확인·작품 미상 그림의 캐릭터 이름을 찾아 하나만 학습합니다.</div>
        <div className="picker learn-search">
          <div className="picker-box">
            <SearchIcon />
            <input value={q} disabled={!ready} placeholder="캐릭터 이름 (영문 태그, 예: aoi)" onChange={(e) => setQ(e.target.value)} />
          </div>
          {hits.length > 0 && (
            <div className="picker-list">
              {hits.map((h) => (
                <button
                  key={h.name}
                  className="picker-opt"
                  disabled={running}
                  onClick={() => {
                    setQ('')
                    void learn([h.name])
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
        <div className="card-head">
          <h2>학습한 캐릭터 {learned.length}명</h2>
          <div className="flat-group">
            <button className="mini" disabled={running || !ccip?.installed} onClick={() => void window.api.learnRefresh().then(showToast)}>
              <RestartIcon />
              지금 다시 비교
            </button>
          </div>
        </div>
        {learned.length === 0 && <div className="row-desc">아직 학습한 캐릭터가 없습니다.</div>}
        {learned.map((c) => (
          <div className="row" key={c.characterId}>
            <div className="row-text">
              <div className="row-title">{c.name}</div>
              <div className="row-desc">
                {c.series} · 참고 그림 {c.refs}장{c.userRefs ? ` + 직접 확정 ${c.userRefs}장` : ''} · {new Date(c.learnedAt).toLocaleDateString()}
              </div>
            </div>
            <div className="flat-group">
              <button className="mini" disabled={!ready || running} title="새 그림만 더 받기" onClick={() => void learn([c.tag])}>
                <RestartIcon />
                다시 학습
              </button>
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
      </section>
    </div>
  )
}
