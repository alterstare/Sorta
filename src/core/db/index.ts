import Database from 'better-sqlite3'
import { migrate, MIGRATIONS } from './migrations'

export type Db = Database.Database

// The data folder is shared by the standalone app and Halftone (which may run
// an older copy of Sorta): a database made by a newer Sorta is not opened.
export class NewerDataError extends Error {
  constructor(
    readonly dataVersion: number,
    readonly codeVersion: number
  ) {
    super(`Sorta 데이터(구조 ${dataVersion})가 이 버전(구조 ${codeVersion})보다 새 버전에서 만들어졌습니다`)
    this.name = 'NewerDataError'
  }
}

// Open (or create) the Sorta database and bring its schema up to date.
// ':memory:' is accepted for tests.
export function openDb(file: string): Db {
  const db = new Database(file)
  const v = db.pragma('user_version', { simple: true }) as number
  if (v > MIGRATIONS.length) {
    db.close()
    throw new NewerDataError(v, MIGRATIONS.length)
  }
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export { migrate, schemaVersion, MIGRATIONS } from './migrations'
