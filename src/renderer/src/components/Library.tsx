// 라이브러리: left tree (게임 → 소속 → 캐릭터) + explorer-style thumbnail grid.
// Phase 0 shell — both sides empty until import/classification exists.
import type { JSX } from 'react'
import { useStore } from '../store'
import type { ThumbSize } from '../store'
import type { SafeMode } from '../../../shared/types'
import { FolderOpenIcon, GridViewIcon, SettingsIcon } from './icons'

const SIZES: [ThumbSize, string][] = [
  ['s', '작게'],
  ['m', '보통'],
  ['l', '크게']
]
const SAFE: [SafeMode, string][] = [
  ['show', '표시'],
  ['blur', '블러'],
  ['hide', '숨김']
]

export default function Library(): JSX.Element {
  const { thumbSize, setThumbSize, settings, saveSettings, setView } = useStore()

  return (
    <div className="library">
      <aside className="tree">
        <div className="tree-head">분류</div>
        <div className="tree-empty">아직 분류된 이미지가 없습니다.</div>
      </aside>
      <section className="grid-pane">
        <div className="toolbar">
          <div className="flat-group">
            <span className="tb-label">
              <GridViewIcon />
            </span>
            {SIZES.map(([v, l]) => (
              <button key={v} className={`mini ${thumbSize === v ? 'on' : ''}`} onClick={() => setThumbSize(v)}>
                {l}
              </button>
            ))}
          </div>
          <div className="flat-group">
            <span className="tb-label">R-18</span>
            {SAFE.map(([v, l]) => (
              <button
                key={v}
                className={`mini ${settings?.safeR18 === v ? 'on' : ''}`}
                onClick={() => void saveSettings({ safeR18: v })}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div className={`grid size-${thumbSize}`}>
          <div className="empty">
            <FolderOpenIcon />
            <p>설정에서 원본 폴더를 등록하면 이미지가 여기에 표시됩니다.</p>
            <button className="btn" onClick={() => setView('settings')}>
              <SettingsIcon />
              설정 열기
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}
