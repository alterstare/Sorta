// Confidence branching (CLAUDE.md §5.4).
//
// The taggers score every character tag independently (sigmoid, not softmax):
// two high scores mean BOTH characters are in the picture, not "A or B". So
// each character is judged on its own:
//   confident                          → in the picture, auto-confirmed
//   candidateMin ≤ best score          → maybe in the picture → review
//   nothing ≥ candidateMin             → unknown (no known character found)
//
// "Confident" (false positives must stay rare):
//   • WD (main tagger) ≥ autoAccept, or
//   • PixAI alone ≥ assistAccept, or
//   • two models agree: both ≥ agreeMin on the same tag.
// Camie never confirms on its own — it has confident misses. A character only
// Camie names (no other model ≥ candidateMin) reaches review only at
// ≥ camieSoloMin, and never as an extra next to already-confirmed characters.
import type { MatchStatus, Thresholds } from '../../shared/types'

export interface TagCandidate {
  tag: string
  score: number
}

export interface ModelScores {
  wd: TagCandidate[]
  pixai?: TagCandidate[]
  camie?: TagCandidate[]
}

export interface CharacterRow {
  status: Exclude<MatchStatus, 'confirmed'>
  tag: string | null // the character (auto) / best guess (pending) / null (unknown)
  confidence: number
  candidates: TagCandidate[] // pending: the uncertain tags, best first (max 3)
}

export function decideEnsemble(m: ModelScores, t: Thresholds, ignored: string[] = []): CharacterRow[] {
  const skip = new Set(ignored)
  const per = new Map<string, { wd: number; pixai: number; camie: number }>()
  const add = (list: TagCandidate[] | undefined, k: 'wd' | 'pixai' | 'camie'): void => {
    for (const c of list ?? []) {
      if (skip.has(c.tag)) continue
      const e = per.get(c.tag) ?? { wd: 0, pixai: 0, camie: 0 }
      e[k] = Math.max(e[k], c.score)
      per.set(c.tag, e)
    }
  }
  add(m.wd, 'wd')
  add(m.pixai, 'pixai')
  add(m.camie, 'camie')

  const present: TagCandidate[] = []
  const maybe: TagCandidate[] = []
  const camieOnly = new Set<string>()
  for (const [tag, s] of per) {
    if (s.wd < t.candidateMin && s.pixai < t.candidateMin) {
      if (s.camie < t.camieSoloMin) continue // weak Camie-only guess → ignore
      camieOnly.add(tag)
    }
    const agree = [s.wd, s.pixai, s.camie].filter((v) => v >= t.agreeMin).length >= 2
    const best = Math.max(s.wd, s.pixai, s.camie)
    if (s.wd >= t.autoAccept || s.pixai >= t.assistAccept || agree) present.push({ tag, score: best })
    else if (best >= t.candidateMin) maybe.push({ tag, score: best })
  }
  present.sort((a, b) => b.score - a.score)
  maybe.sort((a, b) => b.score - a.score)

  const rows: CharacterRow[] = present.map((c) => ({ status: 'auto', tag: c.tag, confidence: c.score, candidates: [] }))
  // With confident characters found, only a fairly strong extra candidate is
  // worth a review (weak leftovers are usually look-alikes of those).
  const extra = present.length ? maybe.filter((c) => c.score >= t.reviewMin && !camieOnly.has(c.tag)) : maybe
  if (extra.length) {
    const top = extra.slice(0, 3)
    rows.push({ status: 'pending', tag: top[0].tag, confidence: top[0].score, candidates: top })
  }
  if (!rows.length) {
    const best = Math.max(0, ...[...per.values()].map((s) => Math.max(s.wd, s.pixai)))
    rows.push({ status: 'unknown', tag: null, confidence: best, candidates: [] })
  }
  return rows
}

// Main tagger only (no assist results).
export function decideCharacters(chars: TagCandidate[], t: Thresholds, ignored: string[] = []): CharacterRow[] {
  return decideEnsemble({ wd: chars }, t, ignored)
}

// Did the main tagger leave anything open (worth asking the assist models)?
export function needsAssist(rows: CharacterRow[]): boolean {
  return rows.some((r) => r.status !== 'auto')
}
