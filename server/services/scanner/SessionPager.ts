/**
 * SessionPager — Tier-2 lazy session listing.
 *
 * Called when the user expands a directory in the sidebar. For the requested
 * cwd we:
 *   1. Locate any jsonl files belonging to it (Claude: derive project dir from
 *      cwdToClaudeProjectKey; Codex: query external_session_index by cwd).
 *   2. For each file not yet in external_session_index — or cached with a
 *      stale (mtime, size) — parseHeader (≤ 8 KB) to extract first user
 *      message, then upsert.
 *   3. Page the result by mtime DESC keyset cursor (cursor = mtimeMs of last
 *      row from previous page). Limit 20 rows by default.
 *   4. Filter out rows already adopted (`adopted_chat_id IS NOT NULL`).
 *
 * Performance contract (design.md):
 *   - First expand cold: ≤ 250 ms for 20 rows on biggest dir (~150 files)
 *   - Re-expand warm:    ≤ 50 ms (all rows cached, no parseHeader calls)
 */

import { existsSync } from 'fs'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type BetterSqlite3 from 'better-sqlite3'
import { getDatabase } from '../../stores/Database'
import { createLogger } from '../../lib/logger'
import { cwdToClaudeProjectKey } from '../../../shared/projectKey'
import { readHeadLines, safeJsonParse } from './readHead'

const log = createLogger('SessionPager')

const CLAUDE_ROOT = join(homedir(), '.claude', 'projects')
const HEAD_CAP = 8192
const FIRST_USER_CAP = 200
const DEFAULT_LIMIT = 20

export interface ExternalSessionRow {
  id: string
  provider: 'claude' | 'codex'
  sessionId: string
  cwd: string
  filePath: string
  firstUserMessage: string | null
  mtimeMs: number
  sizeBytes: number
}

export interface PageResult {
  sessions: ExternalSessionRow[]
  nextCursor: number | null
  hasMore: boolean
}

interface IndexRow {
  id: string
  provider: 'claude' | 'codex'
  session_id: string
  cwd: string
  file_path: string
  first_user_message: string | null
  size_bytes: number
  file_mtime_ms: number
  adopted_chat_id: string | null
}

export class SessionPager {
  private db: BetterSqlite3.Database
  private listByCwdStmt: BetterSqlite3.Statement
  private upsertStmt: BetterSqlite3.Statement
  private deleteByPathStmt: BetterSqlite3.Statement

  constructor() {
    this.db = getDatabase()
    // Selects un-adopted rows for this cwd, ordered newest first, with
    // mtime keyset cursor. limit+1 so we can detect hasMore without COUNT(*).
    this.listByCwdStmt = this.db.prepare(`
      SELECT id, provider, session_id, cwd, file_path,
             first_user_message, size_bytes, file_mtime_ms, adopted_chat_id
      FROM external_session_index
      WHERE cwd = @cwd
        AND adopted_chat_id IS NULL
        AND (@cursor IS NULL OR file_mtime_ms < @cursor)
      ORDER BY file_mtime_ms DESC
      LIMIT @limit
    `)
    this.upsertStmt = this.db.prepare(`
      INSERT INTO external_session_index
        (id, provider, session_id, cwd, file_path, first_user_message,
         size_bytes, file_mtime_ms, scanned_at_ms, adopted_chat_id, parse_error)
      VALUES (@id, @provider, @sessionId, @cwd, @filePath, @firstUser,
              @sizeBytes, @mtime, @scannedAt, NULL, @parseError)
      ON CONFLICT(id) DO UPDATE SET
        cwd = excluded.cwd,
        file_path = excluded.file_path,
        first_user_message = excluded.first_user_message,
        size_bytes = excluded.size_bytes,
        file_mtime_ms = excluded.file_mtime_ms,
        scanned_at_ms = excluded.scanned_at_ms,
        parse_error = excluded.parse_error
    `)
    this.deleteByPathStmt = this.db.prepare(
      'DELETE FROM external_session_index WHERE file_path = ? AND adopted_chat_id IS NULL',
    )
  }

  async listForCwd(
    cwd: string,
    cursor: number | null,
    limit: number = DEFAULT_LIMIT,
  ): Promise<PageResult> {
    // First-pass: ensure all files for this cwd are indexed with a parsed
    // first user message. We do not parse on every call — `ensureIndexed`
    // skips files whose (mtime, size) already match the cached row.
    await this.ensureIndexed(cwd)

    const rows = this.listByCwdStmt.all({
      cwd,
      cursor,
      limit: limit + 1,
    }) as IndexRow[]

    return toPageResult(rows, limit)
  }

