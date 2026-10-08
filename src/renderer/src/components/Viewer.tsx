// 크게 보기: one image over the grid, ← / → to move, Esc to close.
import { useEffect } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { ImageItem } from '../../../shared/types'
import { CloseIcon, FolderOpenIcon, KeyboardArrowLeftIcon, KeyboardArrowRightIcon } from './icons'
import { RATING_LABEL } from './ThumbGrid'

const STATUS: Record<string, string> = { auto: '자동', confirmed: '확정', pending: '검토', unknown: '미확인' }

export default function Viewer({ items }: { items: ImageItem[] }): JSX.Element | null {
  const index = useStore((s) => s.viewerIndex)
  const open = useStore((s) => s.openViewer)
  const img = index === null ? null : items[index]

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') open(null)
      else if (e.key === 'ArrowLeft' && index > 0) open(index - 1)
      else if (e.key === 'ArrowRight' && index < items.length - 1) open(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, open])

  if (!img || index === null) return null
  const name = img.path.split(/[\\/]/).pop()
  return (
    <div className="viewer" onClick={() => open(null)}>
      <div className="viewer-top" onClick={(e) => e.stopPropagation()}>
        <div className="viewer-info">
          <div className="viewer-title selectable">{name}</div>
          <div className="viewer-meta">
            <span>{RATING_LABEL[img.rating]}</span>
            {img.width && img.height && (
              <span>
                {img.width}×{img.height}
              </span>
            )}
            {img.characters
              .filter((c) => c.name)
              .map((c, i) => (
                <span key={i}>
                  {c.name}
                  {c.series ? ` · ${c.series}` : ''} ({STATUS[c.status]}
                  {c.confidence !== null ? ` ${Math.round(c.confidence * 100)}%` : ''})
                </span>
              ))}
            <span>
              {index + 1} / {items.length}
            </span>
          </div>
        </div>
        <div className="flat-group">
          <button className="mini" onClick={() => void window.api.showInFolder(img.path)}>
            <FolderOpenIcon />
            폴더에서 보기
          </button>
          <button className="mini icon" title="닫기 (Esc)" onClick={() => open(null)}>
            <CloseIcon />
          </button>
        </div>
      </div>
      <img className="viewer-img" src={window.api.imageUrl(img.path)} onClick={(e) => e.stopPropagation()} draggable={false} />
      {index > 0 && (
        <button
          className="viewer-arrow left"
          title="이전 (←)"
          onClick={(e) => {
            e.stopPropagation()
            open(index - 1)
          }}
        >
          <KeyboardArrowLeftIcon />
        </button>
      )}
      {index < items.length - 1 && (
        <button
          className="viewer-arrow right"
          title="다음 (→)"
          onClick={(e) => {
            e.stopPropagation()
            open(index + 1)
          }}
        >
          <KeyboardArrowRightIcon />
        </button>
      )}
    </div>
  )
}
