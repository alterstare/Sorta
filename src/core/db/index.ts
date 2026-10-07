import Database from 'better-sqlite3'
import { migrate } from './migrations'

export type Db = Database.Database

// Open (or create) the Sorta database and bring its schema up to date.
// ':memory:' is accepted for tests.
export function openDb(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export { migrate, schemaVersion, MIGRATIONS } from './migrations'
