/**
 * ExpertHandler -  Agent WebSocket + HTTP
 *
 *  SessionRegistry  Expert Agent
 * WS  detach kill
 *
 *  WS  connectionIdExpert Agent
 * -  Map  `connectionId::chatId::agentId`  Chat  Expert
 * - Expert
 * -  Tab  chat  agent  attached Tab  detach
 *
 * - ExpertLifecycle:
 * - ExpertResumeHandler:  Chat
 */

import type { WebSocket } from 'ws'
import type { ConfigCompiler } from '../runtime/ConfigCompiler'
import type { AgentRegistry } from '../config/AgentRegistry'
import type { ChatStore } from '../stores/ChatStore'
import type { AgentStore } from '../stores/AgentStore'
import type { TokenUsageStore } from '../stores/TokenUsageStore'
import type { ExecutionLogStore } from '../stores/ExecutionLogStore'
import type { VersionGate } from '../services/update/VersionGate'
import type { SessionRegistry } from '../terminal/SessionRegistry'
import type { ActivityState } from '../terminal/ActivityDeriver'
import { ExpertSessionStore, compositeKey, parseAgentId, type ExpertEntry, type ExpertListItem } from './ExpertSessionStore'
import { createExpertLifecycle } from './ExpertLifecycle'
import { createExpertResumeHandler } from './ExpertResumeHandler'
import type { MailboxManager } from '../mailbox/MailboxManager'
import type { WhiteboardManager } from '../whiteboard/WhiteboardManager'
import { createLogger } from '../lib/logger'
import { trackEvent } from '../lib/eventTracker'

const log = createLogger('ExpertHandler')

export class ExpertHandler {
  private store = new ExpertSessionStore()
  getExpertStore(): ExpertSessionStore { return this.store }
  private resumeInFlight = new Set<string>()
  private resumeRecent = new Map<string, number>()

  /** connectionId → WebSocket  */
  private connectionWsMap = new Map<string, WebSocket>()
  /**
   * connectionId →  Tab  chatId
   *
   * ⚠️  1:1  Tab chatId
   *    -  `chat:set-context`
   *    -  set-context  UI handleList / handleStopAll /  payload.chatId  fallback
   *    -  chat——  chat store.collectByConnection + parseChatId
   */
  private connectionActiveChatId = new Map<string, string>()
  /** connectionId →  chatId tab  */
  private connectionChatHistory = new Map<string, Set<string>>()

  private lifecycle: ReturnType<typeof createExpertLifecycle>
  private resumeHandler: ReturnType<typeof createExpertResumeHandler>

  constructor(
    private configCompiler: ConfigCompiler,
    private agentRegistry: AgentRegistry,
    private agentStore: AgentStore,
    private chatStore: ChatStore,
    private tokenUsageStore: TokenUsageStore,
    private executionLogStore: ExecutionLogStore,
    _unused: unknown,
    private sessionRegistry: SessionRegistry,
    private versionGate: VersionGate,
    private broadcastToChat: (chatId: string, msg: Record<string, unknown>) => void = () => {},
    private mailboxManager?: MailboxManager,
    private whiteboardManager?: WhiteboardManager,
    /**  GlobalTaskContext  chat chat:permission-request / chat:permission-resolved */
    private globalBroadcast: (msg: Record<string, unknown>) => void = () => {},
  ) {
    this.sessionRegistry.onSessionRemoved((session) => {
      const found = this.store.findBySessionId(session.sessionId)
      if (found) {
        this.store.cleanup(found.key)
        log.info('Cleaned up zombie entry', { key: found.key, sessionId: session.sessionId })
      }
    })

    const sendTo = this.sendTo.bind(this)
    const getConnectionChatId = (connId: string) => this.connectionActiveChatId.get(connId)
    const getConnectionWs = (connId: string) => this.connectionWsMap.get(connId)

    this.lifecycle = createExpertLifecycle({
      configCompiler,
      agentRegistry,
      agentStore,
      chatStore,
      tokenUsageStore,
      executionLogStore,
      sessionRegistry,
      store: this.store,
      versionGate,
      getConnectionWs,
      getConnectionChatId,
      sendTo,
      persistExpertSession: this.persistExpertSession.bind(this),
      broadcastToChat: this.broadcastToChat,
      globalBroadcast: this.globalBroadcast,
      mailboxManager: this.mailboxManager,
      whiteboardManager: this.whiteboardManager,
    })

    this.resumeHandler = createExpertResumeHandler({
      chatStore,
      agentStore,
      sessionRegistry,
      store: this.store,
      sendTo,
      handleStart: this.lifecycle.handleStart,
    })
  }

