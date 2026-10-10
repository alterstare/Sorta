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
  if (img.kind === 'group') return img.groupSeries ? `단체 사진 · ${img.groupSeries}` : '단체 사진'
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

  // Closing 크게 보기: the grid shows the picture that was open (scrolled to
  // it when it's out of view) and flashes it.
  const viewerIndex = useStore((s) => s.viewerIndex)
  const lastViewed = useRef<number | null>(null)
  const [flash, setFlash] = useState<number | null>(null)
  useEffect(() => {
    if (viewerIndex !== null) {
      lastViewed.current = viewerIndex
      return
    }
    const i = lastViewed.current
    lastViewed.current = null
    const el = ref.current
    if (i === null || !el || !items[i]) return
    const r = Math.floor(i / cols)
    const top = PAD + r * rowH
    if (top < el.scrollTop || top + rowH > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - (el.clientHeight - rowH) / 2)
      topRef.current = el.scrollTop
      setBox((b) => ({ ...b, top: el.scrollTop }))
    }
    setFlash(items[i].id)
    const t = window.setTimeout(() => setFlash(null), 1600)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerIndex])

  const icon = CELL[size]
  const inner = Math.max(1, box.w - PAD * 2)
  const cols = list ? 1 : Math.max(1, Math.floor((inner + GAP) / (icon + GAP)))
  const cellW = list ? inner : (inner - GAP * (cols - 1)) / cols
  const rowH = list ? icon + ROW_PAD * 2 + 1 : cellW + FOOT_H + LABEL_H + GAP
  const rows = Math.ceil(items.length / cols)
  const first = Math.max(0, Math.floor((box.top - PAD) / rowH) - 2)
  const last = Math.min(rows, Math.ceil((box.top + box.h) / rowH) + 2)

  // Drag selection (rubber band), from empty space or over pictures. Ctrl /
  // Shift add to the current selection; near the top / bottom edge the grid
  // scrolls. A plain click on empty space clears the selection.
  // The band moves by direct style updates (no re-render per mouse move); the
  // selection updates at most once a frame, and only when it changed.
  const bandRef = useRef<HTMLDivElement>(null)
  const lastHits = useRef('')
  const dragSel = useRef<{ x0: number; y0: number; cx: number; cy: number; base: Set<number>; active: boolean } | null>(null)
  const suppressClick = useRef(false)
  const layout = useRef({ cols, cellW, rowH, list })
  layout.current = { cols, cellW, rowH, list }
  const hits = (x0: number, y0: number, x1: number, y1: number): number[] => {
    const { cols: n, cellW: w, rowH: h, list: l } = layout.current
    const [left, right, top, bottom] = [Math.min(x0, x1), Math.max(x0, x1), Math.min(y0, y1), Math.max(y0, y1)]
    const r0 = Math.max(0, Math.floor((top - PAD) / h))
    const r1 = Math.floor((bottom - PAD) / h)
    const out: number[] = []
    for (let r = r0; r <= r1; r++) {
      const ct = PAD + r * h
      if (ct > bottom || ct + h - (l ? 1 : GAP) < top) continue
      for (let c = 0; c < n; c++) {
        const it = items[r * n + c]
        if (!it) break
        const cl = PAD + c * (w + GAP)
        if (cl <= right && cl + w >= left) out.push(it.id)
      }
    }
    return out
  }
  const onGridMouseDown = (e: MouseEvent): void => {
    if (e.button !== 0) return
    const t = e.target as HTMLElement
    if (t.closest('button, input, .cell-foot, .lrow-act, .dropmenu-panel, .ctx-menu')) return
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    if (e.clientX > r.left + el.clientWidth) return // the scrollbar
    const add = e.ctrlKey || e.metaKey || e.shiftKey
    const x = e.clientX - r.left + el.scrollLeft
    const y = e.clientY - r.top + el.scrollTop
    dragSel.current = { x0: x, y0: y, cx: e.clientX, cy: e.clientY, base: add ? new Set(selected) : new Set(), active: false }
    e.preventDefault() // no text selection while dragging
  }
  useEffect(() => {
    const el = ref.current
    let raf = 0
    const update = (): void => {
      const d = dragSel.current
      if (!d || !el) return
      const r = el.getBoundingClientRect()
      const x = Math.min(Math.max(d.cx, r.left), r.left + el.clientWidth) - r.left + el.scrollLeft
      const y = Math.min(Math.max(d.cy, r.top), r.bottom) - r.top + el.scrollTop
      if (!d.active && Math.abs(x - d.x0) + Math.abs(y - d.y0) < 6) return
      d.active = true
      const b = bandRef.current
      if (b) {
        b.style.display = 'block'
        b.style.left = `${Math.min(d.x0, x)}px`
        b.style.top = `${Math.min(d.y0, y)}px`
        b.style.width = `${Math.abs(x - d.x0)}px`
        b.style.height = `${Math.abs(y - d.y0)}px`
      }
      const ids = hits(d.x0, d.y0, x, y)
      const key = ids.join(',')
      if (key === lastHits.current) return
      lastHits.current = key
      setSelected(new Set([...d.base, ...ids]))
    }
    // One frame loop while dragging: edge auto-scroll + band / selection.
    const tick = (): void => {
      const d = dragSel.current
      if (!d || !el) return
      const r = el.getBoundingClientRect()
      const edge = 40
      const dy = d.cy < r.top + edge ? -(r.top + edge - d.cy) : d.cy > r.bottom - edge ? d.cy - (r.bottom - edge) : 0
      if (d.active && dy) el.scrollTop += Math.max(-30, Math.min(30, dy / 2))
      update()
      raf = requestAnimationFrame(tick)
    }
    const move = (e: globalThis.MouseEvent): void => {
      const d = dragSel.current
      if (!d) return
      d.cx = e.clientX
      d.cy = e.clientY
      if (!raf) raf = requestAnimationFrame(tick)
    }
    const up = (e: globalThis.MouseEvent): void => {
      const d = dragSel.current
      if (!d) return
      dragSel.current = null
      cancelAnimationFrame(raf)
      raf = 0
      lastHits.current = ''
      if (bandRef.current) bandRef.current.style.display = 'none'
      if (d.active) {
        suppressClick.current = true // the click that ends a drag opens nothing
        window.setTimeout(() => (suppressClick.current = false), 0)
      } else if (!(e.target as HTMLElement).closest('.cell, .lrow') && !(e.ctrlKey || e.metaKey || e.shiftKey)) setSelected(new Set())
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    return () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      cancelAnimationFrame(raf)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, setSelected])

  // Ctrl/⌘ toggles, Shift selects a range, a plain click opens the image.
  const onClick = (e: MouseEvent, i: number, img: ImageItem): void => {
    if (suppressClick.current) return
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
      const sel = `${selected.has(img.id) ? 'sel' : ''} ${flash === img.id ? 'found-flash' : ''}`
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
      onMouseDown={onGridMouseDown}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop
        topRef.current = top
        setBox((b) => (Math.abs(b.top - top) < rowH / 3 ? b : { ...b, top }))
      }}
    >
      {/* keyed by the list: another node / filter fades the new list in */}
      <div key={listKey} className="grid-inner" style={{ height: PAD * 2 + rows * rowH }}>
        {cells}
        <div ref={bandRef} className="sel-band" style={{ display: 'none' }} />
      </div>
      {menu}
    </div>
  )
}