  /**
   * Multi-cwd variant — merges and pages across N cwds by mtime DESC. Used by
   * the workspace-level endpoint that surfaces all external sessions falling
   * under a workspace's repositories in one unified, time-sorted feed.
   *
   * Hydration runs per-cwd (parses jsonl headers for new/changed files), then
   * a single SQL query does the cross-cwd ordering. Skips empty cwd list.
   */
  async listForCwds(
    cwds: string[],
    cursor: number | null,
    limit: number = DEFAULT_LIMIT,
  ): Promise<PageResult> {
    if (cwds.length === 0) {
      return { sessions: [], nextCursor: null, hasMore: false }
    }
    for (const cwd of cwds) {
      await this.ensureIndexed(cwd)
    }
    const placeholders = cwds.map(() => '?').join(',')
    const params: Array<string | number | null> = [...cwds]
    let cursorClause = ''
    if (cursor !== null) {
      cursorClause = ' AND file_mtime_ms < ?'
      params.push(cursor)
    }
    params.push(limit + 1)
    const sql = `
      SELECT id, provider, session_id, cwd, file_path,
             first_user_message, size_bytes, file_mtime_ms, adopted_chat_id
      FROM external_session_index
      WHERE cwd IN (${placeholders})
        AND adopted_chat_id IS NULL${cursorClause}
      ORDER BY file_mtime_ms DESC
      LIMIT ?
    `
    const rows = this.db.prepare(sql).all(...params) as IndexRow[]
    return toPageResult(rows, limit)
  }

  /**
   * Walk the on-disk files belonging to `cwd` and upsert any that are missing
   * from the index or whose (mtime, size) has drifted. Idempotent.
   */
  private async ensureIndexed(cwd: string): Promise<void> {
    const claudeFiles = await this.listClaudeFiles(cwd)
    const codexFiles = this.listCodexCachedFiles(cwd)

    const cached = new Map<string, { mtime: number; size: number }>()
    for (const row of this.db
      .prepare(
        'SELECT file_path, file_mtime_ms, size_bytes FROM external_session_index WHERE cwd = ?',
      )
      .all(cwd) as Array<{ file_path: string; file_mtime_ms: number; size_bytes: number }>) {
      cached.set(row.file_path, { mtime: row.file_mtime_ms, size: row.size_bytes })
    }

    const upserts: Array<Record<string, unknown>> = []
    const scannedAt = Date.now()
    const onDiskPaths = new Set<string>()

    for (const f of claudeFiles) {
      onDiskPaths.add(f.filePath)
      const c = cached.get(f.filePath)
      if (c && c.mtime === f.mtime && c.size === f.size) continue
      const parsed = await parseClaudeHeader(f.filePath)
      upserts.push({
        id: `claude:${f.sessionId}`,
        provider: 'claude',
        sessionId: f.sessionId,
        cwd,
        filePath: f.filePath,
        firstUser: parsed.firstUser,
        sizeBytes: f.size,
        mtime: f.mtime,
        scannedAt,
        parseError: parsed.error,
      })
    }

    for (const f of codexFiles) {
      onDiskPaths.add(f.file_path)
      const needsParse =
        f.first_user_message === null
        && f.parse_error === null
      if (!needsParse) continue
      const parsed = await parseCodexHeader(f.file_path)
      upserts.push({
        id: `codex:${f.session_id}`,
        provider: 'codex',
        sessionId: f.session_id,
        cwd,
        filePath: f.file_path,
        firstUser: parsed.firstUser,
        sizeBytes: f.size_bytes,
        mtime: f.file_mtime_ms,
        scannedAt,
        parseError: parsed.error,
      })
    }

    if (upserts.length > 0) {
      const tx = this.db.transaction((rows: Array<Record<string, unknown>>) => {
        for (const r of rows) this.upsertStmt.run(r)
      })
      tx(upserts)
      log.debug('indexed sessions for cwd', { cwd, count: upserts.length })
    }

    // Detect deletions: cached rows for this cwd that no longer exist on disk.
    for (const filePath of cached.keys()) {
      if (!onDiskPaths.has(filePath)) {
        // A claude file may have been deleted, or a codex file went away. Only
        // Codex contributes paths to onDiskPaths via cache (we trust tier-1
        // for codex), and Claude contributes via on-disk readdir. Either way
        // missing means it's gone.
        this.deleteByPathStmt.run(filePath)
      }
    }
  }

