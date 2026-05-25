import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { promises as fs, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import express from 'express'
import { createServer, type Server } from 'http'
import { AddressInfo } from 'net'

const TMP_HOME = join(tmpdir(), `openteam-chat-delete-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => TMP_HOME }
})

type Chat = {
  id: string
  workspaceId: string
  title: string
  primaryAgentId: string
  teamAgentIds: string[]
  expertSessions?: Record<string, { cliSessionId: string; cwd: string; provider?: 'claude' | 'codex'; exitCode?: number }>
  status: 'running' | 'idle' | 'stopped' | 'merged'
  createdAt: string
  lastMessageAt: string
}

const makeChatStore = (initial: Chat[]) => {
  const store = new Map<string, Chat>()
  for (const c of initial) store.set(c.id, c)
  return {
    get: (id: string) => store.get(id),
    update: async (id: string, patch: Partial<Chat>) => {
      const cur = store.get(id)
      if (!cur) return undefined
      const merged = { ...cur, ...patch }
      store.set(id, merged)
      return merged
    },
    remove: async (id: string) => store.delete(id),
    listByWorkspace: () => [],
    listRecent: () => [],
    countByWorkspace: () => ({}),
    create: async () => { throw new Error('not used') },
  } as any
}

let createChatRoutes: typeof import('../routes/chat/chatRoutes').createChatRoutes

beforeAll(async () => {
  await fs.mkdir(TMP_HOME, { recursive: true })
  vi.resetModules()
  ;({ createChatRoutes } = await import('../routes/chat/chatRoutes'))
})

afterAll(async () => {
  await fs.rm(TMP_HOME, { recursive: true, force: true })
})

// Minimal SessionRegistry stub. MemberAggregator only reaches into
// findAllByChat() and getActiveActivities(); other methods are unused at
// runtime for these tests so we can leave them as no-ops.
const makeSessionRegistry = (runningChatIds: string[] = []) => ({
  findAllByChat: (chatId: string) => runningChatIds.includes(chatId)
    ? [{ chatId, agentId: 'lead', cliSessionId: 'live-sess' }]
    : [],
  getActiveActivities: () => ({}),
}) as any

const startServer = (chats: Chat[], opts: { runningChatIds?: string[] } = {}) => {
  const chatStore = makeChatStore(chats)
  const chatService = {} as any
  const sessionRegistry = makeSessionRegistry(opts.runningChatIds)
  const app = express()
  app.use(express.json())
  app.use(createChatRoutes({ chatStore, chatService, sessionRegistry }))
  return new Promise<{ server: Server; baseUrl: string; chatStore: typeof chatStore }>((resolveServer) => {
    const server = createServer(app)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolveServer({ server, baseUrl: `http://127.0.0.1:${port}`, chatStore })
    })
  })
}

const stopServer = (server: Server) =>
  new Promise<void>((res) => server.close(() => res()))

