// Toolbar dropdown (Explorer-style "정렬 ▾ / 보기 ▾"): a flat button that
// opens a panel of options under it. Closes on an outside click or Esc.
import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode } from 'react'
import { ArrowDownIcon, ArrowUpIcon, CheckIcon } from './icons'

export default function DropMenu({
  icon,
  label,
  title,
  children,
  align = 'left'
}: {
  icon?: ReactNode
  label: string
  title?: string
  children: (close: () => void) => ReactNode
  align?: 'left' | 'right'
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="dropmenu" ref={ref}>
      <button className={`mini ${open ? 'open' : ''}`} title={title} onClick={() => setOpen((o) => !o)}>
        {icon}
        {label}
        {open ? <ArrowUpIcon /> : <ArrowDownIcon />}
      </button>
      {open && <div className={`dropmenu-panel ${align}`}>{children(() => setOpen(false))}</div>}
    </div>
  )
}

// One option row: a check mark (radio / checkbox look) + label.
export function MenuOption({
  on,
  onClick,
  children,
  box = false
}: {
  on: boolean
  onClick: () => void
  children: ReactNode
  box?: boolean // checkbox look (several can be on) instead of a radio dot
}): JSX.Element {
  return (
    <button className={`menu-opt ${on ? 'on' : ''}`} role={box ? 'menuitemcheckbox' : 'menuitemradio'} aria-checked={on} onClick={onClick}>
      <span className={box ? 'menu-box' : 'menu-radio'}>{on && (box ? <CheckIcon /> : <span className="menu-dot" />)}</span>
      {children}
    </button>
  )
}

export function MenuSection({ title }: { title: string }): JSX.Element {
  return <div className="menu-sec">{title}</div>
}
