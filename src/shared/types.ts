// Types shared by core, main and renderer. Plain data only (crosses IPC).

export type Rating = 'general' | 'sensitive' | 'r18' | 'unknown'
export type MatchStatus = 'auto' | 'confirmed' | 'pending' | 'unknown'
export type ImageKind = 'character' | 'other' | 'unknown'
export type SafeMode = 'show' | 'blur' | 'hide'

// Tunable numbers (CLAUDE.md §5, §6, §9: never hard-coded in the pipeline).
export interface Thresholds {
  autoAccept: number // top score ≥ this (and margin) → auto-confirm
  reviewMin: number // candidates below this are flagged "low confidence"
  candidateMin: number // any candidate ≥ this → review queue; else unknown
  margin: number // required gap between 1st and 2nd candidate for auto
  r18Threshold: number // questionable + explicit ≥ this → R-18
  sensitiveThreshold: number // sensitive ≥ this → 민감
  ratingMargin: number // ± band around rating thresholds → review
  groupThreshold: number // this many characters (same game, mixed) → 단체
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