  private async listClaudeFiles(
    cwd: string,
  ): Promise<Array<{ filePath: string; sessionId: string; mtime: number; size: number }>> {
    const projectKey = cwdToClaudeProjectKey(cwd)
    const dir = join(CLAUDE_ROOT, projectKey)
    if (!existsSync(dir)) return []
    let names: string[]
    try {
      names = (await fsp.readdir(dir)).filter((n) => n.endsWith('.jsonl'))
    } catch {
      return []
    }
    const out: Array<{ filePath: string; sessionId: string; mtime: number; size: number }> = []
    for (const name of names) {
      const filePath = join(dir, name)
      try {
        const stat = await fsp.stat(filePath)
        out.push({
          filePath,
          sessionId: name.replace(/\.jsonl$/, ''),
          mtime: stat.mtimeMs,
          size: stat.size,
        })
      } catch {
        // ignore broken files
      }
    }
    return out
  }

  private listCodexCachedFiles(cwd: string): Array<{
    file_path: string
    session_id: string
    file_mtime_ms: number
    size_bytes: number
    first_user_message: string | null
    parse_error: string | null
  }> {
    return this.db
      .prepare(
        `SELECT file_path, session_id, file_mtime_ms, size_bytes,
                first_user_message, parse_error
         FROM external_session_index
         WHERE provider = 'codex' AND cwd = ?`,
      )
      .all(cwd) as Array<{
      file_path: string
      session_id: string
      file_mtime_ms: number
      size_bytes: number
      first_user_message: string | null
      parse_error: string | null
    }>
  }
}

// ── page assembly ─────────────────────────────────────────────────────────

const toPageResult = (rows: IndexRow[], limit: number): PageResult => {
  const hasMore = rows.length > limit
  const page = hasMore ? rows.slice(0, limit) : rows
  const nextCursor = hasMore ? page[page.length - 1].file_mtime_ms : null
  return {
    sessions: page.map((r) => ({
      id: r.id,
      provider: r.provider,
      sessionId: r.session_id,
      cwd: r.cwd,
      filePath: r.file_path,
      firstUserMessage: r.first_user_message,
      mtimeMs: r.file_mtime_ms,
      sizeBytes: r.size_bytes,
    })),
    nextCursor,
    hasMore,
  }
}

// ── header parsing ────────────────────────────────────────────────────────

interface ParsedHeader {
  firstUser: string | null
  error: string | null
}

const truncate = (s: string): string =>
  s.length > FIRST_USER_CAP ? s.slice(0, FIRST_USER_CAP) : s

const parseClaudeHeader = async (path: string): Promise<ParsedHeader> => {
  let lines: string[]
  try {
    lines = await readHeadLines(path, HEAD_CAP)
  } catch (err) {
    return { firstUser: null, error: err instanceof Error ? err.message : String(err) }
  }
  for (const line of lines) {
    const obj = safeJsonParse<{
      type?: string
      message?: { role?: string; content?: unknown }
    }>(line)
    if (!obj?.message) continue
    if (obj.message.role !== 'user') continue
    const content = obj.message.content
    if (typeof content === 'string' && content.length > 0) {
      return { firstUser: truncate(content), error: null }
    }
    if (Array.isArray(content)) {
      // Claude content can be a list of blocks; find the first text block.
      for (const block of content) {
        if (
          block
          && typeof block === 'object'
          && (block as { type?: string }).type === 'text'
          && typeof (block as { text?: unknown }).text === 'string'
        ) {
          const text = (block as { text: string }).text
          if (text.length > 0) return { firstUser: truncate(text), error: null }
        }
      }
    }
  }
  return { firstUser: null, error: null }
}

const parseCodexHeader = async (path: string): Promise<ParsedHeader> => {
  let lines: string[]
  try {
    lines = await readHeadLines(path, HEAD_CAP)
  } catch (err) {
    return { firstUser: null, error: err instanceof Error ? err.message : String(err) }
  }
  for (const line of lines) {
    const obj = safeJsonParse<{
      type?: string
      payload?: {
        type?: string
        role?: string
        content?: Array<{ type?: string; text?: string }>
      }
    }>(line)
    const p = obj?.payload
    if (!p) continue
    // Codex stores user inputs as response_item with role=user.
    if (p.role !== 'user') continue
    if (!Array.isArray(p.content)) continue
    for (const block of p.content) {
      if (
        block
        && (block.type === 'input_text' || block.type === 'text')
        && typeof block.text === 'string'
        && block.text.length > 0
      ) {
        return { firstUser: truncate(block.text), error: null }
      }
    }
  }
  return { firstUser: null, error: null }
}
