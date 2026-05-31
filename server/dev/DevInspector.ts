/**
 * DevInspector —  Server
 *
 *  SessionRegistry / StreamJsonManager / SessionFileWatcher / ActivityDeriver
 *  dev:* WS  DevPanel
 *
 * -  getter
 * -  dev:subscribe
 * -  NODE_ENV !== 'production'
 */

import type { WebSocket } from 'ws'
import type { SessionRegistry, ManagedSession } from '../terminal/SessionRegistry'
import type { ChatStore } from '../stores/ChatStore'
import type { ExpertSessionStore } from '../ws/ExpertSessionStore'
import type { ACPAdapterInspect, ACPUpdateEntry } from '../acp/ACPAgentAdapter'
import type { ParsedMessage } from '../terminal/ConversationParser'
import type { WorkflowRegistry } from '../orchestration/WorkflowRegistry'
import type { WhiteboardManager } from '../whiteboard/WhiteboardManager'
import type { WhiteboardEntry } from '../../shared/whiteboard-types'
import type { WorkflowStatus, TaskStatus } from '../../shared/workflow-types'
import { parseConversationFile } from '../terminal/ConversationParser'
import { locateCodexRollout } from '../terminal/CodexRolloutLocator'
import { existsSync, statSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createLogger } from '../lib/logger'
import type { CliProvider } from '../config/types'
import { getRuntimeInspect, type RuntimeInspect } from '../lib/resolveCliCommand'
import { cwdToClaudeProjectKey } from '../../shared/projectKey'

const log = createLogger('DevInspector')

export interface DevSessionSnapshot {
  sessionId: string
  agentId: string | undefined
  agentName: string
  cliSessionId: string | undefined
  /** 'active' = , 'historical' =  DB  */
  status: 'active' | 'historical'
  connectedWs: boolean
  connectionId: string | null
  disconnectedAt: number | null
  createdAt: number
  killReason: string | undefined
  streamJson?: {
    alive: boolean
    pid: number | null
    spawnedAt: number | null
    provider: string
    cliSessionId: string | null
    messageCount: number
    turnIndex: number
    model: string | null
  }
  jsonl: {
    filePath: string
    fileExists: boolean
    fileSizeBytes: number
  } | null
  activity: {
    phase: string
    updatedAt: number
    currentTool: string | null
    turnIndex: number
    toolCount: number
    toolCompleted: number
    modelUsage: Record<string, { input: number; output: number; cost: number }>
  }
  acp?: {
    adapterState: string
    provider: string
    capabilities: { supportsSessionLoad: boolean; supportsImages: boolean; supportsThinking: boolean; modes: string[] }
    promptInFlight: boolean
    promptStartedAt: number | null
    lastPromptDurationMs: number | null
    updateCount: number
    lastUpdateType: string | null
    lastUpdateAt: number | null
    recentUpdates: ACPUpdateEntry[]
  }
}

export type DevPanelMode = 'local'

export interface DevSnapshot {
  chatId: string
  timestamp: number
  mode: DevPanelMode
  chat: {
    status: string | null
    taskStatus: string | null
    expertSessions: Record<string, unknown> | null
  } | null
  sessions: DevSessionSnapshot[]
  totalSessions: number
  runtime: RuntimeInspect
}

export interface DevEvent {
  chatId: string
  timestamp: number
  type: string
  agentId?: string
  sessionId?: string
  data?: Record<string, unknown>
}

// ── Pipeline Type ────────────────────────────────────────────────────────

export type PipelineStageStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'

export interface PipelineStageState {
  id: string
  label: string
  status: PipelineStageStatus
  startedAt: number | null
  endedAt: number | null
  durationMs: number | null
  detail: Record<string, unknown>
}

export type PipelineZoneId = 'local' | 'network' | 'backflow'

export interface PipelineZone {
  id: PipelineZoneId
  label: string
  stages: PipelineStageState[]
}

export interface PipelineSnapshot {
  mode: DevPanelMode
  taskId: string | null
  zones: PipelineZone[]
  totalElapsedMs: number | null
  health: 'green' | 'yellow' | 'red'
}

// ── Timeline Type ────────────────────────────────────────────────────────

