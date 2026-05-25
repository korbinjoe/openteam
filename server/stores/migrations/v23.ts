import type BetterSqlite3 from 'better-sqlite3'
import { getSchemaVersion } from './utils'
import { createLogger } from '../../lib/logger'

const log = createLogger('Migration:V23')

// Persist user-controlled mission organization (pin / archive) on the chat
// row itself so the state follows the chat regardless of which workspace view
// it was set in, survives browser/device changes, and broadcasts via WS like
// any other chat field. Auto-archive remains a client-side UI rule on top.
export function migrateToV23(db: BetterSqlite3.Database): void {
  if (getSchemaVersion(db) >= 23) return

  db.transaction(() => {
    const cols = db.prepare('PRAGMA table_info(chats)').all() as Array<{ name: string }>
    const names = cols.map((c) => c.name)

    if (!names.includes('archived_at'))
      db.exec('ALTER TABLE chats ADD COLUMN archived_at INTEGER')
    if (!names.includes('pinned_at'))
      db.exec('ALTER TABLE chats ADD COLUMN pinned_at INTEGER')

    db.exec('CREATE INDEX IF NOT EXISTS idx_chats_archived_at ON chats(archived_at) WHERE archived_at IS NOT NULL')
    db.exec('CREATE INDEX IF NOT EXISTS idx_chats_pinned_at ON chats(pinned_at) WHERE pinned_at IS NOT NULL')

    db.prepare("UPDATE _meta SET value = '23' WHERE key = 'schema_version'").run()
    log.info('Schema upgraded to V23: chats.archived_at + chats.pinned_at')
  })()
}
