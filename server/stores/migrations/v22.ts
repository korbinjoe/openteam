import type BetterSqlite3 from 'better-sqlite3'
import { nanoid } from 'nanoid'
import { getSchemaVersion } from './utils'
import { createLogger } from '../../lib/logger'

const log = createLogger('Migration:V22')

const TARGET_LEN = 10

/**
 * Shrink legacy 24-char workspace IDs down to 10 chars and cascade the new
 * value to every table that stores a workspace_id reference. Tables with
 * ON DELETE CASCADE FKs (chats, execution_logs, cron_jobs) still need explicit
 * UPDATEs because SQLite does not propagate primary-key changes — we disable
 * foreign_keys for the duration of the rewrite.
 */
export function migrateToV22(db: BetterSqlite3.Database): void {
  if (getSchemaVersion(db) >= 22) return

  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      const rows = db.prepare('SELECT id FROM workspaces').all() as Array<{ id: string }>
      const longIds = rows.filter((r) => r.id.length > TARGET_LEN).map((r) => r.id)

      if (longIds.length > 0) {
        const taken = new Set<string>(rows.map((r) => r.id))
        const mapping = new Map<string, string>()
        for (const oldId of longIds) {
          let newId = nanoid(TARGET_LEN)
          while (taken.has(newId)) newId = nanoid(TARGET_LEN)
          taken.add(newId)
          mapping.set(oldId, newId)
        }

        const updateWorkspace = db.prepare('UPDATE workspaces SET id = ? WHERE id = ?')
        const updateChats = db.prepare('UPDATE chats SET workspace_id = ? WHERE workspace_id = ?')
        const updateExec = db.prepare('UPDATE execution_logs SET workspace_id = ? WHERE workspace_id = ?')
        const updateCron = db.prepare('UPDATE cron_jobs SET workspace_id = ? WHERE workspace_id = ?')
        const updateToken = db.prepare('UPDATE token_usage SET workspace_id = ? WHERE workspace_id = ?')

        for (const [oldId, newId] of mapping) {
          updateWorkspace.run(newId, oldId)
          updateChats.run(newId, oldId)
          updateExec.run(newId, oldId)
          updateCron.run(newId, oldId)
          updateToken.run(newId, oldId)
        }

        log.info(`Shortened ${mapping.size} workspace ID(s) to ${TARGET_LEN} chars`)
      }

      db.prepare("UPDATE _meta SET value = '22' WHERE key = 'schema_version'").run()
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
