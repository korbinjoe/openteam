/**
 * ExpertExitHandler - Agent
 *
 *  ExpertLifecycle
 * - Agent completed
 * - Agent started
 * - Resume
 * - fileCollector, tokenTracker, compiled cleanup
 */

import type { SessionRegistry } from '../terminal/SessionRegistry'
import type { ExecutionLogStore } from '../stores/ExecutionLogStore'
import type { ExpertSessionStore } from './ExpertSessionStore'
import type { ExpertTokenTracker } from './ExpertTokenTracker'
import type { FileOperationCollector } from '../terminal/FileOperationCollector'
import type { ActivityState } from '../terminal/ActivityDeriver'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ChatStore } from '../stores/ChatStore'
import type { AgentStore } from '../stores/AgentStore'
import { parseConversationFile } from '../terminal/ConversationParser'
import { acpUpdateToWSMessage } from '../acp/ACPToFrontendBridge'
import { cwdToClaudeProjectKey } from '../../shared/projectKey'
import { createLogger } from '../lib/logger'
import { trackEvent } from '../lib/eventTracker'

const log = createLogger('ExpertExit')

export interface ExitContext {
  agentId: string
  chatId: string
  sessionId: string
  key: string
  agentName: string
  resumeSessionId?: string
  startedSent: boolean
  fileCollector: FileOperationCollector
  tokenTracker: ExpertTokenTracker
  compiledCleanup: () => Promise<void>
}

export interface ExitHandlerDeps {
  sessionRegistry: SessionRegistry
  executionLogStore: ExecutionLogStore
  store: ExpertSessionStore
  chatStore: ChatStore
  agentStore?: AgentStore
  sendTo: (connectionId: string, msg: Record<string, unknown>) => void
  onExited?: (chatId: string, agentId: string, exitCode: number, taskCompleted: boolean) => void
}

