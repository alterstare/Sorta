// Explorer-style thumbnail grid. Virtualized by rows: only the rows in (or
// near) the viewport are rendered, so tens of thousands of images stay smooth.
import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { useStore } from '../store'
import type { ThumbSize } from '../store'
import type { ImageItem, Settings } from '../../../shared/types'
import { WarningIcon } from './icons'

const CELL: Record<ThumbSize, number> = { s: 120, m: 180, l: 270 }
const GAP = 10
const LABEL_H = 40
const PAD = 16

export const RATING_LABEL: Record<ImageItem['rating'], string> = {
  general: '일반',
  sensitive: '민감',
  r18: 'R-18',
  unknown: '미정'
}

export function safeMode(img: ImageItem, s: Settings | null): 'show' | 'blur' | 'hide' {
  if (!s) return 'show'
  if (img.rating === 'r18') return s.safeR18
  if (img.rating === 'sensitive') return s.safeSensitive
  return 'show'
}

export function charLabel(img: ImageItem): string {
  const named = img.characters.filter((c) => c.name)
  if (named.length) return named.map((c) => c.name).join(', ')
  if (img.kind === 'other') return '캐릭터 아님'
  return img.characters.length ? '미확인' : '분류 전'
}

export default function ThumbGrid({ items }: { items: ImageItem[] }): JSX.Element {
  const size = useStore((s) => s.thumbSize)
  const settings = useStore((s) => s.settings)
  const openViewer = useStore((s) => s.openViewer)
  const selected = useStore((s) => s.selected)
  const setSelected = useStore((s) => s.setSelected)
  const anchor = useRef<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600, top: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox((b) => ({ ...b, w: el.clientWidth, h: el.clientHeight })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // New list → back to the top.
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0
  }, [items])

  const inner = Math.max(1, box.w - PAD * 2)
  const cols = Math.max(1, Math.floor((inner + GAP) / (CELL[size] + GAP)))
  const cellW = (inner - GAP * (cols - 1)) / cols
  const rowH = cellW + LABEL_H + GAP
  const rows = Math.ceil(items.length / cols)
  const first = Math.max(0, Math.floor((box.top - PAD) / rowH) - 2)
  const last = Math.min(rows, Math.ceil((box.top + box.h) / rowH) + 2)

  const cells: JSX.Element[] = []
  for (let r = first; r < last; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const img = items[i]
      if (!img) break
      const mode = safeMode(img, settings)
      const pending = img.characters.some((x) => x.status === 'pending')
      cells.push(
        <div
          key={img.id}
          className={`cell ${selected.has(img.id) ? 'sel' : ''}`}
          style={{ left: PAD + c * (cellW + GAP), top: PAD + r * rowH, width: cellW }}
          onClick={(e) => {
            // Ctrl/⌘ toggles, Shift selects a range, a plain click opens the image.
            if (e.ctrlKey || e.metaKey) {
              const n = new Set(selected)
              if (n.has(img.id)) n.delete(img.id)
              else n.add(img.id)
              anchor.current = i
              setSelected(n)
            } else if (e.shiftKey) {
              const a = anchor.current ?? i
              const n = new Set(selected)
              for (let k = Math.min(a, i); k <= Math.max(a, i); k++) n.add(items[k].id)
              setSelected(n)
            } else if (selected.size) {
              anchor.current = i
              setSelected(new Set([img.id]))
            } else openViewer(i)
          }}
          title={img.path}
        >
          <div className="cell-img" style={{ height: cellW }}>
            {img.thumb ? (
              <img src={window.api.imageUrl(img.thumb)} className={mode === 'blur' ? 'blur' : ''} loading="lazy" draggable={false} />
            ) : (
              <span className="cell-broken">
                <WarningIcon />
              </span>
            )}
            {img.rating !== 'general' && img.rating !== 'unknown' && (
              <span className={`badge r-${img.rating}`}>{RATING_LABEL[img.rating]}</span>
            )}
            {pending && <span className="badge pending">검토</span>}
            {img.ratingReview && <span className="badge rating-review">등급?</span>}
            {img.dupOf !== null && <span className="badge dup">중복?</span>}
          </div>
          <div className="cell-label">{charLabel(img)}</div>
        </div>
      )
    }
  }

  return (
    <div
      className="grid"
      ref={ref}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop
        setBox((b) => (Math.abs(b.top - top) < rowH / 3 ? b : { ...b, top }))
      }}
    >
      <div className="grid-inner" style={{ height: PAD * 2 + rows * rowH }}>
        {cells}
      </div>
    </div>
  )
}