  registerConnection(connectionId: string, ws: WebSocket): void {
    this.connectionWsMap.set(connectionId, ws)
    log.debug('Connection registered', { connectionId })
  }

  unregisterConnection(connectionId: string): void {
    this.connectionWsMap.delete(connectionId)
    this.connectionActiveChatId.delete(connectionId)
    this.connectionChatHistory.delete(connectionId)
    this.store.clearCompletedByConnection(connectionId)
    log.debug('Connection unregistered', { connectionId })
  }

  getConnectionWs(connectionId: string): WebSocket | undefined {
    return this.connectionWsMap.get(connectionId)
  }

  /**  chatId  connectionId tab  */
  getConnectionsViewingChat(chatId: string): string[] {
    const result: string[] = []
    for (const [connId, history] of this.connectionChatHistory) {
      if (history.has(chatId)) result.push(connId)
    }
    return result
  }

  private sendTo(connectionId: string, msg: Record<string, unknown>): void {
    const ws = this.connectionWsMap.get(connectionId)
    if (ws && ws.readyState === 1 /* WebSocket.OPEN */) {
      ws.send(JSON.stringify(msg))
      return
    }
    log.warn('sendTo dropped: ws not open', {
      connectionId,
      type: msg.type,
      reason: ws ? `readyState=${ws.readyState}` : 'no_ws',
    })
  }

  /**
   *  Tab  chatId chat:set-context
   *
   *  Tab  detach  chat  agent —  chat  agent  attached
   *  chatId expert:list  UI
   */
  setChatId(connectionId: string, chatId: string): void {
    const oldChatId = this.connectionActiveChatId.get(connectionId)
    if (oldChatId && oldChatId !== chatId) {
      log.info('Chat context switching (no detach)', { from: oldChatId, to: chatId, connectionId })
    }
    this.connectionActiveChatId.set(connectionId, chatId)
    let history = this.connectionChatHistory.get(connectionId)
    if (!history) {
      history = new Set()
      this.connectionChatHistory.set(connectionId, history)
    }
    history.add(chatId)
    log.debug('Chat context set', { chatId, connectionId })
  }

  async handleStart(
    ws: WebSocket,
    payload: { agentId: string; task?: string; images?: Array<{ data: string; mediaType: string }>; cwd?: string; repositories?: Array<{ path: string }>; resumeSessionId?: string; chatId?: string; cols?: number; rows?: number },
    connectionId: string,
  ): Promise<void> {
    return this.lifecycle.handleStart(ws, payload, connectionId)
  }

  async handleDirectInput(
    ws: WebSocket,
    payload: { chatId?: string; agentId: string; message: string; images?: Array<{ data: string; mediaType: string }>; autoStart?: boolean; cwd?: string; repositories?: Array<{ path: string }>; cols?: number; rows?: number; previousContext?: { agentName: string; lastMessage?: string; jsonlPath?: string } },
    connectionId: string,
  ): Promise<void> {
    return this.lifecycle.handleDirectInput(ws, payload, connectionId)
  }

  handleResize(_ws: WebSocket, _payload: { chatId?: string; agentId: string; cols: number; rows: number }, _connectionId: string): void {
  }

