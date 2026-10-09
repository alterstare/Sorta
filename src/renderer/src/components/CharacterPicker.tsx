// 직접 입력 / 새 캐릭터: type a name (or alias / game) → pick from matches with
// ↑↓ Enter; the last option creates a new character (asks for its game).
import { Fragment, useEffect, useRef, useState } from 'react'
import type { JSX, RefObject } from 'react'
import type { CharacterHit } from '../../../shared/types'
import { PersonAddIcon, SearchIcon } from './icons'

export interface PickedCharacter {
  id: number
  name: string
  series: string
}

export default function CharacterPicker({
  onPick,
  inputRef,
  newMode,
  onNewModeChange,
  placeholder = '캐릭터 이름 · 별칭 · 게임으로 찾기'
}: {
  onPick: (c: PickedCharacter) => void
  inputRef?: RefObject<HTMLInputElement | null>
  newMode?: boolean // show the "new character" form (N key)
  onNewModeChange?: (v: boolean) => void
  placeholder?: string
}): JSX.Element {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<CharacterHit[]>([])
  const [sel, setSel] = useState(0)
  const [series, setSeries] = useState('')
  const [allSeries, setAllSeries] = useState<string[]>([])
  const seriesRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // Keyboard selection stays visible in the (scrolling) list.
  useEffect(() => {
    listRef.current?.querySelectorAll('.picker-opt')[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  const creating = !!newMode

  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      void window.api.searchCharacters(q).then((h) => alive && (setHits(h), setSel(0)))
    }, 120)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [q])
  useEffect(() => {
    if (creating) {
      void window.api.seriesNames().then(setAllSeries)
      setTimeout(() => (q.trim() ? seriesRef.current : inputRef?.current)?.focus(), 0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating])

  const options = q.trim() ? hits.length + 1 : 0 // + "새 캐릭터"
  const pick = (i: number): void => {
    if (i < hits.length) {
      const h = hits[i]
      setQ('')
      // A character only the model knows: create it, then pick it.
      if (h.id === 0 && h.tag) void window.api.characterFromTag(h.tag).then(onPick)
      else onPick(h)
    } else onNewModeChange?.(true)
  }
  const create = async (): Promise<void> => {
    const name = q.trim()
    if (!name) return
    const id = await window.api.createCharacter(name, series)
    onPick({ id, name, series: series.trim() || '작품 미상' })
    setQ('')
    setSeries('')
    onNewModeChange?.(false)
  }

  return (
    <div className="picker">
      <div className="picker-box">
        {creating ? <PersonAddIcon /> : <SearchIcon />}
        <input
          ref={inputRef}
          value={q}
          placeholder={creating ? '새 캐릭터 이름' : placeholder}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation() // keep review shortcuts out of the text field
            if (e.key === 'Escape') {
              if (creating) onNewModeChange?.(false)
              ;(e.target as HTMLInputElement).blur()
            } else if (creating) {
              if (e.key === 'Enter') seriesRef.current?.focus()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSel((s) => Math.min(options - 1, s + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(0, s - 1))
            } else if (e.key === 'Enter' && options) pick(sel)
          }}
        />
      </div>
      {creating && (
        <div className="picker-new">
          <input
            ref={seriesRef}
            list="sorta-series"
            value={series}
            placeholder="게임 (비우면 작품 미상)"
            onChange={(e) => setSeries(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') void create()
              if (e.key === 'Escape') onNewModeChange?.(false)
            }}
          />
          <datalist id="sorta-series">
            {allSeries.map((s) => (
              <option key={s} value={s} />
            ))}
          </datalist>
          <div className="flat-group">
            <button className="mini" disabled={!q.trim()} onClick={() => void create()}>
              <PersonAddIcon />
              만들고 지정
            </button>
            <button className="mini" onClick={() => onNewModeChange?.(false)}>
              취소
            </button>
          </div>
        </div>
      )}
      {!creating && options > 0 && (
        <div className="picker-list" ref={listRef}>
          {hits.map((h, i) => (
            <Fragment key={h.id || h.tag}>
              {h.id === 0 && (i === 0 || hits[i - 1].id !== 0) && <div className="picker-sec">모델이 아는 캐릭터 (라이브러리에 아직 없는 캐릭터)</div>}
              <button
                className={`picker-opt ${i === sel ? 'sel' : ''}`}
                title={h.tag}
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(i)}
              >
                <span className="picker-name">{h.name}</span>
                <span className="picker-series">{h.series}</span>
                <span className="picker-n">{h.id === 0 ? '' : h.n}</span>
              </button>
            </Fragment>
          ))}
          <button className={`picker-opt new ${sel === hits.length ? 'sel' : ''}`} onMouseEnter={() => setSel(hits.length)} onClick={() => pick(hits.length)}>
            <PersonAddIcon />
            <span className="picker-name">새 캐릭터 “{q.trim()}”</span>
          </button>
        </div>
      )}
    </div>
  )
}
