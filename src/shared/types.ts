// Types shared by core, main and renderer. Plain data only (crosses IPC).

export type Rating = 'general' | 'sensitive' | 'r18' | 'unknown'
export type MatchStatus = 'auto' | 'confirmed' | 'pending' | 'unknown'
export type ImageKind = 'character' | 'other' | 'unknown'
export type SafeMode = 'show' | 'blur' | 'hide'
export type AssistMode = 'none' | 'pixai' | 'pixai+camie'
export type ModelId = 'wd' | 'pixai' | 'camie' | 'series' | 'ccip'

// Tunable numbers (CLAUDE.md §5, §6, §9: never hard-coded in the pipeline).
export interface Thresholds {
  autoAccept: number // a character tag ≥ this → in the picture, auto-confirmed
  reviewMin: number // candidates below this are flagged "low confidence"
  candidateMin: number // any candidate ≥ this → review queue; else unknown
  r18Threshold: number // questionable + explicit ≥ this → R-18
  sensitiveThreshold: number // sensitive ≥ this → 민감
  ratingMargin: number // ± band around rating thresholds → review
  groupThreshold: number // this many characters (same game, mixed) → 단체
  assistAccept: number // PixAI alone ≥ this → auto-confirm
  agreeMin: number // two models both ≥ this on the same character → auto-confirm
  camieSoloMin: number // a character only Camie names needs ≥ this to even reach review
  knnCandidate: number // learned-character similarity ≥ this → candidate (CCIP same-character ≈ 0.64)
  knnAccept: number // learned-character similarity ≥ this (and clear of the runner-up) → auto-confirm
  knnMargin: number // best learned character must beat the second by this much to auto-confirm
  clusterSimilarity: number // unknown images this alike form a group (미확인 묶음)
}

export interface Settings {
  sourceDirs: string[] // folders scanned for images
  watch: boolean // auto-import new files in sourceDirs
  organizeDir: string // root the sorted originals are moved into ('' = not set)
  moveAuto: boolean // also move auto-confirmed images (else only user-confirmed)
  splitByRating: boolean // 일반/ · 민감/ · R-18/ top folders
  safeR18: SafeMode
  safeSensitive: SafeMode
  thresholds: Thresholds
  // Character tags never treated as characters (player avatar, mascots …).
  ignoredCharacterTags: string[]
  // Second opinion on images the main tagger couldn't settle (Camie never decides alone).
  assistMode: AssistMode
  learnPerCharacter: number // Safebooru pictures fetched per learned character
  learnMinPosts: number // skip characters with fewer pictures than this
  booruSource: 'danbooru' | 'safebooru' // where reference pictures come from
  learnSensitive: boolean // Danbooru: also use rating:sensitive pictures (swimsuits etc.)
  useGpu: boolean
  allowWebLookup: boolean // wiki / LLM lookups by character name (opt-in)
  autoUpdate: boolean
  theme: 'light' | 'dark'
}

export interface ProgressEvent {
  jobId: number
  label: string
  done: number
  total: number // 0 = indeterminate
  state: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  error?: string
}

export interface AppInfo {
  version: string
  dataDir: string
  dbPath: string
  schemaVersion: number
}

// ---- library (renderer views) ----

export type LibraryNode =
  | { type: 'all' }
  | { type: 'series'; id: number }
  | { type: 'character'; id: number }
  | { type: 'pending' } // has a character awaiting review
  | { type: 'ratingReview' } // rating fell in a borderline band
  | { type: 'unknown' } // classified, no character found
  | { type: 'other' } // marked "캐릭터 아닌 그림"
  | { type: 'unclassified' } // imported, tagger not run yet

export interface LibraryFilter {
  node: LibraryNode
  rating: Rating | 'all'
  q: string
}

export interface TreeCharacter {
  id: number
  name: string
  count: number // base character: its images incl. outfit versions
  children?: TreeCharacter[] // outfit / version characters (e.g. Ako (Dress))
}
export interface TreeSeries {
  id: number
  name: string
  count: number
  characters: TreeCharacter[]
}
export interface LibraryTree {
  series: TreeSeries[]
  counts: { all: number; pending: number; ratingReview: number; unknown: number; other: number; unclassified: number }
}

