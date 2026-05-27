/**
 * ActivityAggregator - Chat  Activity
 *
 *  SessionRegistry
 * -  session  activity
 * -  chatId  Agent  activity  phase
 * -  activity  Dashboard
 * - phase  chat statusidle ↔ running
 * -  API  activity
 */

import type { ManagedSession } from './SessionRegistry'
import type { ActivityState } from './ActivityDeriver'
import type { ChatStore } from '../stores/ChatStore'
import { createLogger } from '../lib/logger'

const log = createLogger('ActivityAggregator')

/**
 * Phase
 * error/waiting_confirmationtool_running/thinking
 *  Agent
 */
const PHASE_PRIORITY = ['error', 'waiting_confirmation', 'tool_running', 'responding', 'thinking', 'waiting_input', 'completed', 'initializing'] as const

function pickTopPhase(phases: string[]): string {
  for (const phase of PHASE_PRIORITY) {
    if (phases.includes(phase)) return phase
  }
  return 'initializing'
}

export interface ChatActivityPayload {
  chatId: string
  phase: string
  currentTool?: string
  toolCount: number
  toolCompleted: number
  cost?: number
  logLine?: string
  exitReason?: 'user_stop' | 'timeout' | 'model_switch'
  agentActivities?: AgentActivitySnapshot[]
  latestMessage?: {
    role: 'user' | 'agent' | 'assistant'
    text: string
    at: number
  }
}

export interface AgentActivitySnapshot {
  agentId: string
  agentName: string
  phase: string
  currentTool?: string
  toolCount: number
  toolCompleted: number
  cost?: number
  /**  Read index.ts$ npm install */
  logLine?: string
  fileOp?: {
    path: string
    operation: 'create' | 'edit' | 'delete' | 'read'
  }
}

export type ChatStatusChangedCallback = (chatId: string, status: string) => void
export type ChatActivityChangedCallback = (payload: ChatActivityPayload) => void

/** VSCode  Disposableon*()  dispose()  */
export interface Disposable {
  dispose(): void
}

export class ActivityAggregator {
  private chatStatusChangedCallbacks = new Set<ChatStatusChangedCallback>()
  private chatActivityChangedCallbacks = new Set<ChatActivityChangedCallback>()

  constructor(
    private sessions: Map<string, ManagedSession>,
    private chatStore: ChatStore | undefined,
    private findAllByChat: (chatId: string) => ManagedSession[],
  ) {}

  onChatStatusChanged(callback: ChatStatusChangedCallback): Disposable {
    this.chatStatusChangedCallbacks.add(callback)
    return { dispose: () => { this.chatStatusChangedCallbacks.delete(callback) } }
  }

  onActivityChanged(callback: ChatActivityChangedCallback): Disposable {
    this.chatActivityChangedCallbacks.add(callback)
    return { dispose: () => { this.chatActivityChangedCallbacks.delete(callback) } }
  }

  /** SessionRegistry  register/exit  */
  notifyChatStatus(chatId: string, status: string): void {
    this.chatStatusChangedCallbacks.forEach((cb) => cb(chatId, status))
  }

  /** SessionRegistry  activity */
  notifyActivity(payload: ChatActivityPayload): void {
    this.chatActivityChangedCallbacks.forEach((cb) => cb(payload))
  }

  /** activity  SessionRegistry  exit  */
  hasActivityListeners(): boolean {
    return this.chatActivityChangedCallbacks.size > 0
  }

  /**
   *  activity
   *  phase  currentTool  Dashboard
   */
  updateActivity(sessionId: string, activity: ActivityState): void {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const prev = session.activitySnapshot
    session.activitySnapshot = activity

    const isTerminal = activity.phase === 'completed' || activity.phase === 'error'

    const phaseChanged = !prev || prev.phase !== activity.phase
    if (session.chatId && this.chatStore && phaseChanged) {
      const isNowIdle = activity.phase === 'waiting_input' || activity.phase === 'waiting_confirmation'
      const prevPhase = prev?.phase ?? 'tool_running'
      const wasIdle = prevPhase === 'waiting_input' || prevPhase === 'waiting_confirmation'

      if (isNowIdle && !wasIdle) {
        const allIdle = this.findAllByChat(session.chatId).every((s) => {
          const phase = s.activitySnapshot?.phase
          return !phase || phase === 'waiting_input' || phase === 'waiting_confirmation' || phase === 'completed'
        })
        if (allIdle) {
          const taskStatus = activity.phase === 'waiting_confirmation' ? 'waiting_confirm' as const : 'waiting_input' as const
          this.chatStore.update(session.chatId, { status: 'idle', taskStatus }).catch((e) => log.warn('Failed to update chat status to idle', { chatId: session.chatId, error: e instanceof Error ? e.message : String(e) }))
          this.notifyChatStatus(session.chatId, 'idle')
        }
      } else if (!isNowIdle && wasIdle) {
        const remainingIdle = this.findAllByChat(session.chatId)
          .filter((s) => s.sessionId !== sessionId)
          .map((s) => s.activitySnapshot?.phase)
          .filter((p): p is 'waiting_input' | 'waiting_confirmation' => p === 'waiting_input' || p === 'waiting_confirmation')
        if (remainingIdle.length === 0) {
          if (!isTerminal) {
            this.chatStore.update(session.chatId, { status: 'running', taskStatus: 'running' }).catch((e) => log.warn('Failed to update chat status to running', { chatId: session.chatId, error: e instanceof Error ? e.message : String(e) }))
            this.notifyChatStatus(session.chatId, 'running')
          }
        } else {
          const hasConfirm = remainingIdle.includes('waiting_confirmation')
          const taskStatus = hasConfirm ? 'waiting_confirm' as const : 'waiting_input' as const
          this.chatStore.update(session.chatId, { status: 'idle', taskStatus }).catch((e) => log.warn('Failed to update chat status to idle (remaining waiters)', { chatId: session.chatId, error: e instanceof Error ? e.message : String(e) }))
          this.notifyChatStatus(session.chatId, 'idle')
        }
      }
    }

    if (this.chatActivityChangedCallbacks.size > 0 && session.chatId) {
      if (isTerminal) {
        const finalPayload = this.buildFinalPayload(session.chatId, session)
        this.notifyActivity(finalPayload)
      } else {
        const hasChanged = !prev ||
          prev.phase !== activity.phase ||
          prev.currentTool !== activity.currentTool ||
          prev.toolCompleted !== activity.toolCompleted ||
          prev.logLine !== activity.logLine

        if (hasChanged) {
          this.broadcastChatActivity(session.chatId)
        }
      }
    }
  }

