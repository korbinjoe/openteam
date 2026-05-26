/**
 * useWorkspaceChats — Live list of chats belonging to a workspace, used as
 * the "missions" data source in workspace sidebar/cards.
 *
 * Subscribes to chat:status-changed and chat:activity WS events so counts and
 * statuses stay live without polling.
 */

import { useCallback, useEffect, useState } from 'react'
import { API_BASE, authFetch } from '@/config/api'
import { getWebSocketClient } from '@/services/WebSocketClient'
import type { ChatActivityPayload } from '@/types/chat'
import type { Chat } from '@/components/workspace/types'
import { ACTIVE_PHASES, reconcileMembersFromActivity } from '@/lib/memberStatus'

const WAITING_TASK_STATUSES = new Set(['waiting_input', 'waiting_confirm'])

export interface WorkspaceChatsResult {
  chats: Chat[]
  loading: boolean
  refresh: () => Promise<void>
  /** Chats currently waiting for the user (input or confirmation). */
  awaitingReview: Chat[]
  /** Chats actively running an agent. */
  running: Chat[]
  /** Chats stopped/idle but not awaiting user. */
  done: Chat[]
}

export const useWorkspaceChats = (workspaceId: string | null | undefined): WorkspaceChatsResult => {
  const [chats, setChats] = useState<Chat[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!workspaceId) {
      setChats([])
      return
    }
    setLoading(true)
    try {
      const res = await authFetch(`${API_BASE}/api/workspaces/${workspaceId}/chats`)
      if (!res.ok) return
      const data: Chat[] = await res.json()
      setChats(data)
    } finally {
      setLoading(false)
    }
  }, [workspaceId])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    if (!workspaceId) return
    const wsClient = getWebSocketClient()
    wsClient.connect().catch(() => {})

    const handleStatusChanged = ({ chatId, status, missionStatus }: { chatId: string; status: string; missionStatus?: string }) => {
      setChats((prev) => prev.map((c) => c.id === chatId
        ? { ...c, status: status as Chat['status'], ...(missionStatus ? { missionStatus } : {}) } as Chat
        : c))
    }

    const handleActivity = (payload: ChatActivityPayload) => {
      const { chatId, phase } = payload
      setChats((prev) => prev.map((c) => {
        if (c.id !== chatId) return c
        const next = { ...c } as Chat & { missionStatus?: string }
        if (phase === 'completed') { next.status = 'stopped'; next.missionStatus = 'success' }
        else if (phase === 'error') { next.status = 'stopped'; next.missionStatus = 'error' }
        else if (phase === 'waiting_input') { next.status = 'idle'; next.missionStatus = 'waiting_input' }
        else if (phase === 'waiting_confirmation') { next.status = 'idle'; next.missionStatus = 'waiting_confirm' }
        else if (ACTIVE_PHASES.has(phase)) { next.status = 'running'; next.missionStatus = 'running' }
        next.members = reconcileMembersFromActivity(c.members, payload)
        return next
      }))
    }

    const handleTitleUpdated = ({ chatId, title }: { chatId: string; title: string }) => {
      setChats((prev) => prev.map((c) => c.id === chatId ? { ...c, title } as Chat : c))
    }

    wsClient.on('chat:status-changed', handleStatusChanged)
    wsClient.on('chat:activity', handleActivity)
    wsClient.on('chat:title-updated', handleTitleUpdated)

    // Poll on visibility change to catch new/deleted chats (no dedicated WS event)
    const handleVisibility = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', handleVisibility)

    // Local DOM events dispatched by callers that just mutated chats
    // (NewChatForm after create, AddAgentPicker after teamAgentIds update).
    // Keeps sidebar/quad in sync without a dedicated WS broadcast.
    const handleChatMutated = (e: Event) => {
      const detail = (e as CustomEvent<{ workspaceId?: string }>).detail
      if (!detail || !detail.workspaceId || detail.workspaceId === workspaceId) {
        void refresh()
      }
    }
    window.addEventListener('openteam:chat-created', handleChatMutated)
    window.addEventListener('openteam:chat-updated', handleChatMutated)

    return () => {
      wsClient.off('chat:status-changed', handleStatusChanged)
      wsClient.off('chat:activity', handleActivity)
      wsClient.off('chat:title-updated', handleTitleUpdated)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('openteam:chat-created', handleChatMutated)
      window.removeEventListener('openteam:chat-updated', handleChatMutated)
    }
  }, [workspaceId, refresh])

  const awaitingReview = chats.filter((c) => {
    const missionStatus = (c as Chat & { missionStatus?: string }).missionStatus
    return missionStatus && WAITING_TASK_STATUSES.has(missionStatus)
  })
  const running = chats.filter((c) => c.status === 'running')
  const done = chats.filter((c) => c.status === 'stopped' || c.status === 'merged')

  return { chats, loading, refresh, awaitingReview, running, done }
}
