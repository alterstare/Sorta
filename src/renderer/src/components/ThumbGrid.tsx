// Explorer-style thumbnails: 격자형 (icons) or 목록형 (rows with details), the
// same icon size in both. Virtualized by rows: only the rows in (or near) the
// viewport are rendered, so tens of thousands of images stay smooth.
import { useEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import { useStore } from '../store'
import { useKept } from '../keep'
import type { ImageItem, Settings } from '../../../shared/types'
import { WarningIcon } from './icons'
import { FavGroup, Stars } from './Rate'
import { useImageMenu } from './ImageMenu'

export type ThumbSize = Settings['thumbSize']
export const CELL: Record<ThumbSize, number> = { s: 120, m: 180, l: 270 }
const GAP = 10
const FOOT_H = 30 // stars + ♥/＋
const LABEL_H = 22
const PAD = 16
const ROW_PAD = 8 // list row: padding around the icon

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
  if (img.kind === 'other') return '캐릭터 아닌 그림'
  return img.characters.length ? '미확인' : '분류 전'
}

const games = (img: ImageItem): string => [...new Set(img.characters.map((c) => c.series).filter(Boolean))].join(', ')
export const fmtSize = (n: number | null): string =>
  n === null ? '' : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`
export const fmtDate = (t: number): string => {
  const d = new Date(t)
  const p = (x: number): string => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
const extOf = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toUpperCase() : '')

function Thumb({ img, settings, size }: { img: ImageItem; settings: Settings | null; size: number }): JSX.Element {
  const mode = safeMode(img, settings)
  const pending = img.characters.some((x) => x.status === 'pending')
  return (
    <div className="cell-img" style={{ width: size, height: size }}>
      {img.thumb ? (
        <img src={window.api.imageUrl(img.thumb)} className={mode === 'blur' ? 'blur' : ''} loading="lazy" draggable={false} />
      ) : (
        <span className="cell-broken">
          <WarningIcon />
        </span>
      )}
      {img.rating !== 'general' && img.rating !== 'unknown' && <span className={`badge r-${img.rating}`}>{RATING_LABEL[img.rating]}</span>}
      {pending && <span className="badge pending">검토</span>}
      {img.ratingReview && <span className="badge rating-review">등급?</span>}
      {img.dupOf !== null && <span className="badge dup">중복?</span>}
    </div>
  )
}

export default function ThumbGrid({ items }: { items: ImageItem[] }): JSX.Element {
  const settings = useStore((s) => s.settings)
  const size = settings?.thumbSize ?? 'm'
  const list = settings?.libLayout === 'list'
  const openViewer = useStore((s) => s.openViewer)
  const selected = useStore((s) => s.selected)
  const setSelected = useStore((s) => s.setSelected)
  const anchor = useRef<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 800, h: 600, top: 0 })
  const { onContextMenu, menu } = useImageMenu(items)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setBox((b) => ({ ...b, w: el.clientWidth, h: el.clientHeight })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  // Scroll position per list (filter): kept while away from the library and
  // across background refreshes; another node / rating / search → top.
  // Keyed by the filter the shown images were loaded for (not the requested
  // one), so the list switches once, when the new images arrive.
  const listKey = useStore((s) => s.imagesKey)
  const [saved, setSaved] = useKept<{ key: string; top: number }>('grid.scroll', { key: '', top: 0 })
  const topRef = useRef(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const top = saved.key === listKey ? saved.top : 0
    el.scrollTop = top
    topRef.current = el.scrollTop
    setBox((b) => ({ ...b, top: el.scrollTop }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listKey])
  useEffect(() => () => setSaved({ key: listKey, top: topRef.current }), [listKey, setSaved])

  const icon = CELL[size]
  const inner = Math.max(1, box.w - PAD * 2)
  const cols = list ? 1 : Math.max(1, Math.floor((inner + GAP) / (icon + GAP)))
  const cellW = list ? inner : (inner - GAP * (cols - 1)) / cols
  const rowH = list ? icon + ROW_PAD * 2 + 1 : cellW + FOOT_H + LABEL_H + GAP
  const rows = Math.ceil(items.length / cols)
  const first = Math.max(0, Math.floor((box.top - PAD) / rowH) - 2)
  const last = Math.min(rows, Math.ceil((box.top + box.h) / rowH) + 2)

  // Ctrl/⌘ toggles, Shift selects a range, a plain click opens the image.
  const onClick = (e: MouseEvent, i: number, img: ImageItem): void => {
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
  }
  // Footer actions apply to the whole selection when the image is in it.
  const targets = (img: ImageItem): ImageItem[] => (selected.has(img.id) && selected.size > 1 ? items.filter((x) => selected.has(x.id)) : [img])

  const cells: JSX.Element[] = []
  for (let r = first; r < last; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const img = items[i]
      if (!img) break
      const sel = selected.has(img.id) ? 'sel' : ''
      if (list) {
        cells.push(
          <div
            key={img.id}
            className={`lrow ${sel}`}
            style={{ top: PAD + r * rowH, left: PAD, width: cellW, height: rowH - 1 }}
            onClick={(e) => onClick(e, i, img)}
            onContextMenu={(e) => onContextMenu(e, img)}
            title={img.path}
          >
            <Thumb img={img} settings={settings} size={icon} />
            <div className="lrow-main">
              <div className="lrow-name">{img.name}</div>
              <div className="lrow-sub">{charLabel(img)}</div>
              {games(img) && <div className="lrow-sub dim">{games(img)}</div>}
            </div>
            <div className="lrow-col">{RATING_LABEL[img.rating]}</div>
            <div className="lrow-col date">{fmtDate(img.mtime ?? img.importedAt)}</div>
            <div className="lrow-col">{extOf(img.name)}</div>
            <div className="lrow-col num">{fmtSize(img.fileSize)}</div>
            <div className="lrow-act" onClick={(e) => e.stopPropagation()}>
              <Stars imgs={targets(img)} />
              <FavGroup imgs={targets(img)} />
            </div>
          </div>
        )
      } else {
        cells.push(
          <div
            key={img.id}
            className={`cell ${sel}`}
            style={{ left: PAD + c * (cellW + GAP), top: PAD + r * rowH, width: cellW }}
            onClick={(e) => onClick(e, i, img)}
            onContextMenu={(e) => onContextMenu(e, img)}
            title={img.path}
          >
            <Thumb img={img} settings={settings} size={cellW} />
            <div className="cell-foot" onClick={(e) => e.stopPropagation()}>
              <Stars imgs={targets(img)} size={size === 's' ? 11 : 13} />
              <FavGroup imgs={targets(img)} noGroup={size === 's'} />
            </div>
            <div className="cell-label">{charLabel(img)}</div>
          </div>
        )
      }
    }
  }

  return (
    <div
      className={`grid ${list ? 'list' : ''}`}
      ref={ref}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop
        topRef.current = top
        setBox((b) => (Math.abs(b.top - top) < rowH / 3 ? b : { ...b, top }))
      }}
    >
      {/* keyed by the list: another node / filter fades the new list in */}
      <div key={listKey} className="grid-inner" style={{ height: PAD * 2 + rows * rowH }}>
        {cells}
      </div>
      {menu}
    </div>
  )
}
