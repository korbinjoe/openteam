/**
 * ExpertEventWiring -  Expert Agent
 *
 *  ExpertLifecycle  StreamJsonManager  ACPClient
 *  FileOperationCollector + ExpertTokenTracker + Activity handler
 *  spawn / cleanup
 */

import type { WebSocket } from 'ws'
import { StreamJsonManager } from '../terminal/StreamJsonManager'
import { FileOperationCollector, type FileOperationEvent } from '../terminal/FileOperationCollector'
import type { SessionRegistry } from '../terminal/SessionRegistry'
import type { ChatStore } from '../stores/ChatStore'
import type { TokenUsageStore } from '../stores/TokenUsageStore'
import type { MailboxManager } from '../mailbox/MailboxManager'
import type { ACPClient } from '../acp/ACPClient'
import { acpUpdateToWSMessage, type BridgeContext } from '../acp/ACPToFrontendBridge'
import type { ACPSessionUpdateParams } from '../../shared/acp-types'
import type { ExpertSessionStore } from './ExpertSessionStore'
import { ExpertTokenTracker } from './ExpertTokenTracker'
import { createActivityHandler } from './ExpertActivityHandler'
import { flushPendingTasks } from './ExpertPendingTaskFlush'
import { createLogger } from '../lib/logger'

const log = createLogger('ExpertEventWiring')

export interface ExpertEventWiringDeps {
  streamManager: StreamJsonManager
  acpClient: ACPClient
  sessionRegistry: SessionRegistry
  store: ExpertSessionStore
  chatStore: ChatStore
  tokenUsageStore: TokenUsageStore
  mailboxManager?: MailboxManager
  sessionId: string
  key: string
  agentId: string
  chatId: string
  agentName: string
  cwd: string
  provider: import('../config/types').CliProvider
  persistExpertSession: (agentId: string, cliSessionId: string, cwd: string, connectionId: string, provider?: import('../config/types').CliProvider, chatId?: string) => void
  connectionId: string
  globalBroadcast?: (msg: Record<string, unknown>) => void
  onExit: (exitCode: number, signal: number | undefined, ctx: { fileCollector: FileOperationCollector; tokenTracker: ExpertTokenTracker }) => void
  ws: WebSocket
}

export interface WiredExpertHandles {
  fileCollector: FileOperationCollector
  tokenTracker: ExpertTokenTracker
}

/**
 *  StreamManager + ACPClient  caller
 */
export const wireExpertStreamHandlers = (deps: ExpertEventWiringDeps): WiredExpertHandles => {
  const {
    streamManager, acpClient, sessionRegistry, store, chatStore, tokenUsageStore,
    mailboxManager, sessionId, key, agentId, chatId, agentName, cwd, provider,
    persistExpertSession, connectionId, globalBroadcast, onExit,
  } = deps

  streamManager.on('cli-session-id', (csid: string) => {
    const currentKey = store.findBySessionId(sessionId)?.key ?? key
    const entry = store.get(currentKey)
    if (entry) entry.cliSessionId = csid
    sessionRegistry.updateCliSessionId(sessionId, csid)
    log.info('Captured CLI session ID', { agentId, cliSessionId: csid, provider })
    persistExpertSession(agentId, csid, cwd, connectionId, provider, chatId)

    // Claude readiness boundary: queue entries from `expert:input` during
    // the starting window or `expert:start` on an attached-no-cliSessionId
    // expert are flushed here. Codex flushes from ExpertLifecycle instead.
    if (provider === 'claude') {
      flushPendingTasks({ store, acpClient, sessionRegistry, sessionId, key: currentKey, agentId, chatId })
    }
  })

  const fileCollector = new FileOperationCollector(agentId)
  fileCollector.on('file-operations', (ops: FileOperationEvent[]) => {
    sessionRegistry.sendToSession(sessionId, {
      type: 'session:file-operation',
      payload: { sessionId, chatId, agentId, operations: ops },
    })
  })

  const tokenTracker = new ExpertTokenTracker(chatId, agentId, tokenUsageStore, chatStore)

  const handleActivity = createActivityHandler({
    store, sessionRegistry, sessionId, key, agentId, chatId,
    fileCollector, tokenTracker, mailboxManager,
  })

  const bridgeCtx: BridgeContext = { agentId, sessionId, chatId }
  acpClient.onUpdate((params: ACPSessionUpdateParams) => {
    const wsMsg = acpUpdateToWSMessage(params.update, bridgeCtx)
    if (wsMsg) {
      sessionRegistry.sendToSession(sessionId, wsMsg as unknown as Record<string, unknown>)
    }
  })

  acpClient.onClientRequest((req) => {
    if (req.method === 'session/request_permission') {
      const params = req.params as import('../../shared/acp-types').ACPRequestPermissionParams
      const permissionPayload = {
        agentId,
        chatId,
        sessionId,
        requestId: req.requestId,
        toolCall: params.toolCall,
        options: params.options,
      }
      sessionRegistry.sendToSession(sessionId, {
        type: 'expert:permission-request',
        payload: permissionPayload,
      })
      globalBroadcast?.({
        type: 'chat:permission-request',
        payload: permissionPayload,
      })
    }
  })

  acpClient.onPermissionTimeout((info) => {
    const errorPayload = {
      agentId,
      chatId,
      sessionId,
      requestId: info.requestId,
      error: 'permission_timeout',
      message: `Permission request "${info.toolTitle}" timed out after ${info.timeoutMs}ms`,
    }
    sessionRegistry.sendToSession(sessionId, {
      type: 'expert:error',
      payload: errorPayload,
    })
    sessionRegistry.sendToSession(sessionId, {
      type: 'expert:permission-timeout',
      payload: {
        agentId,
        chatId,
        sessionId,
        requestId: info.requestId,
        toolCallId: info.toolCallId,
      },
    })
  })

  streamManager.on('cli-init', (initData: { slashCommands: string[]; model?: string }) => {
    sessionRegistry.sendToSession(sessionId, {
      type: 'expert:slash-commands',
      payload: { agentId, chatId, commands: initData.slashCommands },
    })
  })

  streamManager.on('activity', handleActivity)

  streamManager.on('exit', ({ exitCode, signal }: { exitCode: number; signal?: number }) => {
    onExit(exitCode, signal, { fileCollector, tokenTracker })
  })

  streamManager.on('started', ({ pid }: { sessionId: string; pid: number }) => {
    log.info('Agent process started', { agentName, agentId, pid })
  })

  return { fileCollector, tokenTracker }
}
