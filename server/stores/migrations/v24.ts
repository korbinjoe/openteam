import type BetterSqlite3 from 'better-sqlite3'
import { getSchemaVersion } from './utils'
import { createLogger } from '../../lib/logger'

const log = createLogger('Migration:V24')

export function migrateToV24(db: BetterSqlite3.Database): void {
  if (getSchemaVersion(db) >= 24) return

  db.transaction(() => {
    const cols = db.prepare('PRAGMA table_info(execution_logs)').all() as Array<{ name: string }>
    const names = cols.map((c) => c.name)

    if (!names.includes('execution_mode'))
      db.exec("ALTER TABLE execution_logs ADD COLUMN execution_mode TEXT")
    if (!names.includes('handoff_from'))
      db.exec("ALTER TABLE execution_logs ADD COLUMN handoff_from TEXT")
    if (!names.includes('workflow_id'))
      db.exec("ALTER TABLE execution_logs ADD COLUMN workflow_id TEXT")

    db.exec('CREATE INDEX IF NOT EXISTS idx_exec_logs_mode ON execution_logs(execution_mode) WHERE execution_mode IS NOT NULL')

    db.prepare("UPDATE _meta SET value = '24' WHERE key = 'schema_version'").run()
    log.info('Schema upgraded to V24: execution_logs.execution_mode + handoff_from + workflow_id')
  })()
}
