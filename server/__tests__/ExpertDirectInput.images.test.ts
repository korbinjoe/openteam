import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createExpertDirectInput } from '../ws/ExpertDirectInput'
import { ExpertSessionStore, compositeKey } from '../ws/ExpertSessionStore'
import type { ExpertDirectInputDeps } from '../ws/ExpertDirectInput'

const makeWs = () => ({ send: vi.fn(), readyState: 1 }) as any

const makeChatStore = (chat: any = { id: 'chat-1', title: 'Existing Title' }) => ({
  get: vi.fn(() => chat),
  update: vi.fn(),
}) as any

const makeTitleService = () => ({
  generate: vi.fn(async () => 'semantic'),
}) as any

const makeAliveAcpClient = () => ({
  isAlive: () => true,
  prompt: vi.fn(async () => ({})),
  write: vi.fn(),
  destroy: vi.fn(),
})

describe('ExpertDirectInput images transit', () => {
  let store: ExpertSessionStore
  let handleStart: ReturnType<typeof vi.fn>
  let broadcastToChat: ReturnType<typeof vi.fn>
  let trackParticipant: ReturnType<typeof vi.fn>
  let ensureAttachedRunning: ReturnType<typeof vi.fn>

  const connId = 'conn-1'
  const chatId = 'chat-1'
  const agentId = 'agent-1'
  const sampleImages = [
    { data: 'iVBORw0KG-fake1', mediaType: 'image/png' },
    { data: 'iVBORw0KG-fake2', mediaType: 'image/jpeg' },
  ]

  beforeEach(() => {
    store = new ExpertSessionStore()
    handleStart = vi.fn(async () => {})
    broadcastToChat = vi.fn()
    trackParticipant = vi.fn()
    ensureAttachedRunning = vi.fn(() => undefined)
  })

  const buildDeps = (overrides: Partial<ExpertDirectInputDeps> = {}): ExpertDirectInputDeps => ({
    store,
    chatStore: makeChatStore(),
    sessionRegistry: { get: vi.fn(), remove: vi.fn(), findByChat: vi.fn() } as any,
    titleService: makeTitleService(),
    broadcastToChat,
    ensureAttachedRunning,
    trackParticipant,
    handleStart,
    ...overrides,
  })

  it('cold start forwards images to handleStart', async () => {
    const { handleDirectInput } = createExpertDirectInput(buildDeps())

    await handleDirectInput(makeWs(), {
      chatId, agentId, message: 'look at this',
      images: sampleImages, autoStart: true,
    }, connId)

    expect(handleStart).toHaveBeenCalledTimes(1)
    const payload = handleStart.mock.calls[0][1]
    expect(payload.agentId).toBe(agentId)
    expect(payload.task).toBe('look at this')
    expect(payload.images).toEqual(sampleImages)
  })

  it('alive agent forwards images via acpClient.prompt (mimeType)', async () => {
    const acp = makeAliveAcpClient()
    const key = compositeKey(connId, chatId, agentId)
    store.set(key, {
      sessionId: 'sess-1', acpClient: acp as any,
      agentName: 'A', agentIcon: '🤖', cwd: '/tmp',
      connectionId: connId, chatId,
    })
    ensureAttachedRunning.mockReturnValue(store.get(key))

    const { handleDirectInput } = createExpertDirectInput(buildDeps())
    await handleDirectInput(makeWs(), {
      chatId, agentId, message: 'second message',
      images: sampleImages, autoStart: true,
    }, connId)

    expect(acp.prompt).toHaveBeenCalledTimes(1)
    expect(acp.prompt.mock.calls[0][0]).toBe('sess-1')
    expect(acp.prompt.mock.calls[0][1]).toBe('second message')
    expect(acp.prompt.mock.calls[0][2]).toEqual([
      { data: 'iVBORw0KG-fake1', mimeType: 'image/png' },
      { data: 'iVBORw0KG-fake2', mimeType: 'image/jpeg' },
    ])
    expect(handleStart).not.toHaveBeenCalled()
  })

  it('cold start without images leaves field undefined', async () => {
    const { handleDirectInput } = createExpertDirectInput(buildDeps())

    await handleDirectInput(makeWs(), {
      chatId, agentId, message: 'plain text', autoStart: true,
    }, connId)

    expect(handleStart).toHaveBeenCalledTimes(1)
    expect(handleStart.mock.calls[0][1].images).toBeUndefined()
  })
})
