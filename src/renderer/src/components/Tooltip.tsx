import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { createPortal } from 'react-dom'
import { arrowText } from '../arrowText'


// Global themed tooltip, the same as Halftone's (and Envelope's). Replaces
// the browser's white native tooltip: on hover of any element with a `title`,
// we stash+strip the attribute (so the native bubble never shows) and render
// our own styled box, restoring `title` on leave. Not in a window too low to
// hold it: there the native bubble, which can leave the window, stays.
const LOW = 200 // px: a window this low keeps the native tooltip

export default function Tooltip(): JSX.Element | null {
  // x = anchor center, y = below the anchor, top = the anchor's top (for flipping up).
  const [tip, setTip] = useState<{ x: number; y: number; top: number; text: string } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // Place the box after it renders at its natural size: centered under the
  // anchor, but shifted to stay inside the window (near an edge it used to be
  // squeezed into a narrow column — "설/명"), and flipped above the anchor when
  // there's no room below.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!tip || !el) return setPos(null)
    const M = 8
    const w = el.offsetWidth
    const h = el.offsetHeight
    const left = Math.max(M, Math.min(tip.x - w / 2, window.innerWidth - w - M))
    const below = tip.y + h + M <= window.innerHeight
    setPos({ left, top: below ? tip.y : Math.max(M, tip.top - 6 - h) })
  }, [tip])

  useEffect(() => {
    let timer: number | undefined
    let cur: HTMLElement | null = null
    // Every element up the tree that has a `title` is stripped too: with only
    // the hovered one stripped, the browser showed the nearest ancestor's
    // title natively next to ours (a button inside a titled row / card).
    let stripped: HTMLElement[] = []

    const restore = (): void => {
      for (const el of stripped)
        if (el.dataset.tip != null) {
          el.setAttribute('title', el.dataset.tip)
          delete el.dataset.tip
        }
      stripped = []
      cur = null
    }

    const over = (e: MouseEvent): void => {
      if (window.innerHeight < LOW) return
      const el = (e.target as HTMLElement)?.closest?.('[title]') as HTMLElement | null
      if (!el || el === cur) return
      const text = el.getAttribute('title')
      if (!text) return
      restore()
      cur = el
      for (let a: HTMLElement | null = el; a; a = a.parentElement?.closest<HTMLElement>('[title]') ?? null) {
        a.dataset.tip = a.getAttribute('title') ?? ''
        a.removeAttribute('title')
        stripped.push(a)
      }
      window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        const r = el.getBoundingClientRect()
        setTip({ x: r.left + r.width / 2, y: r.bottom + 6, top: r.top, text })
      }, 700)
    }

    const out = (e: MouseEvent): void => {
      // Ignore moves that stay inside the current element.
      if (cur && e.relatedTarget instanceof Node && cur.contains(e.relatedTarget)) return
      window.clearTimeout(timer)
      restore()
      setTip(null)
    }

    // React re-adds `title` (with a new value) to the element we stripped when its
    // state changes under the cursor (e.g. a sort-dir toggle). Catch that: re-strip
    // and refresh the shown text so the native bubble never reappears and ours
    // isn't stale.
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        const el = m.target as HTMLElement
        if (!stripped.includes(el)) continue
        const t = el.getAttribute('title')
        if (t == null) continue
        el.dataset.tip = t
        el.removeAttribute('title')
        if (el === cur) setTip((prev) => (prev ? { ...prev, text: t } : prev))
      }
    })
    obs.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['title'] })

    // Anything that changes the screen while a tip is up (or waiting) hides it:
    // a press, a key (shortcuts change screens), the wheel / a scroll, a resize,
    // the window losing focus, or the anchor going away / moving. The titles
    // stay stripped until the pointer leaves the element, so the browser's own
    // bubble doesn't come up in its place.
    const dismiss = (): void => {
      window.clearTimeout(timer)
      setTip(null)
    }
    let anchor: HTMLElement | null = null
    let anchorRect: DOMRect | null = null
    const track = (): void => {
      if (cur === anchor) return
      anchor = cur
      anchorRect = cur ? cur.getBoundingClientRect() : null
    }
    const check = (): void => {
      if (!cur) return
      if (!cur.isConnected || cur.getClientRects().length === 0) {
        window.clearTimeout(timer)
        restore()
        setTip(null)
        return
      }
      const r = cur.getBoundingClientRect()
      if (anchorRect && (Math.abs(r.left - anchorRect.left) > 2 || Math.abs(r.top - anchorRect.top) > 2)) dismiss()
    }
    // checked right away (not on the next frame: frames stop while the window is hidden)
    const changed = new MutationObserver(check)
    changed.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] })
    document.addEventListener('mousedown', dismiss, true)
    document.addEventListener('keydown', dismiss, true)
    document.addEventListener('wheel', dismiss, { capture: true, passive: true })
    document.addEventListener('scroll', dismiss, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    document.addEventListener('mouseover', over, true)
    document.addEventListener('mouseover', track, true)
    document.addEventListener('mouseout', out, true)
    return () => {
      document.removeEventListener('mouseover', over, true)
      changed.disconnect()
      document.removeEventListener('mouseover', track, true)
      document.removeEventListener('mousedown', dismiss, true)
      document.removeEventListener('keydown', dismiss, true)
      document.removeEventListener('wheel', dismiss, true)
      document.removeEventListener('scroll', dismiss, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
      document.removeEventListener('mouseout', out, true)
      obs.disconnect()
      window.clearTimeout(timer)
      restore()
    }
  }, [])

  if (!tip) return null
  return createPortal(
    <div
      ref={boxRef}
      className="tooltip"
      // Measured off-screen first (hidden), then placed by the layout effect.
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      {arrowText(tip.text)}
    </div>,
    document.body
  )
}