export interface TimelineEntry {
  timestamp: number
  source: 'ws' | 'matrix' | 'oss' | 'internal'
  direction: 'in' | 'out' | 'internal'
  type: string
  taskId: string | null
  agentId: string | null
  summary: string
  detail?: Record<string, unknown>
}

export interface DevWorkflowPayload {
  chatId: string
  workflowId: string | null
  status: WorkflowStatus | null
  tasks: Array<{
    taskId: string
    agentId: string
    description: string
    status: TaskStatus
    dependsOn: string[]
    startedAt: string | null
    completedAt: string | null
    durationMs: number | null
    retryCount: number
    failureReason: string | null
  }>
  totalElapsedMs: number | null
}

export interface DevWhiteboardPayload {
  chatId: string
  goal: WhiteboardEntry | null
  active: WhiteboardEntry[]
  totalActive: number
  totalArchived: number
}

export class DevInspector {
  private subscribers = new Map<string, Set<WebSocket>>()
  private hookedSessions = new Set<string>()
  constructor(
    private sessionRegistry: SessionRegistry,
    private chatStore?: ChatStore,
    private expertStore?: ExpertSessionStore,
    private workflowRegistry?: WorkflowRegistry,
    private whiteboardManager?: WhiteboardManager,
  ) {}

  private resolveMode(): DevPanelMode {
    return 'local'
  }

  hasSubscribers(chatId: string): boolean {
    const subs = this.subscribers.get(chatId)
    return !!subs && subs.size > 0
  }

  subscribe(chatId: string, ws: WebSocket): void {
    let subs = this.subscribers.get(chatId)
    if (!subs) {
      subs = new Set()
      this.subscribers.set(chatId, subs)
    }
    subs.add(ws)

    const sessions = this.sessionRegistry.findAllByChat(chatId)
    const activeAgentIds = new Set(sessions.map((s) => s.agentId).filter(Boolean))
    for (const session of sessions) {
      this.hookSession(chatId, session)
    }

    if (this.chatStore) {
      try {
        const chat = this.chatStore.get(chatId)
        const expertSessions = chat?.expertSessions as Record<string, { cliSessionId: string; provider?: string; cwd: string }> | undefined
        if (expertSessions) {
          for (const [agentId, info] of Object.entries(expertSessions)) {
            if (activeAgentIds.has(agentId)) continue
            const provider = (info.provider ?? 'claude') as CliProvider
            const effectiveCwd = info.cwd
            const messages = this.readHistoricalJsonl(info.cliSessionId, effectiveCwd, provider)
            if (messages.length > 0) {
              this.emitJsonlMessages(chatId, `historical-${agentId}`, agentId, 'full', messages, null)
            }
          }
        }
      } catch (err) {
        log.warn('Failed to load historical JSONL', { chatId, error: String(err) })
      }
    }

    log.info('DevPanel subscribed', { chatId, subscriberCount: subs.size })
  }

  unsubscribe(chatId: string, ws: WebSocket): void {
    const subs = this.subscribers.get(chatId)
    if (!subs) return
    subs.delete(ws)
    if (subs.size === 0) {
      this.subscribers.delete(chatId)
    }
  }

  cleanupWs(ws: WebSocket): void {
    for (const [chatId, subs] of this.subscribers) {
      subs.delete(ws)
      if (subs.size === 0) {
        this.subscribers.delete(chatId)
      }
    }
  }

