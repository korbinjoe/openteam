import { toast } from 'sonner'
import i18n from '@/i18n'
import type { Message, AgentActivity } from '../types/chat'
import { buildContentKey, buildMessageInstanceKey } from '../utils/messageDedup'
import type { AgentMessagesMap } from './useAgentMessages'
import { SYSTEM_MESSAGE_AGENT } from './useAgentMessages'

export interface ExpertEventContext {
  isCurrentChatEvent: (payload?: { chatId?: string }) => boolean
  /** Append a chat-level message (errors, system notices) to a specific or default slot. */
  addSystemMessage: (msg: Message) => void
  uid: (prefix: string) => string
  t: (key: string, opts?: Record<string, unknown>) => string
  setExpertActivities: React.Dispatch<React.SetStateAction<Record<string, AgentActivity>>>
  /** Per-agent message store updater. */
  setAgentMessages: React.Dispatch<React.SetStateAction<AgentMessagesMap>>
  setLoading: React.Dispatch<React.SetStateAction<boolean>>
  setThinking: React.Dispatch<React.SetStateAction<boolean>>
  setAgentSlashCommands: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  setAgentPlans: React.Dispatch<React.SetStateAction<Record<string, { entries: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; priority?: 'low' | 'medium' | 'high' }> }>>>
  setAgentModes: React.Dispatch<React.SetStateAction<Record<string, string>>>
  setAgentAvailableCommands: React.Dispatch<React.SetStateAction<Record<string, string[]>>>
  setAgentSessionInfo: React.Dispatch<React.SetStateAction<Record<string, { title?: string; updatedAt?: string }>>>
}

const isSameActivity = (a: AgentActivity, b: AgentActivity): boolean =>
  a.phase === b.phase &&
  a.background === b.background &&
  a.currentTool === b.currentTool &&
  a.toolCount === b.toolCount &&
  a.toolCompleted === b.toolCompleted &&
  a.hasText === b.hasText &&
  a.cost === b.cost

/** Merge a fresh batch into an existing per-agent list. */
const mergeAgentBatch = (
  base: Message[],
  batch: Message[],
  replacedIds: Set<string>,
  dropStreamingForAgent: boolean,
): Message[] => {
  const filteredBase = base.filter((m) => {
    if (replacedIds.size > 0 && replacedIds.has(m.id)) return false
    if (dropStreamingForAgent && m.streaming) return false
    return true
  })

  const existingInstanceKeys = new Set(filteredBase.map((m) => buildMessageInstanceKey(m)))
  const existingContentKeys = new Set<string>()
  for (const m of filteredBase) {
    const ck = buildContentKey(m)
    if (ck) existingContentKeys.add(ck)
  }

  const seenInBatch = new Set<string>()
  const seenContentInBatch = new Set<string>()
  const deduped = batch.filter((m) => {
    const ik = buildMessageInstanceKey(m)
    if (existingInstanceKeys.has(ik) || seenInBatch.has(ik)) return false
    const ck = buildContentKey(m)
    if (ck && (existingContentKeys.has(ck) || seenContentInBatch.has(ck))) return false
    if (ck) seenContentInBatch.add(ck)
    seenInBatch.add(ik)
    return true
  })

  if (deduped.length === 0 && filteredBase.length === base.length) return base

  const merged: Message[] = []
  let i = 0, j = 0
  while (i < filteredBase.length && j < deduped.length) {
    if (filteredBase[i].timestamp <= deduped[j].timestamp) merged.push(filteredBase[i++])
    else merged.push(deduped[j++])
  }
  while (i < filteredBase.length) merged.push(filteredBase[i++])
  while (j < deduped.length) merged.push(deduped[j++])
  return merged
}

