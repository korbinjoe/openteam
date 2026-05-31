import { useState, useRef, useCallback, useEffect } from 'react'
import type { Message, AgentActivity, QueuedMessage } from '../types/chat'
import { WORKING_PHASES } from '../types/chat'
import type { MentionInfo, PendingImage } from '../components/chat/input/InputArea'
import type { AgentSummary } from '../types/agentConfig'
import type { WebSocketClient } from '../services/WebSocketClient'
import { sendAESEvent } from '@/lib/aes'
import { API_BASE, authFetch } from '@/config/api'
import { isPlaceholderTitle } from '../../shared/placeholderTitles'

interface UseChatActionsParams {
  chatId: string
  wsClient: WebSocketClient
  currentSessionId: string | null
  currentWorkingDirectory: string | null
  wsRepositories: Array<{ path: string; [key: string]: unknown }>
  availableAgents: AgentSummary[]
  targetAgentId: string | null
  expertActivities: Record<string, AgentActivity>
  currentMergedActivity: AgentActivity | null
  /** When set (Quad tile / ?agent=X route), busy-state and interrupt scope
   *  collapse to this single agent so a sibling's run does not freeze this view's input
   *  or cancel that sibling on interrupt. */
  lockedAgentId?: string | null
  messages: Message[]
  input: string
  setInput: (v: string) => void
  addAgentMessage: (agentId: string, msg: Message) => void
  uid: (prefix: string) => string
  handleScrollToBottom: () => void
  setExpertActivities: React.Dispatch<React.SetStateAction<Record<string, AgentActivity>>>
  setTargetAgentId: (id: string) => void
  setLoading: (v: boolean) => void
  chatTitle: string
  setChatTitle: (title: string) => void
  openDirPicker: () => void
}

