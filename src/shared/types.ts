// Types shared by core, main and renderer. Plain data only (crosses IPC).

export type Rating = 'general' | 'sensitive' | 'r18' | 'unknown'
export type MatchStatus = 'auto' | 'confirmed' | 'pending' | 'unknown'
export type ImageKind = 'character' | 'other' | 'unknown'
export type SafeMode = 'show' | 'blur' | 'hide'
export type AssistMode = 'none' | 'pixai' | 'pixai+camie'
export type ModelId = 'wd' | 'pixai' | 'camie' | 'series'

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
  | { type: 'other' } // marked "캐릭터 아님"
  | { type: 'unclassified' } // imported, tagger not run yet

export interface LibraryFilter {
  node: LibraryNode
  rating: Rating | 'all'
  q: string
}

export interface TreeCharacter {
  id: number
  name: string
  count: number
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
  characters: { name: string | null; series: string | null; status: MatchStatus; confidence: number | null }[]
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
