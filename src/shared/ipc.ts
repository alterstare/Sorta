import type { AppInfo, ProgressEvent, Settings } from './types'

export const IPC = {
  appInfo: 'app:info',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  progress: 'queue:progress'
} as const

// What the renderer sees as `window.api`. Halftone can provide the same shape
// when it embeds the Sorta screens.
export interface Api {
  appInfo: () => Promise<AppInfo>
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  onProgress: (cb: (e: ProgressEvent) => void) => () => void
}
