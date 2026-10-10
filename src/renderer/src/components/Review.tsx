// 검토 대기열 (CLAUDE.md §7 Review): one image at a time, keyboard-first.
//   1/2/3 후보 체크 · Enter 확정 (체크 없으면 1순위) · / 직접 입력 · N 새 캐릭터
//   S 건너뛰기 · G 단체 사진 · X 캐릭터 아닌 그림 · R 등급 순환 · ←/→ 이동 · Ctrl+Z 되돌리기 (App)
import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import { useKept } from '../keep'
import type { Rating, ReviewItem, ReviewKind } from '../../../shared/types'
import CharacterPicker from './CharacterPicker'
import type { PickedCharacter } from './CharacterPicker'
import { CheckIcon, CloseIcon, GroupsIcon, ImageSearchIcon, KeyboardArrowLeftIcon, KeyboardArrowRightIcon, PersonOffIcon, SkipNextIcon, UndoIcon } from './icons'
import { RATING_LABEL } from './ThumbGrid'

type R = Exclude<Rating, 'unknown'>
const RATINGS: R[] = ['general', 'sensitive', 'r18']
const RATING_DESC: Record<R, string> = {
  general: '누구나 볼 수 있는 그림',
  sensitive: '노출이 있거나 선정적이지만 성인물은 아닌 그림 (수영복 등)',
  r18: '성인 전용'
}

