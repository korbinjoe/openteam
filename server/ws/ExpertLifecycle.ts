/**
 * ExpertLifecycle - Expert Agent
 *
 *  ExpertHandler
 * - Expert spawn stream-json  SessionRegistry
 * - handleDirectInput
 *
 * Token  → ExpertTokenTracker.ts
 *  → ExpertAttacher.ts
 */

import type { WebSocket } from 'ws'
import { StreamJsonManager } from '../terminal/StreamJsonManager'
import { ConfigCompiler } from '../runtime/ConfigCompiler'
import type { AgentRegistry } from '../config/AgentRegistry'
import type { AgentStore } from '../stores/AgentStore'
import { agentDefToAgent } from '../config/types'
import type { SessionRegistry } from '../terminal/SessionRegistry'
import { getServerPort } from '../lib/serverPort'
import type { ChatStore } from '../stores/ChatStore'
import type { TokenUsageStore } from '../stores/TokenUsageStore'
import type { ExecutionLogStore } from '../stores/ExecutionLogStore'
import { ExpertSessionStore, compositeKey } from './ExpertSessionStore'
import { createExpertAttacher, type ExpertAttacherDeps } from './ExpertAttacher'
import { createExpertExitHandler, type ExitHandlerDeps } from './ExpertExitHandler'
import { createExpertDirectInput } from './ExpertDirectInput'
import { wireExpertStreamHandlers } from './ExpertEventWiring'
import { flushPendingTasks } from './ExpertPendingTaskFlush'
import type { MailboxManager } from '../mailbox/MailboxManager'
import type { WhiteboardManager } from '../whiteboard/WhiteboardManager'
import { ContextBriefing } from '../whiteboard/ContextBriefing'
import { isWhiteboardOnDemandEnabled } from '../runtime/featureFlags'
import { createLogger } from '../lib/logger'
import { trackEvent } from '../lib/eventTracker'
import { isAllowedCwd } from '../lib/validateCwd'
import type { VersionGate } from '../services/update/VersionGate'
import { ChatTitleService } from '../services/chat/ChatTitleService'
import { ACPClient } from '../acp/ACPClient'
import { createACPAdapter } from '../acp/ACPAdapterFactory'

const log = createLogger('Expert')

export interface ExpertLifecycleDeps {
  configCompiler: ConfigCompiler
  agentRegistry: AgentRegistry
  agentStore: AgentStore
  chatStore: ChatStore
  tokenUsageStore: TokenUsageStore
  executionLogStore: ExecutionLogStore
  sessionRegistry: SessionRegistry
  store: ExpertSessionStore
  versionGate: VersionGate
  getConnectionWs: (connectionId: string) => WebSocket | undefined
  getConnectionChatId: (connectionId: string) => string | undefined
  sendTo: (connectionId: string, msg: Record<string, unknown>) => void
  persistExpertSession: (agentId: string, cliSessionId: string, cwd: string, connectionId: string, provider?: import('../config/types').CliProvider, chatId?: string) => void
  broadcastToChat: (chatId: string, msg: Record<string, unknown>) => void
  /**  WS  GlobalTaskContext  chat  chat:permission-request */
  globalBroadcast?: (msg: Record<string, unknown>) => void
  mailboxManager?: MailboxManager
  whiteboardManager?: WhiteboardManager
}

