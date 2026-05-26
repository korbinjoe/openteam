import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import express from 'express'
import { createServer, type Server } from 'http'
import { AddressInfo } from 'net'

const TMP_HOME = join(tmpdir(), `openteam-tray-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => TMP_HOME }
})

let createTrayRoutes: typeof import('../routes/system/trayRoutes').createTrayRoutes

beforeAll(async () => {
  await fs.mkdir(TMP_HOME, { recursive: true })
  vi.resetModules()
  ;({ createTrayRoutes } = await import('../routes/system/trayRoutes'))
})

afterAll(async () => {
  await fs.rm(TMP_HOME, { recursive: true, force: true })
})

type ChatStub = {
  id: string
  title: string
  workspaceId: string
  lastMessageAt?: string
}

type AgentActivity = {
  agentId: string
  agentName: string
  phase: string
  currentTool?: string
  toolCount: number
  toolCompleted: number
  cost?: number
}

type ActivityRecord = {
  chatId: string
  phase: string
  toolCount: number
  toolCompleted: number
  agentActivities: AgentActivity[]
}

const makeDeps = (chats: ChatStub[], activities: Record<string, ActivityRecord>, workspaces: Record<string, string | null>) => {
  const chatStore = { get: (id: string) => chats.find((c) => c.id === id) } as any
  const workspaceStore = {
    get: (id: string) => workspaces[id] !== undefined ? (workspaces[id] === null ? undefined : { id, name: workspaces[id] }) : undefined,
  } as any
  const sessionRegistry = { getActiveActivities: () => activities } as any
  return { chatStore, workspaceStore, sessionRegistry }
}

const startServer = (deps: ReturnType<typeof makeDeps>) =>
  new Promise<{ server: Server; baseUrl: string }>((resolveServer) => {
    const app = express()
    app.use(createTrayRoutes(deps))
    const server = createServer(app)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolveServer({ server, baseUrl: `http://127.0.0.1:${port}` })
    })
  })

const stopServer = (server: Server) => new Promise<void>((res) => server.close(() => res()))

describe('GET /api/tray/active-missions', () => {
  let server: Server | null = null

  beforeEach(() => {
    server = null
  })

  it('returns empty list when no session registry is wired', async () => {
    const app = express()
    app.use(createTrayRoutes({ chatStore: { get: () => undefined } as any, workspaceStore: { get: () => undefined } as any }))
    const s = createServer(app)
    await new Promise<void>((r) => s.listen(0, '127.0.0.1', () => r()))
    server = s
    const port = (s.address() as AddressInfo).port
    const res = await fetch(`http://127.0.0.1:${port}/api/tray/active-missions`)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ missions: [] })
    await stopServer(s)
    server = null
  })

  it('returns missions with at least one non-completed agent', async () => {
    const deps = makeDeps(
      [
        { id: 'cA', title: 'Mission A', workspaceId: 'wsX', lastMessageAt: new Date(1000).toISOString() },
        { id: 'cB', title: 'Mission B', workspaceId: 'wsX', lastMessageAt: new Date(2000).toISOString() },
      ],
      {
        cA: { chatId: 'cA', phase: 'tool_running', toolCount: 1, toolCompleted: 0, agentActivities: [
          { agentId: 'a1', agentName: 'Fullstack', phase: 'tool_running', currentTool: 'Bash', toolCount: 1, toolCompleted: 0 },
        ] },
        cB: { chatId: 'cB', phase: 'completed', toolCount: 1, toolCompleted: 1, agentActivities: [
          { agentId: 'a2', agentName: 'Reviewer', phase: 'completed', toolCount: 1, toolCompleted: 1 },
        ] },
      },
      { wsX: 'Acme' },
    )
    const s = await startServer(deps)
    server = s.server
    const res = await fetch(`${s.baseUrl}/api/tray/active-missions`)
    const body = await res.json() as { missions: Array<{ chatId: string; workspaceName: string }> }
    expect(body.missions.map((m) => m.chatId)).toEqual(['cA'])
    expect(body.missions[0].workspaceName).toBe('Acme')
    await stopServer(s.server)
  })

  it('aggregates progress and cost across agents', async () => {
    const deps = makeDeps(
      [{ id: 'cC', title: 'Mission C', workspaceId: 'wsY' }],
      {
        cC: { chatId: 'cC', phase: 'tool_running', toolCount: 7, toolCompleted: 3, agentActivities: [
          { agentId: 'a1', agentName: 'Fullstack', phase: 'tool_running', toolCount: 4, toolCompleted: 2, cost: 0.1 },
          { agentId: 'a2', agentName: 'Reviewer', phase: 'responding', toolCount: 3, toolCompleted: 1, cost: 0.25 },
        ] },
      },
      { wsY: 'Workspace Y' },
    )
    const s = await startServer(deps)
    server = s.server
    const res = await fetch(`${s.baseUrl}/api/tray/active-missions`)
    const body = await res.json() as { missions: Array<{ totalToolProgress: { completed: number; total: number }; totalCost: number; topPhase: string }> }
    expect(body.missions[0].totalToolProgress).toEqual({ completed: 3, total: 7 })
    expect(body.missions[0].totalCost).toBeCloseTo(0.35, 5)
    expect(body.missions[0].topPhase).toBe('tool_running')
    await stopServer(s.server)
  })

  it('defaults workspace name to Unknown when not found', async () => {
    const deps = makeDeps(
      [{ id: 'cD', title: 'Mission D', workspaceId: 'wsMissing' }],
      {
        cD: { chatId: 'cD', phase: 'thinking', toolCount: 0, toolCompleted: 0, agentActivities: [
          { agentId: 'a1', agentName: 'Fullstack', phase: 'thinking', toolCount: 0, toolCompleted: 0 },
        ] },
      },
      { wsMissing: null },
    )
    const s = await startServer(deps)
    server = s.server
    const res = await fetch(`${s.baseUrl}/api/tray/active-missions`)
    const body = await res.json() as { missions: Array<{ workspaceName: string }> }
    expect(body.missions[0].workspaceName).toBe('Unknown')
    await stopServer(s.server)
  })

  it('excludes activities whose chat is not found in the store', async () => {
    const deps = makeDeps(
      [],
      {
        ghost: { chatId: 'ghost', phase: 'tool_running', toolCount: 1, toolCompleted: 0, agentActivities: [
          { agentId: 'a1', agentName: 'Fullstack', phase: 'tool_running', toolCount: 1, toolCompleted: 0 },
        ] },
      },
      {},
    )
    const s = await startServer(deps)
    server = s.server
    const res = await fetch(`${s.baseUrl}/api/tray/active-missions`)
    const body = await res.json()
    expect(body.missions).toEqual([])
    await stopServer(s.server)
  })
})
