// Close animations for popups (dropdown menus, context menus, group popover,
// autocomplete lists, modals, 크게 보기) — the same approach as Halftone's.
//
// React removes a popup's DOM node the moment it closes, so there's nothing
// left to animate. Instead of threading an "exiting" state through every
// component, this watches the DOM: when a popup node is removed while its
// parent is still on the page, the same (now React-detached) node is put back
// as an inert ghost with `.pop-closing`, plays the CSS exit animation, then is
// removed. React never touches the ghost again.
const POPUP = ['.dropmenu-panel', '.ctx-menu', '.ctx-submenu', '.group-pop', '.picker-list', '.modal-back', '.viewer'].join(',')

const EXIT_MS = 120

export function startExitAnimations(): () => void {
  const obs = new MutationObserver((records) => {
    for (const rec of records) {
      const parent = rec.target as Element
      if (!parent.isConnected) continue
      for (const node of rec.removedNodes) {
        if (!(node instanceof HTMLElement) || !node.matches(POPUP)) continue
        if (node.classList.contains('pop-closing')) continue // our own ghost leaving
        // Swapped for a fresh popup of the same kind in the same spot → no ghost.
        const cls = node.classList[0]
        if ([...rec.addedNodes].some((n) => n instanceof HTMLElement && n.classList.contains(cls))) continue
        const next = rec.nextSibling && rec.nextSibling.parentNode === parent ? rec.nextSibling : null
        node.classList.add('pop-closing')
        node.setAttribute('aria-hidden', 'true')
        node.setAttribute('inert', '')
        parent.insertBefore(node, next)
        let done = false
        const remove = (): void => {
          if (done) return
          done = true
          node.remove()
        }
        node.addEventListener('animationend', remove, { once: true })
        window.setTimeout(remove, EXIT_MS + 80) // fallback if no animation ran
      }
    }
  })
  obs.observe(document.body, { childList: true, subtree: true })
  return () => obs.disconnect()
}
