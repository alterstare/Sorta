import { contextBridge, ipcRenderer } from 'electron'
import { createApi } from './api'

contextBridge.exposeInMainWorld('api', createApi(ipcRenderer))

// Stamp the saved theme on <html> before the first paint: settings load
// asynchronously, so a dark-theme start would otherwise flash light first.
function applyInitialTheme(): void {
  let theme = 'light'
  try {
    theme = ipcRenderer.sendSync('sorta:themeSync') === 'dark' ? 'dark' : 'light'
  } catch {
    return
  }
  const set = (): boolean => {
    const el = document.documentElement
    if (!el) return false
    el.dataset.theme = theme
    return true
  }
  if (set()) return
  const mo = new MutationObserver(() => {
    if (set()) mo.disconnect()
  })
  mo.observe(document, { childList: true })
}
applyInitialTheme()
