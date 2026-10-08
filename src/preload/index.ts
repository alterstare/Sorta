import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { Api } from '../shared/ipc'
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
  imageUrl: (p) => 'sorta-img://f/' + Buffer.from(p, 'utf-8').toString('base64url')
}

contextBridge.exposeInMainWorld('api', api)
