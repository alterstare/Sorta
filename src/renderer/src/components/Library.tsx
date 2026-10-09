// 라이브러리: left tree (게임 → 캐릭터) + explorer-style thumbnail grid.
import { useMemo, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { ThumbSize } from '../store'
import type { Rating, SafeMode } from '../../../shared/types'
import { CloseIcon, FolderOpenIcon, GridViewIcon, SearchIcon, SettingsIcon } from './icons'
import Tree from './Tree'
import ThumbGrid, { safeMode } from './ThumbGrid'
import Viewer from './Viewer'
import SelectionBar from './SelectionBar'

const SIZES: [ThumbSize, string][] = [
  ['s', '작게'],
  ['m', '보통'],
  ['l', '크게']
]
const RATINGS: [Rating | 'all', string][] = [
  ['all', '전체'],
  ['general', '일반'],
  ['sensitive', '민감'],
  ['r18', 'R-18']
]
const SAFE: [SafeMode, string][] = [
  ['show', '표시'],
  ['blur', '블러'],
  ['hide', '숨기기']
]

export default function Library(): JSX.Element {
  const { thumbSize, setThumbSize, settings, saveSettings, setView, filter, setRating, setQuery, images, tree } = useStore()
  const [q, setQ] = useState(filter.q)
  // "숨김" safe mode drops those images from the list (and the viewer).
  const items = useMemo(() => images.filter((i) => safeMode(i, settings) !== 'hide'), [images, settings])

  const safeGroup = (label: string, key: 'safeR18' | 'safeSensitive'): JSX.Element => (
    <div className="flat-group">
      <span className="tb-label">{label}</span>
      {SAFE.map(([v, l]) => (
        <button key={v} className={`mini ${settings?.[key] === v ? 'on' : ''}`} onClick={() => void saveSettings({ [key]: v })}>
          {l}
        </button>
      ))}
    </div>
  )

  const empty = tree && tree.counts.all === 0
  return (
    <div className="library">
      <Tree />
      <section className="grid-pane">
        <div className="toolbar">
          <div className="search-box">
            <SearchIcon />
            <input
              value={q}
              placeholder="캐릭터 · 게임 · 파일명 검색"
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && setQuery(q)}
            />
            {q && (
              <button
                className="search-clear"
                title="지우기"
                onClick={() => {
                  setQ('')
                  setQuery('')
                }}
              >
                <CloseIcon />
              </button>
            )}
          </div>
          <div className="flat-group">
            {RATINGS.map(([v, l]) => (
              <button key={v} className={`mini ${filter.rating === v ? 'on' : ''}`} onClick={() => setRating(v)}>
                {l}
              </button>
            ))}
          </div>
          <span className="tb-count">{items.length}장</span>
        </div>
        <div className="toolbar sub">
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
          {safeGroup('R-18', 'safeR18')}
          {safeGroup('민감', 'safeSensitive')}
        </div>
        <SelectionBar allIds={items.map((i) => i.id)} />
        {empty ? (
          <div className="grid">
            <div className="empty">
              <FolderOpenIcon />
              <p>설정에서 원본 폴더를 등록하고 가져오기를 실행하면 이미지가 여기에 표시됩니다.</p>
              <button className="btn" onClick={() => setView('settings')}>
                <SettingsIcon />
                설정 열기
              </button>
            </div>
          </div>
        ) : items.length === 0 ? (
          <div className="grid">
            <div className="empty">
              <p>조건에 맞는 이미지가 없습니다.</p>
            </div>
          </div>
        ) : (
          <ThumbGrid items={items} />
        )}
      </section>
      <Viewer items={items} />
    </div>
  )
}
