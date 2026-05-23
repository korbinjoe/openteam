/**
 * DirectoryEnumerator — Tier 1 scan for the external session adoption feature.
 *
 * Walks ~/.claude/projects and ~/.codex/sessions, populating external_dir_index
 * with one row per (cwd) found. Codex sessions are individually indexed in
 * external_session_index because their on-disk layout is by date, not by cwd —
 * the per-file rows are how warm-starts skip unchanged files.
 *
 * Performance contract (see openspec/changes/external-session-adoption):
 *   - Cold: ≤ 200 ms wall, ≤ 100 ms longest event-loop block on 3578-file corpus
 *   - Warm: ≤ 50 ms wall (mtime cursor short-circuits ≥99% files)
 *   - Memory: ≤ 2 MB at rest
 *   - Never reads more than 8 KB from any single jsonl
 */

import { existsSync } from 'fs'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type BetterSqlite3 from 'better-sqlite3'
import { getDatabase } from '../../stores/Database'
import { createLogger } from '../../lib/logger'
import { readHeadLines, readFirstLine, safeJsonParse } from './readHead'

const log = createLogger('DirectoryEnumerator')

const CLAUDE_ROOT = join(homedir(), '.claude', 'projects')
const CODEX_ROOT = join(homedir(), '.codex', 'sessions')
const CODEX_ROLLOUT_RE = /^rollout-.+-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})\.jsonl$/
const HEAD_CAP = 8192
const CODEX_FIRST_LINE_CAP = 4096
const BATCH_SIZE = 50

interface DirAggregate {
  cwd: string
  providers: Set<'claude' | 'codex'>
  sessionCount: number
  latestMtimeMs: number
}

interface CodexCacheRow {
  file_path: string
  size_bytes: number
  file_mtime_ms: number
  cwd: string
  session_id: string
}

export interface EnumerateResult {
  scannedFiles: number
  cachedHits: number
  durationMs: number
  dirCount: number
}

export class DirectoryEnumerator {
  private db: BetterSqlite3.Database
  private upsertDirStmt: BetterSqlite3.Statement
  private upsertSessionStmt: BetterSqlite3.Statement
  private listCodexCacheStmt: BetterSqlite3.Statement

  constructor() {
    this.db = getDatabase()
    this.upsertDirStmt = this.db.prepare(`
      INSERT INTO external_dir_index
        (cwd, providers, session_count, latest_mtime_ms, hidden, last_scanned_ms)
      VALUES (@cwd, @providers, @count, @mtime, 0, @scannedAt)
      ON CONFLICT(cwd) DO UPDATE SET
        providers = excluded.providers,
        session_count = excluded.session_count,
        latest_mtime_ms = excluded.latest_mtime_ms,
        last_scanned_ms = excluded.last_scanned_ms
    `)
    this.upsertSessionStmt = this.db.prepare(`
      INSERT INTO external_session_index
        (id, provider, session_id, cwd, file_path, first_user_message,
         size_bytes, file_mtime_ms, scanned_at_ms, adopted_chat_id, parse_error)
      VALUES (@id, @provider, @sessionId, @cwd, @filePath, NULL,
              @sizeBytes, @mtime, @scannedAt, NULL, NULL)
      ON CONFLICT(id) DO UPDATE SET
        cwd = excluded.cwd,
        file_path = excluded.file_path,
        size_bytes = excluded.size_bytes,
        file_mtime_ms = excluded.file_mtime_ms,
        scanned_at_ms = excluded.scanned_at_ms
    `)
    this.listCodexCacheStmt = this.db.prepare(`
      SELECT file_path, size_bytes, file_mtime_ms, cwd, session_id
      FROM external_session_index
      WHERE provider = 'codex'
    `)
  }

