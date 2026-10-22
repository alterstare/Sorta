// 모바일 변경 파일: what Sorta 모바일 changed, for this PC to apply.
// <정리 폴더>/.sorta/mobile/<device>-<time>.json — one file per batch, never
// rewritten (the phone only adds files; Sorta deletes a file once applied).
// The phone works from the 분류 정보 파일 (library.sortapack), so pictures are
// named by sha256 and characters by the file's key ("c12") plus name / game
// (the key alone can belong to another PC's library).
// Shared with the mobile app (copied there as-is).

export const MOBILE_FORMAT = 'sorta-mobile-edits'
export const MOBILE_VERSION = 1
export const MOBILE_DIR = 'mobile'

export interface CharRef {
  k?: string // pack character key
  name: string
  series: string
}

// A picture's classification as the phone left it; fields left out are unchanged.
export interface MobileImageState {
  chars?: { c: CharRef | null; st: string; src: string; conf: number | null; cand: { c: CharRef; score: number }[] | null }[]
  kind?: string // character | other | unknown
  go?: number // 단체 사진으로만 분류
  gs?: string | null // its game (name)
  rating?: { v: string; src: string; rr: number }
  fav?: number
  stars?: number
  groups?: string[] // picture group names (created when missing)
}

export type MobileEdit =
  | { op: 'image'; at: number; sha: string; set: MobileImageState; label: string }
  | { op: 'place'; at: number; char: CharRef; path: string[] | null } // 소속 (top first) in its game; null = 미지정
  | { op: 'addAff'; at: number; series: string; path: string[] } // creates the missing levels
  | { op: 'renameAff'; at: number; series: string; name: string; to: string }
  | { op: 'deleteAff'; at: number; series: string; name: string }
  | { op: 'renameChar'; at: number; char: CharRef; to: string }
  | { op: 'group'; at: number; action: 'create' | 'rename' | 'delete'; name: string; to?: string }
  | { op: 'trash'; at: number; sha: string } // 삭제: the PC moves the original into <정리 폴더>/삭제됨

export interface MobileEditFile {
  format: typeof MOBILE_FORMAT
  version: number
  device: string
  createdAt: number
  basedOn: number // createdAt of the 분류 정보 파일 the phone had
  edits: MobileEdit[]
}
