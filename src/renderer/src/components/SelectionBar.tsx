// Actions for the images selected in the grid (one undo step each).
import { useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { Rating } from '../../../shared/types'
import CharacterPicker from './CharacterPicker'
import { CloseIcon, PersonOffIcon } from './icons'
import { RATING_LABEL } from './ThumbGrid'

const RATINGS: Exclude<Rating, 'unknown'>[] = ['general', 'sensitive', 'r18']

export default function SelectionBar({ allIds }: { allIds: number[] }): JSX.Element | null {
  const selected = useStore((s) => s.selected)
  const setSelected = useStore((s) => s.setSelected)
  const showToast = useStore((s) => s.showToast)
  const [newMode, setNewMode] = useState(false)
  if (!selected.size) return null
  const ids = [...selected]
  const done = (msg: string): void => showToast({ ok: true, message: `${ids.length}장 ${msg} · Ctrl+Z로 되돌리기` })

  return (
    <div className="sel-bar">
      <span className="sel-count">{ids.length}장 선택</span>
      <div className="sel-picker">
        <CharacterPicker
          placeholder="이 캐릭터로 지정"
          newMode={newMode}
          onNewModeChange={setNewMode}
          onPick={(c) => void window.api.confirmCharacters(ids, [c.id]).then(() => done(`${c.name}(으)로 지정`))}
        />
      </div>
      <div className="flat-group">
        {RATINGS.map((r) => (
          <button key={r} className="mini" onClick={() => void window.api.setRating(ids, r).then(() => done(`${RATING_LABEL[r]}로 변경`))}>
            {RATING_LABEL[r]}
          </button>
        ))}
      </div>
      <div className="flat-group">
        <button className="mini" onClick={() => void window.api.markOther(ids).then(() => done('캐릭터 아닌 그림으로 지정'))}>
          <PersonOffIcon />
          캐릭터 아닌 그림
        </button>
        <button className="mini" onClick={() => setSelected(new Set(allIds))}>
          전체 선택
        </button>
        <button className="mini" onClick={() => setSelected(new Set())}>
          <CloseIcon />
          선택 해제
        </button>
      </div>
    </div>
  )
}
