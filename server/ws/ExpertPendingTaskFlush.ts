/**
 * Drain the pending-task queue for a given key and dispatch each entry
 * to the agent via `acpClient.prompt`. Used at provider-specific readiness
 * boundaries (Claude: `cli-session-id` event; Codex: after `markReady`).
 *
 * Drain failures surface as `expert:error { error: 'pending_task_failed' }`
 * routed via the session registry so whoever is currently watching the
 * session sees the failure. Loss reasons handled by the store itself
 * (TTL, cleanup, stop) go through `ExpertSessionStore.onPendingTaskLoss`
 * and are surfaced by ExpertHandler — not here.
 */

import type { ACPClient } from '../acp/ACPClient'
import type { SessionRegistry } from '../terminal/SessionRegistry'
import type { ExpertSessionStore } from './ExpertSessionStore'
import { expandSlashCommand } from '../runtime/SlashCommandResolver'
import { createLogger } from '../lib/logger'

const log = createLogger('ExpertPendingTaskFlush')

export interface FlushDeps {
  store: ExpertSessionStore
  acpClient: ACPClient
  sessionRegistry: SessionRegistry
  sessionId: string
  key: string
  agentId: string
  chatId: string
}

export const flushPendingTasks = (deps: FlushDeps): void => {
  const { store, acpClient, sessionRegistry, sessionId, key, agentId, chatId } = deps
  const drained = store.drainPendingTasks(key)
  if (drained.length === 0) return

  log.info('Flushing pending tasks', { agentId, chatId, count: drained.length })

  const entry = store.get(key)
  const shouldExpand = entry?.provider === 'claude'
  const cwd = entry?.cwd ?? ''

  for (const queued of drained) {
    const images = queued.images?.map(img => ({ data: img.data, mimeType: img.mediaType }))
    const promptPromise = shouldExpand
      ? expandSlashCommand(queued.task, cwd)
      : Promise.resolve(queued.task)

    promptPromise
      .then((text) => acpClient.prompt(sessionId, text, images))
      .catch((err: unknown) => {
        const errorMsg = err instanceof Error ? err.message : String(err)
        log.warn('Pending-task prompt failed', { agentId, chatId, error: errorMsg })
        sessionRegistry.sendToSession(sessionId, {
          type: 'expert:error',
          payload: {
            agentId,
            chatId,
            error: 'pending_task_failed',
            task: queued.task,
            message: `Failed to deliver queued message: ${errorMsg}`,
          },
        })
      })
  }
}