export interface ImageItem {
  id: number
  path: string
  thumb: string | null
  width: number | null
  height: number | null
  rating: Rating
  ratingReview: boolean
  kind: ImageKind
  dupOf: number | null
  error: string | null
  // One per detected character: name (null = unknown) and status.
  characters: { id: number | null; name: string | null; series: string | null; status: MatchStatus; confidence: number | null }[]
}

export interface ModelInfo {
  id: ModelId
  license: string
  note?: string
  label: string
  installed: boolean
  bytes: number
  totalBytes: number
}

// ---- review (Phase 2) ----

export type ReviewKind = 'character' | 'rating'

export interface CharacterHit {
  id: number // 0 = not in the library yet: a character a tagger knows (see `tag`)
  name: string
  series: string
  n: number // images sorted under it
  tag?: string // model-known character: created via characterFromTag when picked
}

export interface ReviewCandidate {
  id: number
  name: string
  series: string
  score: number
  low: boolean // below reviewMin → "낮은 확신"
  refs: string[] // thumbnails of images already sorted under it (max 4)
  // Same character in another outfit as an already-confirmed one → the user
  // chooses "replace" (it's that outfit) or "both" (two outfits in the picture).
  relatedTo?: { id: number; name: string }
}

export interface ReviewItem {
  id: number
  path: string
  thumb: string | null
  width: number | null
  height: number | null
  rating: Rating
  ratingScore: number | null
  confirmed: { id: number; name: string; series: string }[] // already in the picture (auto/confirmed)
  candidates: ReviewCandidate[]
}

export interface UndoResult {
  ok: boolean
  label: string | null // what was undone; null = nothing left
}

// ---- character learning (Phase 3) ----

export interface LearnedCharacter {
  characterId: number
  name: string
  series: string
  tag: string
  refs: number // Safebooru reference pictures
  userRefs: number // user-confirmed reference crops
  learnedAt: number
}

export interface LearnPlanInfo {
  seriesTag: string
  source?: string // which site the counts come from
  learn: { name: string; post_count: number }[]
  known: number
  learned: number
  tooFew: number
}

export interface GameOption {
  tag: string // danbooru copyright tag, e.g. blue_archive
  name: string
}

// ---- organizing (Phase 4) ----

export interface OrganizeMove {
  id: number
  from: string
  to: string
}

export interface OrganizePlan {
  moves: OrganizeMove[]
  unsettled: number // still in review / unknown → stays put
  already: number // already in the right folder
  byFolder: { folder: string; n: number }[] // relative to the organize folder
}

export interface ManagedCharacter {
  id: number
  name: string
  aliases: string[]
  tag: string | null
  parentId: number | null // outfit version of
  seriesId: number
  series: string
  affiliation: string | null
  images: number
  refs: number // learning references
}

export interface UnknownCluster {
  key: string // member image ids (stable while the group is unchanged)
  images: { id: number; path: string; thumb: string | null; rating: Rating }[]
  similarity: number // weakest member's best link
}

export interface ClusterResult {
  clusters: UnknownCluster[]
  loose: number // unknown images that look like no other
  notEmbedded: number // not compared yet (learning model missing / pending)
}

// 소속 조직도 (Phase 4): nested affiliations of one game.
export interface OrgNode {
  id: number
  name: string
  aliases: string[] // earlier names (wiki answers in the old spelling still match)
  parentId: number | null
  order: number
}
export interface OrgCharacter {
  id: number
  name: string
  affiliationId: number | null
  images: number
}
export interface OrgChart {
  series: string
  wiki: string | null // Fandom domain, e.g. bluearchive.fandom.com
  nodes: OrgNode[]
  characters: OrgCharacter[] // base characters (outfit versions follow them)
}

// Affiliation found on the game's wiki for one character — shown for the
// user to accept, never applied on its own.
export interface WikiSuggestion {
  characterId: number
  name: string
  page: string | null // wiki page title
  url: string | null
  path: string[] // suggested nesting, top first (e.g. Liyue › Wangsheng Funeral Parlor)
  fields: { field: string; value: string }[] // everything affiliation-like on the page
  error?: string
}
export interface WikiLookupResult {
  wiki: string
  suggestions: WikiSuggestion[]
}
