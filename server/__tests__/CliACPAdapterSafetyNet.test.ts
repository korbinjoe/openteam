/**
 * Verify: CliACPAdapter.handleSessionPrompt() expands raw slash commands
 * before writing to CLI stdin — the definitive safety net.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdir, writeFile, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

const FAKE_HOME = join(tmpdir(), `adapter-safety-${Date.now()}`)

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => FAKE_HOME }
})

const { setProjectRoot } = await import('../runtime/SlashCommandResolver')

const PROJECT_ROOT = join(FAKE_HOME, 'project')

beforeAll(async () => {
  await mkdir(join(PROJECT_ROOT, '.claude', 'commands', 'openspec'), { recursive: true })
  await writeFile(
    join(PROJECT_ROOT, '.claude', 'commands', 'openspec', 'apply.md'),
    '---\nname: Apply\n---\nExpanded apply body here.\n',
    'utf-8',
  )
  setProjectRoot(PROJECT_ROOT)
})

afterAll(async () => {
  await rm(FAKE_HOME, { recursive: true, force: true }).catch(() => {})
})

describe('CliACPAdapter safety-net slash expansion', () => {
  it('expands /openspec:apply before writing to stdin', async () => {
    const writtenTexts: string[] = []
    const fakeStreamManager = {
      getSessionId: () => 'test-session-1',
      on: vi.fn(),
      write: vi.fn((text: string) => { writtenTexts.push(text) }),
      isAlive: () => true,
      kill: vi.fn(),
      spawn: vi.fn(),
      getCurrentMessages: () => null,
      getPid: () => 1234,
      getCliSessionId: () => null,
      listenerCount: () => 0,
      emit: vi.fn(),
    }

    const { CliACPAdapter } = await import('../acp/CliACPAdapter')
    const adapter = new CliACPAdapter(fakeStreamManager as any, {
      command: 'claude',
      baseArgs: [],
      provider: 'claude',
      cwd: PROJECT_ROOT,
    })

    // Force state to active so handleSessionPrompt works
    adapter.handleInitialize({ clientInfo: { name: 'test', version: '1' } })
    ;(adapter as any)._state = 'active'

    // Send raw slash command — the adapter should expand it
    const resultPromise = adapter.handleSessionPrompt({
      sessionId: 'test-session-1',
      prompt: [{ type: 'text', text: '/openspec:apply build the feature' }],
    })

    // The promise won't resolve (no CLI to respond), but we can check what was written
    // Give it a tick to process
    await new Promise(r => setTimeout(r, 50))

    expect(fakeStreamManager.write).toHaveBeenCalledTimes(1)
    const written = fakeStreamManager.write.mock.calls[0][0]

    // Must NOT be the raw slash command
    expect(written.startsWith('/openspec:apply')).toBe(false)
    // Must contain the expanded body
    expect(written).toContain('Expanded apply body here.')
    // Must contain user arguments
    expect(written).toContain('build the feature')
    // Must have OT_SLASH marker
    expect(written).toMatch(/<!--OT_SLASH:/)
  })

  it('passes through regular text without modification', async () => {
    const fakeStreamManager = {
      getSessionId: () => 'test-session-2',
      on: vi.fn(),
      write: vi.fn(),
      isAlive: () => true,
      kill: vi.fn(),
      spawn: vi.fn(),
      getCurrentMessages: () => null,
      getPid: () => 1234,
      getCliSessionId: () => null,
      listenerCount: () => 0,
      emit: vi.fn(),
    }

    const { CliACPAdapter } = await import('../acp/CliACPAdapter')
    const adapter = new CliACPAdapter(fakeStreamManager as any, {
      command: 'claude',
      baseArgs: [],
      provider: 'claude',
      cwd: PROJECT_ROOT,
    })

    adapter.handleInitialize({ clientInfo: { name: 'test', version: '1' } })
    ;(adapter as any)._state = 'active'

    adapter.handleSessionPrompt({
      sessionId: 'test-session-2',
      prompt: [{ type: 'text', text: 'Fix the login bug please' }],
    })

    await new Promise(r => setTimeout(r, 50))

    expect(fakeStreamManager.write).toHaveBeenCalledTimes(1)
    expect(fakeStreamManager.write.mock.calls[0][0]).toBe('Fix the login bug please')
  })

  it('does NOT expand for codex provider', async () => {
    const fakeStreamManager = {
      getSessionId: () => 'test-session-3',
      on: vi.fn(),
      write: vi.fn(),
      isAlive: () => true,
      kill: vi.fn(),
      spawn: vi.fn(),
      getCurrentMessages: () => null,
      getPid: () => 1234,
      getCliSessionId: () => null,
      listenerCount: () => 0,
      emit: vi.fn(),
    }

    const { CliACPAdapter } = await import('../acp/CliACPAdapter')
    const adapter = new CliACPAdapter(fakeStreamManager as any, {
      command: 'codex',
      baseArgs: [],
      provider: 'codex',
      cwd: PROJECT_ROOT,
    })

    adapter.handleInitialize({ clientInfo: { name: 'test', version: '1' } })
    ;(adapter as any)._state = 'active'

    adapter.handleSessionPrompt({
      sessionId: 'test-session-3',
      prompt: [{ type: 'text', text: '/openspec:apply' }],
    })

    await new Promise(r => setTimeout(r, 50))

    expect(fakeStreamManager.write).toHaveBeenCalledTimes(1)
    // Codex should pass through raw
    expect(fakeStreamManager.write.mock.calls[0][0]).toBe('/openspec:apply')
  })
})