  handleInput(ws: WebSocket, payload: { chatId?: string; agentId: string; data: string }, connectionId?: string): void {
    const chatId = payload.chatId
    if (!chatId) {
      log.error('expert:input missing chatId', { connectionId, agentId: payload.agentId })
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: { agentId: payload.agentId, chatId: '', error: 'missing_chat_id', message: 'expert:input payload must carry chatId' },
      }))
      return
    }
    const expert = this.store.findRunning(payload.agentId, connectionId, chatId)
    if (!expert) {
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: { agentId: payload.agentId, chatId, message: `Expert ${payload.agentId} is not running` },
      }))
      return
    }
    expert.acpClient.write(payload.data)
  }

  handleStop(ws: WebSocket, payload: { agentId: string; chatId?: string }, connectionId: string): void {
    const chatId = payload.chatId
    if (!chatId) {
      log.error('expert:stop missing chatId', { connectionId, agentId: payload.agentId })
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: { agentId: payload.agentId, chatId: '', error: 'missing_chat_id', message: 'expert:stop payload must carry chatId' },
      }))
      return
    }
    const key = compositeKey(connectionId, chatId, payload.agentId)
    const expert = this.store.cleanupWithStop(key, connectionId)
    if (!expert) {
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: { agentId: payload.agentId, chatId, message: `Expert ${payload.agentId} is not running` },
      }))
      return
    }

    const session = this.sessionRegistry.get(expert.sessionId)
    if (session) session.killReason = 'user_stop'
    expert.acpClient.kill()
    trackEvent('agent', 'agent.stopped', { agentId: payload.agentId, connectionId })

    this.sendTo(connectionId, { type: 'expert:stopped', payload: { agentId: payload.agentId, chatId: expert.chatId, exitCode: -1 } })
    this.sendTo(connectionId, { type: 'expert:list-updated', payload: { experts: this.store.getExpertListForConnection(connectionId, expert.chatId), chatId: expert.chatId } })
  }

  handleStopAll(_ws: WebSocket, connectionId: string): void {
    const activeChatId = this.connectionActiveChatId.get(connectionId)
    if (!activeChatId) {
      log.warn('handleStopAll rejected: no active chatId for connection', { connectionId })
      this.sendTo(connectionId, { type: 'expert:all-stopped', payload: { stoppedExperts: [] } })
      return
    }
    const toStop = this.store.collectByConnection(connectionId)
      .filter(({ expert }) => expert.chatId === activeChatId)
    const stoppedAgentIds: string[] = []

    for (const { key, expert } of toStop) {
      const agentId = parseAgentId(key)
      this.store.cleanupWithStop(key, connectionId)
      const session = this.sessionRegistry.get(expert.sessionId)
      if (session) session.killReason = 'user_stop'
      expert.acpClient.kill()
      stoppedAgentIds.push(agentId)
      this.sendTo(connectionId, { type: 'expert:stopped', payload: { agentId, chatId: expert.chatId, exitCode: -1 } })
    }
    this.sendTo(connectionId, { type: 'expert:all-stopped', payload: { stoppedExperts: stoppedAgentIds } })
    this.sendTo(connectionId, { type: 'expert:list-updated', payload: { experts: this.store.getExpertListForConnection(connectionId, activeChatId), chatId: activeChatId } })
  }

  handleList(ws: WebSocket, connectionId: string, chatId?: string): void {
    const activeChatId = chatId || this.connectionActiveChatId.get(connectionId)
    const expertList = this.store.getExpertListForConnection(connectionId, activeChatId)
    ws.send(JSON.stringify({
      type: 'expert:list',
      payload: { experts: expertList, chatId: activeChatId },
    }))
  }

  clearCompleted(connectionId: string, chatId?: string): number {
    const activeChatId = chatId || this.connectionActiveChatId.get(connectionId)
    const count = this.store.clearCompleted(connectionId, activeChatId)
    this.sendTo(connectionId, { type: 'expert:list-updated', payload: { experts: this.store.getExpertListForConnection(connectionId, activeChatId), chatId: activeChatId } })
    return count
  }

  getExpertListForConnection(connectionId: string, chatId?: string): ExpertListItem[] {
    return this.store.getExpertListForConnection(connectionId, chatId)
  }

  /**
   *  ACP permission request
   *  adapter  handleClientResponse  resolve  Promise
   */
  handlePermissionResponse(
    ws: WebSocket,
    payload: {
      agentId: string
      chatId?: string
      sessionId: string
      requestId: string
      outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' }
    },
    connectionId: string,
  ): void {
    const chatId = payload.chatId
    if (!chatId) {
      log.error('expert:permission-response missing chatId', { connectionId, agentId: payload.agentId })
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: { agentId: payload.agentId, chatId: '', error: 'missing_chat_id', message: 'expert:permission-response payload must carry chatId' },
      }))
      return
    }
    const expert = this.store.findRunning(payload.agentId, connectionId, chatId)
    if (!expert) {
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: { agentId: payload.agentId, chatId, error: 'not_running', message: `Expert ${payload.agentId} is not running` },
      }))
      return
    }
    if (expert.sessionId !== payload.sessionId) {
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: { agentId: payload.agentId, chatId, error: 'session_mismatch', message: 'Permission session mismatch' },
      }))
      return
    }
    expert.acpClient.handleClientResponse(payload.requestId, payload.outcome)
    this.globalBroadcast({
      type: 'chat:permission-resolved',
      payload: { chatId, requestId: payload.requestId },
    })
  }

  /**
   * sidebar  { chatId, text }  chat  waiting_input  agent fallback  running agent
   */
  handleUserInput(ws: WebSocket, payload: { chatId: string; text: string }, connectionId: string): void {
    const { chatId, text } = payload || ({} as typeof payload)
    if (!chatId || typeof text !== 'string' || text.length === 0) {
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: { agentId: '', chatId: chatId || '', error: 'invalid_payload', message: 'expert:user-input requires { chatId, text }' },
      }))
      return
    }
    let target: ExpertEntry | undefined
    let fallback: ExpertEntry | undefined
    for (const [key, entry] of this.store.runningEntries()) {
      if (entry.chatId !== chatId) continue
      const activity = this.store.getActivity(key)
      if (activity?.phase === 'waiting_input') { target = entry; break }
      if (!fallback) fallback = entry
    }
    const agent = target ?? fallback
    if (!agent) {
      ws.send(JSON.stringify({
        type: 'expert:error',
        payload: { agentId: '', chatId, error: 'no_running_agent', message: `No running agent for chat ${chatId}` },
      }))
      return
    }
    agent.acpClient.write(text)
    log.debug('expert:user-input forwarded', { chatId, connectionId, sessionId: agent.sessionId, len: text.length })
  }

  /**
   *  chatId  assistant  120
   *  chat:activity payload sidebar
   */
  getLatestMessage(chatId: string): { role: 'user' | 'agent' | 'assistant'; text: string; at: number } | null {
    let best: { role: 'user' | 'agent' | 'assistant'; text: string; at: number } | null = null
    for (const [, entry] of this.store.runningEntries()) {
      if (entry.chatId !== chatId) continue
      const msgs = entry.acpClient.getCurrentMessages()
      if (!msgs || msgs.length === 0) continue
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i]
        if (m.role !== 'agent') continue
        if (m.type !== 'text') continue
        const text = (m.content || '').trim()
        if (!text) continue
        const at = m.timestamp || Date.now()
        if (!best || at > best.at) {
          best = { role: 'agent', text: text.length > 120 ? text.slice(0, 120) : text, at }
        }
        break
      }
    }
    return best
  }

  getExpertList(): ExpertListItem[] {
    return this.store.getExpertList()
  }

  /**  chat  Expert team-status API  */
  getTeamStatus(chatId: string): Array<{
    agentId: string
    agentName: string
    agentIcon: string
    phase: string
    currentTool?: string
    toolCount: number
    toolCompleted: number
    cost?: number
    startedAt?: number
    lastMessage?: string
  }> {
    const entries = this.store.collectByChatId(chatId)
    return entries.map(({ key, expert }) => {
      const activity = this.store.getActivity(key)
      const session = this.sessionRegistry.get(expert.sessionId)
      const msgs = expert.acpClient.getCurrentMessages()
      let lastMessage: string | undefined
      if (msgs && msgs.length > 0) {
        for (let i = msgs.length - 1; i >= 0; i--) {
          const m = msgs[i]
          if (m.role === 'agent' && m.type === 'text') {
            const text = (m.content || '').trim()
            if (text) {
              lastMessage = text.length > 120 ? text.slice(0, 120) : text
              break
            }
          }
        }
      }
      return {
        agentId: parseAgentId(key),
        agentName: expert.agentName,
        agentIcon: expert.agentIcon,
        phase: activity?.phase ?? 'unknown',
        currentTool: activity?.currentTool,
        toolCount: activity?.toolCount ?? 0,
        toolCompleted: activity?.toolCompleted ?? 0,
        cost: activity?.cost,
        startedAt: session?.createdAt,
        lastMessage,
      }
    })
  }

  detachConnection(connectionId: string): void {
    this.persistAllExpertSessions(connectionId)

    const collected = this.store.collectByConnection(connectionId)
    log.info('detachConnection', { connectionId, count: collected.length })
    for (const { key, expert } of collected) {
      this.sessionRegistry.detach(expert.sessionId)
      this.store.clearPendingTaskTimer(key)
      log.debug('Detached agent on disconnect', { agentId: parseAgentId(key), connectionId })
    }
  }

  async resumeFromChat(ws: WebSocket, chatId: string, connectionId: string): Promise<void> {
    this.connectionActiveChatId.set(connectionId, chatId)
    const connKey = `${connectionId}::${chatId}`
    const now = Date.now()
    const last = this.resumeRecent.get(connKey) ?? 0
    if (this.resumeInFlight.has(connKey) || now - last < 200) {
      log.debug('Skip duplicate resume request', { connectionId, chatId, reason: this.resumeInFlight.has(connKey) ? 'in_flight' : 'cooldown' })
      return
    }
    this.resumeInFlight.add(connKey)
    try {
      await this.resumeHandler.resumeFromChat(ws, chatId, connectionId)
      this.resumeRecent.set(connKey, Date.now())
    } finally {
      this.resumeInFlight.delete(connKey)
    }
  }

  isReady(agentId: string, connectionId?: string): boolean {
    const expert = this.store.findRunning(agentId, connectionId)
    return expert?.cliSessionId != null
  }

  getRunning(agentId: string, connectionId?: string): ExpertEntry | undefined {
    return this.store.findRunning(agentId, connectionId)
  }

  /**  meta  expertRoutes  taskEnvelopeId  */
  setRunningMeta(agentId: string, key: string, value: unknown, connectionId?: string): void {
    const entry = this.store.findRunning(agentId, connectionId)
    if (!entry) return
    const ck = compositeKey(entry.connectionId, entry.chatId, agentId)
    this.store.setMeta(ck, key, value)
  }

  getExpertMessages(agentId: string, connectionId?: string): any[] | null {
    const expert = this.store.findRunning(agentId, connectionId)
    if (!expert) return null
    return expert.acpClient.getCurrentMessages()
  }

  getExpertActivity(agentId: string, connectionId?: string): ActivityState | null {
    const expert = this.store.findRunning(agentId, connectionId)
    if (!expert) return null
    const ck = compositeKey(expert.connectionId, expert.chatId, agentId)
    return this.store.getActivity(ck) ?? null
  }

  private persistExpertSession(agentId: string, cliSessionId: string, cwd: string, connectionId: string, provider?: import('../config/types').CliProvider, chatId?: string): void {
    const effectiveChatId = chatId || this.connectionActiveChatId.get(connectionId)
    if (!effectiveChatId) {
      log.warn('persistExpertSession: no chatId for connection', { connectionId, agentId })
      return
    }
    const chat = this.chatStore.get(effectiveChatId)
    if (!chat) return

    const expertSessions = { ...chat.expertSessions, [agentId]: { cliSessionId, provider, cwd } }
    this.chatStore.update(effectiveChatId, { expertSessions }).catch((err) => {
      log.error('Failed to persist session', { agentId, error: err instanceof Error ? err.message : String(err) })
    })
  }

  private persistAllExpertSessions(connectionId: string): void {
    const byChatId = new Map<string, Array<{ agentId: string; cliSessionId: string; cwd: string }>>()
    for (const [key, entry] of this.store.runningEntries()) {
      if (entry.connectionId === connectionId && entry.cliSessionId) {
        const agentId = parseAgentId(key)
        let list = byChatId.get(entry.chatId)
        if (!list) { list = []; byChatId.set(entry.chatId, list) }
        list.push({ agentId, cliSessionId: entry.cliSessionId, cwd: entry.cwd })
      }
    }

    for (const [chatId, agents] of byChatId) {
      const chat = this.chatStore.get(chatId)
      if (!chat) continue
      const expertSessions = { ...chat.expertSessions }
      for (const { agentId, cliSessionId, cwd } of agents) {
        expertSessions[agentId] = { cliSessionId, cwd }
      }
      this.chatStore.update(chatId, { expertSessions }).catch((err) => {
        log.error('Failed to persist expert sessions', { chatId, error: err instanceof Error ? err.message : String(err) })
      })
    }
  }
}
