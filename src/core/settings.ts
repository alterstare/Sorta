// Settings live in the `settings` table, one row per top-level key. Missing
// keys fall back to DEFAULT_SETTINGS, so new settings need no migration.
import type { Settings } from '../shared/types'
import type { Db } from './db'

export const DEFAULT_SETTINGS: Settings = {
  sourceDirs: [],
  watch: false,
  organizeDir: '',
  moveAuto: false,
  splitByRating: false,
  safeR18: 'blur',
  safeSensitive: 'show',
  thresholds: {
    autoAccept: 0.85,
    reviewMin: 0.5,
    candidateMin: 0.25,
    margin: 0.1,
    r18Threshold: 0.5,
    sensitiveThreshold: 0.5,
    ratingMargin: 0.1,
    groupThreshold: 4
  },
  useGpu: true,
  allowWebLookup: false,
  autoUpdate: true,
  theme: 'light'
}

export function loadSettings(db: Db): Settings {
  const rows = db.prepare('SELECT key, value_json FROM settings').all() as { key: string; value_json: string }[]
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    if (!(r.key in DEFAULT_SETTINGS)) continue
    try {
      out[r.key] = JSON.parse(r.value_json)
    } catch {
      /* corrupt row → keep the default */
    }
  }
  // Nested object: fill in thresholds added after the row was written.
  out.thresholds = { ...DEFAULT_SETTINGS.thresholds, ...(out.thresholds as object) }
  return out as unknown as Settings
}

export function saveSettings(db: Db, patch: Partial<Settings>): Settings {
  const put = db.prepare(
    'INSERT INTO settings (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json'
  )
  db.transaction(() => {
    for (const [k, v] of Object.entries(patch)) {
      if (k in DEFAULT_SETTINGS && v !== undefined) put.run(k, JSON.stringify(v))
    }
  })()
  return loadSettings(db)
}
