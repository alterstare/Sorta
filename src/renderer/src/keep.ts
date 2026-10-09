// useState that outlives the component: the value lives in the store under
// `key`, so leaving a view (another tab, settings…) and coming back keeps
// results of slow jobs, positions and selections. Also, a job that finishes
// while its view is closed still lands here. Memory only (not saved to disk).
import { useCallback, useRef } from 'react'
import { useStore } from './store'

type SetState<T> = (v: T | ((prev: T) => T)) => void

export function useKept<T>(key: string, initial: T): [T, SetState<T>] {
  const init = useRef(initial) // first value only — a fresh `new Set()` each render must not count as a change
  const stored = useStore((s) => s.kept[key]) as T | undefined
  const value = stored === undefined ? init.current : stored
  const set = useCallback<SetState<T>>(
    (v) =>
      useStore.setState((s) => {
        const prev = (s.kept[key] === undefined ? init.current : s.kept[key]) as T
        const next = typeof v === 'function' ? (v as (p: T) => T)(prev) : v
        return { kept: { ...s.kept, [key]: next } }
      }),
    [key]
  )
  return [value, set]
}

// Scroll position of a scrolling element, kept the same way. Returns a
// callback ref: restores on attach, saves on detach (also when one view swaps
// between two scrolling pages, e.g. 미확인 list ↔ group).
export function useKeptScroll<T extends HTMLElement>(key: string): (el: T | null) => void {
  const cur = useRef<{ el: T; last: number; on: () => void } | null>(null)
  return useCallback(
    (el: T | null) => {
      const k = `scroll.${key}`
      const c = cur.current
      if (c) {
        c.el.removeEventListener('scroll', c.on)
        useStore.setState((s) => ({ kept: { ...s.kept, [k]: c.last } }))
        cur.current = null
      }
      if (!el) return
      const top = useStore.getState().kept[k]
      if (typeof top === 'number') el.scrollTop = top
      const n = { el, last: el.scrollTop, on: () => (n.last = el.scrollTop) }
      el.addEventListener('scroll', n.on, { passive: true })
      cur.current = n
    },
    [key]
  )
}
