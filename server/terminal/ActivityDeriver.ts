/**
 * ActivityDeriver -  JSONL  Agent
 *
 *  ActivityTracker SessionFileWatcher
 *  ParsedMessage  SessionPhase
 *
 * - initializing: PTY CLI
 * - thinking: LLM
 * - responding: LLM
 * - tool_running:
 * - waiting_input:
 * - waiting_confirmation: AskUserQuestion
 * - completed: exit code 0
 * - error:
 *
 * - 'activity': payload  ActivityState
 */

import { EventEmitter } from 'events'
import type { ParsedMessage } from './ConversationParser'

export interface ModelUsageSnapshot {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUsd: number
}

export type AgentPhase =
  | 'initializing'
  | 'thinking'
  | 'tool_running'
  | 'responding'
  | 'waiting_input'
  | 'waiting_confirmation'
  | 'completed'
  | 'error'

export interface ActivityState {
  phase: AgentPhase
  background: boolean
  currentTool?: string
  toolCount: number
  toolCompleted: number
  hasText: boolean
  cost?: number
  tokens?: { input: number; output: number; cacheRead?: number; cacheCreation?: number }
  modelUsage?: ModelUsageSnapshot[]
  logLine?: string
  fileOp?: {
    path: string
    operation: 'create' | 'edit' | 'delete' | 'read'
  }
  recentTools?: Array<{ tool: string; summary: string }>
  updatedAt: number
}

function extractFileOp(toolName: string, inputStr: string): ActivityState['fileOp'] | undefined {
  try {
    const input = JSON.parse(inputStr)
    switch (toolName) {
      case 'Write':
        return input.file_path ? { path: input.file_path, operation: 'create' } : undefined
      case 'Edit':
        return input.file_path ? { path: input.file_path, operation: 'edit' } : undefined
      case 'Read':
        return input.file_path ? { path: input.file_path, operation: 'read' } : undefined
      default:
        return undefined
    }
  } catch {
    return undefined
  }
}

function extractLogLine(toolName: string, inputStr: string): string {
  try {
    const input = JSON.parse(inputStr)
    const basename = (p: string) => p.split('/').pop() || p

    switch (toolName) {
      case 'Read':
        return input.file_path ? `Read ${basename(input.file_path)}` : 'Read'
      case 'Edit':
        return input.file_path ? `Edit ${basename(input.file_path)}` : 'Edit'
      case 'Write':
        return input.file_path ? `Write ${basename(input.file_path)}` : 'Write'
      case 'Bash': {
        const cmd = (input.command || '').slice(0, 40)
        return cmd ? `$ ${cmd}${(input.command || '').length > 40 ? '…' : ''}` : 'Bash'
      }
      case 'Grep':
        return input.pattern ? `Grep "${input.pattern}"` : 'Grep'
      case 'Glob':
        return input.pattern ? `Glob ${input.pattern}` : 'Glob'
      case 'Agent':
        return input.description ? `Agent: ${(input.description as string).slice(0, 30)}` : 'Agent'
      case 'WebSearch':
        return input.query ? `Search "${(input.query as string).slice(0, 30)}"` : 'WebSearch'
      case 'WebFetch':
        return 'WebFetch'
      default:
        return toolName
    }
  } catch {
    return toolName
  }
}

export class ActivityDeriver extends EventEmitter {
  private state: ActivityState = this.createInitialState()
  private lastEmittedJson = ''
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  /**  toolUse  waiting_input  waiting_confirmation */
  private lastUnresolvedToolName: string | null = null
  private recentToolsWindow: Array<{ tool: string; summary: string }> = []
  /**  Token = accumulatedUsage + currentTurnPeak */
  private modelUsageMap = new Map<string, ModelUsageSnapshot>()
  private accumulatedUsage = new Map<string, ModelUsageSnapshot>()
  private currentTurnPeak = new Map<string, ModelUsageSnapshot>()

  private createInitialState(): ActivityState {
    return {
      phase: 'initializing',
      background: false,
      toolCount: 0,
      toolCompleted: 0,
      hasText: false,
      updatedAt: Date.now(),
    }
  }

  /**
   *  thinking
   *  StreamJsonManager.write  JSONL
   */
  onUserInput(): void {
    this.lastUnresolvedToolName = null
    this.transition({
      ...this.state,
      phase: 'thinking',
      currentTool: undefined,
      toolCount: 0,
      toolCompleted: 0,
      hasText: false,
      cost: undefined,
      tokens: undefined,
      updatedAt: Date.now(),
    })
  }

  onProcessExit(exitCode: number): void {
    // If the agent finished its turn (waiting_input), a non-zero exit code is
    // process cleanup noise (kill signal, timeout), not a task failure.
    const taskDone = this.state.phase === 'waiting_input' || this.state.phase === 'completed'
    this.transition({
      ...this.state,
      phase: (exitCode === 0 || taskDone) ? 'completed' : 'error',
      currentTool: undefined,
      updatedAt: Date.now(),
    })
  }

  setBackground(background: boolean): void {
    if (this.state.background === background) return
    this.transition({
      ...this.state,
      background,
      updatedAt: Date.now(),
    })
  }

