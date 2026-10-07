import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { Api } from '../shared/ipc'
import type { ProgressEvent } from '../shared/types'

const api: Api = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  saveSettings: (patch) => ipcRenderer.invoke(IPC.saveSettings, patch),
  onProgress: (cb) => {
    const h = (_e: unknown, p: ProgressEvent): void => cb(p)
    ipcRenderer.on(IPC.progress, h)
    return () => ipcRenderer.removeListener(IPC.progress, h)
  }
}

contextBridge.exposeInMainWorld('api', api)
