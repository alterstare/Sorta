import { create } from 'zustand'
import type { AppInfo, ProgressEvent, Settings } from '../../shared/types'

export type View = 'library' | 'review' | 'unknown' | 'characters' | 'settings'
export type ThumbSize = 's' | 'm' | 'l'

interface State {
  view: View
  settings: Settings | null
  info: AppInfo | null
  // Live background jobs keyed by id; finished ones drop out.
  jobs: Record<number, ProgressEvent>
  thumbSize: ThumbSize
  setView: (v: View) => void
  setThumbSize: (s: ThumbSize) => void
  load: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  onProgress: (e: ProgressEvent) => void
}

export const useStore = create<State>((set) => ({
  view: 'library',
  settings: null,
  info: null,
  jobs: {},
  thumbSize: 'm',
  setView: (view) => set({ view }),
  setThumbSize: (thumbSize) => set({ thumbSize }),
  load: async () => {
    const [settings, info] = await Promise.all([window.api.getSettings(), window.api.appInfo()])
    set({ settings, info })
  },
  saveSettings: async (patch) => set({ settings: await window.api.saveSettings(patch) }),
  onProgress: (e) =>
    set((s) => {
      const jobs = { ...s.jobs }
      if (e.state === 'queued' || e.state === 'running') jobs[e.jobId] = e
      else delete jobs[e.jobId]
      return { jobs }
    })
}))