  async enumerate(): Promise<EnumerateResult> {
    const startedAt = Date.now()
    const aggregates = new Map<string, DirAggregate>()
    let scannedFiles = 0
    let cachedHits = 0

    if (existsSync(CLAUDE_ROOT)) {
      const r = await this.scanClaude(aggregates)
      scannedFiles += r.scannedFiles
    } else {
      log.debug('Claude root absent, skipping', { root: CLAUDE_ROOT })
    }

    if (existsSync(CODEX_ROOT)) {
      const r = await this.scanCodex(aggregates)
      scannedFiles += r.scannedFiles
      cachedHits += r.cachedHits
    } else {
      log.debug('Codex root absent, skipping', { root: CODEX_ROOT })
    }

    this.persistAggregates(aggregates, startedAt)

    const durationMs = Date.now() - startedAt
    log.info('Tier-1 enumeration complete', {
      durationMs,
      dirCount: aggregates.size,
      scannedFiles,
      cachedHits,
    })
    return { scannedFiles, cachedHits, durationMs, dirCount: aggregates.size }
  }

  // ── Claude ────────────────────────────────────────────────────────────────

  private async scanClaude(
    out: Map<string, DirAggregate>,
  ): Promise<{ scannedFiles: number }> {
    let scannedFiles = 0
    let projectDirs: string[]
    try {
      projectDirs = await fsp.readdir(CLAUDE_ROOT)
    } catch (err) {
      log.warn('readdir CLAUDE_ROOT failed', { err: errMsg(err) })
      return { scannedFiles: 0 }
    }

    for (let i = 0; i < projectDirs.length; i++) {
      const projectKey = projectDirs[i]
      const projectDir = join(CLAUDE_ROOT, projectKey)

      let files: string[]
      try {
        files = (await fsp.readdir(projectDir)).filter((f) => f.endsWith('.jsonl'))
      } catch {
        continue
      }
      if (files.length === 0) continue

      let sampleFile = files[0]
      let sampleMtime = 0
      let latestMtime = 0
      for (const f of files) {
        try {
          const m = (await fsp.stat(join(projectDir, f))).mtimeMs
          if (m > latestMtime) latestMtime = m
          if (m > sampleMtime) {
            sampleMtime = m
            sampleFile = f
          }
        } catch {
          // ignore broken symlinks etc.
        }
      }

      const cwd = await extractClaudeCwd(join(projectDir, sampleFile))
      if (!cwd) {
        log.debug('Claude project has no cwd in head', { projectKey })
        continue
      }
      scannedFiles += files.length

      const agg = ensureAgg(out, cwd)
      agg.providers.add('claude')
      agg.sessionCount += files.length
      if (latestMtime > agg.latestMtimeMs) agg.latestMtimeMs = latestMtime

      // Yield to event loop every BATCH_SIZE dirs (rarely needed — only 41 dirs).
      if ((i + 1) % BATCH_SIZE === 0) await yieldToLoop()
    }
    return { scannedFiles }
  }

  // ── Codex ─────────────────────────────────────────────────────────────────