/** Replay (full) into an existing per-agent list. */
const applyAgentReplay = (base: Message[], tagged: Message[], agentId: string): Message[] => {
  const replayUserIds = new Set(
    tagged.filter((m) => m.role === 'user').map((m) => m.jsonlUuid || m.id),
  )
  const replayUserContents = new Set(
    tagged.filter((m) => m.role === 'user').map((m) => m.content),
  )
  const maxReplayTs = tagged.reduce((max, m) => Math.max(max, m.timestamp), 0)

  const others = base.filter((m) => {
    if (m.role !== 'user') {
      return m.timestamp > maxReplayTs
    }
    if (m.streaming) return false
    if (m.jsonlUuid && replayUserIds.has(m.jsonlUuid)) return false
    if (replayUserIds.has(m.id)) return false
    if (replayUserContents.has(m.content)) return false
    return true
  })

  const result: Message[] = []
  let i = 0, j = 0
  while (i < others.length && j < tagged.length) {
    if (others[i].timestamp <= tagged[j].timestamp) result.push(others[i++])
    else result.push(tagged[j++])
  }
  while (i < others.length) result.push(others[i++])
  while (j < tagged.length) result.push(tagged[j++])
  result.sort((a, b) => a.timestamp - b.timestamp)

  // Drop residual streaming entries for this agent — a full replay supersedes them.
  return result.filter((m) => !(m.streaming && m.agentId === agentId))
}

