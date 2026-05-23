import { useState, useRef, useCallback, useEffect } from 'react'
import type { Message, AgentActivity, AgentPhase, QueuedMessage } from '../types/chat'
import { WORKING_PHASES } from '../types/chat'
import type { MentionInfo, PendingImage } from '../components/chat/input/InputArea'
import type { AgentSummary } from '../types/agentConfig'
import type { WebSocketClient } from '../services/WebSocketClient'
import { sendAESEvent } from '@/lib/aes'
import { API_BASE, authFetch } from '@/config/api'

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
  messages, input, setInput, addAgentMessage, uid, handleScrollToBottom,
  setExpertActivities, setTargetAgentId, setLoading, chatTitle, setChatTitle,
  openDirPicker,
}: UseChatActionsParams) => {
  const [queuedMessages, setQueuedMessages] = useState<QueuedMessage[]>([])
  const queuedMessagesRef = useRef<QueuedMessage[]>([])
  queuedMessagesRef.current = queuedMessages

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

  const isWorkingNow = !!currentMergedActivity && WORKING_PHASES.has(currentMergedActivity.phase)

  const handleSend = (mentions: MentionInfo[] = [], images: PendingImage[] = []) => {
    const text = input.trim()
    if ((!text && images.length === 0) || !currentSessionId) return

    if (/^\/add-dir\s*$/.test(text)) {
      openDirPicker()
      return
    }

    if (isWorkingNow) {
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

    if (!messages.some(m => m.role === 'user') && chatId && text && (chatTitle === 'New Chat' || chatTitle === 'New Session')) {
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

  const stopAllExperts = useCallback(() => {
    Object.entries(expertActivities).forEach(([agentId, activity]) => {
      if (activity.phase !== 'completed') {
        wsClient.send('expert:stop', { agentId, chatId })
      }
    })
  }, [expertActivities, wsClient, chatId])

  const handleInterrupt = useCallback(() => {
    stopAllExperts()
    setLoading(false)
    setExpertActivities((prev) => {
      const next = { ...prev }
      let changed = false
      for (const [agentId, activity] of Object.entries(next)) {
        if (activity.phase !== 'completed') {
          next[agentId] = { ...activity, phase: 'completed' as const, updatedAt: Date.now() }
          changed = true
        }
      }
      return changed ? next : prev
    })
    clearQueue()
  }, [stopAllExperts, setLoading, setExpertActivities, clearQueue])

  const prevPhaseRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    const phase = currentMergedActivity?.phase
    const prev = prevPhaseRef.current
    prevPhaseRef.current = phase
    const wasWorking = !!prev && WORKING_PHASES.has(prev as AgentPhase)
    const nowIdle = phase === 'waiting_input' || phase === 'completed'
    if (wasWorking && nowIdle && queuedMessages.length > 0) {
      flushNext()
    }
  }, [currentMergedActivity?.phase, queuedMessages.length, flushNext])

  return {
    queuedMessages, isWorkingNow,
    handleSend, handleAnswerQuestion, handleInterrupt,
    removeQueuedMessage, clearQueue, dispatchMessage,
  }
}
