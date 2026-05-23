import type BetterSqlite3 from 'better-sqlite3'
import { getSchemaVersion } from './utils'
import { createLogger } from '../../lib/logger'

const log = createLogger('Migration:V21')

export function migrateToV21(db: BetterSqlite3.Database): void {
  if (getSchemaVersion(db) >= 21) return

  db.transaction(() => {
    const cols = db.prepare('PRAGMA table_info(chats)').all() as Array<{ name: string }>
    const names = cols.map((c) => c.name)

    if (!names.includes('source'))
      db.exec("ALTER TABLE chats ADD COLUMN source TEXT NOT NULL DEFAULT 'native'")
    if (!names.includes('external_cwd'))
      db.exec('ALTER TABLE chats ADD COLUMN external_cwd TEXT')

    db.exec(`
      CREATE TABLE IF NOT EXISTS external_dir_index (
        cwd TEXT PRIMARY KEY,
        providers TEXT NOT NULL,
        session_count INTEGER NOT NULL,
        latest_mtime_ms INTEGER NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0,
        last_scanned_ms INTEGER NOT NULL
      )
    `)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_edi_latest_mtime
        ON external_dir_index(latest_mtime_ms DESC)
        WHERE hidden = 0
    `)

    db.exec(`
      CREATE TABLE IF NOT EXISTS external_session_index (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        session_id TEXT NOT NULL,
        cwd TEXT NOT NULL,
        file_path TEXT NOT NULL UNIQUE,
        first_user_message TEXT,
        size_bytes INTEGER NOT NULL,
        file_mtime_ms INTEGER NOT NULL,
        scanned_at_ms INTEGER NOT NULL,
        adopted_chat_id TEXT,
        parse_error TEXT
      )
    `)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_esi_cwd_mtime
        ON external_session_index(cwd, file_mtime_ms DESC)
    `)
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_esi_session
        ON external_session_index(provider, session_id)
    `)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_esi_adopted
        ON external_session_index(adopted_chat_id)
        WHERE adopted_chat_id IS NOT NULL
    `)

    db.prepare("UPDATE _meta SET value = '21' WHERE key = 'schema_version'").run()
    log.info('Schema upgraded to V21: external_dir_index + external_session_index + chats.source/external_cwd')
  })()
}