const writeClaudeJsonl = (cwd: string, cliSessionId: string): string => {
  const projectKey = cwd.replace(/[/.]/g, '-')
  const dir = join(TMP_HOME, '.claude', 'projects', projectKey)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${cliSessionId}.jsonl`)
  writeFileSync(file, '{}')
  return file
}

describe('DELETE /api/chats/:id with purgeJsonl', () => {
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    if (server) await stopServer(server)
  })

  it('preserves backwards-compat: no purgeJsonl flag → JSONL files untouched', async () => {
    const cwd = '/Users/test/repo-a'
    const file = writeClaudeJsonl(cwd, 'sess-keep')

    const ctx = await startServer([{
      id: 'chat-1',
      workspaceId: 'ws',
      title: 't',
      primaryAgentId: 'lead',
      teamAgentIds: [],
      expertSessions: { lead: { cliSessionId: 'sess-keep', cwd, provider: 'claude' } },
      status: 'idle',
      createdAt: '2026-05-24T00:00:00Z',
      lastMessageAt: '2026-05-24T00:00:00Z',
    }])
    server = ctx.server
    baseUrl = ctx.baseUrl

    const r = await fetch(`${baseUrl}/api/chats/chat-1`, { method: 'DELETE' })
    expect(r.status).toBe(200)
    const body = await r.json() as { success: boolean; purged: unknown[] }
    expect(body.success).toBe(true)
    expect(body.purged).toEqual([])
    expect(existsSync(file)).toBe(true)
  })

  it('purgeJsonl=1 → unlinks every expert session jsonl', async () => {
    const cwd = '/Users/test/repo-b'
    const f1 = writeClaudeJsonl(cwd, 'sess-a')
    const f2 = writeClaudeJsonl(cwd, 'sess-b')

    const ctx = await startServer([{
      id: 'chat-2',
      workspaceId: 'ws',
      title: 't',
      primaryAgentId: 'lead',
      teamAgentIds: ['worker'],
      expertSessions: {
        lead: { cliSessionId: 'sess-a', cwd, provider: 'claude' },
        worker: { cliSessionId: 'sess-b', cwd, provider: 'claude' },
      },
      status: 'idle',
      createdAt: '2026-05-24T00:00:00Z',
      lastMessageAt: '2026-05-24T00:00:00Z',
    }])
    server = ctx.server
    baseUrl = ctx.baseUrl

    const r = await fetch(`${baseUrl}/api/chats/chat-2?purgeJsonl=1`, { method: 'DELETE' })
    expect(r.status).toBe(200)
    const body = await r.json() as { success: boolean; purged: Array<{ deleted: boolean; agentId: string }> }
    expect(body.purged.length).toBe(2)
    expect(body.purged.every((p) => p.deleted)).toBe(true)
    expect(existsSync(f1)).toBe(false)
    expect(existsSync(f2)).toBe(false)
  })

  it('purgeJsonl=1 with missing jsonl → still deletes record, deleted=false no error', async () => {
    const ctx = await startServer([{
      id: 'chat-3',
      workspaceId: 'ws',
      title: 't',
      primaryAgentId: 'lead',
      teamAgentIds: [],
      expertSessions: { lead: { cliSessionId: 'never-existed', cwd: '/x/y', provider: 'claude' } },
      status: 'idle',
      createdAt: '2026-05-24T00:00:00Z',
      lastMessageAt: '2026-05-24T00:00:00Z',
    }])
    server = ctx.server
    baseUrl = ctx.baseUrl

    const r = await fetch(`${baseUrl}/api/chats/chat-3?purgeJsonl=1`, { method: 'DELETE' })
    expect(r.status).toBe(200)
    const body = await r.json() as { purged: Array<{ deleted: boolean; error?: string }> }
    expect(body.purged[0].deleted).toBe(false)
    expect(body.purged[0].error).toBeUndefined()
  })

  it('purgeJsonl=1 on a live-running chat → 409', async () => {
    const cwd = '/Users/test/repo-d'
    const file = writeClaudeJsonl(cwd, 'sess-d')

    const ctx = await startServer([{
      id: 'chat-4',
      workspaceId: 'ws',
      title: 't',
      primaryAgentId: 'lead',
      teamAgentIds: [],
      expertSessions: { lead: { cliSessionId: 'sess-d', cwd, provider: 'claude' } },
      status: 'running',
      createdAt: '2026-05-24T00:00:00Z',
      lastMessageAt: '2026-05-24T00:00:00Z',
    }], { runningChatIds: ['chat-4'] })
    server = ctx.server
    baseUrl = ctx.baseUrl

    const r = await fetch(`${baseUrl}/api/chats/chat-4?purgeJsonl=1`, { method: 'DELETE' })
    expect(r.status).toBe(409)
    expect(existsSync(file)).toBe(true)
  })

  // Regression: ChatStore.create seeds new chats with status='running' even
  // when no session has actually started. The delete guard must look at the
  // live member rollup (SessionRegistry), not the stale persisted status,
  // otherwise brand-new Missions with no conversation can never be deleted.
  it('purgeJsonl=1 on a freshly-created chat (status=running but no live session) → 200', async () => {
    const ctx = await startServer([{
      id: 'chat-fresh',
      workspaceId: 'ws',
      title: 'New Mission',
      primaryAgentId: 'lead',
      teamAgentIds: [],
      status: 'running',
      createdAt: '2026-05-25T00:00:00Z',
      lastMessageAt: '2026-05-25T00:00:00Z',
    }])
    server = ctx.server
    baseUrl = ctx.baseUrl

    const r = await fetch(`${baseUrl}/api/chats/chat-fresh?purgeJsonl=1`, { method: 'DELETE' })
    expect(r.status).toBe(200)
    const body = await r.json() as { success: boolean }
    expect(body.success).toBe(true)
  })
})

describe('DELETE /api/chats/:id/sessions/:agentId', () => {
  let server: Server
  let baseUrl: string

  beforeEach(async () => {
    if (server) await stopServer(server)
  })

  it('removes one session and unlinks its jsonl, leaves siblings alone', async () => {
    const cwd = '/Users/test/repo-e'
    const fLead = writeClaudeJsonl(cwd, 'sess-lead')
    const fWorker = writeClaudeJsonl(cwd, 'sess-worker')

    const ctx = await startServer([{
      id: 'chat-5',
      workspaceId: 'ws',
      title: 't',
      primaryAgentId: 'lead',
      teamAgentIds: ['worker'],
      expertSessions: {
        lead: { cliSessionId: 'sess-lead', cwd, provider: 'claude' },
        worker: { cliSessionId: 'sess-worker', cwd, provider: 'claude' },
      },
      status: 'idle',
      createdAt: '2026-05-24T00:00:00Z',
      lastMessageAt: '2026-05-24T00:00:00Z',
    }])
    server = ctx.server
    baseUrl = ctx.baseUrl

    const r = await fetch(`${baseUrl}/api/chats/chat-5/sessions/worker`, { method: 'DELETE' })
    expect(r.status).toBe(200)
    const body = await r.json() as { chat: Chat; purged: { deleted: boolean; agentId: string } }
    expect(body.purged.deleted).toBe(true)
    expect(body.purged.agentId).toBe('worker')
    expect(body.chat.expertSessions?.worker).toBeUndefined()
    expect(body.chat.expertSessions?.lead).toBeDefined()
    expect(existsSync(fWorker)).toBe(false)
    expect(existsSync(fLead)).toBe(true)
  })

  it('404 when agent has no expert session in this chat', async () => {
    const ctx = await startServer([{
      id: 'chat-6',
      workspaceId: 'ws',
      title: 't',
      primaryAgentId: 'lead',
      teamAgentIds: [],
      expertSessions: { lead: { cliSessionId: 's', cwd: '/x', provider: 'claude' } },
      status: 'idle',
      createdAt: '2026-05-24T00:00:00Z',
      lastMessageAt: '2026-05-24T00:00:00Z',
    }])
    server = ctx.server
    baseUrl = ctx.baseUrl

    const r = await fetch(`${baseUrl}/api/chats/chat-6/sessions/never`, { method: 'DELETE' })
    expect(r.status).toBe(404)
  })

  it('404 when chat does not exist', async () => {
    const ctx = await startServer([])
    server = ctx.server
    baseUrl = ctx.baseUrl

    const r = await fetch(`${baseUrl}/api/chats/missing/sessions/x`, { method: 'DELETE' })
    expect(r.status).toBe(404)
  })

  it('idempotent: second call returns 404 (session already removed)', async () => {
    const cwd = '/Users/test/repo-f'
    writeClaudeJsonl(cwd, 'sess-f')

    const ctx = await startServer([{
      id: 'chat-7',
      workspaceId: 'ws',
      title: 't',
      primaryAgentId: 'lead',
      teamAgentIds: ['worker'],
      expertSessions: {
        lead: { cliSessionId: 'sess-lead-f', cwd, provider: 'claude' },
        worker: { cliSessionId: 'sess-f', cwd, provider: 'claude' },
      },
      status: 'idle',
      createdAt: '2026-05-24T00:00:00Z',
      lastMessageAt: '2026-05-24T00:00:00Z',
    }])
    server = ctx.server
    baseUrl = ctx.baseUrl

    const r1 = await fetch(`${baseUrl}/api/chats/chat-7/sessions/worker`, { method: 'DELETE' })
    expect(r1.status).toBe(200)
    const r2 = await fetch(`${baseUrl}/api/chats/chat-7/sessions/worker`, { method: 'DELETE' })
    expect(r2.status).toBe(404)
  })
})
