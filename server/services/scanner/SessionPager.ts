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

import { createReadStream, existsSync } from 'fs'
import { promises as fsp } from 'fs'
import { createInterface } from 'readline'
import { join } from 'path'
import { homedir } from 'os'
import type BetterSqlite3 from 'better-sqlite3'
import { getDatabase } from '../../stores/Database'
import { createLogger } from '../../lib/logger'
import { cwdToClaudeProjectKey } from '../../../shared/projectKey'
import { safeJsonParse } from './readHead'

const log = createLogger('SessionPager')

const CLAUDE_ROOT = join(homedir(), '.claude', 'projects')
// Hard cap on bytes scanned per file when searching for the first user message.
// Claude / Codex jsonl headers can be 30-50 KB of metadata (attachments,
// AGENTS.md injection, session_meta) before the first real user input. 1 MB
// covers all observed corpora with room to spare; stream-with-early-exit
// means small sessions cost only a few KB to read.
const HEAD_SCAN_BYTES_MAX = 1024 * 1024
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
  private linkByProviderStmt: BetterSqlite3.Statement
  private linkAnyProviderStmt: BetterSqlite3.Statement

  constructor() {
    this.db = getDatabase()
    // Reverse-link helpers: when an external_session_index row corresponds to
    // a chat that already references its cliSessionId, stamp adopted_chat_id
    // so the row gets filtered out of the external feed (otherwise the chat
    // shows up twice in the sidebar — once as native TaskRow, once as
    // ExternalSessionRow).
    //
    // Two variants because expertSessions[].provider was optional historically:
    // when present we can use the unique (provider, session_id) index; when
    // missing we fall back to session_id alone. Both guard `adopted_chat_id
    // IS NULL` to avoid clobbering an existing link.
    this.linkByProviderStmt = this.db.prepare(`
      UPDATE external_session_index
      SET adopted_chat_id = @chatId
      WHERE provider = @provider AND session_id = @sessionId
        AND adopted_chat_id IS NULL
    `)
    this.linkAnyProviderStmt = this.db.prepare(`
      UPDATE external_session_index
      SET adopted_chat_id = @chatId
      WHERE session_id = @sessionId
        AND adopted_chat_id IS NULL
    `)
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

    // Pull the existing parse state so we can detect cached rows that have
    // mtime/size match but never resolved a first_user_message (parser bug,
    // missing message in old 8 KB window, etc.) — those get re-parsed.
    const cachedClaudeState = new Map<string, { firstUser: string | null; parseError: string | null }>()
    for (const row of this.db
      .prepare(
        `SELECT file_path, first_user_message, parse_error
         FROM external_session_index
         WHERE provider = 'claude' AND cwd = ?`,
      )
      .all(cwd) as Array<{ file_path: string; first_user_message: string | null; parse_error: string | null }>) {
      cachedClaudeState.set(row.file_path, { firstUser: row.first_user_message, parseError: row.parse_error })
    }

    for (const f of claudeFiles) {
      onDiskPaths.add(f.filePath)
      const c = cached.get(f.filePath)
      const state = cachedClaudeState.get(f.filePath)
      const stale = !c || c.mtime !== f.mtime || c.size !== f.size
      const needsParse = stale || (state?.firstUser === null && state?.parseError === null)
      if (!needsParse) continue
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

    // After indexing this cwd's files, link any rows whose sessionId is
    // already referenced by an existing chat. This covers the timing where
    // OpenTeam created a chat (writing expertSessions) before the user ever
    // expanded the directory in the sidebar — the row appears here with
    // adopted_chat_id NULL and would otherwise duplicate the native TaskRow.
    this.linkAdoptedRowsForCwd(cwd)
  }

  /**
   * Build a map of cliSessionId → chatId by scanning chats.expert_sessions.
   * Used both by the per-cwd link pass and the one-shot backfill on boot.
   */
  private collectChatSessionLinks(): Array<{ chatId: string; cliSessionId: string; provider?: string }> {
    const rows = this.db
      .prepare(`SELECT id, expert_sessions FROM chats WHERE expert_sessions IS NOT NULL`)
      .all() as Array<{ id: string; expert_sessions: string }>
    const out: Array<{ chatId: string; cliSessionId: string; provider?: string }> = []
    for (const row of rows) {
      let parsed: Record<string, { cliSessionId?: string; provider?: string }> | null
      try {
        parsed = JSON.parse(row.expert_sessions) as Record<string, { cliSessionId?: string; provider?: string }>
      } catch {
        continue
      }
      if (!parsed) continue
      for (const info of Object.values(parsed)) {
        if (info?.cliSessionId) {
          out.push({ chatId: row.id, cliSessionId: info.cliSessionId, provider: info.provider })
        }
      }
    }
    return out
  }

  private linkAdoptedRowsForCwd(cwd: string): void {
    // Narrow to sessionIds present in this cwd's index — avoids touching every
    // chat for every directory expand. Cheap because the cwd index is small.
    const sessionRows = this.db
      .prepare(`SELECT session_id FROM external_session_index WHERE cwd = ? AND adopted_chat_id IS NULL`)
      .all(cwd) as Array<{ session_id: string }>
    if (sessionRows.length === 0) return
    const cwdSessionIds = new Set(sessionRows.map((r) => r.session_id))
    const links = this.collectChatSessionLinks().filter((l) => cwdSessionIds.has(l.cliSessionId))
    if (links.length === 0) return
    const tx = this.db.transaction((items: typeof links) => {
      for (const l of items) {
        if (l.provider) {
          this.linkByProviderStmt.run({ chatId: l.chatId, provider: l.provider, sessionId: l.cliSessionId })
        } else {
          this.linkAnyProviderStmt.run({ chatId: l.chatId, sessionId: l.cliSessionId })
        }
      }
    })
    tx(links)
  }

  /**
   * One-shot backfill for existing rows whose adopted_chat_id was never
   * populated (chats created before this link pass existed). Safe to call on
   * every boot — UPDATEs are guarded by `adopted_chat_id IS NULL`.
   */
  backfillAdoptedChatIds(): { linked: number } {
    const links = this.collectChatSessionLinks()
    let linked = 0
    const tx = this.db.transaction((items: typeof links) => {
      for (const l of items) {
        const result = l.provider
          ? this.linkByProviderStmt.run({ chatId: l.chatId, provider: l.provider, sessionId: l.cliSessionId })
          : this.linkAnyProviderStmt.run({ chatId: l.chatId, sessionId: l.cliSessionId })
        linked += result.changes
      }
    })
    tx(links)
    if (linked > 0) log.info('backfilled adopted_chat_id for legacy rows', { linked })
    return { linked }
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

const truncate = (s: string): string => {
  const single = s.replace(/\s+/g, ' ').trim()
  return single.length > FIRST_USER_CAP ? single.slice(0, FIRST_USER_CAP) : single
}

/**
 * Stream a jsonl file line-by-line and return the first line for which
 * `match` returns a non-null string. Stops as soon as a match is found or
 * `maxBytes` is exceeded — fast path for small sessions, bounded worst case
 * for headers padded with attachments / context injection.
 */
const scanForFirstMatch = async (
  path: string,
  match: (obj: unknown) => string | null,
  maxBytes: number,
): Promise<ParsedHeader> => {
  let bytes = 0
  let stream: ReturnType<typeof createReadStream> | null = null
  try {
    stream = createReadStream(path, { encoding: 'utf8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      bytes += Buffer.byteLength(line, 'utf8') + 1
      if (!line) continue
      const obj = safeJsonParse(line)
      if (obj) {
        const text = match(obj)
        if (text) {
          rl.close()
          stream.destroy()
          return { firstUser: truncate(text), error: null }
        }
      }
      if (bytes >= maxBytes) {
        rl.close()
        stream.destroy()
        return { firstUser: null, error: 'no_user_message_in_head' }
      }
    }
    return { firstUser: null, error: null }
  } catch (err) {
    return { firstUser: null, error: err instanceof Error ? err.message : String(err) }
  } finally {
    if (stream && !stream.destroyed) stream.destroy()
  }
}

// Claude hooks inject synthetic "user" messages like <command-name>/clear</command-name>
// or <system-reminder>...</system-reminder>. Those are not real user input.
const CLAUDE_NOISE_PREFIXES = ['<command-', '<system-reminder', '<local-command-stdout', 'Caveat:']

const isClaudeNoise = (text: string): boolean => {
  const trimmed = text.trimStart()
  return CLAUDE_NOISE_PREFIXES.some((p) => trimmed.startsWith(p))
}

const matchClaude = (obj: unknown): string | null => {
  const o = obj as { type?: string; message?: { role?: string; content?: unknown } }
  if (!o?.message || o.message.role !== 'user') return null
  const content = o.message.content
  if (typeof content === 'string') {
    if (!content || isClaudeNoise(content)) return null
    return content
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block
        && typeof block === 'object'
        && (block as { type?: string }).type === 'text'
        && typeof (block as { text?: unknown }).text === 'string'
      ) {
        const text = (block as { text: string }).text
        if (text && !isClaudeNoise(text)) return text
      }
    }
  }
  return null
}

const parseClaudeHeader = (path: string): Promise<ParsedHeader> =>
  scanForFirstMatch(path, matchClaude, HEAD_SCAN_BYTES_MAX)

// Codex injects AGENTS.md / environment context as the first response_item
// with role=user. Heuristic: real user input is rarely prefixed with these
// markers and is rarely > 2 KB. Prefer the event_msg.user_message envelope
// when present — it's the most reliable signal.
const CODEX_INJECTED_PREFIXES = ['# AGENTS.md', '<INSTRUCTIONS>', '<environment_context>', '<user_instructions>']

const isCodexInjected = (text: string): boolean => {
  const trimmed = text.trimStart()
  if (CODEX_INJECTED_PREFIXES.some((p) => trimmed.startsWith(p))) return true
  // Defensive: anything > 4 KB at the very head is almost certainly context
  // injection, not a real prompt.
  return trimmed.length > 4096
}

const matchCodex = (obj: unknown): string | null => {
  const o = obj as {
    type?: string
    payload?: {
      type?: string
      role?: string
      message?: unknown
      content?: Array<{ type?: string; text?: string }>
    }
  }
  const p = o?.payload
  if (!p) return null
  // Preferred path: event_msg envelope with payload.type='user_message'.
  if (o.type === 'event_msg' && p.type === 'user_message') {
    if (typeof p.message === 'string' && p.message) return p.message
  }
  // Fallback: response_item.message with role=user, skipping injected context.
  if (o.type === 'response_item' && p.role === 'user' && Array.isArray(p.content)) {
    for (const block of p.content) {
      if (
        block
        && (block.type === 'input_text' || block.type === 'text')
        && typeof block.text === 'string'
        && block.text
        && !isCodexInjected(block.text)
      ) {
        return block.text
      }
    }
  }
  return null
}

const parseCodexHeader = (path: string): Promise<ParsedHeader> =>
  scanForFirstMatch(path, matchCodex, HEAD_SCAN_BYTES_MAX)