  async collectSnapshot(chatId: string): Promise<DevSnapshot> {
    const sessions = this.sessionRegistry.findAllByChat(chatId)

    let chatInfo: DevSnapshot['chat'] = null
    if (this.chatStore) {
      try {
        const chat = this.chatStore.get(chatId)
        if (chat) {
          chatInfo = {
            status: chat.status,
            taskStatus: chat.taskStatus ?? null,
            expertSessions: chat.expertSessions ?? null,
          }
        }
      } catch { /* ignore */ }
    }
    const activeAgentIds = new Set(sessions.map((s) => s.agentId).filter(Boolean))

    const sessionSnapshots: DevSessionSnapshot[] = sessions.map((s) => {
      const inspect = s.streamManager.getInspectState()
      const sjData = inspect.streamJson
      const acpInspect = this.getACPInspect(s.sessionId)
      return {
        sessionId: s.sessionId,
        agentId: s.agentId,
        agentName: s.agentName,
        cliSessionId: s.cliSessionId,
        status: 'active' as const,
        connectedWs: s.connectedWs !== null && s.connectedWs.readyState === 1,
        connectionId: s.connectionId,
        disconnectedAt: s.disconnectedAt,
        createdAt: s.createdAt,
        killReason: s.killReason,
        activity: inspect.activity,
        streamJson: sjData ? {
          alive: sjData.alive,
          pid: sjData.pid,
          spawnedAt: sjData.spawnedAt,
          provider: sjData.provider,
          cliSessionId: sjData.cliSessionId ?? null,
          messageCount: sjData.messageCount,
          turnIndex: sjData.turnIndex,
          model: sjData.model ?? null,
        } : undefined,
        jsonl: this.getJsonlMeta(s),
        acp: acpInspect ? {
          adapterState: acpInspect.state,
          provider: acpInspect.provider,
          capabilities: acpInspect.config,
          promptInFlight: acpInspect.promptInFlight,
          promptStartedAt: acpInspect.promptStartedAt,
          lastPromptDurationMs: acpInspect.lastPromptDurationMs,
          updateCount: acpInspect.updateCount,
          lastUpdateType: acpInspect.lastUpdateType,
          lastUpdateAt: acpInspect.lastUpdateAt,
          recentUpdates: acpInspect.recentUpdates,
        } : undefined,
      }
    })

    const expertSessions = chatInfo?.expertSessions as Record<string, { cliSessionId: string; provider?: string; cwd: string }> | null | undefined
    if (expertSessions) {
      for (const [agentId, info] of Object.entries(expertSessions)) {
        if (activeAgentIds.has(agentId)) continue
        const provider = (info.provider ?? 'claude') as CliProvider
        const effectiveCwd = info.cwd
        const jsonlMeta = this.resolveHistoricalJsonlMeta(info.cliSessionId, effectiveCwd, provider)
        sessionSnapshots.push({
          sessionId: `historical-${agentId}`,
          agentId,
          agentName: agentId,
          cliSessionId: info.cliSessionId,
          status: 'historical',
          connectedWs: false,
          connectionId: null,
          disconnectedAt: null,
          createdAt: 0,
          killReason: undefined,
          activity: {
            phase: 'completed',
            updatedAt: 0,
            currentTool: null,
            turnIndex: 0,
            toolCount: 0,
            toolCompleted: 0,
            modelUsage: {},
          },
          jsonl: jsonlMeta,
        })
      }
    }

    return {
      chatId,
      timestamp: Date.now(),
      mode: 'local' as const,
      chat: chatInfo,
      sessions: sessionSnapshots,
      totalSessions: sessionSnapshots.length,
      runtime: getRuntimeInspect(),
    }
  }

  private resolveJsonlPath(session: ManagedSession): string | null {
    const cliSessionId = session.cliSessionId
    if (!cliSessionId) return null
    const provider = (session.streamManager.getProvider?.() ?? 'claude') as CliProvider
    return this.buildJsonlPath(cliSessionId, session.cwd, provider)
  }

  /**  session  JSONL  provider  */
  private resolveHistoricalJsonlPath(cliSessionId: string, cwd: string, provider: CliProvider = 'claude'): string | null {
    return this.buildJsonlPath(cliSessionId, cwd, provider)
  }

  /**
   *  provider  JSONL
   * - codex :  ~/.codex/sessions/YYYY/MM/DD/  threadId  rollout
   * -   : ~/.claude/projects/<cwd-key>/<cliSessionId>.jsonl
   */
  private buildJsonlPath(cliSessionId: string, cwd: string, provider: CliProvider): string | null {
    if (provider === 'codex') {
      return locateCodexRollout(cliSessionId)
    }
    if (provider === 'qoder') {
      const projectKey = cwd.replace(/[/.]/g, '-')
      return join(homedir(), '.qoder', 'projects', projectKey, 'transcript', `${cliSessionId}.jsonl`)
    }
    const projectKey = cwdToClaudeProjectKey(cwd)
    return join(homedir(), '.claude', 'projects', projectKey, `${cliSessionId}.jsonl`)
  }

