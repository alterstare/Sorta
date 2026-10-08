import type { AppInfo, ImageItem, LibraryFilter, LibraryTree, ModelId, ModelInfo, ProgressEvent, Settings } from './types'

export const IPC = {
  appInfo: 'app:info',
  getSettings: 'settings:get',
  saveSettings: 'settings:save',
  progress: 'queue:progress',
  cancelJob: 'queue:cancel',
  pickFolder: 'dialog:pickFolder',
  runImport: 'pipeline:import',
  runClassify: 'pipeline:classify',
  runAssist: 'pipeline:assist',
  reclassifyAll: 'pipeline:reclassifyAll',
  models: 'models:status',
  downloadModel: 'models:download',
  deleteModel: 'models:delete',
  tree: 'library:tree',
  images: 'library:images',
  libraryChanged: 'library:changed',
  showInFolder: 'file:show'
} as const

// Finished pipeline job summary (shown as a toast / status line).
export interface JobSummary {
  ok: boolean
  message: string
}

// What the renderer sees as `window.api`. Halftone can provide the same shape
// when it embeds the Sorta screens.
export interface Api {
  appInfo: () => Promise<AppInfo>
  getSettings: () => Promise<Settings>
  saveSettings: (patch: Partial<Settings>) => Promise<Settings>
  onProgress: (cb: (e: ProgressEvent) => void) => () => void
  cancelJob: (id: number) => Promise<boolean>
  pickFolder: () => Promise<string | null>
  // Import, then classify when a model is installed.
  runImport: () => Promise<JobSummary>
  runClassify: () => Promise<JobSummary>
  // Re-run the tagger on every image (user-confirmed results are kept).
  reclassifyAll: () => Promise<JobSummary>
  models: () => Promise<ModelInfo[]>
  downloadModel: (id: ModelId) => Promise<JobSummary>
  deleteModel: (id: ModelId) => Promise<void>
  runAssist: () => Promise<JobSummary>
  tree: () => Promise<LibraryTree>
  images: (f: LibraryFilter) => Promise<ImageItem[]>
  onLibraryChanged: (cb: () => void) => () => void
  showInFolder: (path: string) => Promise<void>
  imageUrl: (path: string) => string
}
