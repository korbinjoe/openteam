/**
 * scanSettings — toggle for external session scanner.
 *
 * Persisted in `_meta` under the key `external_session_scan_enabled`.
 * Absent value defaults to enabled (true) — opt-out, not opt-in.
 */

import { getDatabase } from '../stores/Database'

const META_KEY = 'external_session_scan_enabled'

export const isExternalScanEnabled = (): boolean => {
  const db = getDatabase()
  const row = db.prepare('SELECT value FROM _meta WHERE key = ?').get(META_KEY) as
    | { value: string }
    | undefined
  if (!row) return true
  return row.value !== 'false'
}

export const setExternalScanEnabled = (enabled: boolean): void => {
  const db = getDatabase()
  db.prepare('INSERT OR REPLACE INTO _meta (key, value) VALUES (?, ?)').run(
    META_KEY,
    enabled ? 'true' : 'false',
  )
}