  onFullMessages(messages: ParsedMessage[]): void {
    if (messages.length === 0) return

    this.accumulatedUsage.clear()
    this.currentTurnPeak.clear()
    this.modelUsageMap.clear()

    let toolCount = 0
    let toolCompleted = 0
    let hasText = false
    let cost: number | undefined
    let tokens: { input: number; output: number; cacheRead?: number; cacheCreation?: number } | undefined
    let lastPhase: AgentPhase = 'initializing'
    let currentTool: string | undefined
    this.lastUnresolvedToolName = null
    this.recentToolsWindow = []

    for (const msg of messages) {
      switch (msg.type) {
        case 'text':
          if (msg.role === 'user') {
            toolCount = 0
            toolCompleted = 0
            hasText = false
            cost = undefined
            tokens = undefined
            currentTool = undefined
            this.lastUnresolvedToolName = null
            this.recentToolsWindow = []
            lastPhase = 'thinking'
          } else {
            hasText = true
            lastPhase = 'responding'
          }
          break
        case 'thinking':
          lastPhase = 'thinking'
          break
        case 'toolUse': {
          toolCount++
          currentTool = msg.toolUse?.toolName
          this.lastUnresolvedToolName = currentTool || null
          lastPhase = 'tool_running'
          const tn = msg.toolUse?.toolName || 'unknown'
          const ti = msg.toolUse?.input || ''
          this.recentToolsWindow.push({ tool: tn, summary: extractLogLine(tn, ti) })
          if (this.recentToolsWindow.length > 5) this.recentToolsWindow.shift()
          break
        }
        case 'toolResult':
          toolCompleted++
          currentTool = undefined
          this.lastUnresolvedToolName = null
          lastPhase = 'thinking'
          break
        case 'stats':
          this.updateModelUsage(msg)
          cost = msg.stats?.costUsd
          tokens = msg.stats?.inputTokens != null
            ? { input: msg.stats.inputTokens, output: msg.stats.outputTokens || 0, cacheRead: msg.stats.cacheReadInputTokens || 0, cacheCreation: msg.stats.cacheCreationInputTokens || 0 }
            : undefined
          if (msg.isTurnEnd) {
            this.flushTurnUsage()
            lastPhase = this.deriveWaitingPhase()
            currentTool = undefined
          }
          break
      }
    }

    this.transition({
      phase: lastPhase,
      background: this.state.background,
      currentTool,
      toolCount,
      toolCompleted,
      hasText,
      cost,
      tokens,
      modelUsage: this.modelUsageMap.size > 0 ? Array.from(this.modelUsageMap.values()) : undefined,
      recentTools: this.recentToolsWindow.length > 0 ? [...this.recentToolsWindow] : undefined,
      updatedAt: Date.now(),
    })
  }

  onDeltaMessages(messages: ParsedMessage[]): void {
    for (const msg of messages) {
      switch (msg.type) {
        case 'text':
          if (msg.role === 'user') {
            this.lastUnresolvedToolName = null
            this.transition({
              ...this.state,
              phase: 'thinking',
              currentTool: undefined,
              toolCount: 0,
              toolCompleted: 0,
              hasText: false,
              cost: undefined,
              tokens: undefined,
              logLine: undefined,
              updatedAt: Date.now(),
            })
          } else {
            // agent text → responding
            this.transition({
              ...this.state,
              phase: 'responding',
              hasText: true,
              currentTool: undefined,
              logLine: undefined,
              updatedAt: Date.now(),
            })
          }
          break

        case 'thinking':
          if (this.state.phase !== 'tool_running' || !this.state.currentTool) {
            this.transition({
              ...this.state,
              phase: 'thinking',
              logLine: undefined,
              updatedAt: Date.now(),
            })
          }
          break

        case 'toolUse': {
          this.lastUnresolvedToolName = msg.toolUse?.toolName || null
          const toolName = msg.toolUse?.toolName || 'unknown'
          const toolInput = msg.toolUse?.input || ''
          const logLine = extractLogLine(toolName, toolInput)
          this.recentToolsWindow.push({ tool: toolName, summary: logLine })
          if (this.recentToolsWindow.length > 5) this.recentToolsWindow.shift()
          this.transition({
            ...this.state,
            phase: 'tool_running',
            currentTool: toolName,
            toolCount: this.state.toolCount + 1,
            logLine,
            fileOp: extractFileOp(toolName, toolInput),
            recentTools: [...this.recentToolsWindow],
            updatedAt: Date.now(),
          })
          break
        }

        case 'toolResult':
          this.lastUnresolvedToolName = null
          this.transition({
            ...this.state,
            phase: 'thinking',
            toolCompleted: this.state.toolCompleted + 1,
            currentTool: undefined,
            fileOp: undefined,
            updatedAt: Date.now(),
          })
          break

        case 'stats': {
          this.updateModelUsage(msg)
          if (msg.isTurnEnd) {
            this.flushTurnUsage()
          }
          const nextPhase = msg.isTurnEnd
            ? this.deriveWaitingPhase()
            : this.state.phase
          this.transition({
            ...this.state,
            phase: nextPhase,
            currentTool: msg.isTurnEnd ? undefined : this.state.currentTool,
            cost: msg.stats?.costUsd,
            tokens: msg.stats?.inputTokens != null
              ? { input: msg.stats.inputTokens, output: msg.stats.outputTokens || 0, cacheRead: msg.stats.cacheReadInputTokens || 0, cacheCreation: msg.stats.cacheCreationInputTokens || 0 }
              : this.state.tokens,
            modelUsage: this.modelUsageMap.size > 0 ? Array.from(this.modelUsageMap.values()) : undefined,
            logLine: msg.isTurnEnd ? undefined : this.state.logLine,
            updatedAt: Date.now(),
          })
          break
        }
      }
    }
  }

