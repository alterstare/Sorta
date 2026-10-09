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
  setFavorite: 'collect:favorite',
  setStars: 'collect:stars',
  groups: 'collect:groups',
  createGroup: 'collect:createGroup',
  renameGroup: 'collect:renameGroup',
  deleteGroup: 'collect:deleteGroup',
  setGroupMembership: 'collect:membership',
  copyImage: 'app:copyImage',
  duplicates: 'dup:groups',
  exportPack: 'pack:export',
  pickPack: 'pack:pick',
  previewPack: 'pack:preview',
  importPack: 'pack:import',
  setAside: 'dup:setAside',
  notDuplicate: 'dup:notDup',
  images: 'library:images',
  libraryChanged: 'library:changed',
  showInFolder: 'file:show',
  reviewQueue: 'review:queue',
  confirmCharacters: 'review:confirm',
  addCharacter: 'review:add',
  markOther: 'review:other',
  setRating: 'review:rating',
  createCharacter: 'review:createCharacter',
  searchCharacters: 'review:search',
  characterFromTag: 'review:fromTag',
  seriesNames: 'review:series',
  undo: 'review:undo',
  toast: 'app:toast',
  learnRefresh: 'learn:refresh',
  learnPlan: 'learn:plan',
  learn: 'learn:run',
  booruTags: 'learn:booruTags',
  learned: 'learn:list',
  forgetLearned: 'learn:forget',
  games: 'learn:games',
  organizePlan: 'organize:plan',
  organize: 'organize:run',
  characters: 'manage:characters',
  affiliations: 'manage:affiliations',
  renameCharacter: 'manage:rename',
  setAliases: 'manage:aliases',
  setSeries: 'manage:series',
  setAffiliation: 'manage:affiliation',
  mergeCharacters: 'manage:merge',
  unknownClusters: 'unknown:clusters',
  orgChart: 'org:chart',
  addAffiliation: 'org:add',
  renameAffiliation: 'org:rename',
  deleteAffiliation: 'org:delete',
  moveAffiliation: 'org:move',
  placeCharacters: 'org:place',
  setWiki: 'org:wiki',
  applyAffiliations: 'org:apply',
  wikiLookup: 'org:lookup',
  openUrl: 'app:openUrl'
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
  tree: (ratings?: RatingPick[]) => Promise<LibraryTree>
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
  setRating: (imageIds: number[], rating: Exclude<Rating, 'unknown'>) => Promise<void>
  createCharacter: (name: string, series: string) => Promise<number>
  searchCharacters: (q: string) => Promise<CharacterHit[]>
  // A model-known character (hit with id 0) → created in the library.
  characterFromTag: (tag: string) => Promise<CharacterHit>
  seriesNames: () => Promise<string[]>
  undo: () => Promise<UndoResult>
  onToast: (cb: (t: JobSummary) => void) => () => void
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
}