export default function Review(): JSX.Element {
  const tree = useStore((s) => s.tree)
  const showToast = useStore((s) => s.showToast)
  // 구글에서 찾기: the picture goes to Google Lens — opt-in, asked once here.
  const allowSearch = useStore((s) => !!s.settings?.allowImageSearch)
  const saveSettings = useStore((s) => s.saveSettings)
  const [askSearch, setAskSearch] = useState<string | null>(null)
  const imageSearch = (path: string): void => {
    if (!allowSearch) return setAskSearch(path)
    window.api.imageSearch(path).catch((e: Error) =>
      showToast({ ok: false, message: `구글 렌즈를 열지 못했습니다: ${String(e.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}` })
    )
  }
  const libraryVersion = useStore((s) => s.libraryVersion)
  const [kind, setKind] = useKept<ReviewKind>('review.kind', 'character')
  const [items, setItems] = useKept<ReviewItem[]>('review.items', [])
  const [index, setIndex] = useKept('review.index', 0)
  // Choices for the shown image survive leaving the view (reset only when
  // another image comes up).
  const [choicesFor, setChoicesFor] = useKept<number | null>('review.choicesFor', null)
  const [checked, setChecked] = useKept<Set<number>>('review.checked', new Set())
  const [extras, setExtras] = useKept<PickedCharacter[]>('review.extras', [])
  const [rating, setRating] = useKept<R>('review.rating', 'general')
  const [newMode, setNewMode] = useState(false)
  // Outfit candidates: 'replace' = the confirmed character is actually in this
  // outfit; 'both' = two outfits of the character in the picture.
  const [outfit, setOutfit] = useKept<Record<number, 'replace' | 'both'>>('review.outfit', {})
  // Confirmed characters the user takes out (the model was wrong).
  const [removed, setRemoved] = useKept<Set<number>>('review.removed', new Set())
  const pickerRef = useRef<HTMLInputElement>(null)
  const item = items[Math.min(index, items.length - 1)] as ReviewItem | undefined

  const load = useCallback(async () => setItems(await window.api.reviewQueue(kind)), [kind])
  // Reload on kind switch and whenever the library changes (incl. undo).
  useEffect(() => {
    void load()
  }, [load, libraryVersion])
  // Fresh choices for each image.
  useEffect(() => {
    setNewMode(false)
    if ((item?.id ?? null) === choicesFor) return // same image as before leaving the view
    setChoicesFor(item?.id ?? null)
    setChecked(new Set())
    setExtras([])
    setOutfit({})
    setRemoved(new Set())
    setRating(item && item.rating !== 'unknown' ? item.rating : 'general')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id])

  const toggle = (id: number): void =>
    setChecked((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  const after = async (msg?: string): Promise<void> => {
    await load() // the decided image drops out; the same index shows the next one
    if (msg) showToast({ ok: true, message: msg })
  }

  const confirm = async (): Promise<void> => {
    if (!item) return
    if (kind === 'rating') {
      await window.api.setRating([item.id], rating)
      return after()
    }
    let chosen = [...checked, ...extras.map((e) => e.id)]
    if (!chosen.length && !extra && item.candidates[0]) chosen = [item.candidates[0].id]
    if (!chosen.length && !extra) return
    // Keep the confirmed characters, minus the ones taken out or replaced by an outfit.
    await window.api.confirmCharacters([item.id], [...kept(), ...chosen])
    if (item.rating !== rating) await window.api.setRating([item.id], rating)
    await after()
  }
  // 없음: only the already-confirmed characters are in the picture.
  const onlyConfirmed = async (): Promise<void> => {
    if (!item) return
    await window.api.confirmCharacters([item.id], item.confirmed.filter((c) => !removed.has(c.id)).map((c) => c.id))
    await after()
  }
  const isSwap = (c: ReviewItem['candidates'][number]): boolean =>
    checked.has(c.id) && !!c.relatedTo && (outfit[c.id] ?? 'replace') === 'replace'
  const kept = (): number[] => {
    const replaced = new Set((item?.candidates ?? []).filter(isSwap).map((c) => c.relatedTo!.id))
    return (item?.confirmed ?? []).filter((c) => !removed.has(c.id) && !replaced.has(c.id)).map((c) => c.id)
  }
  const markOther = async (): Promise<void> => {
    if (!item) return
    await window.api.markOther([item.id])
    await after()
  }
  // 단체 사진: pick the game first (suggested: the top candidate's)
  const markGroup = (): void => {
    if (!item) return
    const suggest = item.confirmed[0]?.series ?? item.candidates[0]?.series ?? null
    useStore.getState().setGroupShotDialog({ ids: [item.id], suggest, after: () => void after() })
  }
  const skip = (d = 1): void => setIndex((i) => Math.max(0, Math.min(items.length - 1, i + d)))
  const cycleRating = (): void => setRating((r) => RATINGS[(RATINGS.indexOf(r) + 1) % RATINGS.length])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return
      const k = e.key.toLowerCase()
      if (['1', '2', '3'].includes(k)) {
        if (kind === 'rating') setRating(RATINGS[Number(k) - 1])
        else {
          const c = item?.candidates[Number(k) - 1]
          if (c) toggle(c.id)
        }
      } else if (k === 'enter') {
        // "다른 캐릭터도 있나요?" — Enter without a pick means 없음 (never adds a guess).
        if (kind === 'character' && item?.confirmed.length && !checked.size && !extras.length) void onlyConfirmed()
        else void confirm()
      }
      else if (k === '0' && kind === 'character' && item?.confirmed.length) void onlyConfirmed()
      else if (k === '/') {
        e.preventDefault()
        pickerRef.current?.focus()
      } else if (k === 'n' && kind === 'character') {
        e.preventDefault()
        setNewMode(true)
      } else if (k === 's') skip()
      else if (k === 'x' && kind === 'character') void markOther()
      else if (k === 'g' && kind === 'character') markGroup()
      else if (k === 'r') cycleRating()
      else if (k === 'arrowright') skip(1)
      else if (k === 'arrowleft') skip(-1)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const counts = tree?.counts
  const extra = !!item && item.confirmed.length > 0
  const chosenNames = item
    ? [...item.candidates.filter((c) => checked.has(c.id)).map((c) => c.name), ...extras.map((e) => e.name)]
    : []
  // Primary button label for the "다른 캐릭터도 있나요?" case.
  const swaps = item ? item.candidates.filter(isSwap) : []
  const adds = item
    ? [...item.candidates.filter((c) => checked.has(c.id) && !isSwap(c)).map((c) => c.name), ...extras.map((e) => e.name)]
    : []
  const swapped = new Set(swaps.map((c) => c.relatedTo!.id))
  const removedNames = item ? item.confirmed.filter((c) => removed.has(c.id) && !swapped.has(c.id)).map((c) => c.name) : []
  const extraLabel = [
    ...swaps.map((c) => `${c.relatedTo!.name} → ${c.name}`),
    ...(adds.length ? [`${adds.join(', ')} 추가`] : []),
    ...(removedNames.length ? [`${removedNames.join(', ')} 빼기`] : [])
  ].join(' · ')
  return (
    <div className="review">
      <div className="review-head">
        <div className="flat-group">
          <button className={`mini ${kind === 'character' ? 'on' : ''}`} onClick={() => (setKind('character'), setIndex(0))}>
            캐릭터 검토 {counts?.pending ?? 0}
          </button>
          <button className={`mini ${kind === 'rating' ? 'on' : ''}`} onClick={() => (setKind('rating'), setIndex(0))}>
            등급 확인 {counts?.ratingReview ?? 0}
          </button>
        </div>
        {item && (
          <span className="review-pos">
            {Math.min(index, items.length - 1) + 1} / {items.length}
          </span>
        )}
        <span className="review-keys">
          {kind === 'character'
            ? '1·2·3 고르기 · Enter 확정 · 0 추가 없이 확정 · / 직접 입력 · N 새 캐릭터 · S 건너뛰기 · G 단체 사진 · X 캐릭터 아닌 그림 · R 등급 · Ctrl+Z 되돌리기'
            : '1·2·3 등급 고르기 · Enter 확정 · S 건너뛰기 · Ctrl+Z 되돌리기'}
        </span>
      </div>

      {!item ? (
        <div className="empty">
          <CheckIcon />
          <p>{kind === 'character' ? '검토할 캐릭터가 없습니다.' : '확인할 등급이 없습니다.'}</p>
        </div>
      ) : (
        <div className="review-body">
          <div className="review-stage">
            <img key={item.id} className="review-img" src={window.api.imageUrl(item.path)} draggable={false} />
            <button className="viewer-arrow left" disabled={index <= 0} title="이전 (←)" onClick={() => skip(-1)}>
              <KeyboardArrowLeftIcon />
            </button>
            <button className="viewer-arrow right" disabled={index >= items.length - 1} title="다음 (→)" onClick={() => skip(1)}>
              <KeyboardArrowRightIcon />
            </button>
          </div>

          <aside className="review-side">
            <div className="review-file selectable" title={item.path}>
              {item.path.split(/[\\/]/).pop()}
            </div>

            {kind === 'character' && (
              <>
                <div className="review-q">
                  {extra ? (
                    <>
                      <div className="review-q-title">이 그림에 다른 캐릭터도 있나요?</div>
                      <div className="review-q-sub">자동으로 인식된 캐릭터예요. 틀렸으면 빼세요.</div>
                      <div className="chip-row q-chips">
                        {item.confirmed.map((c) => (
                          <span key={c.id} className={`tag-chip confirmed ${removed.has(c.id) ? 'struck' : ''}`}>
                            {c.name}
                            <button
                              title={removed.has(c.id) ? '되살리기' : '이 캐릭터 빼기'}
                              onClick={() =>
                                setRemoved((r) => {
                                  const n = new Set(r)
                                  if (n.has(c.id)) n.delete(c.id)
                                  else n.add(c.id)
                                  return n
                                })
                              }
                            >
                              {removed.has(c.id) ? <UndoIcon /> : <CloseIcon />}
                            </button>
                          </span>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="review-q-title">이 그림의 캐릭터는 누구인가요?</div>
                      <div className="review-q-sub">모델이 확실하지 않아요. 맞는 캐릭터를 고르세요. 여러 명이 있으면 모두 고르세요.</div>
                    </>
                  )}
                </div>

                <div className="review-sec">
                  <div className="review-label">{extra ? '함께 있을 수 있는 캐릭터' : '후보'}</div>
                  {item.candidates.map((c, i) => (
                    <button key={c.id} className={`cand ${checked.has(c.id) ? 'on' : ''}`} onClick={() => toggle(c.id)}>
                      <span className="cand-key">{i + 1}</span>
                      <span className="cand-main">
                        <span className="cand-name">
                          {c.name}
                          {c.low && <span className="cand-low">낮은 확신</span>}
                        </span>
                        <span className="cand-meta">
                          {c.relatedTo ? `${c.relatedTo.name}의 다른 복장 · ` : ''}
                          {c.series} · {Math.round(c.score * 100)}%
                        </span>
                        {c.relatedTo && checked.has(c.id) && (
                          <span className="outfit-choice" onClick={(e) => e.stopPropagation()}>
                            {(['replace', 'both'] as const).map((m) => (
                              <span
                                key={m}
                                role="radio"
                                aria-checked={(outfit[c.id] ?? 'replace') === m}
                                className={`outfit-opt ${(outfit[c.id] ?? 'replace') === m ? 'on' : ''}`}
                                onClick={() => setOutfit((o) => ({ ...o, [c.id]: m }))}
                              >
                                {m === 'replace'
                                  ? `이 복장으로 변경 (${c.relatedTo!.name} 빼기)`
                                  : `둘 다 포함 (${c.relatedTo!.name} + ${c.name})`}
                              </span>
                            ))}
                          </span>
                        )}
                        {c.refs.length > 0 && (
                          <span className="cand-refs">
                            {c.refs.map((r) => (
                              <img key={r} src={window.api.imageUrl(r)} draggable={false} />
                            ))}
                          </span>
                        )}
                      </span>
                      <span className="cand-check">{checked.has(c.id) && <CheckIcon />}</span>
                    </button>
                  ))}
                  {item.candidates.length === 0 && <div className="row-desc">후보가 없습니다. 직접 입력하세요.</div>}
                </div>

                <div className="review-sec">
                  <div className="review-label">{extra ? '다른 캐릭터가 있으면 직접 입력' : '목록에 없으면 직접 입력'}</div>
                  {extras.length > 0 && (
                    <div className="chip-row">
                      {extras.map((c) => (
                        <span key={c.id} className="tag-chip">
                          {c.name} · {c.series}
                          <button title="빼기" onClick={() => setExtras((x) => x.filter((y) => y.id !== c.id))}>
                            <CloseIcon />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                  <CharacterPicker
                    inputRef={pickerRef}
                    newMode={newMode}
                    onNewModeChange={setNewMode}
                    onPick={(c) => setExtras((x) => (x.some((y) => y.id === c.id) ? x : [...x, c]))}
                  />
                </div>
              </>
            )}

            {kind === 'rating' ? (
              <>
                <div className="review-q">
                  <div className="review-q-title">이 그림의 등급은 무엇인가요?</div>
                  <div className="review-q-sub">
                    모델이 경계에 걸려 확실하지 않아요
                    {item.ratingScore !== null && ` (모델 점수 ${Math.round(item.ratingScore * 100)}%)`}. 맞는 등급을 고르세요.
                  </div>
                </div>
                <div className="review-sec" role="radiogroup">
                  {RATINGS.map((r, i) => (
                    <button
                      key={r}
                      role="radio"
                      aria-checked={rating === r}
                      className={`cand radio ${rating === r ? 'on' : ''}`}
                      onClick={() => setRating(r)}
                    >
                      <span className="cand-key">{i + 1}</span>
                      <span className="cand-main">
                        <span className="cand-name">{RATING_LABEL[r]}</span>
                        <span className="cand-meta">{RATING_DESC[r]}</span>
                      </span>
                      <span className={`radio-dot ${rating === r ? 'on' : ''}`} />
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <div className="review-sec">
                <div className="review-label">등급</div>
                <div className="flat-group">
                  {RATINGS.map((r) => (
                    <button key={r} className={`mini ${rating === r ? 'on' : ''}`} onClick={() => setRating(r)}>
                      {RATING_LABEL[r]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="review-actions">
              {kind === 'character' && extra ? (
                <div className="review-yesno">
                  {chosenNames.length || removed.size ? (
                    <>
                      <button className="btn primary" onClick={() => void confirm()}>
                        <CheckIcon />
                        {extraLabel}
                        <kbd>Enter</kbd>
                      </button>
                      <button className="btn" onClick={() => void onlyConfirmed()}>
                        {item.confirmed.map((c) => c.name).join(', ')}만 확정
                        <kbd>0</kbd>
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn primary" onClick={() => void onlyConfirmed()}>
                        <CheckIcon />
                        {item.confirmed.map((c) => c.name).join(', ')}만 확정
                        <kbd>Enter</kbd>
                      </button>
                      <div className="review-hint">함께 있는 캐릭터가 있으면 위에서 고르세요 (1·2·3)</div>
                    </>
                  )}
                </div>
              ) : (
                <button className="btn primary" onClick={() => void confirm()}>
                  <CheckIcon />
                  {kind === 'rating'
                    ? `${RATING_LABEL[rating]}(으)로 확정`
                    : chosenNames.length
                      ? `${chosenNames.join(', ')}(으)로 확정`
                      : item.candidates[0]
                        ? `${item.candidates[0].name}(으)로 확정`
                        : '캐릭터를 골라주세요'}
                  <kbd>Enter</kbd>
                </button>
              )}
              <div className="flat-group">
                <button className="mini" onClick={() => skip()}>
                  <SkipNextIcon />
                  건너뛰기
                </button>
                {kind === 'character' && (
                  <button className="mini" title="누가 있는지 정하지 않고 단체 사진으로 분류 (게임을 고르면 정리 폴더/게임/단체)" onClick={() => markGroup()}>
                    <GroupsIcon />
                    단체 사진
                  </button>
                )}
                {kind === 'character' && (
                  <button className="mini" onClick={() => void markOther()}>
                    <PersonOffIcon />
                    캐릭터 아닌 그림
                  </button>
                )}
                <button className="mini" title="구글 렌즈로 이 그림을 검색합니다" onClick={() => imageSearch(item.path)}>
                  <ImageSearchIcon />
                  구글에서 찾기
                </button>
                <button
                  className="mini"
                  onClick={() =>
                    void window.api.undo().then((r) => showToast({ ok: true, message: r.label ? `되돌리기 완료: ${r.label}` : '되돌릴 작업이 없습니다.' }))
                  }
                >
                  <UndoIcon />
                  되돌리기
                </button>
              </div>
            </div>
          </aside>
        </div>
      )}
      {askSearch && (
        <div className="modal-back" onMouseDown={() => setAskSearch(null)}>
          <div className="modal small" onMouseDown={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>구글 렌즈로 검색</h2>
            </div>
            <div className="row-desc">
              이 그림을 작게 줄인 사본(JPEG)을 구글 렌즈에 올려 검색합니다. 그림이 PC 밖으로 나가는 기능이라 처음 한 번 허용이 필요합니다. 설정 →
              이미지 검색 허용에서 언제든 끌 수 있습니다.
            </div>
            <div className="modal-foot">
              <button className="btn" onClick={() => setAskSearch(null)}>
                취소
              </button>
              <button
                className="btn primary"
                autoFocus
                onClick={() => {
                  const p = askSearch
                  setAskSearch(null)
                  void saveSettings({ allowImageSearch: true }).then(() =>
                    window.api.imageSearch(p).catch((e: Error) => showToast({ ok: false, message: `구글 렌즈를 열지 못했습니다: ${String(e.message ?? e)}` }))
                  )
                }}
              >
                <ImageSearchIcon />
                허용하고 검색
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
