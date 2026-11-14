// Arrows in UI text drawn as Material Symbols icons instead of the font's
// thin, uneven glyphs: → ← ↔ ↑ ↓ ⬆ as arrow_forward / arrow_back / swap_horiz /
// arrow_upward / arrow_downward. A key hint, "(←)" or "Shift+←", is a key,
// not a direction: keyboard arrows. Inside quotes ("원문 → 번역") an arrow is
// text the user types, so it stays. Text without arrows comes back as is.
import type { JSX, ReactNode } from 'react'
import {
  ArrowBackIcon,
  ArrowDownwardIcon,
  ArrowForwardIcon,
  ArrowUpwardIcon,
  KeyboardArrowDownIcon,
  KeyboardArrowLeftIcon,
  KeyboardArrowRightIcon,
  KeyboardArrowUpIcon,
  SwapHorizIcon
} from './components/icons'

type Icon = (p: { className?: string }) => JSX.Element
const DIRECTION: Record<string, Icon> = {
  '→': ArrowForwardIcon,
  '←': ArrowBackIcon,
  '↔': SwapHorizIcon,
  '↑': ArrowUpwardIcon,
  '↓': ArrowDownwardIcon,
  '⬆': ArrowUpwardIcon
}
const KEY: Record<string, Icon> = {
  '←': KeyboardArrowLeftIcon,
  '→': KeyboardArrowRightIcon,
  '↑': KeyboardArrowUpIcon,
  '↓': KeyboardArrowDownIcon
}

export function arrowText(text: string): ReactNode {
  if (!/[←→↑↓↔⬆]/.test(text)) return text
  return text.split(/("[^"]*"|“[^”]*”|\([←→↑↓]\)|\+[←→↑↓]|[←→↑↓↔⬆])/).map((part, i) => {
    if (/^["“]/.test(part)) return part
    if (part.length === 2 && part[0] === '+' && KEY[part[1]]) {
      const K = KEY[part[1]]
      return (
        <span key={i}>
          +<K className="txt-key" />
        </span>
      )
    }
    const key = part.length === 3 ? KEY[part[1]] : undefined
    if (key) {
      const K = key
      return (
        <span key={i}>
          (<K className="txt-key" />)
        </span>
      )
    }
    const D = DIRECTION[part]
    return D ? <D key={i} className="txt-arrow" /> : part
  })
}
