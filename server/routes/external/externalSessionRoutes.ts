/**
 * externalSessionRoutes — HTTP surface for the external session adoption
 * feature (sidebar + lazy session listing + click-to-adopt).
 *
 * Routes:
 *   GET  /api/sidebar/groups
 *   GET  /api/external-cwds/:cwd/sessions
 *   POST /api/external-sessions/:id/adopt
 *   POST /api/external-cwds/hide
 *   POST /api/external-cwds/unhide
 */

import { Router } from 'express'
import { basename, sep } from 'path'
import type { WorkspaceStore } from '../../stores/WorkspaceStore'
import type { ChatStore } from '../../stores/ChatStore'
import type { Workspace, CliProvider } from '../../config/types'
import { getDatabase } from '../../stores/Database'
import { SessionPager } from '../../services/scanner/SessionPager'
import { createLogger } from '../../lib/logger'

const log = createLogger('externalSessionRoutes')

interface ExternalSessionRouteDeps {
  workspaceStore: WorkspaceStore
  chatStore: ChatStore
}

interface DirRow {
  cwd: string
  providers: string
  session_count: number
  latest_mtime_ms: number
  hidden: number
}

interface AdoptedRow {
  cwd: string
  count: number
}

export const createExternalSessionRoutes = ({
  workspaceStore,
  chatStore,
}: ExternalSessionRouteDeps): Router => {
  const router = Router()
  const pager = new SessionPager()

  router.get('/api/sidebar/groups', (_req, res) => {
    const db = getDatabase()
    const workspaces = workspaceStore.listSorted()

    // All visible directory aggregates with un-adopted session counts.
    const dirRows = db
      .prepare(
        `SELECT cwd, providers, session_count, latest_mtime_ms, hidden
         FROM external_dir_index
         WHERE hidden = 0
         ORDER BY latest_mtime_ms DESC`,
      )
      .all() as DirRow[]

    const adoptedByCwd = new Map<string, number>()
    for (const r of db
      .prepare(
        `SELECT cwd, COUNT(*) as count
         FROM external_session_index
         WHERE adopted_chat_id IS NOT NULL
         GROUP BY cwd`,
      )
      .all() as AdoptedRow[]) {
      adoptedByCwd.set(r.cwd, r.count)
    }

    const matchedDirs = new Set<string>()
    const wsOut = workspaces.map((ws) => {
      const externalDirs = dirRows
        .filter((d) => isCwdInWorkspace(d.cwd, ws))
        .map((d) => {
          matchedDirs.add(d.cwd)
          const adopted = adoptedByCwd.get(d.cwd) ?? 0
          const unAdopted = Math.max(0, d.session_count - adopted)
          return {
            cwd: d.cwd,
            providers: d.providers.split(',').filter(Boolean) as ('claude' | 'codex')[],
            sessionCount: unAdopted,
            latestMtimeMs: d.latest_mtime_ms,
          }
        })
        .filter((d) => d.sessionCount > 0)

      return {
        kind: 'workspace' as const,
        id: ws.id,
        name: ws.name,
        repositories: ws.repositories.map((r) => ({ path: r.path, name: basename(r.path) })),
        chats: chatStore.listByWorkspace(ws.id),
        externalDirs,
      }
    })

    const unmatchedDirs = dirRows
      .filter((d) => !matchedDirs.has(d.cwd))
      .map((d) => {
        const adopted = adoptedByCwd.get(d.cwd) ?? 0
        const unAdopted = Math.max(0, d.session_count - adopted)
        return {
          kind: 'external-cwd' as const,
          cwd: d.cwd,
          providers: d.providers.split(',').filter(Boolean) as ('claude' | 'codex')[],
          sessionCount: unAdopted,
          adoptedCount: adopted,
          latestMtimeMs: d.latest_mtime_ms,
        }
      })
      .filter((d) => d.sessionCount > 0 || d.adoptedCount > 0)

    res.json({ workspaces: wsOut, unmatchedDirs })
  })

  router.get('/api/external-cwds/:cwd/sessions', async (req, res) => {
    try {
      const cwd = decodeURIComponent(req.params.cwd)
      const cursor = req.query.cursor ? Number(req.query.cursor) : null
      const rawLimit = req.query.limit ? Number(req.query.limit) : 20
      const limit = Math.min(Math.max(1, rawLimit || 20), 100)
      const result = await pager.listForCwd(cwd, cursor, limit)
      res.json(result)
    } catch (err) {
      log.warn('list sessions failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to list sessions',
      })
    }
  })

  // Workspace-scoped unified feed: merges every external cwd that falls under
  // the workspace's repositories into a single mtime-DESC stream. Sidebar uses
  // this to interleave native chats with claude/codex sessions inside one
  // workspace group.
  router.get('/api/workspaces/:id/external-sessions', async (req, res) => {
    try {
      const ws = workspaceStore.get(req.params.id)
      if (!ws) return res.status(404).json({ error: 'Workspace not found' })
      const cursor = req.query.cursor ? Number(req.query.cursor) : null
      const rawLimit = req.query.limit ? Number(req.query.limit) : 20
      const limit = Math.min(Math.max(1, rawLimit || 20), 100)

      const dirRows = getDatabase()
        .prepare(`SELECT cwd FROM external_dir_index WHERE hidden = 0`)
        .all() as Array<{ cwd: string }>
      const cwds = dirRows.map((r) => r.cwd).filter((cwd) => isCwdInWorkspace(cwd, ws))

      const result = await pager.listForCwds(cwds, cursor, limit)
      res.json(result)
    } catch (err) {
      log.warn('list workspace external sessions failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Failed to list sessions',
      })
    }
  })

  router.post('/api/external-sessions/:id/adopt', async (req, res) => {
    try {
      const id = req.params.id
      const db = getDatabase()
      const sessionRow = db
        .prepare(
          `SELECT id, provider, session_id, cwd, file_path, first_user_message, adopted_chat_id
           FROM external_session_index
           WHERE id = ?`,
        )
        .get(id) as {
        id: string
        provider: 'claude' | 'codex'
        session_id: string
        cwd: string
        file_path: string
        first_user_message: string | null
        adopted_chat_id: string | null
      } | undefined

      if (!sessionRow) {
        return res.status(404).json({ error: 'External session not found' })
      }

      // Idempotent: if already adopted, return existing chat.
      if (sessionRow.adopted_chat_id) {
        const existing = chatStore.get(sessionRow.adopted_chat_id)
        if (existing) return res.json({ chatId: existing.id })
        // Stale pointer (chat deleted) — fall through to re-create.
      }

      // 1. Resolve workspace: match by repository prefix, else auto-create one
      //    that owns this cwd. Auto-created workspace is a real first-class
      //    workspace; it just happens to be created at adoption time.
      const workspace = await resolveOrCreateWorkspace(
        workspaceStore,
        sessionRow.cwd,
      )

      // 2. Create the chat row.
      const primaryAgentId =
        workspace.agentTeam?.primaryAgentId ?? 'lead'
      const teamAgentIds = workspace.agentTeam?.teamAgentIds ?? []
      const titleSource =
        sessionRow.first_user_message
        ?? `${basename(sessionRow.cwd)}/${sessionRow.session_id.slice(0, 8)}`
      const title = truncateTitle(titleSource)

      const expertSessions: Record<string, { cliSessionId: string; provider: CliProvider; cwd: string }> = {
        [primaryAgentId]: {
          cliSessionId: sessionRow.session_id,
          provider: sessionRow.provider as CliProvider,
          cwd: sessionRow.cwd,
        },
      }

      // Two-step: create the row, then enrich. ChatStore.insertEntity is
      // protected, so we go through the public create() path and patch.
      const created = await chatStore.create({
        workspaceId: workspace.id,
        title,
        primaryAgentId,
        teamAgentIds,
      })
      const chat = await chatStore.update(created.id, {
        expertSessions,
        status: 'idle',
        source: 'external',
        externalCwd: sessionRow.cwd,
      })
      if (!chat) {
        return res.status(500).json({ error: 'Chat update failed after create' })
      }

      // 3. Mark as adopted in the index.
      db.prepare(
        'UPDATE external_session_index SET adopted_chat_id = ? WHERE id = ?',
      ).run(chat.id, id)

      // 4. Decrement dir's un-adopted count (best effort — index is the SoT
      //    via adopted_chat_id, but the cached aggregate lets the sidebar
      //    avoid a second query).
      db.prepare(
        `UPDATE external_dir_index
         SET session_count = MAX(0, session_count - 1)
         WHERE cwd = ?`,
      ).run(sessionRow.cwd)

      log.info('Adopted external session', {
        provider: sessionRow.provider,
        sessionId: sessionRow.session_id,
        chatId: chat.id,
        workspaceId: workspace.id,
      })
      res.json({ chatId: chat.id })
    } catch (err) {
      log.warn('adopt failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Adopt failed',
      })
    }
  })

  router.post('/api/external-cwds/hide', (req, res) => {
    const cwd = typeof req.body?.cwd === 'string' ? req.body.cwd : ''
    if (!cwd) return res.status(400).json({ error: 'cwd is required' })
    getDatabase()
      .prepare('UPDATE external_dir_index SET hidden = 1 WHERE cwd = ?')
      .run(cwd)
    res.json({ ok: true })
  })

  router.post('/api/external-cwds/unhide', (req, res) => {
    const cwd = typeof req.body?.cwd === 'string' ? req.body.cwd : ''
    if (!cwd) return res.status(400).json({ error: 'cwd is required' })
    getDatabase()
      .prepare('UPDATE external_dir_index SET hidden = 0 WHERE cwd = ?')
      .run(cwd)
    res.json({ ok: true })
  })

  return router
}

// ── helpers ────────────────────────────────────────────────────────────────

const isCwdInWorkspace = (cwd: string, ws: Workspace): boolean => {
  for (const repo of ws.repositories) {
    if (cwd === repo.path) return true
    const repoPrefix = repo.path.endsWith(sep) ? repo.path : repo.path + sep
    if (cwd.startsWith(repoPrefix)) return true
  }
  return false
}

const resolveOrCreateWorkspace = async (
  store: WorkspaceStore,
  cwd: string,
): Promise<Workspace> => {
  const all = store.listSorted()
  for (const ws of all) {
    if (isCwdInWorkspace(cwd, ws)) return ws
  }
  // Auto-create. Re-checking findByRepoPath catches the race where the same
  // cwd is adopted in two parallel requests.
  const existing = store.findByRepoPath(cwd)
  if (existing) return existing
  return await store.create({
    name: basename(cwd) || cwd,
    repositories: [{ path: cwd }],
  })
}

const truncateTitle = (s: string, max: number = 80): string => {
  const single = s.replace(/\s+/g, ' ').trim()
  return single.length > max ? single.slice(0, max - 1) + '…' : single
}
