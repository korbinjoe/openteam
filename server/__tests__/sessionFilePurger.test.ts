import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs, writeFileSync, symlinkSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const TMP_HOME = join(tmpdir(), `openteam-purger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)

vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os')
  return { ...actual, homedir: () => TMP_HOME }
})

let purger: typeof import('../services/sessionFilePurger')

beforeEach(async () => {
  vi.resetModules()
  await fs.mkdir(TMP_HOME, { recursive: true })
  purger = await import('../services/sessionFilePurger')
})

afterEach(async () => {
  await fs.rm(TMP_HOME, { recursive: true, force: true })
})

describe('sessionFilePurger', () => {
  describe('resolveExpertSessionJsonl', () => {
    it('claude path uses cwdToClaudeProjectKey + cliSessionId', () => {
      const { path, provider } = purger.resolveExpertSessionJsonl({
        cliSessionId: 'session-abc',
        cwd: '/Users/test/repo',
        provider: 'claude',
      })
      expect(provider).toBe('claude')
      expect(path).toBe(join(TMP_HOME, '.claude', 'projects', '-Users-test-repo', 'session-abc.jsonl'))
    })

    it('defaults to claude when provider is omitted', () => {
      const { provider } = purger.resolveExpertSessionJsonl({
        cliSessionId: 'session-x',
        cwd: '/tmp/x',
      })
      expect(provider).toBe('claude')
    })

    it('codex path uses locateCodexRollout (returns null when missing)', () => {
      const { path, provider } = purger.resolveExpertSessionJsonl({
        cliSessionId: '00000000-0000-0000-0000-000000000000',
        cwd: '/tmp',
        provider: 'codex',
      })
      expect(provider).toBe('codex')
      expect(path).toBeNull()
    })
  })

  describe('purgeExpertSessionJsonl', () => {
    it('unlinks an existing claude jsonl', () => {
      const dir = join(TMP_HOME, '.claude', 'projects', '-Users-test-repo')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'session-abc.jsonl')
      writeFileSync(file, '{}')

      const result = purger.purgeExpertSessionJsonl({
        cliSessionId: 'session-abc',
        cwd: '/Users/test/repo',
        provider: 'claude',
      }, { chatId: 'c1', agentId: 'a1' })

      expect(result.deleted).toBe(true)
      expect(result.path).toBe(file)
      expect(result.agentId).toBe('a1')
      expect(existsSync(file)).toBe(false)
    })

    it('returns deleted=false with no error when file is already missing', () => {
      const result = purger.purgeExpertSessionJsonl({
        cliSessionId: 'never-existed',
        cwd: '/Users/test/repo',
        provider: 'claude',
      })
      expect(result.deleted).toBe(false)
      expect(result.error).toBeUndefined()
    })

    it('refuses to follow a symlink', () => {
      const dir = join(TMP_HOME, '.claude', 'projects', '-Users-test-repo')
      mkdirSync(dir, { recursive: true })
      const target = join(TMP_HOME, 'sensitive.txt')
      writeFileSync(target, 'KEEP')
      const link = join(dir, 'session-link.jsonl')
      symlinkSync(target, link)

      const result = purger.purgeExpertSessionJsonl({
        cliSessionId: 'session-link',
        cwd: '/Users/test/repo',
        provider: 'claude',
      })

      expect(result.deleted).toBe(false)
      expect(result.error).toMatch(/symlink/)
      expect(existsSync(target)).toBe(true)
      expect(existsSync(link)).toBe(true)
    })

    it('rejects path outside allowed prefix (path traversal via cwd)', () => {
      const outside = join(TMP_HOME, 'outside.jsonl')
      writeFileSync(outside, 'PROTECT')

      // craft a cwd whose projectKey resolves outside ~/.claude/projects/
      // cwdToClaudeProjectKey replaces / and . with - so traversal via that
      // path is structurally blocked; we still verify with an absolute escape
      const result = purger.purgeExpertSessionJsonl({
        cliSessionId: '../../outside',
        cwd: '/x',
        provider: 'claude',
      })

      expect(result.deleted).toBe(false)
      expect(result.error).toMatch(/outside allowed prefix/)
      expect(existsSync(outside)).toBe(true)
    })

    it('codex provider returns deleted=false when rollout cannot be located', () => {
      const result = purger.purgeExpertSessionJsonl({
        cliSessionId: 'unknown-thread',
        cwd: '/tmp',
        provider: 'codex',
      })
      expect(result.deleted).toBe(false)
      expect(result.path).toBeNull()
    })

    it('unlinks an existing codex rollout located by threadId', () => {
      const today = new Date()
      const yyyy = String(today.getUTCFullYear())
      const mm = String(today.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(today.getUTCDate()).padStart(2, '0')
      const dir = join(TMP_HOME, '.codex', 'sessions', yyyy, mm, dd)
      mkdirSync(dir, { recursive: true })
      const threadId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
      const file = join(dir, `rollout-2026-05-24T10-00-00-${threadId}.jsonl`)
      writeFileSync(file, '{}')

      const result = purger.purgeExpertSessionJsonl({
        cliSessionId: threadId,
        cwd: '/tmp',
        provider: 'codex',
      })

      expect(result.deleted).toBe(true)
      expect(result.path).toBe(file)
      expect(existsSync(file)).toBe(false)
    })
  })
})
