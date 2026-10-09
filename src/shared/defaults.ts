// Default tuning values, shared by the engine and the settings screen (reset).
import type { Thresholds } from './types'

export const DEFAULT_THRESHOLDS: Thresholds = {
  autoAccept: 0.75,
  reviewMin: 0.5,
  candidateMin: 0.25,
  r18Threshold: 0.5,
  sensitiveThreshold: 0.5,
  ratingMargin: 0.1,
  groupThreshold: 4,
  assistAccept: 0.9,
  agreeMin: 0.5,
  camieSoloMin: 0.8,
  knnCandidate: 0.64,
  knnAccept: 0.75,
  knnMargin: 0.1,
  clusterSimilarity: 0.72,
  dupDistance: 6,
  dupDetail: 5
}

// Character tags that are not "characters" for sorting (player avatar, mascots).
export const DEFAULT_IGNORED: string[] = [
  'sensei_(blue_archive)',
  'doodle_sensei_(blue_archive)',
  'peroro_(blue_archive)',
  'boo_tao_(genshin_impact)'
]