  private async scanCodex(
    out: Map<string, DirAggregate>,
  ): Promise<{ scannedFiles: number; cachedHits: number }> {
    const cache = new Map<string, CodexCacheRow>()
    for (const row of this.listCodexCacheStmt.all() as CodexCacheRow[]) {
      cache.set(row.file_path, row)
    }

    const dayDirs = await listCodexDayDirs()
    let scannedFiles = 0
    let cachedHits = 0
    let inBatch = 0
    const scannedAt = Date.now()

    const upsertSessions: Array<Record<string, unknown>> = []
    const reachedNow = new Set<string>()

    for (const dayDir of dayDirs) {
      let files: string[]
      try {
        files = await fsp.readdir(dayDir)
      } catch {
        continue
      }

      for (const f of files) {
        const m = f.match(CODEX_ROLLOUT_RE)
        if (!m) continue
        const sessionId = m[1]
        const filePath = join(dayDir, f)

        let stat
        try {
          stat = await fsp.stat(filePath)
        } catch {
          continue
        }

        scannedFiles++
        reachedNow.add(filePath)

        const cached = cache.get(filePath)
        let cwd: string | null = null

        if (
          cached
          && cached.size_bytes === stat.size
          && cached.file_mtime_ms === stat.mtimeMs
        ) {
          cwd = cached.cwd
          cachedHits++
        } else {
          cwd = await extractCodexCwd(filePath)
          if (!cwd) continue
          upsertSessions.push({
            id: `codex:${sessionId}`,
            provider: 'codex',
            sessionId,
            cwd,
            filePath,
            sizeBytes: stat.size,
            mtime: stat.mtimeMs,
            scannedAt,
          })
        }

        const agg = ensureAgg(out, cwd)
        agg.providers.add('codex')
        agg.sessionCount += 1
        if (stat.mtimeMs > agg.latestMtimeMs) agg.latestMtimeMs = stat.mtimeMs

        inBatch++
        if (inBatch >= BATCH_SIZE) {
          inBatch = 0
          await yieldToLoop()
        }
      }
    }

    if (upsertSessions.length > 0) {
      const upsertMany = this.db.transaction((rows: Array<Record<string, unknown>>) => {
        for (const r of rows) this.upsertSessionStmt.run(r)
      })
      upsertMany(upsertSessions)
    }

    // Detect deleted codex files: rows in cache but not seen this run.
    const deleted: string[] = []
    for (const fp of cache.keys()) {
      if (!reachedNow.has(fp)) deleted.push(fp)
    }
    if (deleted.length > 0) {
      const del = this.db.prepare(
        'DELETE FROM external_session_index WHERE file_path = ? AND adopted_chat_id IS NULL',
      )
      const delMany = this.db.transaction((paths: string[]) => {
        for (const p of paths) del.run(p)
      })
      delMany(deleted)
    }

    return { scannedFiles, cachedHits }
  }

  // ── Persist ──────────────────────────────────────────────────────────────

  private persistAggregates(
    aggregates: Map<string, DirAggregate>,
    scannedAt: number,
  ): void {
    if (aggregates.size === 0) return
    const tx = this.db.transaction((rows: Array<Record<string, unknown>>) => {
      for (const r of rows) this.upsertDirStmt.run(r)
    })
    const rows: Array<Record<string, unknown>> = []
    for (const agg of aggregates.values()) {
      rows.push({
        cwd: agg.cwd,
        providers: Array.from(agg.providers).sort().join(','),
        count: agg.sessionCount,
        mtime: agg.latestMtimeMs,
        scannedAt,
      })
    }
    tx(rows)
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

const ensureAgg = (out: Map<string, DirAggregate>, cwd: string): DirAggregate => {
  let agg = out.get(cwd)
  if (!agg) {
    agg = { cwd, providers: new Set(), sessionCount: 0, latestMtimeMs: 0 }
    out.set(cwd, agg)
  }
  return agg
}

const yieldToLoop = (): Promise<void> => new Promise((r) => setImmediate(r))

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const extractClaudeCwd = async (path: string): Promise<string | null> => {
  const lines = await readHeadLines(path, HEAD_CAP)
  for (const line of lines) {
    const obj = safeJsonParse<{ cwd?: string }>(line)
    if (obj && typeof obj.cwd === 'string' && obj.cwd.length > 0) return obj.cwd
  }
  return null
}

const extractCodexCwd = async (path: string): Promise<string | null> => {
  const line = await readFirstLine(path, CODEX_FIRST_LINE_CAP)
  if (!line) return null
  const obj = safeJsonParse<{ payload?: { cwd?: string }; cwd?: string }>(line)
  const cwd = obj?.payload?.cwd ?? obj?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : null
}

const listCodexDayDirs = async (): Promise<string[]> => {
  const out: string[] = []
  let years: string[]
  try {
    years = await fsp.readdir(CODEX_ROOT)
  } catch {
    return out
  }
  for (const y of years) {
    const yDir = join(CODEX_ROOT, y)
    let months: string[]
    try {
      months = await fsp.readdir(yDir)
    } catch {
      continue
    }
    for (const mo of months) {
      const moDir = join(yDir, mo)
      let days: string[]
      try {
        days = await fsp.readdir(moDir)
      } catch {
        continue
      }
      for (const d of days) out.push(join(moDir, d))
    }
  }
  return out
}
