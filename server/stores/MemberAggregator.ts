/**
 * MemberAggregator - derive Chat.members[] from live session state.
 *
 * Pure read-side enrichment: takes the persisted Chat plus the in-memory
 * SessionRegistry and produces one ChatMember per agent (lead first, then
 * teamAgentIds in order). Status is derived from:
 *   1. active session activity phase (running / waiting / error / done)
 *   2. expertSessions[agentId].exitCode (post-exit done/error)
 *   3. fallback 'idle' when neither is present
 *
 * No JSONL parsing here — that is heavyweight and deferred until measured
 * need (see fix-workspace-v2-task-agent-routing/design.md risk R1). The
 * lastMessage preview is derived from the live activity's currentTool when
 * available.
 */

import type { Chat, ChatMember, ChatMemberRole, ChatMemberStatus } from '../config/types'
import type { SessionRegistry } from '../terminal/SessionRegistry'
import type { AgentActivitySnapshot } from '../terminal/ActivityAggregator'

// `waiting` here means "real block, needs user attention" (AskUserQuestion /
// ExitPlanMode / EnterPlanMode → waiting_confirmation). `waiting_input` is the
// post-turn idle phase the CLI sits in between messages — not a real block —
// so it maps to `idle`, keeping yellow reserved for true demands on the user.
const PHASE_TO_STATUS: Record<string, ChatMemberStatus> = {
  thinking: 'running',
  responding: 'running',
  tool_running: 'running',
  initializing: 'running',
  waiting_input: 'idle',
  waiting_confirmation: 'waiting',
  error: 'error',
  completed: 'done',
}

const phaseToStatus = (phase: string | undefined): ChatMemberStatus | undefined => {
  if (!phase) return undefined
  return PHASE_TO_STATUS[phase]
}

const orderedAgentIds = (chat: Chat): string[] => {
  const seen = new Set<string>()
  const out: string[] = []
  const push = (id: string | undefined): void => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push(id)
  }
  push(chat.primaryAgentId)
  for (const id of chat.teamAgentIds ?? []) push(id)
  // Include ad-hoc experts (joined via @mention) whose runs are recorded in
  // expertSessions but never written back to teamAgentIds — otherwise they
  // get silently dropped from members[] and the V2 toolbar / quad layout.
  for (const id of Object.keys(chat.expertSessions ?? {})) push(id)
  return out
}

const previewFromActivity = (agentAct: AgentActivitySnapshot | undefined): string | undefined => {
  if (!agentAct) return undefined
  if (agentAct.fileOp) {
    return `${agentAct.fileOp.operation} ${agentAct.fileOp.path}`.slice(0, 120)
  }
  if (agentAct.currentTool) {
    const completed = agentAct.toolCompleted
    const total = agentAct.toolCount
    return total > 0 ? `${agentAct.currentTool} (${completed}/${total})` : agentAct.currentTool
  }
  if (agentAct.logLine) return agentAct.logLine.slice(0, 120)
  return undefined
}

export class MemberAggregator {
  constructor(private sessionRegistry?: SessionRegistry) {}

  enrich(chat: Chat): ChatMember[] {
    const ids = orderedAgentIds(chat)
    const liveByAgent = new Map<string, { cliSessionId?: string }>()
    if (this.sessionRegistry) {
      for (const s of this.sessionRegistry.findAllByChat(chat.id)) {
        if (s.agentId) liveByAgent.set(s.agentId, { cliSessionId: s.cliSessionId })
      }
    }
    const activity = this.sessionRegistry?.getActiveActivities()[chat.id]
    const actByAgent = new Map<string, AgentActivitySnapshot>()
    for (const a of activity?.agentActivities ?? []) {
      actByAgent.set(a.agentId, a)
    }

    return ids.map<ChatMember>((agentId) => {
      const role: ChatMemberRole = agentId === chat.primaryAgentId ? 'lead' : 'worker'
      const live = liveByAgent.get(agentId)
      const expert = chat.expertSessions?.[agentId]
      const agentAct = actByAgent.get(agentId)

      let status: ChatMemberStatus = 'idle'
      if (live) {
        status = phaseToStatus(agentAct?.phase) ?? 'running'
      } else if (expert?.exitCode !== undefined) {
        status = (expert.taskCompleted ?? true) ? 'done' : 'error'
      }

      const lastMessage = previewFromActivity(agentAct)

      return {
        agentId,
        role,
        status,
        lastMessageAt: chat.lastMessageAt,
        lastMessage,
        cliSessionId: live?.cliSessionId ?? expert?.cliSessionId,
      }
    })
  }

  /**
   * Worst-of rollup across members, used to keep the legacy chat.status /
   * taskStatus fields in sync without requiring callers to compute it.
   *
   * Priority: error > waiting > running > done > idle
   */
  rollupStatus(members: ChatMember[]): ChatMemberStatus {
    const priority: ChatMemberStatus[] = ['error', 'waiting', 'running', 'done', 'idle']
    for (const p of priority) {
      if (members.some((m) => m.status === p)) return p
    }
    return 'idle'
  }
}
