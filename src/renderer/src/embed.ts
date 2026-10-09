// Inside Halftone (캐릭터 분류 mode) Sorta runs in a frame of Halftone's window.
// The host app then owns the look and the bottom bar: Sorta follows the
// host's theme and hands its job progress to the host's activity bar.
import type { ProgressEvent } from '../../shared/types'

export const embedded = window.parent !== window

// The host page (same origin), or null when standalone / not reachable.
function hostDocument(): Document | null {
  try {
    return embedded ? window.parent.document : null
  } catch {
    return null
  }
}

// Mirror the host's <html data-theme> now and whenever it changes.
export function followHostTheme(apply: (theme: string) => void): () => void {
  const doc = hostDocument()
  if (!doc) return () => {}
  const read = (): void => apply(doc.documentElement.dataset.theme || 'light')
  read()
  const mo = new MutationObserver(read)
  mo.observe(doc.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => mo.disconnect()
}

// Message the host's activity bar listens for (Halftone App.tsx).
export interface SortaJobMessage {
  type: 'sorta-job'
  event: ProgressEvent
}
export function postJob(event: ProgressEvent): void {
  if (embedded) window.parent.postMessage({ type: 'sorta-job', event } satisfies SortaJobMessage, '*')
}

// The host's tab bar carries Sorta's settings button: the host asks to open
// it, and Sorta reports which screen is showing (so the button lights up).
export function onHostSettings(open: () => void): () => void {
  if (!embedded) return () => {}
  const h = (e: MessageEvent): void => {
    if (e.source === window.parent && e.data?.type === 'sorta-settings') open()
  }
  window.addEventListener('message', h)
  return () => window.removeEventListener('message', h)
}
export function postView(view: string): void {
  if (embedded) window.parent.postMessage({ type: 'sorta-view', view }, '*')
}