  private resolveHistoricalJsonlMeta(cliSessionId: string, cwd: string, provider: CliProvider = 'claude'): DevSessionSnapshot['jsonl'] {
    const filePath = this.resolveHistoricalJsonlPath(cliSessionId, cwd, provider)
    if (!filePath) {
      const placeholder = provider === 'codex'
        ? join(homedir(), '.codex', 'sessions', `<not-found>-${cliSessionId}.jsonl`)
        : join(homedir(), '.claude', 'projects', cwdToClaudeProjectKey(cwd), `${cliSessionId}.jsonl`)
      return { filePath: placeholder, fileExists: false, fileSizeBytes: 0 }
    }
    const fileExists = existsSync(filePath)
    let fileSizeBytes = 0
    if (fileExists) {
      try { fileSizeBytes = statSync(filePath).size } catch { /* ignore */ }
    }
    return { filePath, fileExists, fileSizeBytes }
  }

  readHistoricalJsonl(cliSessionId: string, cwd: string, provider: CliProvider = 'claude'): ParsedMessage[] {
    const filePath = this.resolveHistoricalJsonlPath(cliSessionId, cwd, provider)
    if (!filePath) return []
    return parseConversationFile(filePath)
  }

  private getJsonlMeta(session: ManagedSession): DevSessionSnapshot['jsonl'] {
    const cliSessionId = session.cliSessionId
    if (!cliSessionId) return null
    const provider = (session.streamManager.getProvider?.() ?? 'claude') as CliProvider
    const filePath = this.buildJsonlPath(cliSessionId, session.cwd, provider)
    if (!filePath) {
      const placeholder = provider === 'codex'
        ? join(homedir(), '.codex', 'sessions', `<not-found>-${cliSessionId}.jsonl`)
        : join(homedir(), '.claude', 'projects', cwdToClaudeProjectKey(session.cwd), `${cliSessionId}.jsonl`)
      return { filePath: placeholder, fileExists: false, fileSizeBytes: 0 }
    }
    if (existsSync(filePath)) {
      let fileSizeBytes = 0
      try { fileSizeBytes = statSync(filePath).size } catch { /* ignore */ }
      return { filePath, fileExists: true, fileSizeBytes }
    }
    if (this.chatStore && session.agentId) {
      try {
        const chat = this.chatStore.get(session.chatId)
        const info = (chat?.expertSessions as Record<string, { cwd?: string }> | undefined)?.[session.agentId]
        if (info) {
          const altCwds = [info.cwd].filter((c): c is string => !!c && c !== session.cwd)
          for (const altCwd of altCwds) {
            const altPath = this.buildJsonlPath(cliSessionId, altCwd, provider)
            if (altPath && existsSync(altPath)) {
              let fileSizeBytes = 0
              try { fileSizeBytes = statSync(altPath).size } catch { /* ignore */ }
              return { filePath: altPath, fileExists: true, fileSizeBytes }
            }
          }
        }
      } catch { /* ignore */ }
    }
    return { filePath, fileExists: false, fileSizeBytes: 0 }
  }

  readJsonlContent(chatId: string, sessionId: string): {
    filePath: string | null
    fileExists: boolean
    messages: ParsedMessage[]
    lineCount: number
  } {
    const sessions = this.sessionRegistry.findAllByChat(chatId)
    const session = sessions.find((s) => s.sessionId === sessionId)
    if (!session) return { filePath: null, fileExists: false, messages: [], lineCount: 0 }

    const messages = session.streamManager.getCurrentMessages() ?? []
    const inspect = session.streamManager.getInspectState()
    const cliSessionId = inspect.streamJson?.cliSessionId

    return {
      filePath: cliSessionId ?? null,
      fileExists: messages.length > 0,
      messages,
      lineCount: messages.length,
    }
  }

  emitEvent(chatId: string, event: Omit<DevEvent, 'chatId' | 'timestamp'>): void {
    const subs = this.subscribers.get(chatId)
    if (!subs || subs.size === 0) return

    const fullEvent: DevEvent = {
      chatId,
      timestamp: Date.now(),
      ...event,
    }

    const msg = JSON.stringify({ type: 'dev:event', payload: fullEvent })
    for (const ws of subs) {
      if (ws.readyState === 1) {
        ws.send(msg)
      }
    }
  }