export const createExpertLifecycle = (deps: ExpertLifecycleDeps) => {
  const {
    configCompiler, agentRegistry, agentStore, chatStore, tokenUsageStore,
    executionLogStore, sessionRegistry, store, versionGate, sendTo,
    persistExpertSession, getConnectionChatId, broadcastToChat, globalBroadcast, mailboxManager,
    whiteboardManager,
  } = deps

  const titleService = new ChatTitleService()
  const briefing = whiteboardManager ? new ContextBriefing(whiteboardManager) : null

  const attacherDeps: ExpertAttacherDeps = { sessionRegistry, chatStore, store, getConnectionChatId, sendTo }
  const { trackParticipant, ensureAttachedRunning } = createExpertAttacher(attacherDeps)

  const exitDeps: ExitHandlerDeps = { sessionRegistry, executionLogStore, store, chatStore, agentStore, sendTo, mailboxManager }
  const { handleExit } = createExpertExitHandler(exitDeps)

  const handleStart = async (
    ws: WebSocket,
    payload: { agentId: string; task?: string; images?: Array<{ data: string; mediaType: string }>; cwd?: string; repositories?: Array<{ path: string }>; resumeSessionId?: string; chatId?: string; cols?: number; rows?: number; previousContext?: { agentName: string; lastMessage?: string; jsonlPath?: string } },
    connectionId: string,
  ): Promise<void> => {
    try {
      const { agentId, task } = payload
      const chatId = payload.chatId
      if (!chatId) {
        log.error('expert:start missing chatId', { connectionId, agentId })
        ws.send(JSON.stringify({
          type: 'expert:error',
          payload: { agentId, chatId: '', error: 'missing_chat_id', message: 'expert:start payload must carry chatId' },
        }))
        return
      }
      const key = compositeKey(connectionId, chatId, agentId)

      const isVirtualConnection = connectionId.startsWith('matrix-task-')

      if (versionGate.isBlocked()) {
        const policy = versionGate.getPolicy()
        log.warn('Expert start blocked: client version too low', {
          agentId, chatId,
          clientVersion: versionGate.getClientVersion(),
          minClientVersion: policy?.minClientVersion,
        })
        ws.send(JSON.stringify({
          type: 'expert:version-blocked',
          payload: {
            agentId,
            chatId,
            clientVersion: versionGate.getClientVersion(),
            minClientVersion: policy?.minClientVersion ?? '',
            upgradeMessage: policy?.upgradeMessage,
            upgradeUrl: policy?.upgradeUrl,
          },
        }))
        return
      }

      const crossSession = sessionRegistry.findByChat(chatId, agentId)
      if (crossSession && crossSession.connectionId !== connectionId) {
        log.warn('Killing duplicate agent on different connection before spawn', {
          chatId, agentId,
          existingConnectionId: crossSession.connectionId,
          newConnectionId: connectionId,
        })
        crossSession.killReason = 'user_stop'
        crossSession.streamManager.kill()
      }

      if (store.isStarting(key)) {
        // Duplicate expert:start during the starting window — the original
        // handleStart's initial-task dispatch already covers this task,
        // so do not enqueue it again. Direct user input arriving during
        // starting goes through ExpertDirectInput, which does enqueue.
        log.info('Agent already starting, skipping duplicate', { agentId })
        return
      }

      const existing = store.get(key)
      if (existing) {
        if (existing.acpClient.isAlive()) {
          log.info('Agent already running', { agentId, sessionId: existing.sessionId })
          ws.send(JSON.stringify({
            type: 'expert:already-running',
            payload: {
              agentId,
              chatId,
              model: existing.model,
              sessionId: existing.sessionId,
              agentName: existing.agentName,
              agentIcon: existing.agentIcon,
              status: 'running',
            },
          }))
          return
        }
        log.warn('Agent in store but process is dead, cleaning up', { agentId })
        store.cleanup(key)
      }

      const attached = ensureAttachedRunning(ws, chatId, agentId, connectionId)
      if (attached) {
        if (task?.trim()) {
          if (!attached.cliSessionId && attached.provider !== 'codex') {
            store.enqueuePendingTask(key, {
              task: task.trim(),
              images: payload.images,
              enqueuedAt: Date.now(),
              connectionId,
            })
          } else {
            attached.acpClient.write(task.trim(), payload.images)
          }
        }
        return
      }

      store.markStarting(key)

      const agentDef = agentRegistry.get(agentId)
      const storedAgent = !agentDef ? agentStore.get(agentId) : undefined
      if (!agentDef && !storedAgent) {
        ws.send(JSON.stringify({
          type: 'expert:error',
          payload: { agentId, chatId, message: `Expert ${agentId} not found` },
        }))
        store.clearStarting(key)
        return
      }

      const agent = agentDef ? agentDefToAgent(agentDef) : storedAgent!

      if (chatId) {
        const chat = chatStore.get(chatId)
        if (chat?.model) {
          agent.model = chat.model
        }
      }

      const provider = agent.provider || 'claude'
      const streamManager = new StreamJsonManager()
      const sessionId = streamManager.getSessionId()
      const cwd = payload.cwd || process.cwd()

      if (!isAllowedCwd(cwd)) {
        log.warn('Expert start rejected: cwd outside allowed roots', { agentId, cwd, connectionId })
        ws.send(JSON.stringify({
          type: 'expert:start-failed',
          payload: { agentId, chatId, message: `Refused: cwd "${cwd}" is outside allowed workspace` },
        }))
        return
      }

      let acpClient: ACPClient

      const llmEnv: Record<string, string> = {}

      const availableExperts = agent.subAgentNames?.length
        ? agent.subAgentNames.map((name) => {
            const def = agentRegistry.get(name)
            return { name, description: def?.description || '' }
          })
        : undefined

      const parentChain: string[] = process.env.OPENTEAM_DISPATCH_CHAIN
        ? JSON.parse(process.env.OPENTEAM_DISPATCH_CHAIN)
        : []
      const dispatchChain = [...parentChain, agentId]

      const compiled = await configCompiler.compile(agent, {
        repositories: payload.repositories?.length ? payload.repositories : [{ path: cwd }],
        serverPort: getServerPort(),
        resumeSessionId: payload.resumeSessionId,
        connectionId,
        availableExperts,
        chatId,
        model: agent.model,
        instanceId: agentId,
        dispatchChain,
        previousContext: payload.previousContext,
      }, provider, llmEnv)

      if (provider === 'claude') {
        const effectiveSessionId = compiled.presetSessionId || payload.resumeSessionId
        if (effectiveSessionId) {
          streamManager.setCliSessionId(effectiveSessionId)
        }
      }

      const adapter = createACPAdapter(provider, streamManager, {
        command: compiled.command,
        baseArgs: compiled.args,
      })
      acpClient = new ACPClient(adapter)
      acpClient.initialize().catch((err) => {
        const errorMsg = err instanceof Error ? err.message : String(err)
        log.warn('ACP initialize failed', { agentId, sessionId, error: errorMsg })
        trackEvent('agent', 'agent.acp_initialize_failed', { agentId, sessionId, error: errorMsg })
        sendTo(connectionId, {
          type: 'expert:error',
          payload: { agentId, chatId, error: 'acp_initialize_failed', message: errorMsg },
        })
      })
      log.info('ACP client created for agent', { agentId, sessionId })

      sessionRegistry.register({
        sessionId,
        streamManager,
        acpClient,
        chatId,
        model: agent.model,
        agentId,
        agentName: agent.name,
        agentIcon: agent.icon,
        cwd,
        connectedWs: ws,
        connectionId,
        connectionType: isVirtualConnection ? 'virtual' : 'browser',
        activitySnapshot: null,
        createdAt: Date.now(),
        disconnectedAt: null,
      })

      let startedSent = false

      const { fileCollector, tokenTracker } = wireExpertStreamHandlers({
        streamManager, acpClient, sessionRegistry, store, chatStore, tokenUsageStore,
        mailboxManager, sessionId, key, agentId, chatId, agentName: agent.name, cwd, provider,
        persistExpertSession, connectionId, globalBroadcast, ws,
        onExit: (exitCode, signal, ctx) => {
          handleExit({
            agentId, chatId, sessionId, key, agentName: agent.name,
            resumeSessionId: payload.resumeSessionId,
            startedSent, fileCollector: ctx.fileCollector, tokenTracker: ctx.tokenTracker,
            compiledCleanup: () => compiled.cleanup(),
          }, exitCode, signal)
        },
      })

      const onDemandActive = isWhiteboardOnDemandEnabled()
      const wrappedTask = task && briefing && !onDemandActive
        ? briefing.maybeWrapTask(task, { chatId, agentId, agentName: agent.name, agentTags: agent.tags })
        : task

      const spawnArgs = compiled.args.slice()
      if (provider === 'codex' && wrappedTask) {
        spawnArgs.push(wrappedTask)
      }

      store.set(key, {
        sessionId,
        acpClient,
        agentName: agent.name,
        agentIcon: agent.icon,
        cwd,
        cliSessionId: payload.resumeSessionId,
        provider,
        connectionId,
        chatId,
        model: agent.model,
      })

      // Start stream-json Process
      await streamManager.spawn({
        command: compiled.command,
        args: spawnArgs,
        cwd: compiled.cwd,
        env: compiled.env,
        provider,
      })

      acpClient.markReady()

      store.clearStarting(key)

      sendTo(connectionId, {
        type: 'expert:started',
        payload: { agentId, chatId, sessionId, agentName: agent.name, agentIcon: agent.icon, status: 'running', cwd },
      })

      sendTo(connectionId, {
        type: 'expert:list-updated',
        payload: { experts: store.getExpertListForConnection(connectionId, chatId), chatId },
      })

      startedSent = true

      if (payload.resumeSessionId && provider === 'claude') {
        streamManager.emit('cli-session-id', payload.resumeSessionId)
      }

      if (task && wrappedTask) {
        const briefingInjected = wrappedTask !== task
        const initialImages = payload.images?.map(i => ({ data: i.data, mimeType: i.mediaType }))
        if (provider === 'codex') {
          if (initialImages?.length) {
            log.warn('Codex provider does not support image attachments on initial task; dropping images', { agentId, imageCount: initialImages.length })
          }
          log.debug('Codex task passed as CLI arg', { task: wrappedTask.substring(0, 50), briefingInjected })
        } else {
          log.info('Sending task via ACP prompt', { agentId, task: task.substring(0, 50), briefingInjected, imageCount: initialImages?.length ?? 0 })
          acpClient.prompt(sessionId, wrappedTask, initialImages).catch(err => {
            const errorMsg = err instanceof Error ? err.message : String(err)
            log.warn('ACP initial prompt failed', { agentId, error: errorMsg })
            sendTo(connectionId, {
              type: 'expert:error',
              payload: { agentId, chatId, error: 'prompt_failed', message: errorMsg },
            })
          })
        }
      }

      // Codex readiness boundary: drain any messages enqueued during the
      // starting window. Claude flushes from ExpertEventWiring's
      // `cli-session-id` handler instead, since Claude prompts must wait
      // until the CLI session ID is known.
      if (provider === 'codex') {
        flushPendingTasks({ store, acpClient, sessionRegistry, sessionId, key, agentId, chatId })
      }

      log.info('Expert started', { agentName: agent.name, agentId, sessionId, connectionId })
      trackEvent('agent', 'agent.started', { agentId, agentName: agent.name, chatId, connectionId })

      const workspaceId = chatStore.get(chatId)?.workspaceId || ''
      executionLogStore.create({ chatId, workspaceId, agentId }).then((execLog) => {
        store.setMeta(key, 'executionLogId', execLog.id)
      }).catch((err) => {
        log.warn('Failed to create execution log', { agentId, error: err instanceof Error ? err.message : String(err) })
      })

    } catch (error) {
      const chatId = payload.chatId || ''
      const key = compositeKey(connectionId, chatId, payload.agentId)
      store.clearStarting(key)

      const entry = store.get(key)
      if (entry) {
        sessionRegistry.remove(entry.sessionId)
        store.cleanup(key)
      }

      const errorMsg = error instanceof Error ? error.message : String(error)
      const isCommandNotFound = errorMsg.includes('Command not found')
      log.error('Start error', { agentId: payload.agentId, error: errorMsg, isCommandNotFound })
      trackEvent('agent', 'agent.start_failed', { agentId: payload.agentId, error: errorMsg, isCommandNotFound, connectionId })
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: {
          agentId: payload.agentId,
          chatId: chatId || 'unknown',
          error: isCommandNotFound ? 'command_not_found' : 'start_failed',
          message: errorMsg,
        },
      }))

      sendTo(connectionId, {
        type: 'expert:list-updated',
        payload: { experts: store.getExpertListForConnection(connectionId, chatId), chatId },
      })
    }
  }

  const directInputDeps: import('./ExpertDirectInput').ExpertDirectInputDeps = {
    store, chatStore, sessionRegistry, titleService,
    broadcastToChat, ensureAttachedRunning, trackParticipant, handleStart,
  }
  const { handleDirectInput } = createExpertDirectInput(directInputDeps)

  return { handleStart, handleDirectInput }
}
