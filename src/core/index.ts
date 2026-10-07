// Sorta engine entry. Pure Node (no Electron imports) so the standalone app,
// Halftone and the tests all drive the same code.
import { mkdirSync } from 'fs'
import { join } from 'path'
import type { Settings } from '../shared/types'
import { openDb, schemaVersion } from './db'
import type { Db } from './db'
import { loadSettings, saveSettings } from './settings'
import { JobQueue } from './queue'
import { ActionLog } from './actionLog'

export interface CorePaths {
  dataDir: string
  dbPath: string
  thumbsDir: string
  modelsDir: string
}

export class SortaCore {
  readonly db: Db
  readonly queue = new JobQueue(1)
  readonly log: ActionLog
  readonly paths: CorePaths

  // dataDir ':memory:' → in-memory DB, no folders (tests).
  constructor(dataDir: string) {
    const mem = dataDir === ':memory:'
    this.paths = {
      dataDir,
      dbPath: mem ? ':memory:' : join(dataDir, 'sorta.db'),
      thumbsDir: mem ? '' : join(dataDir, 'thumbs'),
      modelsDir: mem ? '' : join(dataDir, 'models')
    }
    if (!mem) {
      for (const d of [dataDir, this.paths.thumbsDir, this.paths.modelsDir]) mkdirSync(d, { recursive: true })
    }
    this.db = openDb(this.paths.dbPath)
    this.log = new ActionLog(this.db)
  }

  get schemaVersion(): number {
    return schemaVersion(this.db)
  }

  settings(): Settings {
    return loadSettings(this.db)
  }

  saveSettings(patch: Partial<Settings>): Settings {
    return saveSettings(this.db, patch)
  }

  close(): void {
    this.db.close()
  }
}

export { DEFAULT_SETTINGS } from './settings'
export { JobQueue, CancelledError } from './queue'
export { ActionLog } from './actionLog'
export type * from './ml/types'
