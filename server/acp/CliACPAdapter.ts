/**
 * CliACPAdapter -  CLI Agent (stream-json)  ACP
 *
 *  ProviderConfig  Claude / Codex / Qoder
 * - ACP JSON-RPC method → CLI stdin
 * - CLI stdout event → ACP session/update notification
 *
 * v5:  ACP spec 2026-04
 *   - P0-2: agentCapabilities promptCapabilities / mcpCapabilities / sessionCapabilities
 *   - P1-5: cancel pending request  cancelled
 *   - P1-6: needsStandardPermission
 *   - P1-7: image-text
 *   - P1-9: cliSessionId  cli-session-id
 *   - P2-4: blockIndex
 */

import { EventEmitter } from 'events'
import type { StreamJsonManager, StreamJsonOptions } from '../terminal/StreamJsonManager'
import type { ParsedMessage } from '../terminal/ConversationParser'
import type { ActivityState } from '../terminal/ActivityDeriver'
import type { ACPAgentAdapter, AdapterState, ACPAdapterInspect, ACPUpdateEntry } from './ACPAgentAdapter'
import type {
  InitializeParams,
  InitializeResult,
  SessionNewParams,
  SessionNewResult,
  SessionLoadParams,
  SessionLoadResult,
  SessionPromptParams,
  SessionPromptResult,
  SessionCancelParams,
  ACPSessionUpdateParams,
  SessionUpdateType,
  ACPContentBlock,
  ACPUsage,
  ACPRequestPermissionParams,
  ACPRequestPermissionResult,
} from '../../shared/acp-types'
import { expandSlashCommand } from '../runtime/SlashCommandResolver'
import { createLogger } from '../lib/logger'
import { trackEvent } from '../lib/eventTracker'

const log = createLogger('CliACPAdapter')

const DEFAULT_PROMPT_TIMEOUT_MS = 30 * 60 * 1000
const DEFAULT_PERMISSION_TIMEOUT_MS = 10 * 60 * 1000
const MAX_RECENT_UPDATES = 100

interface ProviderConfig {
  agentName: string
  supportsSessionLoad: boolean
  supportsImages: boolean
  supportsThinking: boolean
  captureCliSessionId: boolean
  needsStandardPermission: boolean
  modes: string[]
}

const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  claude: {
    agentName: 'claude-code-claude',
    supportsSessionLoad: true,
    supportsImages: true,
    supportsThinking: true,
    captureCliSessionId: true,
    needsStandardPermission: false,
    modes: ['code', 'plan'],
  },
  qoder: {
    agentName: 'claude-code-qoder',
    supportsSessionLoad: true,
    supportsImages: true,
    supportsThinking: true,
    captureCliSessionId: true,
    needsStandardPermission: false,
    modes: ['code', 'plan'],
  },
  codex: {
    agentName: 'codex',
    supportsSessionLoad: false,
    supportsImages: false,
    supportsThinking: false,
    captureCliSessionId: false,
    needsStandardPermission: false,
    modes: ['code'],
  },
}

export interface CliACPAdapterOptions {
  command: string
  baseArgs: string[]
  env?: Record<string, string>
  provider?: string
  cwd?: string
  promptTimeoutMs?: number
  permissionTimeoutMs?: number
}

export class CliACPAdapter extends EventEmitter implements ACPAgentAdapter {
  private sessionId: string
  private _state: AdapterState = 'created'
  private promptResolver: {
    resolve: (result: SessionPromptResult) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  } | null = null
  private cliSessionId: string | null = null
  private cliVersion = '1.0.0'
  private currentUsage: ACPUsage = {}
  private config: ProviderConfig
  private promptTimeoutMs: number
  private permissionTimeoutMs: number
  private _pendingClientRequests: Map<string, {
    resolve: (result: ACPRequestPermissionResult) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }> = new Map()
  private _clientRequestSeq = 0
  private _updateCount = 0
  private _lastUpdateType: string | null = null
  private _lastUpdateAt: number | null = null
  private _promptStartedAt: number | null = null
  private _lastPromptDurationMs: number | null = null
  private _recentUpdates: ACPUpdateEntry[] = []

  get state(): AdapterState {
    return this._state
  }

