import { create } from 'zustand'
import type { JobSummary } from '../../shared/ipc'
import type {
  AppInfo,
  ImageItem,
  LibraryFilter,
  LibraryNode,
  LibraryTree,
  ModelInfo,
  ProgressEvent,
  Rating,
  Settings
} from '../../shared/types'

export type View = 'library' | 'review' | 'unknown' | 'characters' | 'settings'
export type ThumbSize = 's' | 'm' | 'l'

interface State {
  view: View
  settings: Settings | null
  info: AppInfo | null
  models: ModelInfo[]
  // Live background jobs keyed by id; finished ones drop out.
  jobs: Record<number, ProgressEvent>
  toast: JobSummary | null
  thumbSize: ThumbSize
  // library
  tree: LibraryTree | null
  filter: LibraryFilter
  images: ImageItem[]
  viewerIndex: number | null // index into `images` of the opened image
  libraryVersion: number // bumped on every library refresh (views re-query)
  selected: Set<number> // multi-selected image ids in the grid
  setSelected: (s: Set<number>) => void
  undo: () => Promise<void>
  setView: (v: View) => void
  setThumbSize: (s: ThumbSize) => void
  load: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  onProgress: (e: ProgressEvent) => void
  showToast: (t: JobSummary) => void
  dismissToast: () => void
  refreshModels: () => Promise<void>
  refreshLibrary: () => Promise<void>
  setNode: (n: LibraryNode) => void
  setRating: (r: Rating | 'all') => void
  setQuery: (q: string) => void
  openViewer: (i: number | null) => void
}

let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State>((set, get) => ({
  view: 'library',
  settings: null,
  info: null,
  models: [],
  jobs: {},
  toast: null,
  thumbSize: 'm',
  tree: null,
  filter: { node: { type: 'all' }, rating: 'all', q: '' },
  images: [],
  viewerIndex: null,
  libraryVersion: 0,
  selected: new Set(),
  setSelected: (selected) => set({ selected }),
  undo: async () => {
    const r = await window.api.undo()
    get().showToast({ ok: true, message: r.label ? `되돌림: ${r.label}` : '되돌릴 작업이 없습니다.' })
  },
  setView: (view) => set({ view }),
  setThumbSize: (thumbSize) => set({ thumbSize }),
  load: async () => {
    const [settings, info] = await Promise.all([window.api.getSettings(), window.api.appInfo()])
    set({ settings, info })
    await Promise.all([get().refreshModels(), get().refreshLibrary()])
  },
  saveSettings: async (patch) => set({ settings: await window.api.saveSettings(patch) }),
  onProgress: (e) =>
    set((s) => {
      const jobs = { ...s.jobs }
      if (e.state === 'queued' || e.state === 'running') jobs[e.jobId] = e
      else delete jobs[e.jobId]
      return { jobs }
    }),
  showToast: (toast) => {
    if (toastTimer) clearTimeout(toastTimer)
    set({ toast })
    toastTimer = setTimeout(() => set({ toast: null }), 6000)
  },
  dismissToast: () => set({ toast: null }),
  refreshModels: async () => set({ models: await window.api.models() }),
  refreshLibrary: async () => {
    const [tree, images] = await Promise.all([window.api.tree(), window.api.images(get().filter)])
    // Keep only selections that are still listed.
    const ids = new Set(images.map((i) => i.id))
    const selected = new Set([...get().selected].filter((id) => ids.has(id)))
    set({ tree, images, selected, libraryVersion: get().libraryVersion + 1 })
  },
  setNode: (node) => {
    set({ filter: { ...get().filter, node }, viewerIndex: null, selected: new Set() })
    void get().refreshLibrary()
  },
  setRating: (rating) => {
    set({ filter: { ...get().filter, rating }, viewerIndex: null })
    void get().refreshLibrary()
  },
  setQuery: (q) => {
    set({ filter: { ...get().filter, q }, viewerIndex: null })
    void get().refreshLibrary()
  },
  openViewer: (viewerIndex) => set({ viewerIndex })
}))
