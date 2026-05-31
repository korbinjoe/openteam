/**
 * memberStatus — shared mapping from a CLI activity phase string to the
 * sidebar's `ChatMemberStatus` vocabulary.
 *
 * Mirrors `server/stores/MemberAggregator.ts` `PHASE_TO_STATUS` so the live
 * WS payload (`chat:activity`) updates `chat.members[]` with the same status
 * the server would compute on a fresh GET. Without this, members[] stays
 * frozen at its initial-fetch value and the sidebar status dot misreports
 * whenever an agent transitions between turns.
 *
 * `waiting_input` → `waiting_input`: agent finished its turn, awaiting user's
 * next message. `waiting_confirmation` → `waiting`: true block needing user
 * action (AskUserQuestion / ExitPlanMode).
 */

import type { ChatMember, ChatMemberStatus } from '@/components/workspace/types'
import type { ChatActivityPayload } from '@/types/chat'

export const PHASE_TO_MEMBER_STATUS: Record<string, ChatMemberStatus> = {
  thinking: 'running',
  responding: 'running',
  tool_running: 'running',
  initializing: 'running',
  waiting_input: 'waiting_input',
  waiting_confirmation: 'waiting',
  error: 'error',
  completed: 'done',
}

export const phaseToMemberStatus = (phase: string | undefined): ChatMemberStatus | undefined => {
  if (!phase) return undefined
  return PHASE_TO_MEMBER_STATUS[phase]
}

export const ACTIVE_PHASES = new Set<string>(
  Object.entries(PHASE_TO_MEMBER_STATUS)
    .filter(([, s]) => s === 'running')
    .map(([p]) => p),
)

/**
 * Reconcile `chat.members[]` from a live `chat:activity` WS payload.
 *
 * Without this, members[] stays frozen at its initial GET value (typically
 * 'idle') and the sidebar's `chatStatusDot` — which prefers the members[]
 * rollup over `chat.status` — keeps reporting gray while an agent is mid-turn.
 *
 * Strategy:
 *   - Members present in `payload.agentActivities`: status mapped from phase.
 *   - Members absent on a terminal payload (`completed` / `error`): any
 *     leftover running/waiting is neutralized to done/error so the ripple
 *     stops. Idle/done stay as-is.
 *   - Members absent on a non-terminal payload: status untouched (the next
 *     GET will resync from server-side MemberAggregator).
 */
export const reconcileMembersFromActivity = (
  members: ChatMember[] | undefined,
  payload: ChatActivityPayload,
): ChatMember[] | undefined => {
  if (!members || members.length === 0) return members
  const phaseByAgent = new Map<string, string>()
  for (const a of payload.agentActivities ?? []) phaseByAgent.set(a.agentId, a.phase)

  const isTerminal = payload.phase === 'completed' || payload.phase === 'error'
  const terminalStatus: ChatMemberStatus = payload.phase === 'error' ? 'error' : 'done'

  const updated = members.map((m) => {
    const live = phaseByAgent.get(m.agentId)
    if (live) {
      const next = phaseToMemberStatus(live)
      return next && next !== m.status ? { ...m, status: next } : m
    }
    if (isTerminal && (m.status === 'running' || m.status === 'waiting' || m.status === 'waiting_input')) {
      return { ...m, status: terminalStatus }
    }
    return m
  })

  const knownIds = new Set(members.map((m) => m.agentId))
  let appended = false
  phaseByAgent.forEach((phase, agentId) => {
    if (knownIds.has(agentId)) return
    const status = phaseToMemberStatus(phase)
    if (!status) return
    appended = true
    updated.push({ agentId, role: 'worker', status, lastMessageAt: '' })
  })

  return appended ? updated : (updated === members ? members : updated)
}
