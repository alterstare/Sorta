// Right-click menu at the cursor, with one level of submenus (as in
// Halftone). Closes on outside click, Esc, scroll, resize or a leaf click.
import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { KeyboardArrowRightIcon } from './icons'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onClick?: () => void
  disabled?: boolean
  checked?: boolean
  children?: MenuItem[]
  separator?: boolean // draws a line above
}

function Row({ item, onClose }: { item: MenuItem; onClose: () => void }): JSX.Element {
  const [open, setOpen] = useState(false)
  const sep = item.separator ? <div className="ctx-sep" /> : null
  if (item.children) {
    return (
      <>
        {sep}
        <div className="ctx-item has-sub" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
          <span className="ctx-icon">{item.icon}</span>
          <span className="ctx-label">{item.label}</span>
          <span className="ctx-arrow">
            <KeyboardArrowRightIcon />
          </span>
          {open && (
            <div className="ctx-submenu">
              {item.children.map((c, i) => (
                <Row key={i} item={c} onClose={onClose} />
              ))}
            </div>
          )}
        </div>
      </>
    )
  }
  return (
    <>
      {sep}
      <button
        className={`ctx-item ${item.checked ? 'checked' : ''}`}
        disabled={item.disabled}
        onClick={() => {
          onClose()
          item.onClick?.()
        }}
      >
        <span className="ctx-icon">{item.icon}</span>
        <span className="ctx-label">{item.label}</span>
      </button>
    </>
  )
}

export default function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  useEffect(() => {
    const el = ref.current
    if (el) {
      const r = el.getBoundingClientRect()
      setPos({ x: Math.max(4, Math.min(x, window.innerWidth - r.width - 8)), y: Math.max(4, Math.min(y, window.innerHeight - r.height - 8)) })
    }
    const close = (): void => onClose()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [x, y, onClose])
  return createPortal(
    <div
      ref={ref}
      className="ctx-menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) => (
        <Row key={i} item={it} onClose={onClose} />
      ))}
    </div>,
    document.body
  )
}
