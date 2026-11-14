// 한글 이름 (관리 → 캐릭터): Korean 표시 이름 for games, characters and
// affiliations — from the game's data site (Blue Archive: SchaleDB, the
// game's own Korean names), a roster picture read by the LLM, or the LLM by
// name (every game title; games with few characters: title + characters in
// one go). A checklist of the proposed names → 적용 (system names stay), one
// Ctrl+Z step.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { NameChange, NamePlan } from '../../../shared/types'
import { ComboInput } from './Combo'
import { Check } from './PackDialogs'
import ImageDrop from './ImageDrop'
import type { PickedImage } from './ImageDrop'
import { ArrowForwardIcon, ImageIcon, TranslateIcon } from './icons'
import { arrowText } from '../arrowText'

export type KoMode = 'data' | 'roster' | 'titles' | 'small'

const keyOf = (c: NameChange): string => `${c.kind}:${c.id}`
const KIND_LABEL: Record<NameChange['kind'], string> = { character: '캐릭터', affiliation: '소속', series: '게임' }
const KEEP = '내부명(영어)은 그대로 남아 태그 인식과 위키 조회는 그대로 되고, 화면과 정리 폴더에는 한글 이름이 쓰입니다.'

export default function KoNames({
  mode,
  games,
  game: first,
  onClose,
  onApply
}: {
  mode: KoMode
  games: string[]
  game: string
  onClose: () => void
  onApply: (changes: NameChange[], source: string) => Promise<boolean>
}): JSX.Element {
  const perGame = mode === 'data' || mode === 'roster'
  const [game, setGame] = useState(first)
  const known = games.includes(game.trim())
  const [site, setSite] = useState<string | null | undefined>(undefined) // undefined = asking
  const [image, setImage] = useState<PickedImage | null>(null)
  const [maxChars, setMaxChars] = useState(2)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [plan, setPlan] = useState<NamePlan | null>(null)
  const [off, setOff] = useState<Set<string>>(new Set()) // unchecked rows

  useEffect(() => {
    setPlan(null)
    setErr('')
    if (mode !== 'data') return
    setSite(undefined)
    if (!games.includes(game.trim())) return
    // a failed check doesn't lock 가져오기: it tells the reason itself
    Promise.resolve()
      .then(() => window.api.gameDataSite(game.trim()))
      .then(setSite, () => setSite(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, mode])

  const read = async (): Promise<void> => {
    setBusy(true)
    setErr('')
    setPlan(null)
    setOff(new Set())
    try {
      setPlan(
        mode === 'data'
          ? await window.api.namesFromGameData(game.trim())
          : mode === 'roster'
            ? await window.api.namesFromRoster(game.trim(), image!.data, image!.name)
            : mode === 'titles'
              ? await window.api.namesForTitles()
              : await window.api.namesForSmallGames(maxChars)
      )
    } catch (e) {
      setErr(String((e as Error).message ?? e))
    } finally {
      setBusy(false)
    }
  }
  const chosen = plan ? plan.changes.filter((c) => !off.has(keyOf(c))) : []
  const apply = async (): Promise<void> => {
    if (!plan || !chosen.length) return
    setBusy(true)
    if (await onApply(chosen, plan.source)) onClose()
    setBusy(false)
  }
  const toggle = (c: NameChange): void =>
    setOff((s) => {
      const n = new Set(s)
      if (n.has(keyOf(c))) n.delete(keyOf(c))
      else n.add(keyOf(c))
      return n
    })
  const count = (k: NameChange['kind']): number => plan?.changes.filter((c) => c.kind === k).length ?? 0
  const counts = (['series', 'character', 'affiliation'] as const)
    .filter((k) => count(k))
    .map((k) => `${KIND_LABEL[k]} ${count(k)}`)
    .join(' · ')

  const title = { data: '게임 데이터', roster: '명부 이미지', titles: '게임 이름', small: '캐릭터 적은 게임' }[mode]
  const desc = {
    data: `게임 데이터 사이트의 공식 한글 이름으로 캐릭터(의상 포함)와 소속(학교 · 동아리) 이름을 번역합니다. ${KEEP}`,
    roster: arrowText(`캐릭터 명부나 소속 목록처럼 한글 이름이 적힌 그림을 넣으세요. 설정 → LLM의 모델이 그림의 이름을 내 캐릭터 · 소속과 맞춥니다. ${KEEP}`),
    titles: arrowText(`번역하지 않은 게임 · 애니메이션 이름을 모두 설정 → LLM의 모델로 번역합니다. ${KEEP}`),
    small: arrowText(`캐릭터가 몇 명 없는 게임은 게임 이름과 캐릭터 이름을 한 번에 설정 → LLM의 모델로 번역합니다. ${KEEP}`)
  }[mode]

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal org-import ko-names" onMouseDown={(e) => e.stopPropagation()}>
        <div className="dlg-title">
          <h2>
            {mode === 'roster' ? <ImageIcon /> : <TranslateIcon />}
            한글 이름 · {title}
          </h2>
          <div className="row-desc">{desc}</div>
        </div>
        <div className="dlg-field">
          <div className="dlg-row">
            {perGame ? (
              <ComboInput
                className="ko-game"
                typed
                value={game}
                options={games}
                placeholder="게임 이름"
                onChange={(v) => (setGame(v), setPlan(null))}
                onEnter={() => known && mode === 'data' && !busy && void read()}
                suffix={
                  mode === 'data' && known && site !== undefined ? <span className={`ko-site ${site ? 'on' : ''}`}>{site ? '지원' : '미지원'}</span> : null
                }
              />
            ) : mode === 'small' ? (
              <label className="ko-max">
                캐릭터
                <input
                  className="tag-input"
                  type="number"
                  min={1}
                  max={20}
                  value={maxChars}
                  onChange={(e) => (setMaxChars(Math.max(1, Math.min(20, Number(e.target.value) || 1))), setPlan(null))}
                />
                명 이하인 게임
              </label>
            ) : (
              <span className="dim">번역하지 않은 모든 게임</span>
            )}
            <button className="btn" disabled={busy || (perGame && !known) || (mode === 'roster' && !image)} onClick={() => void read()}>
              {busy
                ? mode === 'data'
                  ? '가져오는 중…'
                  : mode === 'roster'
                    ? 'LLM이 읽는 중…'
                    : 'LLM이 번역하는 중…'
                : mode === 'data'
                  ? '가져오기'
                  : mode === 'roster'
                    ? '읽기'
                    : '번역'}
            </button>
          </div>
          {mode === 'data' && known && site !== undefined && (
            <div className="dim">{site ? `${site}의 공식 한글 이름을 가져옵니다.` : '이 게임은 아직 게임 데이터가 없습니다. 명부 이미지로 번역을 쓰세요.'}</div>
          )}
          {perGame && game.trim() && !known && <div className="dim">이 이름의 게임이 없습니다.</div>}
        </div>
        {mode === 'roster' && <ImageDrop image={image} onImage={(img) => (setImage(img), setPlan(null), setErr(''))} />}

        {err && <div className="pack-warn">{arrowText(err)}</div>}
        {plan && (
          <>
            <div className="pack-stats">
              <span>
                번역할 이름 <b>{plan.changes.length}</b>개{counts && ` (${counts})`}
              </span>
              {plan.unmatched > 0 && <span className="dim">번역을 찾지 못한 것 {plan.unmatched}개</span>}
              <span className="spacer" />
              <div className="flat-group">
                <button className="mini" onClick={() => setOff(new Set())}>
                  전체 선택
                </button>
                <button className="mini" onClick={() => setOff(new Set(plan.changes.map(keyOf)))}>
                  전체 선택 해제
                </button>
              </div>
            </div>
            {plan.changes.length ? (
              <div className="modal-list org-import-rows">
                {plan.changes.map((c) => (
                  <div className="ko-row" key={keyOf(c)}>
                    <Check on={!off.has(keyOf(c))} onClick={() => toggle(c)}>
                      <span className={`org-import-tag ${c.kind === 'character' ? 'new' : c.kind === 'series' ? 'game' : 'moved'}`}>{KIND_LABEL[c.kind]}</span>
                      {!perGame && c.kind !== 'series' && c.series && <span className="dim">{c.series} ·</span>}
                      <span className="dim">{c.from}</span>
                      <ArrowForwardIcon className="txt-arrow" />
                      <b>{c.to}</b>
                    </Check>
                  </div>
                ))}
              </div>
            ) : (
              <div className="dim">번역할 이름이 없습니다.</div>
            )}
          </>
        )}

        <div className="modal-foot">
          <button className="btn primary" disabled={!chosen.length || busy} onClick={() => void apply()}>
            {chosen.length ? `${chosen.length}개 적용` : '적용'}
          </button>
          <button className="btn" onClick={onClose}>
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