  constructor(
    private streamManager: StreamJsonManager,
    private options: CliACPAdapterOptions,
  ) {
    super()
    this.sessionId = streamManager.getSessionId()
    this.config = PROVIDER_CONFIGS[options.provider ?? 'claude'] ?? { ...PROVIDER_CONFIGS.claude, needsStandardPermission: true }
    this.promptTimeoutMs = options.promptTimeoutMs ?? DEFAULT_PROMPT_TIMEOUT_MS
    this.permissionTimeoutMs = options.permissionTimeoutMs ?? DEFAULT_PERMISSION_TIMEOUT_MS
    this.setupEventBridge()
  }

  handleInitialize(_params: InitializeParams): InitializeResult {
    this.pushUpdate({ ts: Date.now(), type: 'initialize', summary: 'client initialize', dir: 'in', data: _params })
    this.transitionState('initialized', 'initialize')
    log.info('ACP initialized', { sessionId: this.sessionId })

    return {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: this.config.supportsSessionLoad,
        promptCapabilities: {
          image: this.config.supportsImages,
          audio: false,
          embeddedContext: true,
        },
        mcpCapabilities: {
          http: true,
          sse: false,
        },
        sessionCapabilities: {
          list: false,
        },
        _meta: {
          'openteam/modes': this.config.modes,
        },
      },
      agentInfo: {
        name: this.config.agentName,
        title: `OpenTeam · ${this.config.agentName}`,
        version: this.cliVersion,
      },
      authMethods: [],
    }
  }

  async handleSessionNew(params: SessionNewParams): Promise<SessionNewResult> {
    const spawnOptions: StreamJsonOptions = {
      command: this.options.command,
      args: [...this.options.baseArgs],
      cwd: params.cwd,
      env: this.options.env,
      provider: this.options.provider as StreamJsonOptions['provider'],
    }

    this.pushUpdate({ ts: Date.now(), type: 'session/new', summary: `cwd=${params.cwd}`, dir: 'in', data: params })
    await this.streamManager.spawn(spawnOptions)
    this.transitionState('active', 'session/new')

    log.info('ACP session created', { sessionId: this.sessionId, cwd: params.cwd })
    return { sessionId: this.sessionId }
  }

  async handleSessionLoad(params: SessionLoadParams): Promise<SessionLoadResult> {
    if (!this.config.supportsSessionLoad) {
      throw new Error(`Provider ${this.options.provider} does not support session/load`)
    }

    const args = [...this.options.baseArgs, '--resume', params.sessionId]

    const spawnOptions: StreamJsonOptions = {
      command: this.options.command,
      args,
      cwd: params.cwd,
      provider: this.options.provider as StreamJsonOptions['provider'],
    }

    this.pushUpdate({ ts: Date.now(), type: 'session/load', summary: `resume=${params.sessionId}`, dir: 'in', data: params })
    await this.streamManager.spawn(spawnOptions)
    this.transitionState('active', 'session/load')

    log.info('ACP session loaded', { sessionId: this.sessionId, cliSessionId: params.sessionId })
    return null
  }

  async handleSessionPrompt(params: SessionPromptParams): Promise<SessionPromptResult> {
    if (this._state !== 'active') {
      throw new Error(`Cannot prompt in state: ${this._state}`)
    }
    if (this.promptResolver) {
      throw new Error('Another prompt is already in progress')
    }

    this.transitionState('prompting', 'session/prompt')
    this._promptStartedAt = Date.now()
    this.currentUsage = {}

    const textParts: string[] = []
    const images: Array<{ data: string; mediaType: string }> = []

    for (const block of params.prompt) {
      if (block.type === 'text') {
        textParts.push(block.text)
      } else if (block.type === 'image' && this.config.supportsImages) {
        images.push({ data: block.data, mediaType: block.mimeType })
      }
    }
    let text = textParts.join('\n')

    if (text.startsWith('/') && this.options.provider !== 'codex' && this.options.cwd) {
      const expanded = await expandSlashCommand(text, this.options.cwd)
      if (expanded !== text) {
        log.warn('Safety-net slash expansion triggered in ACP adapter — upstream missed expansion', {
          sessionId: this.sessionId,
          command: text.split(/\s/)[0],
          cwd: this.options.cwd,
        })
        text = expanded
      }
    }

    this.pushUpdate({ ts: Date.now(), type: 'session/prompt', summary: text.length > 80 ? text.slice(0, 80) + '…' : text, dir: 'in', data: params })

    log.info('ACP prompt → CLI stdin', {
      sessionId: this.sessionId,
      provider: this.options.provider,
      textLen: text.length,
      imageCount: images.length,
    })
    this.streamManager.write(text, images.length > 0 ? images : undefined)

    return new Promise<SessionPromptResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.promptResolver = null
        this.resolvePromptDuration()
        this.transitionState('active', 'prompt/timeout')
        this.emitDebug('acp:prompt-error', { sessionId: this.sessionId, error: 'timeout' })
        reject(new Error(`Prompt timeout after ${this.promptTimeoutMs}ms`))
      }, this.promptTimeoutMs)

      this.promptResolver = { resolve, reject, timer }
    })
  }

  handleSessionCancel(_params: SessionCancelParams): void {
    if (this._state !== 'prompting') return

    this.pushUpdate({ ts: Date.now(), type: 'session/cancel', summary: 'user cancelled', dir: 'in', data: _params })

    for (const [id] of this._pendingClientRequests) {
      this.emitSessionUpdate({
        sessionUpdate: 'tool_call_update',
        toolCallUpdate: { toolCallId: id, status: 'cancelled' },
      })
    }

    for (const [requestId, pending] of this._pendingClientRequests) {
      clearTimeout(pending.timer)
      pending.resolve({ outcome: { outcome: 'cancelled' } })
      this._pendingClientRequests.delete(requestId)
    }

    this.streamManager.kill('SIGINT')

    if (this.promptResolver) {
      clearTimeout(this.promptResolver.timer)
      this.promptResolver.resolve({ stopReason: 'cancelled', usage: this.currentUsage })
      this.promptResolver = null
    }

    this.resolvePromptDuration()
    this.transitionState('active', 'session/cancel')
    this.emitDebug('acp:prompt-complete', { sessionId: this.sessionId, stopReason: 'cancelled', durationMs: this._lastPromptDurationMs })
    log.info('ACP session cancelled', { sessionId: this.sessionId })
  }

  getCliSessionId(): string | null {
    return this.cliSessionId ?? this.streamManager.getCliSessionId()
  }

  write(text: string, images?: Array<{ data: string; mediaType: string }>): void {
    this.streamManager.write(text, images)
  }

  kill(signal?: string): void {
    this.streamManager.kill(signal)
  }

  getSessionId(): string {
    return this.sessionId
  }

  getCurrentMessages(): ParsedMessage[] | null {
    return this.streamManager.getCurrentMessages()
  }

  isAlive(): boolean {
    return this.streamManager.isAlive()
  }

  getPid(): number | undefined {
    return this.streamManager.getPid()
  }

  destroy(): void {
    if (this.promptResolver) {
      clearTimeout(this.promptResolver.timer)
      this.promptResolver.reject(new Error('Adapter destroyed'))
      this.promptResolver = null
    }
    for (const [requestId, pending] of this._pendingClientRequests) {
      clearTimeout(pending.timer)
      pending.reject(new Error('Adapter destroyed'))
      this._pendingClientRequests.delete(requestId)
    }
    this.streamManager.kill('SIGTERM')
    this.transitionState('exited', 'destroy')
    this.removeAllListeners()
    log.info('ACP adapter destroyed', { sessionId: this.sessionId })
  }

  async requestPermission(params: ACPRequestPermissionParams): Promise<ACPRequestPermissionResult> {
    if (!this.config.needsStandardPermission) {
      const fallbackOption = params.options.find(o => o.kind === 'allow_once') ?? params.options[0]
      const optionId = fallbackOption?.optionId ?? 'allow_once'
      log.warn('requestPermission called on stream-json provider — returning allow_once placeholder', {
        sessionId: this.sessionId,
        provider: this.options.provider,
        toolCallId: params.toolCall.toolCallId,
        selectedOptionId: optionId,
      })
      this.pushUpdate({
        ts: Date.now(),
        type: 'session/request_permission',
        summary: `auto allow_once (stream-json) → ${optionId}`,
        dir: 'in',
        data: params,
      })
      return { outcome: { outcome: 'selected', optionId } }
    }

    const requestId = `${this.sessionId}-${++this._clientRequestSeq}-${Date.now().toString(36)}`
    this.pushUpdate({
      ts: Date.now(),
      type: 'session/request_permission',
      summary: `${params.toolCall.title} (${params.options.length} options)`,
      dir: 'out',
      data: { requestId, ...params },
    })

    return new Promise<ACPRequestPermissionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingClientRequests.delete(requestId)
        const toolTitle = params.toolCall.title
        const toolCallId = params.toolCall.toolCallId
        log.warn('Permission request timeout', {
          sessionId: this.sessionId, requestId, toolCallId, toolTitle,
          timeoutMs: this.permissionTimeoutMs,
        })
        trackEvent('agent', 'agent.acp_permission_timeout', {
          sessionId: this.sessionId, requestId, toolCallId,
          timeoutMs: this.permissionTimeoutMs,
        })
        this.emit('acp:permission-timeout', {
          requestId,
          toolCallId,
          toolTitle,
          timeoutMs: this.permissionTimeoutMs,
        })
        this.pushUpdate({
          ts: Date.now(),
          type: 'session/request_permission',
          summary: `timeout after ${this.permissionTimeoutMs}ms`,
          dir: 'in',
          data: { requestId, timeout: true },
        })
        reject(new Error(`Permission request timeout after ${this.permissionTimeoutMs}ms`))
      }, this.permissionTimeoutMs)

      this._pendingClientRequests.set(requestId, { resolve, reject, timer })
      this.emit('acp:client-request', {
        requestId,
        method: 'session/request_permission',
        params,
      })
    })
  }

  handleClientResponse(requestId: string, outcome: ACPRequestPermissionResult['outcome']): void {
    const pending = this._pendingClientRequests.get(requestId)
    if (!pending) {
      log.warn('handleClientResponse: no pending request', { sessionId: this.sessionId, requestId })
      return
    }
    clearTimeout(pending.timer)
    this._pendingClientRequests.delete(requestId)
    pending.resolve({ outcome })
    this.pushUpdate({
      ts: Date.now(),
      type: 'session/request_permission_response',
      summary: outcome.outcome === 'selected' ? `selected ${outcome.optionId}` : 'cancelled',
      dir: 'in',
      data: { requestId, outcome },
    })
  }

  markReady(): void {
    if (this._state === 'initialized') {
      this.transitionState('active', 'markReady')
      log.info('ACP adapter marked ready', { sessionId: this.sessionId })
    }
  }

  replayMessages(messages: ParsedMessage[], type: 'full' | 'delta'): void {
    this.emitSessionUpdate({
      sessionUpdate: '_openteam/messages_batch',
      messages: messages as unknown as import('../../shared/acp-types').OpenTeamParsedMessage[],
      replacedStatsId: null,
      batchType: type,
    }, true)
    log.debug('replayMessages via ACP', { sessionId: this.sessionId, type, count: messages.length })
  }

  getInspectState(): ACPAdapterInspect {
    return {
      state: this._state,
      provider: this.options.provider ?? 'claude',
      config: {
        supportsSessionLoad: this.config.supportsSessionLoad,
        supportsImages: this.config.supportsImages,
        supportsThinking: this.config.supportsThinking,
        modes: this.config.modes,
      },
      promptInFlight: this._state === 'prompting',
      promptStartedAt: this._promptStartedAt,
      lastPromptDurationMs: this._lastPromptDurationMs,
      cliSessionId: this.cliSessionId,
      updateCount: this._updateCount,
      lastUpdateType: this._lastUpdateType,
      lastUpdateAt: this._lastUpdateAt,
      recentUpdates: this._recentUpdates,
    }
  }

  private setupEventBridge(): void {
    this.streamManager.on('session:structured-message', (data: {
      type: string
      messages: ParsedMessage[]
      replacedStatsId: string | null
    }) => {
      this.emitSessionUpdate({
        sessionUpdate: '_openteam/messages_batch',
        messages: data.messages as unknown as import('../../shared/acp-types').OpenTeamParsedMessage[],
        replacedStatsId: data.replacedStatsId,
      })

      for (const msg of data.messages) {
        if (msg.type === 'stats' && msg.stats) {
          this.currentUsage = {
            inputTokens: msg.stats.inputTokens,
            outputTokens: msg.stats.outputTokens,
            cacheReadTokens: msg.stats.cacheReadInputTokens,
            cacheCreationTokens: msg.stats.cacheCreationInputTokens,
            costUsd: msg.stats.costUsd,
          }

          if (msg.isTurnEnd && this.promptResolver) {
            clearTimeout(this.promptResolver.timer)
            this.promptResolver.resolve({ stopReason: 'end_turn', usage: this.currentUsage })
            this.promptResolver = null
            this.resolvePromptDuration()
            this.transitionState('active', 'prompt/end_turn')
            this.emitDebug('acp:prompt-complete', { sessionId: this.sessionId, stopReason: 'end_turn', durationMs: this._lastPromptDurationMs })
          }
        }
      }
    })

    this.streamManager.on('session:partial-text', (delta: { blockIndex: number; text: string }) => {
      this.emitSessionUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: delta.text, _meta: { blockIndex: delta.blockIndex } },
      })
    })

    this.streamManager.on('activity', (state: ActivityState) => {
      const { phase, background, currentTool, toolCount, toolCompleted, hasText, cost, tokens, modelUsage, logLine, fileOp, recentTools, updatedAt } = state
      this.emitSessionUpdate({
        sessionUpdate: '_openteam/activity',
        activity: { phase, background, currentTool, toolCount, toolCompleted, hasText, cost, tokens, modelUsage, logLine, fileOp, recentTools, updatedAt },
      })
    })

    if (this.config.captureCliSessionId) {
      this.streamManager.on('cli-session-id', (sid: string) => {
        this.cliSessionId = sid
      })
    }

    this.streamManager.on('exit', ({ exitCode }: { exitCode: number | null }) => {
      if (this.promptResolver) {
        clearTimeout(this.promptResolver.timer)
        this.resolvePromptDuration()
        if (exitCode === 0) {
          this.promptResolver.resolve({ stopReason: 'end_turn', usage: this.currentUsage })
          this.emitDebug('acp:prompt-complete', { sessionId: this.sessionId, stopReason: 'end_turn', durationMs: this._lastPromptDurationMs })
        } else {
          this.promptResolver.reject(new Error(`CLI exited with code ${exitCode}`))
          this.emitDebug('acp:prompt-error', { sessionId: this.sessionId, error: `exit_code_${exitCode}` })
        }
        this.promptResolver = null
      }
      this.transitionState('exited', `exit/${exitCode}`)
    })
  }

  private emitSessionUpdate(update: SessionUpdateType, isReplay = false): void {
    const now = Date.now()
    this._updateCount++
    this._lastUpdateType = update.sessionUpdate
    this._lastUpdateAt = now

    this.pushUpdate({ ts: now, type: update.sessionUpdate, summary: this.summarizeUpdate(update), dir: 'out', data: update, isReplay })

    const params: ACPSessionUpdateParams = {
      sessionId: this.sessionId,
      update,
    }
    this.emit('acp:session-update', params)
    this.emitDebug('acp:update', { updateType: update.sessionUpdate, isReplay })
  }

  private transitionState(to: AdapterState, trigger: string): void {
    const from = this._state
    this._state = to
    this.emitDebug('acp:state-change', { from, to, trigger })
  }

  private resolvePromptDuration(): void {
    if (this._promptStartedAt) {
      this._lastPromptDurationMs = Date.now() - this._promptStartedAt
      this._promptStartedAt = null
    }
  }

  private pushUpdate(entry: ACPUpdateEntry): void {
    this._recentUpdates.unshift(entry)
    if (this._recentUpdates.length > MAX_RECENT_UPDATES) {
      this._recentUpdates.length = MAX_RECENT_UPDATES
    }
  }

  private summarizeUpdate(update: SessionUpdateType): string {
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        return `text: ${update.content.type === 'text' ? update.content.text.slice(0, 40) : '[non-text]'}`
      case 'tool_call':
        return update.toolCall.title
      case 'tool_call_update':
        return `${update.toolCallUpdate.toolCallId.slice(0, 8)}… ${update.toolCallUpdate.status ?? 'partial'}`
      case '_openteam/activity':
        return `${(update as any).activity?.phase ?? ''}${(update as any).activity?.currentTool ? ` → ${(update as any).activity.currentTool}` : ''}`
      case '_openteam/thinking':
        return `thinking: ${(update as any).text?.slice(0, 40) ?? ''}`
      case '_openteam/messages_batch':
        return `${(update as any).messages?.length ?? 0} msgs`
      default:
        return update.sessionUpdate
    }
  }

  private emitDebug(event: string, data: Record<string, unknown>): void {
    if (this.listenerCount('acp:debug') > 0) {
      this.emit('acp:debug', { event, ...data })
    }
  }
}
