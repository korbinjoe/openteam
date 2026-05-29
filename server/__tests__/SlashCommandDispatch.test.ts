/**
 * End-to-end verification: /openspec:proposal must be expanded before
 * reaching the CLI (acpClient.prompt / acpClient.write). If the raw
 * "/openspec:proposal" text reaches Claude Code CLI via stream-json, the
 * CLI rejects it with "Unknown command".
 *
 * These tests exercise the actual dispatch code (ExpertDirectInput) with
 * a mocked acpClient to capture exactly what text reaches the CLI.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const FAKE_HOME = join(tmpdir(), `slash-e2e-${Date.now()}-${process.pid}`)

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => FAKE_HOME }
})

const { setProjectRoot } = await import('../runtime/SlashCommandResolver')
const { createExpertDirectInput } = await import('../ws/ExpertDirectInput')
const { ExpertSessionStore, compositeKey } = await import('../ws/ExpertSessionStore')

const PROJECT_ROOT = join(FAKE_HOME, 'openteam')

beforeAll(async () => {
  await mkdir(join(PROJECT_ROOT, '.claude', 'commands', 'openspec'), { recursive: true })
  await writeFile(
    join(PROJECT_ROOT, '.claude', 'commands', 'openspec', 'proposal.md'),
    '---\nname: Test Proposal\n---\nExpanded proposal body.\n',
    'utf-8',
  )
  setProjectRoot(PROJECT_ROOT)
})

afterAll(async () => {
  await rm(FAKE_HOME, { recursive: true, force: true }).catch(() => {})
})

const makeWs = () => ({ send: vi.fn(), readyState: 1 }) as any

const makeAliveAcpClient = () => ({
  isAlive: () => true,
  prompt: vi.fn(async () => ({})),
  write: vi.fn(),
  destroy: vi.fn(),
})

describe('slash command dispatch — end-to-end expansion', () => {
  const connId = 'conn-1'
  const chatId = 'chat-1'
  const agentId = 'agent-1'
  let store: InstanceType<typeof ExpertSessionStore>
  let handleStart: ReturnType<typeof vi.fn>

  beforeEach(() => {
    store = new ExpertSessionStore()
    handleStart = vi.fn(async () => {})
  })

  const buildDeps = () => ({
    store,
    chatStore: {
      get: vi.fn(() => ({ id: chatId, title: 'Test Chat' })),
      update: vi.fn(),
    } as any,
    sessionRegistry: { get: vi.fn(), remove: vi.fn(), findByChat: vi.fn() } as any,
    titleService: { generate: vi.fn(async () => 'semantic') } as any,
    broadcastToChat: vi.fn(),
    ensureAttachedRunning: vi.fn(() => undefined) as any,
    trackParticipant: vi.fn(),
    handleStart,
  })

  it('running agent (provider=claude): /openspec:proposal is expanded in acpClient.prompt', async () => {
    const acp = makeAliveAcpClient()
    const key = compositeKey(connId, chatId, agentId)
    store.set(key, {
      sessionId: 'sess-1',
      acpClient: acp as any,
      agentName: 'TestAgent',
      agentIcon: '',
      cwd: join(FAKE_HOME, 'user-workspace'),
      provider: 'claude',
      connectionId: connId,
      chatId,
    })

    const deps = buildDeps()
    deps.ensureAttachedRunning.mockReturnValue(store.get(key))
    const { handleDirectInput } = createExpertDirectInput(deps)

    await handleDirectInput(makeWs(), {
      chatId,
      agentId,
      message: '/openspec:proposal build feature X',
      autoStart: true,
    }, connId)

    expect(acp.prompt).toHaveBeenCalledTimes(1)
    const [, promptText] = acp.prompt.mock.calls[0]

    // The text reaching CLI must NOT start with /
    expect(promptText.startsWith('/')).toBe(false)
    // It must contain the expanded command body
    expect(promptText).toContain('Expanded proposal body.')
    // It must contain the user's arguments
    expect(promptText).toContain('build feature X')
    // It must have the OT_SLASH marker
    expect(promptText).toMatch(/^<!--OT_SLASH:/)
  })

  it('running agent (provider=undefined, defaults): /openspec:proposal is still expanded', async () => {
    const acp = makeAliveAcpClient()
    const key = compositeKey(connId, chatId, agentId)
    store.set(key, {
      sessionId: 'sess-1',
      acpClient: acp as any,
      agentName: 'TestAgent',
      agentIcon: '',
      cwd: '/tmp/nowhere',
      connectionId: connId,
      chatId,
    })

    const deps = buildDeps()
    deps.ensureAttachedRunning.mockReturnValue(store.get(key))
    const { handleDirectInput } = createExpertDirectInput(deps)

    await handleDirectInput(makeWs(), {
      chatId,
      agentId,
      message: '/openspec:proposal',
      autoStart: true,
    }, connId)

    expect(acp.prompt).toHaveBeenCalledTimes(1)
    const [, promptText] = acp.prompt.mock.calls[0]
    expect(promptText.startsWith('/')).toBe(false)
    expect(promptText).toContain('Expanded proposal body.')
  })

  it('running agent (provider=codex): /openspec:proposal is NOT expanded (codex pass-through)', async () => {
    const acp = makeAliveAcpClient()
    const key = compositeKey(connId, chatId, agentId)
    store.set(key, {
      sessionId: 'sess-1',
      acpClient: acp as any,
      agentName: 'TestAgent',
      agentIcon: '',
      cwd: '/tmp',
      provider: 'codex',
      connectionId: connId,
      chatId,
    })

    const deps = buildDeps()
    deps.ensureAttachedRunning.mockReturnValue(store.get(key))
    const { handleDirectInput } = createExpertDirectInput(deps)

    await handleDirectInput(makeWs(), {
      chatId,
      agentId,
      message: '/openspec:proposal',
      autoStart: true,
    }, connId)

    expect(acp.prompt).toHaveBeenCalledTimes(1)
    const [, promptText] = acp.prompt.mock.calls[0]
    expect(promptText).toBe('/openspec:proposal')
  })

  it('cold start: /openspec:proposal is passed to handleStart (expansion happens there)', async () => {
    const { handleDirectInput } = createExpertDirectInput(buildDeps())

    await handleDirectInput(makeWs(), {
      chatId,
      agentId,
      message: '/openspec:proposal build it',
      autoStart: true,
    }, connId)

    expect(handleStart).toHaveBeenCalledTimes(1)
    const payload = handleStart.mock.calls[0][1]
    expect(payload.task).toBe('/openspec:proposal build it')
  })

  it('regular messages (no slash) pass through unchanged', async () => {
    const acp = makeAliveAcpClient()
    const key = compositeKey(connId, chatId, agentId)
    store.set(key, {
      sessionId: 'sess-1',
      acpClient: acp as any,
      agentName: 'TestAgent',
      agentIcon: '',
      cwd: '/tmp',
      provider: 'claude',
      connectionId: connId,
      chatId,
    })

    const deps = buildDeps()
    deps.ensureAttachedRunning.mockReturnValue(store.get(key))
    const { handleDirectInput } = createExpertDirectInput(deps)

    await handleDirectInput(makeWs(), {
      chatId,
      agentId,
      message: 'Fix the login bug please',
      autoStart: true,
    }, connId)

    expect(acp.prompt).toHaveBeenCalledTimes(1)
    const [, promptText] = acp.prompt.mock.calls[0]
    expect(promptText).toBe('Fix the login bug please')
  })
})
