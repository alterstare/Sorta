import type { IpcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { Api, JobSummary, UpdateStatus } from '../shared/ipc'
import type { ProgressEvent } from '../shared/types'

// The renderer API over IPC — shared by Sorta's own preload and Halftone's
// (which exposes it in the Sorta frame).
export function createApi(ipcRenderer: IpcRenderer): Api {
  const on = <T>(ch: string, cb: (v: T) => void): (() => void) => {
    const h = (_e: unknown, v: T): void => cb(v)
    ipcRenderer.on(ch, h)
    return () => ipcRenderer.removeListener(ch, h)
  }

  // A main-process error reaches the page as "Error invoking remote method
  // 'x': Error: …". Keep only the message, so toasts show what went wrong.
  const invoke = (channel: string, ...args: unknown[]): Promise<any> =>
    ipcRenderer.invoke(channel, ...args).catch((e: unknown) => {
      throw new Error(String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''))
    })

  return {
    appInfo: () => invoke(IPC.appInfo),
    getSettings: () => invoke(IPC.getSettings),
    saveSettings: (patch) => invoke(IPC.saveSettings, patch),
    setMinWidth: (width) => ipcRenderer.send(IPC.setMinWidth, width),
    onProgress: (cb) => on<ProgressEvent>(IPC.progress, cb),
    cancelJob: (id) => invoke(IPC.cancelJob, id),
    pickFolder: () => invoke(IPC.pickFolder),
    runImport: () => invoke(IPC.runImport),
    runClassify: () => invoke(IPC.runClassify),
    reclassifyAll: () => invoke(IPC.reclassifyAll),
    models: () => invoke(IPC.models),
    downloadModel: (id) => invoke(IPC.downloadModel, id),
    deleteModel: (id) => invoke(IPC.deleteModel, id),
    runAssist: () => invoke(IPC.runAssist),
    tree: (r, g) => invoke(IPC.tree, r, g),
    setFavorite: (ids, on) => invoke(IPC.setFavorite, ids, on),
    setStars: (ids, n) => invoke(IPC.setStars, ids, n),
    groups: () => invoke(IPC.groups),
    createGroup: (n, ids) => invoke(IPC.createGroup, n, ids),
    renameGroup: (id, n) => invoke(IPC.renameGroup, id, n),
    deleteGroup: (id) => invoke(IPC.deleteGroup, id),
    setGroupMembership: (ids, g, on) => invoke(IPC.setGroupMembership, ids, g, on),
    copyImage: (p) => invoke(IPC.copyImage, p),
    duplicates: () => invoke(IPC.duplicates),
    exportPack: (o) => invoke(IPC.exportPack, o),
    pickPack: () => invoke(IPC.pickPack),
    previewPack: (f, o) => invoke(IPC.previewPack, f, o),
    importPack: (f, o) => invoke(IPC.importPack, f, o),
    setAside: (ids) => invoke(IPC.setAside, ids),
    notDuplicate: (ids) => invoke(IPC.notDuplicate, ids),
    images: (f) => invoke(IPC.images, f),
    onLibraryChanged: (cb) => on<void>(IPC.libraryChanged, () => cb()),
    showInFolder: (p) => invoke(IPC.showInFolder, p),
    imageUrl: (p) => 'sorta-img://f/' + Buffer.from(p, 'utf-8').toString('base64url'),
    reviewQueue: (k) => invoke(IPC.reviewQueue, k),
    confirmCharacters: (i, c) => invoke(IPC.confirmCharacters, i, c),
    addCharacter: (i, c) => invoke(IPC.addCharacter, i, c),
    markOther: (i) => invoke(IPC.markOther, i),
    markGroup: (i, s) => invoke(IPC.markGroup, i, s),
    setRating: (i, r) => invoke(IPC.setRating, i, r),
    createCharacter: (n, s) => invoke(IPC.createCharacter, n, s),
    searchCharacters: (q) => invoke(IPC.searchCharacters, q),
    characterFromTag: (t) => invoke(IPC.characterFromTag, t),
    seriesNames: () => invoke(IPC.seriesNames),
    undo: () => invoke(IPC.undo),
    imageSearch: (p) => invoke(IPC.imageSearch, p),
    trash: (ids) => invoke(IPC.trash, ids),
    redo: () => invoke(IPC.redo),
    onToast: (cb) => on<JobSummary>(IPC.toast, cb),
    onUpdateStatus: (cb) => on<UpdateStatus>(IPC.updateStatus, cb),
    checkUpdate: () => invoke(IPC.checkUpdate),
    installUpdate: () => ipcRenderer.send(IPC.installUpdate),
    learnRefresh: () => invoke(IPC.learnRefresh),
    learnPlan: (t) => invoke(IPC.learnPlan, t),
    learn: (tags) => invoke(IPC.learn, tags),
    booruTags: (q) => invoke(IPC.booruTags, q),
    learned: () => invoke(IPC.learned),
    forgetLearned: (id) => invoke(IPC.forgetLearned, id),
    games: () => invoke(IPC.games),
    organizePlan: () => invoke(IPC.organizePlan),
    organize: () => invoke(IPC.organize),
    characters: () => invoke(IPC.characters),
    affiliations: (s) => invoke(IPC.affiliations, s),
    renameCharacter: (id, n) => invoke(IPC.renameCharacter, id, n),
    setAliases: (id, a) => invoke(IPC.setAliases, id, a),
    setSeries: (ids, s) => invoke(IPC.setSeries, ids, s),
    setAffiliation: (ids, n) => invoke(IPC.setAffiliation, ids, n),
    mergeCharacters: (f, i) => invoke(IPC.mergeCharacters, f, i),
    unknownClusters: () => invoke(IPC.unknownClusters),
    orgChart: (s) => invoke(IPC.orgChart, s),
    addAffiliation: (s, n, p) => invoke(IPC.addAffiliation, s, n, p),
    renameAffiliation: (id, n) => invoke(IPC.renameAffiliation, id, n),
    deleteAffiliation: (id) => invoke(IPC.deleteAffiliation, id),
    moveAffiliation: (id, p, i) => invoke(IPC.moveAffiliation, id, p, i),
    placeCharacters: (ids, a) => invoke(IPC.placeCharacters, ids, a),
    setWiki: (s, w) => invoke(IPC.setWiki, s, w),
    applyAffiliations: (s, items) => invoke(IPC.applyAffiliations, s, items),
    wikiLookup: (s, ids) => invoke(IPC.wikiLookup, s, ids),
    openUrl: (u) => invoke(IPC.openUrl, u),
    status: () => invoke(IPC.status),
    retryLock: () => invoke(IPC.retryLock),
    start: () => invoke(IPC.start)
  }
}
