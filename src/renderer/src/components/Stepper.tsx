// Compact number stepper (same look as Halftone): a value pill with ▲/▼
// stacked on its right. Values are rounded to the step's precision.
import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { ArrowDownIcon, ArrowUpIcon } from './icons'

export default function Stepper({
  value,
  onChange,
  min = 0,
  max,
  step = 1
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
}): JSX.Element {
  const digits = (String(step).split('.')[1] ?? '').length
  const clamp = (v: number): number => Number(Math.max(min, max != null ? Math.min(max, v) : v).toFixed(digits))
  // Edit as text so "0." can be typed; commit on blur / Enter.
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = Number(text)
    if (Number.isFinite(n) && text.trim() !== '') onChange(clamp(n))
    else setText(String(value))
  }
  return (
    <span className="stepper">
      <input
        className="stepper-val"
        inputMode="decimal"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <span className="stepper-arrows">
        <button type="button" className="stepper-btn" disabled={max != null && value >= max} onClick={() => onChange(clamp(value + step))} aria-label="올리기">
          <ArrowUpIcon />
        </button>
        <button type="button" className="stepper-btn" disabled={value <= min} onClick={() => onChange(clamp(value - step))} aria-label="내리기">
          <ArrowDownIcon />
        </button>
      </span>
    </span>
  )
}