  /**
   *  chatId  activity  Agent
   */
  broadcastChatActivity(chatId: string): void {
    const agents = this.collectAgentActivities(chatId)
    if (agents.length === 0) return

    const topPhase = pickTopPhase(agents.map((a) => a.phase))

    const payload: ChatActivityPayload = {
      chatId,
      phase: topPhase,
      currentTool: agents.find((a) => a.currentTool)?.currentTool,
      toolCount: agents.reduce((sum, a) => sum + a.toolCount, 0),
      toolCompleted: agents.reduce((sum, a) => sum + a.toolCompleted, 0),
      cost: agents.reduce((sum, a) => sum + (a.cost ?? 0), 0) || undefined,
      agentActivities: agents,
    }
    this.notifyActivity(payload)
  }

  buildFinalPayload(chatId: string, session: ManagedSession): ChatActivityPayload {
    const agents = this.collectAgentActivities(chatId)
    const finalPhase = session.activitySnapshot?.phase === 'error' ? 'error' : 'completed'
    return {
      chatId,
      phase: finalPhase,
      toolCount: session.activitySnapshot?.toolCount ?? 0,
      toolCompleted: session.activitySnapshot?.toolCompleted ?? 0,
      cost: session.activitySnapshot?.cost,
      logLine: undefined,
      ...(session.killReason ? { exitReason: session.killReason } : {}),
      ...(agents.length > 0 ? { agentActivities: agents } : {}),
    }
  }

  /**
   *  chatId  session  activity
   */
  collectAgentActivities(chatId: string): AgentActivitySnapshot[] {
    const agents: AgentActivitySnapshot[] = []
    for (const s of this.sessions.values()) {
      if (s.chatId !== chatId || !s.activitySnapshot) continue
      if (s.activitySnapshot.phase === 'completed') continue
      agents.push({
        agentId: s.agentId || s.agentName,
        agentName: s.agentName,
        phase: s.activitySnapshot.phase,
        currentTool: s.activitySnapshot.currentTool,
        toolCount: s.activitySnapshot.toolCount,
        toolCompleted: s.activitySnapshot.toolCompleted,
        cost: s.activitySnapshot.cost,
        logLine: s.activitySnapshot.logLine,
        fileOp: s.activitySnapshot.fileOp,
      })
    }
    return agents
  }

  /**
   *  activity key  chatId
   *  API  WS
   */
  getActiveActivities(): Record<string, ChatActivityPayload> {
    const chatMap = new Map<string, ManagedSession[]>()
    for (const session of this.sessions.values()) {
      if (!session.chatId || !session.activitySnapshot) continue
      const list = chatMap.get(session.chatId) || []
      list.push(session)
      chatMap.set(session.chatId, list)
    }

    const result: Record<string, ChatActivityPayload> = {}
    for (const [chatId, sessions] of chatMap) {
      const agents = sessions
        .filter((s) => s.activitySnapshot && s.activitySnapshot.phase !== 'completed')
        .map((s) => ({
          agentId: s.agentId || s.agentName,
          agentName: s.agentName,
          phase: s.activitySnapshot!.phase,
          currentTool: s.activitySnapshot!.currentTool,
          toolCount: s.activitySnapshot!.toolCount,
          toolCompleted: s.activitySnapshot!.toolCompleted,
          cost: s.activitySnapshot!.cost,
        }))

      if (agents.length === 0) continue

      const topPhase = pickTopPhase(agents.map((a) => a.phase))

      result[chatId] = {
        chatId,
        phase: topPhase,
        currentTool: agents.find((a) => a.currentTool)?.currentTool,
        toolCount: agents.reduce((sum, a) => sum + a.toolCount, 0),
        toolCompleted: agents.reduce((sum, a) => sum + a.toolCompleted, 0),
        cost: agents.reduce((sum, a) => sum + (a.cost ?? 0), 0) || undefined,
        agentActivities: agents,
      }
    }
    return result
  }
}