export const createExpertEventHandlers = (ctx: ExpertEventContext) => {
  const {
    isCurrentChatEvent, addSystemMessage, uid, t,
    setExpertActivities, setAgentMessages, setLoading, setThinking,
    setAgentSlashCommands, setAgentPlans, setAgentModes,
    setAgentAvailableCommands, setAgentSessionInfo,
  } = ctx

  // Per-agent delta buffering. Flush coalesces by agent so multiple agents
  // running in parallel never overwrite each other's pending stream.
  const deltaBuffers = new Map<string, { messages: Message[]; replacedIds: Set<string> }>()
  let deltaFlushTimer: ReturnType<typeof setTimeout> | null = null
  const DELTA_FLUSH_MS = 16

  const flushDeltaBuffer = () => {
    deltaFlushTimer = null
    if (deltaBuffers.size === 0) return
    const snapshot = new Map(deltaBuffers)
    deltaBuffers.clear()

    setAgentMessages((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [agentId, { messages: batch, replacedIds }] of snapshot.entries()) {
        if (batch.length === 0 && replacedIds.size === 0) continue
        const base = next[agentId] ?? []
        const merged = mergeAgentBatch(base, batch, replacedIds, true)
        if (merged !== base) {
          next[agentId] = merged
          changed = true
        }
      }
      return changed ? next : prev
    })
  }

  const cleanupDeltaTimer = () => {
    if (deltaFlushTimer) {
      clearTimeout(deltaFlushTimer)
      deltaFlushTimer = null
    }
    flushDeltaBuffer()
  }

  const pushDelta = (agentId: string, messages: Message[], replacedStatsId?: string | null) => {
    let bucket = deltaBuffers.get(agentId)
    if (!bucket) {
      bucket = { messages: [], replacedIds: new Set() }
      deltaBuffers.set(agentId, bucket)
    }
    bucket.messages.push(...messages)
    if (replacedStatsId) bucket.replacedIds.add(replacedStatsId)
    if (!deltaFlushTimer) {
      deltaFlushTimer = setTimeout(flushDeltaBuffer, DELTA_FLUSH_MS)
    }
  }

  const handleExpertActivity = (payload: { agentId: string; chatId?: string; activity: AgentActivity }) => {
    if (!isCurrentChatEvent(payload)) return
    if (!payload?.agentId || !payload?.activity) return
    setExpertActivities((prev) => {
      const existing = prev[payload.agentId]
      if (existing && isSameActivity(existing, payload.activity)) return prev
      return { ...prev, [payload.agentId]: payload.activity }
    })
  }

  const handleExpertExit = (payload: { agentId: string; chatId?: string; finalActivity?: AgentActivity }) => {
    if (!isCurrentChatEvent(payload)) return
    if (!payload?.agentId) return
    setExpertActivities((prev) => {
      if (!prev[payload.agentId]) return prev
      return {
        ...prev,
        [payload.agentId]: {
          ...(payload.finalActivity || prev[payload.agentId]),
          phase: 'completed' as const,
          updatedAt: Date.now(),
        },
      }
    })
  }

  const handleExpertResumeFailed = (payload: { agentId: string; chatId?: string; agentName: string; reason: string; sessionId?: string; message?: string }) => {
    if (!isCurrentChatEvent(payload)) return
    if (!payload?.agentId) return
    if (payload.reason === 'command_not_found') {
      toast.error(payload.message || t('chat:cliNotInstalled'), { duration: 10000 })
    } else if (payload.reason === 'cwd_not_found') {
      toast.info(t('chat:expertResumeCwdNotFound', { name: payload.agentName || payload.agentId, message: payload.message }))
    } else {
      toast.info(t('chat:expertResumeExpired', { name: payload.agentName || payload.agentId }))
    }
  }

  const handleExpertError = (payload: { agentId?: string; chatId?: string; error?: string; message?: string }) => {
    if (!isCurrentChatEvent(payload)) return
    if (payload?.error === 'command_not_found') {
      toast.error(payload.message || t('chat:cliNotInstalled'), { duration: 10000 })
    } else {
      const errorMsg: Message = {
        id: uid('err'),
        role: 'agent',
        content: `Error: ${payload?.message ?? 'unknown'}`,
        timestamp: Date.now(),
        type: 'error',
        agentId: payload?.agentId,
      }
      if (payload?.agentId) {
        setAgentMessages((prev) => {
          const list = prev[payload.agentId!] ?? []
          return { ...prev, [payload.agentId!]: [...list, errorMsg] }
        })
      } else {
        addSystemMessage(errorMsg)
      }
      setLoading(false); setThinking(false)
    }
    if (payload?.agentId) {
      setExpertActivities((prev) => {
        if (!prev[payload.agentId!]) return prev
        return { ...prev, [payload.agentId!]: { ...prev[payload.agentId!], phase: 'completed' as const, updatedAt: Date.now() } }
      })
    }
  }

  const handleVersionBlocked = (payload: { agentId?: string; chatId?: string; clientVersion?: string; minClientVersion?: string; upgradeMessage?: string; upgradeUrl?: string }) => {
    if (!isCurrentChatEvent(payload)) return
    const msg = payload?.upgradeMessage || i18n.t('common:upgrade.versionTooLow', { clientVersion: payload?.clientVersion, minVersion: payload?.minClientVersion })
    toast.error(msg, { duration: 15000 })
    setLoading(false); setThinking(false)
  }

  const handleExpertStarted = (payload: { agentId: string; chatId?: string; agentName: string; sessionId: string; status?: string }) => {
    if (!isCurrentChatEvent(payload)) return
    if (!payload?.agentId) return
    if (payload.status === 'completed') return

    setExpertActivities((prev) => {
      const existing = prev[payload.agentId]
      if (existing && existing.phase !== 'completed' && existing.phase !== 'error') return prev
      const next: AgentActivity = {
        phase: 'initializing',
        background: false,
        toolCount: 0,
        toolCompleted: 0,
        hasText: false,
        updatedAt: Date.now(),
      }
      if (existing && isSameActivity(existing, next)) return prev
      return { ...prev, [payload.agentId]: next }
    })
  }

  const onExpertStructuredMessage = (payload: {
    agentId: string
    sessionId: string
    chatId?: string
    type?: 'full' | 'delta'
    messages: Message[]
    replacedStatsId?: string | null
  }) => {
    if (!payload?.agentId || !payload?.messages?.length) return
    if (!payload.chatId || !isCurrentChatEvent(payload)) return

    if (payload.type === 'delta') {
      const agentOnly = payload.messages.filter((m) => m.role !== 'user')
      if (agentOnly.length === 0) return
      const tagged = agentOnly.map((m) => ({ ...m, agentId: payload.agentId }))
      pushDelta(payload.agentId, tagged, payload.replacedStatsId ?? null)
      return
    }

    // Full replay — drop any pending delta for this agent so we don't double-apply.
    if (deltaFlushTimer) {
      const bucket = deltaBuffers.get(payload.agentId)
      if (bucket) deltaBuffers.delete(payload.agentId)
      if (deltaBuffers.size === 0) {
        clearTimeout(deltaFlushTimer)
        deltaFlushTimer = null
      }
    }

    const tagged = payload.messages.map((m) => ({ ...m, agentId: payload.agentId }))
    if (tagged.length === 0) return

    setAgentMessages((prev) => {
      const base = prev[payload.agentId] ?? []
      const next = applyAgentReplay(base, tagged, payload.agentId)
      if (next === base) return prev
      return { ...prev, [payload.agentId]: next }
    })
  }

  const handleExpertPartialText = (payload: { agentId: string; chatId?: string; sessionId?: string; blockIndex: number; text: string }) => {
    if (!isCurrentChatEvent(payload)) return
    if (!payload?.agentId || !payload?.text) return
    // If we already have a queued delta batch for this agent, partial text would
    // race with the structured update; let the delta win.
    if (deltaBuffers.get(payload.agentId)?.messages.length) return

    setAgentMessages((prev) => {
      const list = prev[payload.agentId] ?? []
      const last = list[list.length - 1]
      if (last?.role === 'agent' && last.agentId === payload.agentId && last.streaming) {
        const nextList = list.slice()
        nextList[nextList.length - 1] = { ...last, content: last.content + payload.text }
        return { ...prev, [payload.agentId]: nextList }
      }
      return {
        ...prev,
        [payload.agentId]: [
          ...list,
          {
            id: uid('stream'),
            role: 'agent',
            agentId: payload.agentId,
            content: payload.text,
            timestamp: Date.now(),
            type: 'text',
            streaming: true,
          },
        ],
      }
    })
  }

  const handleExpertSlashCommands = (payload: { agentId: string; chatId?: string; commands: string[] }) => {
    if (!isCurrentChatEvent(payload)) return
    if (!payload?.agentId || !Array.isArray(payload.commands)) return
    setAgentSlashCommands((prev) => {
      const existing = prev[payload.agentId]
      if (existing && existing.length === payload.commands.length && existing.every((c, i) => c === payload.commands[i])) return prev
      return { ...prev, [payload.agentId]: payload.commands }
    })
  }

  const handleExpertPlanUpdate = (payload: {
    agentId: string
    chatId?: string
    sessionId: string
    plan: { entries: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; priority?: 'low' | 'medium' | 'high' }> }
  }) => {
    if (!isCurrentChatEvent(payload)) return
    if (!payload?.agentId || !payload?.plan) return
    setAgentPlans((prev) => ({ ...prev, [payload.agentId]: payload.plan }))
  }

  const handleExpertModeChange = (payload: { agentId: string; chatId?: string; sessionId: string; currentModeId: string }) => {
    if (!isCurrentChatEvent(payload)) return
    if (!payload?.agentId || !payload?.currentModeId) return
    setAgentModes((prev) => {
      if (prev[payload.agentId] === payload.currentModeId) return prev
      return { ...prev, [payload.agentId]: payload.currentModeId }
    })
  }

  const handleExpertCommandsUpdate = (payload: { agentId: string; chatId?: string; sessionId: string; availableCommands: string[] }) => {
    if (!isCurrentChatEvent(payload)) return
    if (!payload?.agentId || !Array.isArray(payload.availableCommands)) return
    setAgentAvailableCommands((prev) => {
      const existing = prev[payload.agentId]
      if (existing && existing.length === payload.availableCommands.length && existing.every((c, i) => c === payload.availableCommands[i])) return prev
      return { ...prev, [payload.agentId]: payload.availableCommands }
    })
  }

  const handleExpertSessionInfo = (payload: { agentId: string; chatId?: string; sessionId: string; title?: string; updatedAt?: string }) => {
    if (!isCurrentChatEvent(payload)) return
    if (!payload?.agentId) return
    setAgentSessionInfo((prev) => ({
      ...prev,
      [payload.agentId]: { title: payload.title, updatedAt: payload.updatedAt },
    }))
  }

  return {
    handleExpertActivity,
    handleExpertExit,
    handleExpertResumeFailed,
    handleExpertError,
    handleVersionBlocked,
    handleExpertStarted,
    onExpertStructuredMessage,
    handleExpertPartialText,
    handleExpertSlashCommands,
    handleExpertPlanUpdate,
    handleExpertModeChange,
    handleExpertCommandsUpdate,
    handleExpertSessionInfo,
    flushDeltaBuffer,
    cleanupDeltaTimer,
  }
}

export type ExpertEventHandlers = ReturnType<typeof createExpertEventHandlers>
export { SYSTEM_MESSAGE_AGENT }
