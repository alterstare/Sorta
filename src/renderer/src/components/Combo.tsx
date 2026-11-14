// Field dropdowns in one piece: the field and its list form one shape while
// open (the list hangs from the field's border), and the arrow turns to
// point up. `Select` picks from a list; `ComboInput` is a text field with
// suggestions (type to filter, the arrow shows them all).
import { useEffect, useRef, useState } from 'react'
import type { JSX, ReactNode, RefObject } from 'react'
import { ArrowDownIcon } from './icons'

function useOutside(open: boolean, close: () => void): RefObject<HTMLDivElement | null> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) close()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open, close])
  return ref
}

function Caret({ up }: { up: boolean }): JSX.Element {
  return <ArrowDownIcon className={`caret ${up ? 'up' : ''}`} />
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  className = ''
}: {
  value: T
  options: readonly (readonly [T, ReactNode])[]
  onChange: (v: T) => void
  className?: string
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const ref = useOutside(open, () => setOpen(false))
  const label = options.find(([v]) => v === value)?.[1] ?? value
  return (
    <div className={`combo ${open ? 'open' : ''} ${className}`} ref={ref}>
      <button
        type="button"
        className="combo-box"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        <span className="combo-label">{label}</span>
        <Caret up={open} />
      </button>
      {open && (
        <div className="combo-list">
          {options.map(([v, l]) => (
            <button
              key={v}
              type="button"
              className={`combo-opt ${v === value ? 'on' : ''}`}
              onClick={() => {
                onChange(v)
                setOpen(false)
              }}
            >
              {l}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function ComboInput({
  value,
  options,
  onChange,
  onEnter,
  placeholder,
  className = '',
  typed = false,
  suffix
}: {
  value: string
  options: string[]
  onChange: (v: string) => void
  onEnter?: () => void // Enter with no suggestion picked
  placeholder?: string
  className?: string
  typed?: boolean // a plain input: matches show only while typing, no list arrow
  suffix?: ReactNode // at the box's right end (e.g. a status)
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const [all, setAll] = useState(false) // opened by the arrow: every option, not just matches
  const [sel, setSel] = useState(-1)
  const ref = useOutside(open, () => setOpen(false))
  const listRef = useRef<HTMLDivElement>(null)
  const t = value.trim().toLowerCase()
  const hits = all || !t ? (typed ? [] : options) : options.filter((o) => o.toLowerCase().includes(t) && (!typed || o.toLowerCase() !== t))
  const shown = open && hits.length > 0
  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: 'nearest' })
  }, [sel])
  const pick = (v: string): void => {
    onChange(v)
    setOpen(false)
    setSel(-1)
  }
  return (
    <div className={`combo ${shown ? 'open' : ''} ${className}`} ref={ref}>
      <div className="combo-box">
        <input
          value={value}
          placeholder={placeholder}
          onChange={(e) => {
            onChange(e.target.value)
            setAll(false)
            setOpen(true)
            setSel(-1)
          }}
          onFocus={() => (setAll(false), setOpen(!typed))}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setOpen(true)
              setSel((s) => Math.min(hits.length - 1, s + 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSel((s) => Math.max(-1, s - 1))
            } else if (e.key === 'Escape') setOpen(false)
            else if (e.key === 'Enter') {
              if (shown && sel >= 0) pick(hits[sel])
              else (setOpen(false), onEnter?.())
            }
          }}
        />
        {suffix}
        {!typed && (
          <button
            type="button"
            className="combo-arrow"
            tabIndex={-1}
            title="목록"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setAll(true)
              setOpen((o) => !o)
              setSel(-1)
            }}
          >
            <Caret up={shown} />
          </button>
        )}
      </div>
      {shown && (
        <div className="combo-list" ref={listRef}>
          {hits.map((o, i) => (
            <button
              key={i}
              type="button"
              className={`combo-opt ${i === sel ? 'sel' : ''} ${o === value ? 'on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
            >
              {o}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
