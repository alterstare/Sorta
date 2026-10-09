import { contextBridge, ipcRenderer } from 'electron'
import { createApi } from './api'

contextBridge.exposeInMainWorld('api', createApi(ipcRenderer))
