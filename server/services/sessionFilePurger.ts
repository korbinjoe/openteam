/**
 * sessionFilePurger — best-effort hard-delete of CLI JSONL files associated
 * with a chat's expert session.
 *
 * Resolves the JSONL path the same way chatRoutes' GET /sessions does:
 *   - claude → ~/.claude/projects/<projectKey>/<cliSessionId>.jsonl
 *   - codex  → ~/.codex/sessions/YYYY/MM/DD/rollout-*-<threadId>.jsonl (via locateCodexRollout)
 *
 * Path-prefix guard + symlink reject before any unlink.
 */

import { lstatSync, unlinkSync, existsSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import type { ExpertSessionInfo } from '../config/types'
import { cwdToClaudeProjectKey } from '../../shared/projectKey'
import { locateCodexRollout } from '../terminal/CodexRolloutLocator'
import { createLogger } from '../lib/logger'

const log = createLogger('SessionFilePurger')

export interface PurgeResult {
  agentId?: string
  provider: 'claude' | 'codex'
  path: string | null
  deleted: boolean
  error?: string
}

const claudeRoot = (): string => resolve(join(homedir(), '.claude', 'projects'))
const codexRoot = (): string => resolve(join(homedir(), '.codex', 'sessions'))

const isWithin = (filePath: string, rootDir: string): boolean => {
  const normalized = resolve(filePath)
  const root = resolve(rootDir)
  return normalized === root || normalized.startsWith(root + '/')
}

export const resolveExpertSessionJsonl = (session: ExpertSessionInfo): { path: string | null; provider: 'claude' | 'codex' } => {
  const provider = session.provider || 'claude'
  if (provider === 'codex') {
    const found = locateCodexRollout(session.cliSessionId)
    return { path: found, provider: 'codex' }
  }
  const projectKey = cwdToClaudeProjectKey(session.cwd)
  const absPath = join(homedir(), '.claude', 'projects', projectKey, `${session.cliSessionId}.jsonl`)
  return { path: absPath, provider: 'claude' }
}

const unlinkSafe = (filePath: string, provider: 'claude' | 'codex'): PurgeResult => {
  const allowedRoot = provider === 'codex' ? codexRoot() : claudeRoot()
  if (!isWithin(filePath, allowedRoot)) {
    return { provider, path: filePath, deleted: false, error: 'path outside allowed prefix' }
  }
  if (!existsSync(filePath)) {
    return { provider, path: filePath, deleted: false }
  }
  try {
    const stat = lstatSync(filePath)
    if (stat.isSymbolicLink()) {
      return { provider, path: filePath, deleted: false, error: 'refuse to follow symlink' }
    }
    if (!stat.isFile()) {
      return { provider, path: filePath, deleted: false, error: 'not a regular file' }
    }
    unlinkSync(filePath)
    return { provider, path: filePath, deleted: true }
  } catch (err) {
    return { provider, path: filePath, deleted: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export const purgeExpertSessionJsonl = (session: ExpertSessionInfo, ctx?: { chatId?: string; agentId?: string }): PurgeResult => {
  const { path, provider } = resolveExpertSessionJsonl(session)
  if (!path) {
    const result: PurgeResult = { provider, path: null, deleted: false }
    log.info('Purge skipped — JSONL not found', { ...ctx, provider, cliSessionId: session.cliSessionId })
    return ctx?.agentId ? { ...result, agentId: ctx.agentId } : result
  }
  const result = unlinkSafe(path, provider)
  const enriched = ctx?.agentId ? { ...result, agentId: ctx.agentId } : result
  if (result.deleted) {
    log.info('Purged JSONL', { ...ctx, provider, path })
  } else if (result.error) {
    log.warn('Failed to purge JSONL', { ...ctx, provider, path, error: result.error })
  } else {
    log.info('Purge no-op (file already absent)', { ...ctx, provider, path })
  }
  return enriched
}
