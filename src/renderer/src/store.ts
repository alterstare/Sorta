import { create } from 'zustand'
import type { JobSummary, UpdateStatus } from '../../shared/ipc'
import type {
  AppInfo,
  ImageItem,
  LibraryFilter,
  LibraryNode,
  LibraryTree,
  ModelInfo,
  ProgressEvent,
  RatingPick,
  Settings,
  SortDir,
  SortKey,
  WikiSuggestion
} from '../../shared/types'

export type View = 'library' | 'review' | 'unknown' | 'characters' | 'settings'
export type ThumbSize = 's' | 'm' | 'l'
export type CharTab = 'manage' | 'org' | 'learn'
// One wiki suggestion as the user edits it: which option, applied or not.
export type WikiRow = WikiSuggestion & { pick: number; on: boolean }
// A wiki lookup outlives the 소속 tab (it can take minutes): kept here until
// applied or closed.
export interface OrgLookup {
  series: string
  running: boolean
  wiki?: string
  rows?: WikiRow[]
}

interface State {
  view: View
  settings: Settings | null
  info: AppInfo | null
  models: ModelInfo[]
  // Live background jobs keyed by id; finished ones drop out.
  jobs: Record<number, ProgressEvent>
  toast: JobSummary | null
  // library
  tree: LibraryTree | null
  filter: LibraryFilter
  images: ImageItem[]
  viewerIndex: number | null // index into `images` of the opened image
  libraryVersion: number // bumped on every library refresh (views re-query)
  imagesKey: string // the filter (JSON) `images` was loaded for
  selected: Set<number> // multi-selected image ids in the grid
  setSelected: (s: Set<number>) => void
  // Screen state that must survive leaving a view (results of slow jobs,
  // positions, selections) — see useKept.
  kept: Record<string, unknown>
  update: UpdateStatus
  // "새 그룹" dialog: the images that go into the new group (null = closed)
  groupDialog: number[] | null
  setGroupDialog: (ids: number[] | null) => void
  // rename dialog for a group (null = closed)
  renameGroup: { id: number; name: string } | null
  setRenameGroup: (g: { id: number; name: string } | null) => void
  charTab: CharTab
  setCharTab: (t: CharTab) => void
  orgLookup: OrgLookup | null
  startOrgLookup: (series: string, ids?: number[]) => Promise<void>
  setOrgRows: (rows: WikiRow[]) => void
  clearOrgLookup: () => void
  undo: () => Promise<void>
  setView: (v: View) => void
  load: () => Promise<void>
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  onProgress: (e: ProgressEvent) => void
  showToast: (t: JobSummary) => void
  dismissToast: () => void
  refreshModels: () => Promise<void>
  refreshLibrary: () => Promise<void>
  setNode: (n: LibraryNode) => void
  setRatings: (r: RatingPick[], prev?: RatingPick[] | null) => void
  setSort: (k: SortKey) => void
  setGroupFilter: (ids: number[]) => void
  reshuffle: () => void // 재정렬: a new random order (other sorts: just re-query)
  setDir: (d: SortDir) => void
  setQuery: (q: string) => void
  openViewer: (i: number | null) => void
  goToNode: (node: LibraryNode) => void // search pick: open the node, the tree scrolls to it
  treeReveal: { node: LibraryNode; n: number } | null
}

let librarySeq = 0
let toastTimer: ReturnType<typeof setTimeout> | null = null

