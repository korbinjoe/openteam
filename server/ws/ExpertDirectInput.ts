import type { WebSocket } from 'ws'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ExpertSessionStore, ExpertEntry } from './ExpertSessionStore'
import { compositeKey } from './ExpertSessionStore'
import type { ChatStore } from '../stores/ChatStore'
import type { SessionRegistry } from '../terminal/SessionRegistry'
import type { ChatTitleService } from '../services/chat/ChatTitleService'
import { silentlyIgnore } from '../lib/silentlyIgnore'
import { createLogger } from '../lib/logger'
import { expandSlashCommand } from '../runtime/SlashCommandResolver'
import { trackEvent } from '../lib/eventTracker'
import { cwdToClaudeProjectKey } from '../../shared/projectKey'
import { isPlaceholderTitle } from '../../shared/placeholderTitles'

const log = createLogger('Expert')

type StartPayload = {
  agentId: string; task?: string
  images?: Array<{ data: string; mediaType: string }>
  cwd?: string
  repositories?: Array<{ path: string }>; resumeSessionId?: string
  chatId?: string; cols?: number; rows?: number
  previousContext?: { agentName: string; lastMessage?: string; jsonlPath?: string }
}

export interface ExpertDirectInputDeps {
  store: ExpertSessionStore
  chatStore: ChatStore
  sessionRegistry: SessionRegistry
  titleService: ChatTitleService
  broadcastToChat: (chatId: string, msg: Record<string, unknown>) => void
  ensureAttachedRunning: (ws: WebSocket, chatId: string, agentId: string, connectionId: string) => ExpertEntry | undefined
  trackParticipant: (agentId: string, connectionId: string, chatId: string) => void
  handleStart: (ws: WebSocket, payload: StartPayload, connectionId: string) => Promise<void>
}

export const createExpertDirectInput = (deps: ExpertDirectInputDeps) => {
  const { store, chatStore, titleService, broadcastToChat, ensureAttachedRunning, trackParticipant, handleStart } = deps

  const titleInProgress = new Set<string>()

  const handleDirectInput = async (
    ws: WebSocket,
    payload: { chatId?: string; agentId: string; message: string; images?: Array<{ data: string; mediaType: string }>; autoStart?: boolean; cwd?: string; repositories?: Array<{ path: string }>; cols?: number; rows?: number; previousContext?: { agentName: string; lastMessage?: string; jsonlPath?: string } },
    connectionId: string,
  ): Promise<void> => {
    const { agentId, message, images, autoStart = true } = payload
    const chatId = payload.chatId
    if (!chatId) {
      log.error('expert:direct-input missing chatId', { connectionId, agentId })
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: { agentId, chatId: '', error: 'missing_chat_id', message: 'expert:direct-input payload must carry chatId' },
      }))
      return
    }
    const key = compositeKey(connectionId, chatId, agentId)
    const existing = ensureAttachedRunning(ws, chatId, agentId, connectionId) || store.get(key)

    const cleanMessage = message.trim()

    if (cleanMessage && chatId && !titleInProgress.has(chatId)) {
      const chat = chatStore.get(chatId)
      if (chat && isPlaceholderTitle(chat.title)) {
        titleInProgress.add(chatId)
        const truncated = cleanMessage.length > 50 ? cleanMessage.slice(0, 50) + '…' : cleanMessage
        silentlyIgnore(() => chatStore.update(chatId, { title: truncated }), 'auto-title truncated update')
        broadcastToChat(chatId, { type: 'chat:title-updated', payload: { chatId, title: truncated } })
        silentlyIgnore(async () => {
          try {
            const semantic = await titleService.generate(cleanMessage)
            if (semantic) {
              await silentlyIgnore(() => chatStore.update(chatId, { title: semantic }), 'auto-title semantic update')
              broadcastToChat(chatId, { type: 'chat:title-updated', payload: { chatId, title: semantic } })
            }
          } finally {
            titleInProgress.delete(chatId)
          }
        }, 'auto-title semantic generation')
      }
    }

    const isExistingAlive = existing
      ? existing.acpClient.isAlive()
      : false

    if (existing && isExistingAlive) {
      const chatModelNow = chatId ? chatStore.get(chatId)?.model : undefined
      const modelChanged = chatModelNow && existing.model && chatModelNow !== existing.model

      if (modelChanged) {
        log.info('Model changed, restarting agent', { agentId, chatId, oldModel: existing.model, newModel: chatModelNow })
        const session = deps.sessionRegistry.get(existing.sessionId)
        if (session) session.killReason = 'model_switch'
        existing.acpClient.destroy()
        deps.sessionRegistry.remove(existing.sessionId)
        store.cleanup(key)
      } else {
        if (!cleanMessage) {
          trackParticipant(agentId, connectionId, chatId)
          return
        }

        const promptText = existing.provider === 'claude'
          ? await expandSlashCommand(cleanMessage, existing.cwd)
          : cleanMessage
        log.info('Sending message via ACP', { agentId, chatId, sessionId: existing.sessionId, messageLen: promptText.length, imageCount: images?.length ?? 0, expanded: promptText !== cleanMessage })
        existing.acpClient.prompt(existing.sessionId, promptText, images?.map(i => ({ data: i.data, mimeType: i.mediaType }))).catch(err => {
          const errorMsg = err instanceof Error ? err.message : String(err)
          log.warn('ACP prompt failed', { agentId, chatId, error: errorMsg })
          trackEvent('agent', 'agent.acp_prompt_failed', { agentId, chatId, error: errorMsg })
          broadcastToChat(chatId, {
            type: 'expert:error',
            payload: { agentId, chatId, error: 'acp_prompt_failed', message: `Failed to send message: ${errorMsg}` },
          })
        })
        trackParticipant(agentId, connectionId, chatId)
        return
      }
    }

    if (!existing && store.isStarting(key)) {
      if (cleanMessage) {
        store.enqueuePendingTask(key, {
          task: cleanMessage,
          images,
          enqueuedAt: Date.now(),
          connectionId,
        })
      }
      log.info('Agent is starting, queuing message', { agentId })
      trackParticipant(agentId, connectionId, chatId)
      return
    }

    if (!autoStart) {
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: { agentId, chatId, message: `Expert ${agentId} is not running` },
      }))
      return
    }

    let resumeSessionId: string | undefined
    let effectiveCwd = payload.cwd
    if (chatId) {
      const chat = chatStore.get(chatId)
      const oldSession = chat?.expertSessions?.[agentId]
      if (oldSession) {
        const oldCliSessionId = typeof oldSession === 'string'
          ? oldSession
          : oldSession.cliSessionId
        const sessionCwd = (typeof oldSession === 'object' && oldSession.cwd) || effectiveCwd || process.cwd()
        if (oldCliSessionId) {
          const projectKey = cwdToClaudeProjectKey(sessionCwd)
          const jsonlPath = join(homedir(), '.claude', 'projects', projectKey, `${oldCliSessionId}.jsonl`)
          if (existsSync(jsonlPath)) {
            resumeSessionId = oldCliSessionId
            if (!effectiveCwd) effectiveCwd = sessionCwd
            log.info('Resuming dead expert with --resume', { agentId, chatId, resumeSessionId, jsonlPath })
          }
        }
      }
    }

    await handleStart(ws, {
      agentId,
      task: cleanMessage,
      images,
      cwd: effectiveCwd,
      repositories: payload.repositories,
      resumeSessionId,
      chatId,
      cols: payload.cols,
      rows: payload.rows,
      previousContext: payload.previousContext,
    }, connectionId)

    trackParticipant(agentId, connectionId, chatId)
  }

  return { handleDirectInput }
}