export const createExpertExitHandler = (deps: ExitHandlerDeps) => {
  const { sessionRegistry, executionLogStore, store, chatStore, agentStore, sendTo, onExited } = deps

  const handleExit = (
    ctx: ExitContext,
    exitCode: number,
    signal?: number,
  ): void => {
    const { agentId, chatId, sessionId, agentName, fileCollector, tokenTracker, compiledCleanup } = ctx

    fileCollector.flushNow()
    fileCollector.destroy()
    tokenTracker.destroy()
    compiledCleanup().catch((err) => log.warn('Cleanup error', { error: err instanceof Error ? err.message : String(err) }))

    const currentKey = store.findBySessionId(sessionId)?.key ?? ctx.key
    const expertInfo = store.get(currentKey)
    const finalActivity = store.getActivity(currentKey)

    if (!expertInfo) {
      log.debug('Exit ignored — already cleaned up by chat switch', { agentId })
      return
    }

    const currentConnectionId = expertInfo.connectionId

    if (!ctx.startedSent) {
      log.warn('Agent exited before started was sent', { agentId, exitCode, sessionId })
      sendTo(currentConnectionId, {
        type: 'expert:start-failed',
        payload: { agentId, chatId, exitCode, message: `Agent exited immediately (code ${exitCode})` },
      })
      store.cleanup(currentKey)
      sendTo(currentConnectionId, {
        type: 'expert:list-updated',
        payload: { experts: store.getExpertListForConnection(currentConnectionId, chatId), chatId },
      })
      return
    }

    // Resume Failed
    if (ctx.resumeSessionId && exitCode !== 0) {
      log.warn('Resume failed, cleaning up runtime state', { agentId, resumeSessionId: ctx.resumeSessionId })
      const cwd = expertInfo?.cwd
      let jsonlPath: string | null = null
      if (cwd && ctx.resumeSessionId) {
        const projectKey = cwdToClaudeProjectKey(cwd)
        const candidatePath = join(homedir(), '.claude', 'projects', projectKey, `${ctx.resumeSessionId}.jsonl`)
        if (existsSync(candidatePath)) {
          jsonlPath = candidatePath
        } else {
          const chat = chatStore.get(chatId)
          if (chat?.expertSessions?.[agentId]) {
            const updatedSessions = { ...chat.expertSessions }
            delete updatedSessions[agentId]
            chatStore.update(chatId, { expertSessions: Object.keys(updatedSessions).length > 0 ? updatedSessions : undefined })
            log.info('Cleared dead expert session from DB', { agentId, chatId, resumeSessionId: ctx.resumeSessionId })
          }
        }
      }

      let replayed = false
      if (jsonlPath && ctx.resumeSessionId) {
        const messages = parseConversationFile(jsonlPath)
        if (messages.length > 0) {
          const agent = agentStore?.get(agentId)
          sessionRegistry.sendToSession(sessionId, {
            type: 'expert:started',
            payload: { agentId, chatId, sessionId, agentName: agent?.name || agentName, agentIcon: agent?.icon || '', status: 'completed' },
          })
          const wsMsg = acpUpdateToWSMessage({
            sessionUpdate: '_openteam/messages_batch',
            messages: messages as unknown as import('../../shared/acp-types').OpenTeamParsedMessage[],
            replacedStatsId: null,
            batchType: 'full',
          }, { agentId, sessionId, chatId })
          if (wsMsg) {
            sessionRegistry.sendToSession(sessionId, wsMsg as Record<string, unknown>)
          }
          sessionRegistry.sendToSession(sessionId, {
            type: 'expert:exit',
            payload: { agentId, chatId, exitCode: 0 },
          })
          replayed = true
          log.info('Resume failed but replayed from JSONL', { agentId, chatId, messageCount: messages.length })
        }
      }

      if (!replayed) {
        sessionRegistry.sendToSession(sessionId, {
          type: 'expert:resume-failed',
          payload: { agentId, chatId, agentName, sessionId, reason: 'session_expired' },
        })
      }

      store.cleanup(currentKey)
      sessionRegistry.sendToSession(sessionId, {
        type: 'expert:list-updated',
        payload: { experts: store.getExpertListForConnection(currentConnectionId, chatId), chatId },
      })
      return
    }

    store.setCompleted(currentKey, {
      sessionId: expertInfo.sessionId,
      agentName: expertInfo.agentName,
      agentIcon: expertInfo.agentIcon,
      exitCode,
      completedAt: new Date().toISOString(),
      connectionId: currentConnectionId,
      chatId: expertInfo.chatId,
    })

    trackEvent('agent', 'agent.exited', { agentId, exitCode, chatId: expertInfo.chatId, connectionId: currentConnectionId })

    const taskCompleted = finalActivity?.phase !== 'error'

    const chat = chatStore.get(chatId)
    if (chat?.expertSessions?.[agentId]) {
      const updatedSessions = { ...chat.expertSessions }
      updatedSessions[agentId] = { ...updatedSessions[agentId], exitCode, taskCompleted }
      chatStore.update(chatId, { expertSessions: updatedSessions }).catch((err) =>
        log.warn('Failed to persist exitCode', { agentId, error: err instanceof Error ? err.message : String(err) }),
      )
    }

    const execLogId = store.getMeta(currentKey, 'executionLogId') as string | undefined
    if (execLogId) {
      const status = taskCompleted ? 'completed' as const : 'error' as const
      const duration = expertInfo.sessionId ? Date.now() - (sessionRegistry.get(expertInfo.sessionId)?.createdAt || Date.now()) : undefined
      const totalCost = finalActivity?.cost
      const tokenSums = finalActivity?.modelUsage?.reduce((acc, u) => ({
        input: acc.input + u.inputTokens,
        output: acc.output + u.outputTokens,
        cacheRead: acc.cacheRead + u.cacheReadInputTokens,
        cacheCreation: acc.cacheCreation + u.cacheCreationInputTokens,
      }), { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })
      executionLogStore.update(execLogId, {
        status,
        completedAt: new Date().toISOString(),
        duration,
        toolCalls: finalActivity?.toolCompleted || 0,
        totalCost,
        inputTokens: tokenSums?.input || 0,
        outputTokens: tokenSums?.output || 0,
        cacheReadTokens: tokenSums?.cacheRead || 0,
        cacheCreationTokens: tokenSums?.cacheCreation || 0,
      }).catch((err) => {
        log.warn('Failed to update execution log', { execLogId, error: err instanceof Error ? err.message : String(err) })
      })
    }

    sessionRegistry.sendToSession(sessionId, {
      type: 'expert:exit',
      payload: { agentId, chatId, sessionId, exitCode, signal, finalActivity },
    })

    store.cleanup(currentKey)

    sendTo(currentConnectionId, {
      type: 'expert:list-updated',
      payload: { experts: store.getExpertListForConnection(currentConnectionId, chatId), chatId },
    })

    if (onExited) {
      onExited(chatId, agentId, exitCode, taskCompleted)
    }
  }

  return { handleExit }
}