  hookSession(chatId: string, session: ManagedSession): void {
    if (this.hookedSessions.has(session.sessionId)) return
    this.hookedSessions.add(session.sessionId)

    const sid = session.sessionId
    const agentId = session.agentId
    const pm = session.streamManager

    pm.on('started', (e: { sessionId: string; pid: number }) => {
      this.emitEvent(chatId, { type: 'pty:spawned', sessionId: sid, agentId, data: { pid: e.pid } })
    })

    pm.on('exit', (e: { exitCode: number; signal?: number }) => {
      this.emitEvent(chatId, { type: 'pty:exit', sessionId: sid, agentId, data: { exitCode: e.exitCode, signal: e.signal } })
      this.hookedSessions.delete(sid)
    })

    pm.on('activity', (state: Record<string, unknown>) => {
      this.emitEvent(chatId, { type: 'activity:phase', sessionId: sid, agentId, data: { phase: state.phase, currentTool: state.currentTool } })
    })

    pm.on('cli-session-id', (cliSid: string) => {
      this.emitEvent(chatId, { type: 'jsonl:discovered', sessionId: sid, agentId, data: { cliSessionId: cliSid } })
    })

    pm.on('session:structured-message', (msg: { type: string; messages: ParsedMessage[]; replacedStatsId?: string | null }) => {
      this.emitEvent(chatId, {
        type: msg.type === 'full' ? 'jsonl:full' : 'jsonl:delta',
        sessionId: sid,
        agentId,
        data: { messageCount: msg.messages.length },
      })
      this.emitJsonlMessages(chatId, sid, agentId, msg.type as 'full' | 'delta', msg.messages, msg.replacedStatsId ?? null)
    })

    const existingMessages = pm.getCurrentMessages()
    if (existingMessages && existingMessages.length > 0) {
      this.emitJsonlMessages(chatId, sid, agentId, 'full', existingMessages, null)
    }

    // ACP debug Event hook
    this.hookACPAdapter(chatId, sid, agentId)
  }

  /**  ExpertSessionStore  ACP adapter inspect  */
  private getACPInspect(sessionId: string): ACPAdapterInspect | null {
    if (!this.expertStore) return null
    const found = this.expertStore.findBySessionId(sessionId)
    if (!found) return null
    return found.entry.acpClient?.getInspectState() ?? null
  }

  /**  ACP adapter  debug  ExpertSessionStore  */
  private hookACPAdapter(chatId: string, sessionId: string, agentId: string | undefined): void {
    if (!this.expertStore) return
    const found = this.expertStore.findBySessionId(sessionId)
    if (!found?.entry.acpClient) return

    const adapter = found.entry.acpClient.getAdapter()
    if (adapter.listenerCount('acp:debug') > 0) return

    adapter.on('acp:debug', (data: { event: string } & Record<string, unknown>) => {
      if (!this.hasSubscribers(chatId)) return
      this.emitEvent(chatId, {
        type: data.event,
        sessionId,
        agentId,
        data: data as Record<string, unknown>,
      })
    })
  }