  private updateModelUsage(msg: ParsedMessage): void {
    if (msg.type !== 'stats' || !msg.model) return

    const peak = this.currentTurnPeak.get(msg.model) || {
      model: msg.model,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      costUsd: 0,
    }
    peak.inputTokens = Math.max(peak.inputTokens, msg.stats?.inputTokens || 0)
    peak.outputTokens = Math.max(peak.outputTokens, msg.stats?.outputTokens || 0)
    peak.cacheReadInputTokens = Math.max(peak.cacheReadInputTokens, msg.stats?.cacheReadInputTokens || 0)
    peak.cacheCreationInputTokens = Math.max(peak.cacheCreationInputTokens, msg.stats?.cacheCreationInputTokens || 0)
    peak.costUsd = Math.max(peak.costUsd, msg.stats?.costUsd || 0)
    this.currentTurnPeak.set(msg.model, peak)

    this.rebuildModelUsageMap()
  }

  /**  accumulatedUsage currentTurnPeak */
  private flushTurnUsage(): void {
    for (const [model, peak] of this.currentTurnPeak) {
      const acc = this.accumulatedUsage.get(model)
      if (acc) {
        acc.inputTokens += peak.inputTokens
        acc.outputTokens += peak.outputTokens
        acc.cacheReadInputTokens += peak.cacheReadInputTokens
        acc.cacheCreationInputTokens += peak.cacheCreationInputTokens
        acc.costUsd += peak.costUsd
      } else {
        this.accumulatedUsage.set(model, { ...peak })
      }
    }
    this.currentTurnPeak.clear()
    this.rebuildModelUsageMap()
  }

  /** modelUsageMap = accumulatedUsage + currentTurnPeak */
  private rebuildModelUsageMap(): void {
    const merged = new Map<string, ModelUsageSnapshot>()
    for (const [model, acc] of this.accumulatedUsage) {
      merged.set(model, { ...acc })
    }
    for (const [model, peak] of this.currentTurnPeak) {
      const existing = merged.get(model)
      if (existing) {
        existing.inputTokens += peak.inputTokens
        existing.outputTokens += peak.outputTokens
        existing.cacheReadInputTokens += peak.cacheReadInputTokens
        existing.cacheCreationInputTokens += peak.cacheCreationInputTokens
        existing.costUsd += peak.costUsd
      } else {
        merged.set(model, { ...peak })
      }
    }
    this.modelUsageMap = merged
  }

  getState(): ActivityState {
    return { ...this.state }
  }

  getInspectState() {
    return {
      phase: this.state.phase,
      updatedAt: this.state.updatedAt,
      currentTool: this.state.currentTool ?? null,
      turnIndex: this.state.toolCount,
      toolCount: this.state.toolCount,
      toolCompleted: this.state.toolCompleted,
      modelUsage: Object.fromEntries(
        Array.from(this.modelUsageMap.entries()).map(([model, usage]) => [
          model,
          { input: usage.inputTokens, output: usage.outputTokens, cost: usage.costUsd },
        ]),
      ),
    }
  }

  destroy(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.removeAllListeners()
  }

  /**
   *  waiting_input  waiting_confirmation
   */
  private deriveWaitingPhase(): AgentPhase {
    if (this.lastUnresolvedToolName === 'AskUserQuestion' || this.lastUnresolvedToolName === 'ExitPlanMode' || this.lastUnresolvedToolName === 'EnterPlanMode') {
      return 'waiting_confirmation'
    }
    return 'waiting_input'
  }

  private transition(newState: ActivityState): void {
    const isCurrentTerminal = this.state.phase === 'completed' || this.state.phase === 'error'
    const isNewTerminal = newState.phase === 'completed' || newState.phase === 'error'
    if (isCurrentTerminal && !isNewTerminal) return

    this.state = newState

    if (newState.phase === 'completed' || newState.phase === 'error') {
      if (this.debounceTimer) { clearTimeout(this.debounceTimer); this.debounceTimer = null }
      this.emitIfChanged()
      return
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.emitIfChanged()
    }, 100)
  }

  private emitIfChanged(): void {
    const json = JSON.stringify(this.state)
    if (json === this.lastEmittedJson) return
    this.lastEmittedJson = json
    this.emit('activity', { ...this.state })
  }
}
