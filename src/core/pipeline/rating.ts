// Rating decision (CLAUDE.md §5.2): 일반 / 민감 / R-18 from the tagger's four
// rating classes. R-18 = explicit only; questionable (suggestive, partial
// nudity) counts toward 민감 together with sensitive. Inside the ± margin band
// around a threshold the stricter rating is chosen and the image is flagged
// for review.
import type { Rating, Thresholds } from '../../shared/types'
import type { TagResult } from '../ml/types'

export interface RatingDecision {
  rating: Exclude<Rating, 'unknown'>
  score: number // the score the decision was based on
  review: boolean // fell in a borderline band
}

export function decideRating(r: TagResult['rating'], t: Thresholds): RatingDecision {
  const adult = r.explicit
  const suggestive = r.sensitive + r.questionable
  const m = t.ratingMargin
  if (adult >= t.r18Threshold + m) return { rating: 'r18', score: adult, review: false }
  if (adult >= t.r18Threshold - m) return { rating: 'r18', score: adult, review: true }
  if (suggestive >= t.sensitiveThreshold + m) return { rating: 'sensitive', score: suggestive, review: false }
  if (suggestive >= t.sensitiveThreshold - m) return { rating: 'sensitive', score: suggestive, review: true }
  return { rating: 'general', score: r.general, review: false }
}