export const useChatActions = ({
  chatId, wsClient, currentSessionId, currentWorkingDirectory, wsRepositories,
  availableAgents, targetAgentId, expertActivities, currentMergedActivity,
  lockedAgentId,
  messages, input, setInput, addAgentMessage, uid, handleScrollToBottom,
  setExpertActivities, setTargetAgentId, setLoading, chatTitle, setChatTitle,
  openDirPicker,
}: UseChatActionsParams) => {
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([])
  const queuedMessagesRef = useRef<QueuedMessage[]>([])
  queuedMessagesRef.current = queuedMessages

  const expertActivitiesRef = useRef(expertActivities)
  expertActivitiesRef.current = expertActivities
  const currentMergedActivityRef = useRef(currentMergedActivity)
  currentMergedActivityRef.current = currentMergedActivity

  const dispatchMessage = useCallback((payload: {
    text: string
    mentions: MentionInfo[]
    images: PendingImage[]
    targetAgentId: string | null
  }) => {
    const { text, mentions, images, targetAgentId: snapshotTargetId } = payload

    let msgMentions: MentionInfo[] | undefined = mentions.length > 0 ? mentions : undefined
    if (!msgMentions) {
      const targetAgent = availableAgents.find((a) => a.name === snapshotTargetId || a.id === snapshotTargetId)
      if (targetAgent) msgMentions = [{ id: targetAgent.id, name: targetAgent.name }]
    }

    const msgImages = images.length > 0
      ? images.map((img) => ({ data: img.data, mediaType: img.mediaType }))
      : undefined

    const cleanText = mentions.length > 0
      ? mentions.reduce((t, m) => t.replace(new RegExp(`@${m.id}\\b`, 'g'), ''), text).replace(/\s+/g, ' ').trim()
      : text
    const messageContent = (mentions.length > 0 ? (cleanText || text) : text)
      || (images.length > 0 ? `[${images.length} image(s)]` : '')

    const inferredTargetAgentId = (() => {
      if (mentions.length > 0) return mentions[0]?.id
      const targetAgent = availableAgents.find((a) => a.name === snapshotTargetId || a.id === snapshotTargetId)
      return targetAgent?.id || snapshotTargetId || availableAgents[0]?.id
    })()

    if (inferredTargetAgentId) {
      addAgentMessage(inferredTargetAgentId, {
        id: uid('usr'), role: 'user',
        content: messageContent,
        timestamp: Date.now(), type: 'text',
        mentions: msgMentions, images: msgImages,
      })
    }
    handleScrollToBottom()

    const wsImages = images.length > 0
      ? images.map((img) => ({ data: img.data, mediaType: img.mediaType }))
      : undefined

    const sendToAgent = (agentId: string, message: string) => {
      setExpertActivities((prev) => ({
        ...prev,
        [agentId]: { phase: 'initializing', background: false, toolCount: 0, toolCompleted: 0, hasText: false, updatedAt: Date.now() },
      }))

      wsClient.send('expert:direct-input', {
        chatId, agentId, message, images: wsImages, autoStart: true,
        cwd: currentWorkingDirectory,
        repositories: wsRepositories.map((r) => ({ path: r.path })),
        cols: 80, rows: 24,
      })
    }

    let finalAgentId: string | undefined
    if (mentions.length > 0) {
      mentions.forEach((m) => sendToAgent(m.id, cleanText || text))
      finalAgentId = mentions[mentions.length - 1].id
      setTargetAgentId(finalAgentId)
    } else {
      const targetAgent = availableAgents.find((a) => a.name === snapshotTargetId || a.id === snapshotTargetId)
      const agentId = targetAgent?.id || snapshotTargetId || availableAgents[0]?.id
      if (agentId) {
        sendToAgent(agentId, text)
        finalAgentId = agentId
      }
    }

    if (finalAgentId && chatId) {
      authFetch(`${API_BASE}/api/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lastAgentId: finalAgentId }),
      }).catch(() => {})
    }
  }, [availableAgents, addAgentMessage, uid, handleScrollToBottom, setExpertActivities, wsClient, chatId, currentWorkingDirectory, wsRepositories, setTargetAgentId])

  const flushNext = useCallback(() => {
    const head = queuedMessagesRef.current[0]
    if (!head) return
    console.debug('[QueueFlush] flushNext: dispatching to agent=%s text=%s', head.targetAgentId, head.text?.slice(0, 40))
    setQueuedMessages((prev) => prev.slice(1))
    dispatchMessage({
      text: head.text, mentions: head.mentions,
      images: head.images, targetAgentId: head.targetAgentId,
    })
    sendAESEvent('chat', 'message_dequeued', { remaining: queuedMessagesRef.current.length - 1 })
  }, [dispatchMessage])

  const removeQueuedMessage = useCallback((id: string) => {
    setQueuedMessages((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const clearQueue = useCallback(() => {
    setQueuedMessages((prev) => {
      if (prev.length === 0) return prev
      sendAESEvent('chat', 'queue_cleared', { count: prev.length })
      return []
    })
  }, [])

  // Pop the most recently enqueued message so it can be recalled into the
  // input for editing. Returns the popped item or null when the queue is empty.
  const popLastQueued = useCallback((): QueuedMessage | null => {
    const current = queuedMessagesRef.current
    if (current.length === 0) return null
    const popped = current[current.length - 1]
    setQueuedMessages((prev) => prev.slice(0, -1))
    return popped
  }, [])

  const isAnyWorking = !!currentMergedActivity && WORKING_PHASES.has(currentMergedActivity.phase)

  const isTargetAgentWorking = (agentId: string | null): boolean => {
    if (!agentId) return isAnyWorking
    const activity = expertActivities[agentId]
    return !!activity && WORKING_PHASES.has(activity.phase)
  }

  const handleSend = (mentions: MentionInfo[] = [], images: PendingImage[] = []) => {
    const text = input.trim()
    if ((!text && images.length === 0) || !currentSessionId) return

    if (/^\/add-dir\s*$/.test(text)) {
      openDirPicker()
      return
    }

    if (isTargetAgentWorking(targetAgentId)) {
      const queued: QueuedMessage = {
        id: uid('queue'), text, mentions, images, targetAgentId, enqueuedAt: Date.now(),
      }
      setQueuedMessages((prev) => [...prev, queued])
      setInput('')
      sendAESEvent('chat', 'message_queued', {
        position: queuedMessages.length + 1, textLength: text.length,
        mentionCount: mentions.length, imageCount: images.length,
      })
      return
    }

    if (!messages.some(m => m.role === 'user') && chatId && text && isPlaceholderTitle(chatTitle)) {
      const autoTitle = text.length > 50 ? text.slice(0, 50) + '…' : text
      setChatTitle(autoTitle)
    }

    setInput('')
    dispatchMessage({ text, mentions, images, targetAgentId })
  }

  const handleAnswerQuestion = useCallback((agentId: string, answer: string) => {
    if (!chatId) return
    wsClient.send('expert:direct-input', { chatId, agentId, message: answer })
  }, [chatId, wsClient])

  // In single-agent mode (Quad tile / ?agent=X), interrupt must NOT cascade to
  // sibling agents — they belong to other tiles and have their own input/stop.
  const stopAllExperts = useCallback(() => {
    Object.entries(expertActivities).forEach(([agentId, activity]) => {
      if (lockedAgentId && agentId !== lockedAgentId) return
      if (activity.phase !== 'completed') {
        wsClient.send('expert:stop', { agentId, chatId })
      }
    })
  }, [expertActivities, wsClient, chatId, lockedAgentId])

  const handleInterrupt = useCallback(() => {
    stopAllExperts()
    setLoading(false)
    setExpertActivities((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [agentId, activity] of Object.entries(next)) {
        if (lockedAgentId && agentId !== lockedAgentId) continue
        if (activity.phase !== 'completed') {
          next[agentId] = { ...activity, phase: 'completed' as const, updatedAt: Date.now() }
          changed = true
        }
      }
      return changed ? next : prev
    })
    clearQueue()
  }, [stopAllExperts, setLoading, setExpertActivities, clearQueue, lockedAgentId])

  // Determine if the queue head's target agent is idle and ready to receive.
  // Uses refs instead of closure state to guarantee fresh reads — avoids stale
  // closures in the polling interval and batched-update edge cases.
  const canFlushHead = useCallback((): boolean => {
    const head = queuedMessagesRef.current[0]
    if (!head) return false
    const headAgentId = head.targetAgentId ?? head.mentions?.[0]?.id
    const activities = expertActivitiesRef.current
    const headActivity = headAgentId ? activities[headAgentId] : currentMergedActivityRef.current
    const phase = headActivity?.phase
    if (phase && WORKING_PHASES.has(phase)) {
      console.debug('[QueueFlush] blocked: headAgent=%s phase=%s (WORKING)', headAgentId, phase)
      return false
    }
    if (phase === 'waiting_confirmation') {
      console.debug('[QueueFlush] blocked: headAgent=%s phase=waiting_confirmation', headAgentId)
      return false
    }
    console.debug('[QueueFlush] canFlush=true headAgent=%s phase=%s hasActivity=%s', headAgentId, phase, !!headActivity)
    return true
  }, [])

  // Flush the queue head whenever its *target agent* is idle. Per-agent gating
  // prevents cross-agent interference: Agent A finishing does not flush a
  // message queued for still-busy Agent B, and vice versa.
  useEffect(() => {
    if (queuedMessages.length === 0) return
    const can = canFlushHead()
    console.debug('[QueueFlush] effect fired: queueLen=%d canFlush=%s mergedPhase=%s activities=%o',
      queuedMessages.length, can, currentMergedActivity?.phase,
      Object.fromEntries(Object.entries(expertActivities).map(([k, v]) => [k, v.phase])))
    if (can) flushNext()
  }, [expertActivities, currentMergedActivity?.phase, queuedMessages.length, flushNext, canFlushHead])

  // Polling fallback: if the event-driven flush above misses a state transition
  // (e.g., due to batched updates or a reconnect gap), this interval catches it.
  // canFlushHead is stable (ref-based) so the interval persists without churn.
  useEffect(() => {
    if (queuedMessages.length === 0) return
    const id = setInterval(() => {
      if (queuedMessagesRef.current.length === 0) return
      if (canFlushHead()) {
        console.debug('[QueueFlush] polling fallback flushing')
        flushNext()
      }
    }, 2000)
    return () => clearInterval(id)
  }, [queuedMessages.length, canFlushHead, flushNext])

  return {
    queuedMessages, isWorkingNow: isAnyWorking,
    handleSend, handleAnswerQuestion, handleInterrupt,
    removeQueuedMessage, clearQueue, popLastQueued, dispatchMessage,
  }
}
