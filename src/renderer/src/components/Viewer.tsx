// 크게 보기: one image over the grid, ← / → to move, Esc to close.
import { useEffect, useRef } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { ImageItem } from '../../../shared/types'
import { CloseIcon, FolderOpenIcon, KeyboardArrowLeftIcon, KeyboardArrowRightIcon } from './icons'
import { RATING_LABEL } from './ThumbGrid'
import EditBar from './EditBar'
import { FavGroup, Stars } from './Rate'
import { useImageMenu } from './ImageMenu'

const STATUS: Record<string, string> = { auto: '자동', confirmed: '확정', pending: '검토', unknown: '미확인' }

export default function Viewer({ items }: { items: ImageItem[] }): JSX.Element | null {
  const index = useStore((s) => s.viewerIndex)
  const open = useStore((s) => s.openViewer)
  const img = index === null ? null : items[index]
  const wheelNav = useStore((s) => s.settings?.wheelNavigate ?? true)
  const { onContextMenu, menu } = useImageMenu(items)
  const lastWheel = useRef(0)

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement
      if (t.tagName === 'INPUT') return
      if (e.key === 'Escape') open(null)
      else if (e.key === 'ArrowLeft' && index > 0) open(index - 1)
      else if (e.key === 'ArrowRight' && index < items.length - 1) open(index + 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, open])

  // 스크롤로 넘기기: one image per wheel gesture (a trackpad fires many events).
  const onWheel = (e: React.WheelEvent): void => {
    if (!wheelNav || index === null || Math.abs(e.deltaY) < 4) return
    const now = Date.now()
    if (now - lastWheel.current < 250) return
    lastWheel.current = now
    if (e.deltaY > 0 && index < items.length - 1) open(index + 1)
    else if (e.deltaY < 0 && index > 0) open(index - 1)
  }

  if (!img || index === null) return null
  const name = img.path.split(/[\\/]/).pop()
  return (
    <div className="viewer" onClick={() => open(null)} onWheel={onWheel}>
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
        <div className="viewer-rate">
          <Stars imgs={[img]} size={16} />
          <FavGroup imgs={[img]} />
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
      <EditBar img={img} />
      <img
        className="viewer-img"
        src={window.api.imageUrl(img.path)}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => onContextMenu(e, img)}
        draggable={false}
      />
      {menu}
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
