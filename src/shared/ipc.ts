import type {
  AppInfo,
  CharacterHit,
  ClusterResult,
  ManagedCharacter,
  OrganizePlan,
  PackExportOptions,
  PackPreview,
  DupGroup,
  RatingPick,
  OrgChart,
  WikiLookupResult,
  GameOption,
  LearnedCharacter,
  LearnPlanInfo,
  ImageItem,
  LibraryFilter,
  LibraryTree,
  ModelId,
  ModelInfo,
  ProgressEvent,
  Rating,
  ReviewItem,
  ReviewKind,
  Settings,
  UndoResult
} from './types'

export const IPC = {
  appInfo: 'sorta:app:info',
  getSettings: 'sorta:settings:get',
  saveSettings: 'sorta:settings:save',
  progress: 'sorta:queue:progress',
  cancelJob: 'sorta:queue:cancel',
  pickFolder: 'sorta:dialog:pickFolder',
  runImport: 'sorta:pipeline:import',
  runClassify: 'sorta:pipeline:classify',
  runAssist: 'sorta:pipeline:assist',
  reclassifyAll: 'sorta:pipeline:reclassifyAll',
  models: 'sorta:models:status',
  downloadModel: 'sorta:models:download',
  deleteModel: 'sorta:models:delete',
  tree: 'sorta:library:tree',
  setFavorite: 'sorta:collect:favorite',
  setStars: 'sorta:collect:stars',
  groups: 'sorta:collect:groups',
  createGroup: 'sorta:collect:createGroup',
  renameGroup: 'sorta:collect:renameGroup',
  deleteGroup: 'sorta:collect:deleteGroup',
  setGroupMembership: 'sorta:collect:membership',
  copyImage: 'sorta:app:copyImage',
  duplicates: 'sorta:dup:groups',
  exportPack: 'sorta:pack:export',
  pickPack: 'sorta:pack:pick',
  previewPack: 'sorta:pack:preview',
  importPack: 'sorta:pack:import',
  setAside: 'sorta:dup:setAside',
  notDuplicate: 'sorta:dup:notDup',
  images: 'sorta:library:images',
  libraryChanged: 'sorta:library:changed',
  showInFolder: 'sorta:file:show',
  reviewQueue: 'sorta:review:queue',
  confirmCharacters: 'sorta:review:confirm',
  addCharacter: 'sorta:review:add',
  markOther: 'sorta:review:other',
  markGroup: 'sorta:review:group',
  setRating: 'sorta:review:rating',
  createCharacter: 'sorta:review:createCharacter',
  searchCharacters: 'sorta:review:search',
  characterFromTag: 'sorta:review:fromTag',
  seriesNames: 'sorta:review:series',
  undo: 'sorta:review:undo',
  imageSearch: 'sorta:review:imageSearch',
  trash: 'sorta:library:trash',
  redo: 'sorta:review:redo',
  toast: 'sorta:app:toast',
  updateStatus: 'sorta:update:status',
  checkUpdate: 'sorta:update:check',
  installUpdate: 'sorta:update:install',
  learnRefresh: 'sorta:learn:refresh',
  learnPlan: 'sorta:learn:plan',
  learn: 'sorta:learn:run',
  booruTags: 'sorta:learn:booruTags',
  learned: 'sorta:learn:list',
  forgetLearned: 'sorta:learn:forget',
  games: 'sorta:learn:games',
  organizePlan: 'sorta:organize:plan',
  organize: 'sorta:organize:run',
  characters: 'sorta:manage:characters',
  affiliations: 'sorta:manage:affiliations',
  renameCharacter: 'sorta:manage:rename',
  setAliases: 'sorta:manage:aliases',
  setSeries: 'sorta:manage:series',
  setAffiliation: 'sorta:manage:affiliation',
  mergeCharacters: 'sorta:manage:merge',
  unknownClusters: 'sorta:unknown:clusters',
  orgChart: 'sorta:org:chart',
  addAffiliation: 'sorta:org:add',
  renameAffiliation: 'sorta:org:rename',
  deleteAffiliation: 'sorta:org:delete',
  moveAffiliation: 'sorta:org:move',
  placeCharacters: 'sorta:org:place',
  setWiki: 'sorta:org:wiki',
  applyAffiliations: 'sorta:org:apply',
  wikiLookup: 'sorta:org:lookup',
  openUrl: 'sorta:app:openUrl',
  // embedding: the renderer asks whether the data folder is free (another app
  // may hold it) and starts background work once it shows
  status: 'sorta:status',
  retryLock: 'sorta:retryLock',
  start: 'sorta:start'
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
  tree: (ratings?: RatingPick[], groups?: number[]) => Promise<LibraryTree>
  // 즐겨찾기 · 평점 · 그룹 — each change is one undo step
  setFavorite: (ids: number[], on: boolean) => Promise<void>
  setStars: (ids: number[], stars: number) => Promise<void>
  groups: () => Promise<{ id: number; name: string }[]>
  createGroup: (name: string, ids?: number[]) => Promise<number>
  renameGroup: (id: number, name: string) => Promise<void>
  deleteGroup: (id: number) => Promise<void>
  setGroupMembership: (ids: number[], groupId: number, on: boolean) => Promise<void>
  copyImage: (path: string) => Promise<boolean> // original image → clipboard
  // 공유 파일 (.sortapack)
  exportPack: (o: PackExportOptions) => Promise<JobSummary | null> // null = save dialog cancelled
  pickPack: () => Promise<string | null>
  previewPack: (file: string, o: { overwrite: boolean; learned: boolean }) => Promise<PackPreview>
  importPack: (file: string, o: { overwrite: boolean; learned: boolean }) => Promise<JobSummary>
  // 중복 정리
  duplicates: () => Promise<DupGroup[]>
  setAside: (ids: number[]) => Promise<JobSummary> // → <정리 폴더>/중복, one undo step
  notDuplicate: (ids: number[]) => Promise<void>
  images: (f: LibraryFilter) => Promise<ImageItem[]>
  onLibraryChanged: (cb: () => void) => () => void
  showInFolder: (path: string) => Promise<void>
  imageUrl: (path: string) => string
  // review (Phase 2) — mutations are single undo steps
  reviewQueue: (kind: ReviewKind) => Promise<ReviewItem[]>
  confirmCharacters: (imageIds: number[], characterIds: number[]) => Promise<void>
  addCharacter: (imageId: number, characterId: number) => Promise<void>
  markOther: (imageIds: number[]) => Promise<void>
  markGroup: (imageIds: number[], series: string | null) => Promise<void> // 단체 사진으로만 분류 (game or null)
  setRating: (imageIds: number[], rating: Exclude<Rating, 'unknown'>) => Promise<void>
  createCharacter: (name: string, series: string) => Promise<number>
  searchCharacters: (q: string) => Promise<CharacterHit[]>
  // A model-known character (hit with id 0) → created in the library.
  characterFromTag: (tag: string) => Promise<CharacterHit>
  seriesNames: () => Promise<string[]>
  undo: () => Promise<UndoResult>
  imageSearch: (path: string) => Promise<void> // 구글 렌즈 window (needs allowImageSearch)
  trash: (ids: number[]) => Promise<JobSummary> // 삭제 → OS recycle bin
  redo: () => Promise<UndoResult> // what the last undo reverted, put back
  onToast: (cb: (t: JobSummary) => void) => () => void
  // 자동 업데이트 (packaged builds; GitHub Releases)
  onUpdateStatus: (cb: (s: UpdateStatus) => void) => () => void
  checkUpdate: () => Promise<UpdateStatus>
  installUpdate: () => void // quit + install the downloaded update
  // character learning (Phase 3)
  learnRefresh: () => Promise<JobSummary>
  learnPlan: (seriesTag: string) => Promise<LearnPlanInfo>
  learn: (tags: string[]) => Promise<JobSummary>
  booruTags: (q: string) => Promise<{ name: string; post_count: number }[]>
  learned: () => Promise<LearnedCharacter[]>
  forgetLearned: (characterId: number) => Promise<void>
  games: () => Promise<GameOption[]>
  // organizing + management (Phase 4) — edits are single undo steps
  organizePlan: () => Promise<OrganizePlan>
  organize: () => Promise<JobSummary>
  characters: () => Promise<ManagedCharacter[]>
  affiliations: (series: string) => Promise<string[]>
  renameCharacter: (id: number, name: string) => Promise<void>
  setAliases: (id: number, aliases: string[]) => Promise<void>
  setSeries: (ids: number[], series: string) => Promise<void>
  setAffiliation: (ids: number[], name: string | null) => Promise<void>
  mergeCharacters: (from: number[], into: number) => Promise<void>
  unknownClusters: () => Promise<ClusterResult>
  // 소속 조직도 — edits are single undo steps
  orgChart: (series: string) => Promise<OrgChart>
  addAffiliation: (series: string, name: string, parentId: number | null) => Promise<number>
  renameAffiliation: (id: number, name: string) => Promise<void>
  deleteAffiliation: (id: number) => Promise<void>
  moveAffiliation: (id: number, parentId: number | null, index?: number) => Promise<void>
  placeCharacters: (ids: number[], affiliationId: number | null) => Promise<void>
  setWiki: (series: string, wiki: string | null) => Promise<void>
  applyAffiliations: (series: string, items: { characterId: number; path: string[] }[]) => Promise<number>
  // Ask the game's wiki by character name (default: characters without one).
  wikiLookup: (series: string, ids?: number[]) => Promise<WikiLookupResult>
  openUrl: (url: string) => Promise<void>
  // embedding (Halftone): is the shared data folder free? start background work.
  status: () => Promise<SortaStatus>
  retryLock: () => Promise<SortaStatus>
  start: () => Promise<void>
}

export interface UpdateStatus {
  state: 'idle' | 'dev' | 'checking' | 'none' | 'available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  percent?: number
  error?: string
}

// The data folder is shared by the standalone app and Halftone; only one may
// use it at a time.
export interface SortaStatus {
  ready: boolean
  lockedBy?: string // app holding the data folder ("Sorta" / "Halftone")
  newerData?: boolean // the data was made by a newer Sorta → update this app
}
