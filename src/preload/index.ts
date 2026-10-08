import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { Api, JobSummary } from '../shared/ipc'
import type { ProgressEvent } from '../shared/types'

const on = <T>(ch: string, cb: (v: T) => void): (() => void) => {
  const h = (_e: unknown, v: T): void => cb(v)
  ipcRenderer.on(ch, h)
  return () => ipcRenderer.removeListener(ch, h)
}

const api: Api = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.saveSettings, patch),
  onProgress: (cb) => on<ProgressEvent>(IPC.progress, cb),
  cancelJob: (id) => ipcRenderer.invoke(IPC.cancelJob, id),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  runImport: () => ipcRenderer.invoke(IPC.runImport),
  runClassify: () => ipcRenderer.invoke(IPC.runClassify),
  reclassifyAll: () => ipcRenderer.invoke(IPC.reclassifyAll),
  models: () => ipcRenderer.invoke(IPC.models),
  downloadModel: (id) => ipcRenderer.invoke(IPC.downloadModel, id),
  deleteModel: (id) => ipcRenderer.invoke(IPC.deleteModel, id),
  runAssist: () => ipcRenderer.invoke(IPC.runAssist),
  tree: () => ipcRenderer.invoke(IPC.tree),
  images: (f) => ipcRenderer.invoke(IPC.images, f),
  onLibraryChanged: (cb) => on<void>(IPC.libraryChanged, () => cb()),
  showInFolder: (p) => ipcRenderer.invoke(IPC.showInFolder, p),
  imageUrl: (p) => 'sorta-img://f/' + Buffer.from(p, 'utf-8').toString('base64url'),
  reviewQueue: (k) => ipcRenderer.invoke(IPC.reviewQueue, k),
  confirmCharacters: (i, c) => ipcRenderer.invoke(IPC.confirmCharacters, i, c),
  addCharacter: (i, c) => ipcRenderer.invoke(IPC.addCharacter, i, c),
  markOther: (i) => ipcRenderer.invoke(IPC.markOther, i),
  setRating: (i, r) => ipcRenderer.invoke(IPC.setRating, i, r),
  createCharacter: (n, s) => ipcRenderer.invoke(IPC.createCharacter, n, s),
  searchCharacters: (q) => ipcRenderer.invoke(IPC.searchCharacters, q),
  seriesNames: () => ipcRenderer.invoke(IPC.seriesNames),
  undo: () => ipcRenderer.invoke(IPC.undo),
  onToast: (cb) => on<JobSummary>(IPC.toast, cb),
  learnRefresh: () => ipcRenderer.invoke(IPC.learnRefresh),
  learnPlan: (t) => ipcRenderer.invoke(IPC.learnPlan, t),
  learn: (tags) => ipcRenderer.invoke(IPC.learn, tags),
  booruTags: (q) => ipcRenderer.invoke(IPC.booruTags, q),
  learned: () => ipcRenderer.invoke(IPC.learned),
  forgetLearned: (id) => ipcRenderer.invoke(IPC.forgetLearned, id),
  games: () => ipcRenderer.invoke(IPC.games)
}

contextBridge.exposeInMainWorld('api', api)
