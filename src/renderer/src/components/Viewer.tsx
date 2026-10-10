// 크게 보기: one image over the grid, ← / → to move, Esc / ✕ to close (a
// click on the empty backdrop doesn't close it).
// Ctrl+wheel zooms around the cursor; zoomed in, drag to pan, double-click
// (or the % button) back to fit.
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { ImageItem } from '../../../shared/types'
import { CloseIcon, FolderOpenIcon, KeyboardArrowLeftIcon, KeyboardArrowRightIcon, ZoomOutMapIcon } from './icons'
import { RATING_LABEL } from './ThumbGrid'
import EditBar from './EditBar'
import { FavGroup, Stars } from './Rate'
import { useImageMenu } from './ImageMenu'

const MAX_ZOOM = 8
const STATUS: Record<string, string> = { auto: '자동', confirmed: '확정', pending: '검토', unknown: '미확인' }

export default function Viewer({ items }: { items: ImageItem[] }): JSX.Element | null {
  const index = useStore((s) => s.viewerIndex)
  const open = useStore((s) => s.openViewer)
  const img = index === null ? null : items[index]
  const wheelNav = useStore((s) => s.settings?.wheelNavigate ?? true)
  const { onContextMenu, menu } = useImageMenu(items)
  const lastWheel = useRef(0)
  const [zoom, setZoom] = useState({ z: 1, x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)
  const viewerRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null)
  const zoomed = zoom.z > 1.001
  useEffect(() => setZoom({ z: 1, x: 0, y: 0 }), [img?.id])

  // Ctrl+wheel: a native, non-passive listener (React's wheel is passive, and
  // the default would zoom the whole page).
  useEffect(() => {
    const el = viewerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      const im = imgRef.current
      if (!im) return
      setZoom((cur) => {
        const z = Math.min(MAX_ZOOM, Math.max(1, cur.z * Math.pow(1.0015, -e.deltaY)))
        if (z === 1) return { z: 1, x: 0, y: 0 }
        // keep the point under the cursor in place
        const r = im.getBoundingClientRect()
        const cx = r.left + r.width / 2
        const cy = r.top + r.height / 2
        const qx = (e.clientX - cx) / cur.z
        const qy = (e.clientY - cy) / cur.z
        return { z, x: e.clientX - (cx - cur.x) - z * qx, y: e.clientY - (cy - cur.y) - z * qy }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [img])

  // Zoomed in: drag pans (also when the pointer leaves the picture).
  useEffect(() => {
    if (!dragging) return
    const move = (e: MouseEvent): void => {
      const d = drag.current
      if (!d) return
      setZoom((z) => ({ ...z, x: d.x + e.clientX - d.sx, y: d.y + e.clientY - d.sy }))
    }
    const up = (): void => setDragging(false)
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
    }
  }, [dragging])

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
    if (!wheelNav || zoomed || e.ctrlKey || index === null || Math.abs(e.deltaY) < 4) return
    const now = Date.now()
    if (now - lastWheel.current < 250) return
    lastWheel.current = now
    if (e.deltaY > 0 && index < items.length - 1) open(index + 1)
    else if (e.deltaY < 0 && index > 0) open(index - 1)
  }

  if (!img || index === null) return null
  const name = img.path.split(/[\\/]/).pop()
  return (
    <div
      ref={viewerRef}
      className="viewer"
      onWheel={onWheel}
    >
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
          {zoomed && (
            <button className="mini" title="화면에 맞추기 (더블클릭)" onClick={() => setZoom({ z: 1, x: 0, y: 0 })}>
              <ZoomOutMapIcon />
              {Math.round(zoom.z * 100)}%
            </button>
          )}
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
        key={img.id}
        ref={imgRef}
        className={`viewer-img ${zoomed ? 'zoomed' : ''} ${dragging ? 'dragging' : ''}`}
        style={zoomed ? { transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.z})` } : undefined}
        src={window.api.imageUrl(img.path)}
        title={zoomed ? undefined : 'Ctrl+휠로 확대'}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={() => setZoom({ z: 1, x: 0, y: 0 })}
        onMouseDown={(e) => {
          if (!zoomed || e.button !== 0) return
          e.preventDefault()
          drag.current = { sx: e.clientX, sy: e.clientY, x: zoom.x, y: zoom.y }
          setDragging(true)
        }}
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
