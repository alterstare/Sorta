// Fix one image from the big view: characters (confirm / remove / add),
// rating, 캐릭터 아님. Every change is one Ctrl+Z step.
import { useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { ImageItem, Rating } from '../../../shared/types'
import CharacterPicker from './CharacterPicker'
import { CheckIcon, CloseIcon, GroupsIcon, PersonOffIcon } from './icons'
import { RATING_LABEL } from './ThumbGrid'

const RATINGS: Exclude<Rating, 'unknown'>[] = ['general', 'sensitive', 'r18']

export default function EditBar({ img }: { img: ImageItem }): JSX.Element {
  const [newMode, setNewMode] = useState(false)
  const sorted = img.characters.filter((c) => c.id !== null && (c.status === 'auto' || c.status === 'confirmed'))
  const ids = sorted.map((c) => c.id!)
  const hasAuto = sorted.some((c) => c.status === 'auto')

  return (
    <div className="edit-bar" onClick={(e) => e.stopPropagation()}>
      <div className="edit-sec">
        <span className="edit-label">캐릭터</span>
        {sorted.map((c) => (
          <span key={c.id} className={`tag-chip ${c.status === 'confirmed' ? 'confirmed' : ''}`} title={c.status === 'auto' ? '자동 분류' : '직접 확정'}>
            {c.name}
            <button
              title="이 캐릭터 빼기"
              onClick={() => void window.api.confirmCharacters([img.id], ids.filter((x) => x !== c.id))}
            >
              <CloseIcon />
            </button>
          </span>
        ))}
        {sorted.length === 0 && <span className="edit-none">{img.kind === 'other' ? '캐릭터 아닌 그림' : img.kind === 'group' ? (img.groupSeries ? `단체 사진 · ${img.groupSeries}` : '단체 사진') : '미지정'}</span>}
        {hasAuto && (
          <div className="flat-group">
            <button className="mini" title="자동 분류 결과가 맞다고 확정" onClick={() => void window.api.confirmCharacters([img.id], ids)}>
              <CheckIcon />
              확인
            </button>
          </div>
        )}
        <div className="edit-picker">
          <CharacterPicker
            placeholder="캐릭터 추가"
            newMode={newMode}
            onNewModeChange={setNewMode}
            onPick={(c) => void window.api.addCharacter(img.id, c.id)}
          />
        </div>
      </div>
      <div className="edit-sec">
        <span className="edit-label">등급</span>
        <div className="flat-group">
          {RATINGS.map((r) => (
            <button key={r} className={`mini ${img.rating === r ? 'on' : ''}`} onClick={() => void window.api.setRating([img.id], r)}>
              {RATING_LABEL[r]}
            </button>
          ))}
        </div>
        <div className="flat-group">
          <button className={`mini ${img.kind === 'group' ? 'on' : ''}`} onClick={() => useStore.getState().setGroupShotDialog({ ids: [img.id], suggest: img.groupSeries ?? img.characters.find((c) => c.series)?.series ?? null })}>
            <GroupsIcon />
            단체 사진
          </button>
          <button className={`mini ${img.kind === 'other' ? 'on' : ''}`} onClick={() => void window.api.markOther([img.id])}>
            <PersonOffIcon />
            캐릭터 아닌 그림
          </button>
        </div>
      </div>
    </div>
  )
}
