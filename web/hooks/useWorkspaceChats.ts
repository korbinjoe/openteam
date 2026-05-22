/**
 * useWorkspaceChats — Live list of chats belonging to a workspace, used as
 * the "tasks" data source in workspace sidebar/cards.
 *
 * Subscribes to chat:status-changed and chat:activity WS events so counts and
 * statuses stay live without polling.
 */

import { useCallback, useEffect, useState } from 'react'
import { API_BASE, authFetch } from '@/config/api'
import { getWebSocketClient } from '@/services/WebSocketClient'
import type { ChatActivityPayload } from '@/types/chat'
import type { Chat } from '@/components/workspace/types'

const ACTIVE_PHASES = new Set(['thinking', 'tool_running', 'responding', 'initializing'])
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

    const handleStatusChanged = ({ chatId, status, taskStatus }: { chatId: string; status: string; taskStatus?: string }) => {
      setChats((prev) => prev.map((c) => c.id === chatId
        ? { ...c, status: status as Chat['status'], ...(taskStatus ? { taskStatus } : {}) } as Chat
        : c))
    }

    const handleActivity = (payload: ChatActivityPayload) => {
      const { chatId, phase } = payload
      setChats((prev) => prev.map((c) => {
        if (c.id !== chatId) return c
        const next = { ...c } as Chat & { taskStatus?: string }
        if (phase === 'completed') { next.status = 'stopped'; next.taskStatus = 'success' }
        else if (phase === 'error') { next.status = 'stopped'; next.taskStatus = 'error' }
        else if (phase === 'waiting_input') { next.status = 'idle'; next.taskStatus = 'waiting_input' }
        else if (phase === 'waiting_confirmation') { next.status = 'idle'; next.taskStatus = 'waiting_confirm' }
        else if (ACTIVE_PHASES.has(phase)) { next.status = 'running'; next.taskStatus = 'running' }
        return next
      }))
    }

    wsClient.on('chat:status-changed', handleStatusChanged)
    wsClient.on('chat:activity', handleActivity)

    // Poll on visibility change to catch new/deleted chats (no dedicated WS event)
    const handleVisibility = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      wsClient.off('chat:status-changed', handleStatusChanged)
      wsClient.off('chat:activity', handleActivity)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [workspaceId, refresh])

  const awaitingReview = chats.filter((c) => {
    const taskStatus = (c as Chat & { taskStatus?: string }).taskStatus
    return taskStatus && WAITING_TASK_STATUSES.has(taskStatus)
  })
  const running = chats.filter((c) => c.status === 'running')
  const done = chats.filter((c) => c.status === 'stopped' || c.status === 'merged')

  return { chats, loading, refresh, awaitingReview, running, done }
}