export const useStore = create<State>((set, get) => ({
  view: 'library',
  settings: null,
  info: null,
  models: [],
  jobs: {},
  toast: null,
  tree: null,
  filter: { node: { type: 'all' }, ratings: ['general', 'sensitive', 'r18'], q: '', sort: 'date', dir: 'desc', seed: Date.now() % 2147483647 },
  images: [],
  viewerIndex: null,
  libraryVersion: 0,
  imagesKey: '',
  selected: new Set(),
  setSelected: (selected) => set({ selected }),
  kept: {},
  update: { state: 'idle' },
  groupDialog: null,
  setGroupDialog: (groupDialog) => set({ groupDialog }),
  renameGroup: null,
  setRenameGroup: (renameGroup) => set({ renameGroup }),
  charTab: 'manage',
  setCharTab: (charTab) => set({ charTab }),
  orgLookup: null,
  startOrgLookup: async (series, ids) => {
    set({ orgLookup: { series, running: true } })
    try {
      const r = await window.api.wikiLookup(series, ids)
      const rows = r.suggestions.map((s) => ({ ...s, pick: 0, on: s.path.length > 0 }))
      set({ orgLookup: { series, running: false, wiki: r.wiki, rows } })
      const n = rows.filter((x) => x.on).length
      get().showToast({
        ok: true,
        message: `위키 조회 완료: ${rows.length}명 중 ${n}명 소속 후보 · 캐릭터 → 소속 탭에서 확인하고 적용하세요`
      })
    } catch (e) {
      set({ orgLookup: null })
      get().showToast({ ok: false, message: String((e as Error).message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') })
    }
  },
  setOrgRows: (rows) => set((s) => (s.orgLookup ? { orgLookup: { ...s.orgLookup, rows } } : {})),
  clearOrgLookup: () => set({ orgLookup: null }),
  undo: async () => {
    const r = await window.api.undo()
    get().showToast({ ok: true, message: r.label ? `되돌리기 완료: ${r.label}` : '되돌릴 작업이 없습니다.' })
  },
  setView: (view) => set({ view }),
  load: async () => {
    const [settings, info] = await Promise.all([window.api.getSettings(), window.api.appInfo()])
    // The library view (rating filter, sort) comes back as it was left.
    set({ settings, info, filter: { ...get().filter, ratings: settings.libRatings, groups: settings.libGroups, sort: settings.libSort, dir: settings.libDir } })
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
    const f = get().filter
    const seq = ++librarySeq
    const [tree, images] = await Promise.all([window.api.tree(f.ratings, f.groups), window.api.images(f)])
    // A newer request (another node / filter) superseded this one.
    if (seq !== librarySeq) return
    // Keep only selections that are still listed.
    const ids = new Set(images.map((i) => i.id))
    const selected = new Set([...get().selected].filter((id) => ids.has(id)))
    set({ tree, images, selected, imagesKey: JSON.stringify(f), libraryVersion: get().libraryVersion + 1 })
  },
  setNode: (node) => {
    set({ filter: { ...get().filter, node }, viewerIndex: null, selected: new Set() })
    void get().refreshLibrary()
  },
  setRatings: (ratings, prev) => {
    set({ filter: { ...get().filter, ratings }, viewerIndex: null })
    void get().saveSettings(prev === undefined ? { libRatings: ratings } : { libRatings: ratings, libRatingsPrev: prev })
    void get().refreshLibrary()
  },
  reshuffle: () => {
    if (get().filter.sort === 'random') set({ filter: { ...get().filter, seed: (Date.now() * 7919) % 2147483647 } })
    void get().refreshLibrary()
  },
  setGroupFilter: (groups) => {
    set({ filter: { ...get().filter, groups }, viewerIndex: null })
    void get().saveSettings({ libGroups: groups })
    void get().refreshLibrary()
  },
  setSort: (sort) => {
    set({ filter: { ...get().filter, sort } })
    void get().saveSettings({ libSort: sort })
    void get().refreshLibrary()
  },
  setDir: (dir) => {
    set({ filter: { ...get().filter, dir } })
    void get().saveSettings({ libDir: dir })
    void get().refreshLibrary()
  },
  setQuery: (q) => {
    set({ filter: { ...get().filter, q }, viewerIndex: null })
    void get().refreshLibrary()
  },
  openViewer: (viewerIndex) => set({ viewerIndex }),
  treeReveal: null,
  goToNode: (node) => {
    set({
      filter: { ...get().filter, node, q: '' },
      viewerIndex: null,
      selected: new Set(),
      treeReveal: { node, n: (get().treeReveal?.n ?? 0) + 1 }
    })
    void get().refreshLibrary()
  }
}))