  private emitJsonlMessages(
    chatId: string,
    sessionId: string,
    agentId: string | undefined,
    type: 'full' | 'delta',
    messages: ParsedMessage[],
    replacedStatsId: string | null,
  ): void {
    const subs = this.subscribers.get(chatId)
    if (!subs || subs.size === 0) return

    const payload = {
      chatId,
      sessionId,
      agentId,
      type,
      messages: messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        timestamp: m.timestamp,
        type: m.type,
        toolUse: m.toolUse,
        toolResult: m.toolResult,
        stats: m.stats,
        thinkingSummary: m.thinkingSummary,
        model: m.model,
        turnIndex: m.turnIndex,
      })),
      replacedStatsId,
    }

    const msg = JSON.stringify({ type: 'dev:jsonl-messages', payload })
    for (const ws of subs) {
      if (ws.readyState === 1) ws.send(msg)
    }
  }

  async readRawJsonl(chatId: string, sessionId: string): Promise<{
    filePath: string | null
    fileExists: boolean
    content: string
    sizeBytes: number
  }> {
    const localResult = this.readRawJsonlLocal(chatId, sessionId)
    return localResult ?? { filePath: null, fileExists: false, content: '', sizeBytes: 0 }
  }

  private readRawJsonlLocal(chatId: string, sessionId: string): {
    filePath: string | null
    fileExists: boolean
    content: string
    sizeBytes: number
  } | null {
    const sessions = this.sessionRegistry.findAllByChat(chatId)
    const session = sessions.find((s) => s.sessionId === sessionId)
    if (session) {
      let filePath = this.resolveJsonlPath(session)
      if ((!filePath || !existsSync(filePath)) && this.chatStore && session.agentId && session.cliSessionId) {
        try {
          const chatForAlt = this.chatStore.get(chatId)
          const infoForAlt = (chatForAlt?.expertSessions as Record<string, { cwd?: string }> | undefined)?.[session.agentId]
          if (infoForAlt) {
            const provider = (session.streamManager.getProvider?.() ?? 'claude') as CliProvider
            const altCwds = [infoForAlt.cwd].filter((c): c is string => !!c && c !== session.cwd)
            for (const altCwd of altCwds) {
              const altPath = this.buildJsonlPath(session.cliSessionId, altCwd, provider)
              if (altPath && existsSync(altPath)) { filePath = altPath; break }
            }
          }
        } catch { /* ignore */ }
      }
      if (filePath && existsSync(filePath)) {
        return this.readJsonlFileContent(filePath)
      }
      return { filePath, fileExists: false, content: '', sizeBytes: 0 }
    }

    // History session（sessionId Format: historical-{agentId}）
    if (sessionId.startsWith('historical-') && this.chatStore) {
      const agentId = sessionId.replace('historical-', '')
      try {
        const chat = this.chatStore.get(chatId)
        const expertSessions = chat?.expertSessions as Record<string, { cliSessionId: string; provider?: string; cwd: string }> | undefined
        const info = expertSessions?.[agentId]
        if (info) {
          const provider = (info.provider ?? 'claude') as CliProvider
          const effectiveCwd = info.cwd
          const filePath = this.resolveHistoricalJsonlPath(info.cliSessionId, effectiveCwd, provider)
          if (filePath && existsSync(filePath)) {
            return this.readJsonlFileContent(filePath)
          }
          return { filePath: filePath ?? null, fileExists: false, content: '', sizeBytes: 0 }
        }
      } catch (err) {
        log.warn('Failed to read raw JSONL for historical session', { chatId, sessionId, error: String(err) })
      }
    }

    return null
  }

  private readJsonlFileContent(filePath: string): { filePath: string; fileExists: boolean; content: string; sizeBytes: number } {
    const stat = statSync(filePath)
    const MAX_SIZE = 2 * 1024 * 1024
    const content = stat.size > MAX_SIZE
      ? readFileSync(filePath, 'utf-8').slice(-MAX_SIZE)
      : readFileSync(filePath, 'utf-8')
    return { filePath, fileExists: true, content, sizeBytes: stat.size }
  }

  async collectPipelineState(chatId: string): Promise<PipelineSnapshot> {
    const sessions = this.sessionRegistry.findAllByChat(chatId)
    return this.buildLocalPipeline(sessions)
  }

  private buildLocalPipeline(sessions: ManagedSession[]): PipelineSnapshot {
    const s = sessions[0]
    const inspect = s?.streamManager.getInspectState()
    const sj = inspect?.streamJson
    const act = inspect?.activity

    const zones: PipelineZone[] = [{
      id: 'local', label: 'Local Daemon',
      stages: [
        {
          id: 'ws-connection', label: 'WS Connection',
          status: s?.connectedWs?.readyState === 1 ? 'done' : s ? 'error' : 'pending',
          startedAt: s?.createdAt ?? null, endedAt: null, durationMs: null,
          detail: { connectionId: s?.connectionId ?? null },
        },
        {
          id: 'expert-spawn', label: 'Expert Spawn',
          status: sj?.alive ? 'done' : s ? 'pending' : 'pending',
          startedAt: sj?.spawnedAt ?? null, endedAt: null, durationMs: null,
          detail: { pid: sj?.pid ?? null, provider: sj?.provider ?? null, model: sj?.model ?? null },
        },
        {
          id: 'cli-execution', label: 'CLI Execution',
          status: act ? (act.phase === 'completed' ? 'done' : 'active') : 'pending',
          startedAt: sj?.spawnedAt ?? null, endedAt: act?.phase === 'completed' ? act.updatedAt : null, durationMs: null,
          detail: { phase: act?.phase ?? null, currentTool: act?.currentTool ?? null, turnIndex: act?.turnIndex ?? 0, toolCount: act?.toolCount ?? 0, toolCompleted: act?.toolCompleted ?? 0 },
        },
        {
          id: 'jsonl-parser', label: 'JSONL Parser',
          status: sj ? 'done' : 'pending',
          startedAt: null, endedAt: null, durationMs: null,
          detail: { messageCount: sj?.messageCount ?? 0 },
        },
        {
          id: 'ui-delivery', label: 'UI Delivery',
          status: sj?.messageCount ? 'done' : 'pending',
          startedAt: null, endedAt: null, durationMs: null,
          detail: { lastUpdate: act?.updatedAt ?? null },
        },
      ],
    }]

    return {
      mode: 'local', taskId: null, zones,
      totalElapsedMs: sj?.spawnedAt ? Date.now() - sj.spawnedAt : null,
      health: this.deriveHealthFromZones(zones),
    }
  }

  private deriveHealthFromZones(zones: PipelineZone[]): 'green' | 'yellow' | 'red' {
    const allStages = zones.flatMap((z) => z.stages)
    if (allStages.some((s) => s.status === 'error')) return 'red'
    if (allStages.some((s) => s.status === 'active')) return 'yellow'
    return 'green'
  }

  collectTimeline(_chatId: string, _taskId?: string, _limit = 100): TimelineEntry[] {
    return []
  }

  collectWorkflowState(chatId: string): DevWorkflowPayload {
    if (!this.workflowRegistry) {
      return { chatId, workflowId: null, status: null, tasks: [], totalElapsedMs: null }
    }
    const engines = this.workflowRegistry.findByChatId(chatId)
    const engine = engines[engines.length - 1]
    if (!engine) {
      return { chatId, workflowId: null, status: null, tasks: [], totalElapsedMs: null }
    }
    const state = engine.getState()
    const tasks = state.dag.tasks.map((t) => {
      const ts = state.tasks[t.taskId]
      const startedAt = ts?.startedAt ?? null
      const completedAt = ts?.completedAt ?? null
      let durationMs: number | null = null
      if (startedAt && completedAt) {
        durationMs = new Date(completedAt).getTime() - new Date(startedAt).getTime()
      } else if (startedAt) {
        durationMs = Date.now() - new Date(startedAt).getTime()
      }
      return {
        taskId: t.taskId,
        agentId: t.agentId,
        description: t.description,
        status: ts?.status ?? ('pending' as TaskStatus),
        dependsOn: t.dependsOn,
        startedAt,
        completedAt,
        durationMs,
        retryCount: ts?.retryCount ?? 0,
        failureReason: ts?.failureReason ?? null,
      }
    })
    const firstStarted = tasks.map((t) => t.startedAt).filter(Boolean).sort()[0]
    const totalElapsedMs = firstStarted ? Date.now() - new Date(firstStarted).getTime() : null

    return {
      chatId,
      workflowId: engine.workflowId,
      status: engine.status,
      tasks,
      totalElapsedMs,
    }
  }

  collectWhiteboardState(chatId: string): DevWhiteboardPayload {
    if (!this.whiteboardManager) {
      return { chatId, goal: null, active: [], totalActive: 0, totalArchived: 0 }
    }
    const snapshot = this.whiteboardManager.getSnapshot(chatId)
    return {
      chatId,
      goal: snapshot.goal,
      active: snapshot.active.slice(-20),
      totalActive: snapshot.active.length,
      totalArchived: snapshot.archivedCount,
    }
  }

  async executeAction(chatId: string, action: string, params?: Record<string, unknown>): Promise<{ success: boolean; message?: string }> {
    const sessions = this.sessionRegistry.findAllByChat(chatId)

    switch (action) {
      case 'restart-watcher': {
        const agentId = params?.agentId as string | undefined
        const session = agentId
          ? sessions.find((s) => s.agentId === agentId)
          : sessions[0]
        if (!session) return { success: false, message: 'No session found' }
        session.streamManager.restartSessionFileWatcher()
        return { success: true, message: `Restarted watcher for ${session.agentName}` }
      }
      case 'refresh': {
        return { success: true }
      }
      default:
        return { success: false, message: `Unknown action: ${action}` }
    }
  }
}
