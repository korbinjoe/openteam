/**
 * useAllChats — Cross-workspace task list for the V2 sidebar.
 *
 * Aggregates chats from every workspace and tags each with its workspace meta
 * (id + name) so the sidebar can group tasks by workspace. Stays live via the
 * same chat:status-changed / chat:activity WS events used by the per-workspace
 * hook, so a status change in any workspace updates the sidebar without polling.
 */

import { useCallback, useEffect, useState } from 'react'
import { API_BASE, authFetch } from '@/config/api'
import { getWebSocketClient } from '@/services/WebSocketClient'
import type { ChatActivityPayload } from '@/types/chat'
import type { Chat, Workspace } from '@/components/workspace/types'

const ACTIVE_PHASES = new Set(['thinking', 'tool_running', 'responding', 'initializing'])

export interface WorkspaceLite {
  id: string
  name: string
}

export interface V2AllChatsResult {
  chats: Chat[]
  workspaces: WorkspaceLite[]
  loading: boolean
  refresh: () => Promise<void>
}

export const useAllChats = (): V2AllChatsResult => {
  const [chats, setChats] = useState<Chat[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceLite[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const wsRes = await authFetch(`${API_BASE}/api/workspaces`)
      if (!wsRes.ok) return
      const wsData: Workspace[] = await wsRes.json()
      const wsLite: WorkspaceLite[] = wsData.map((w) => ({ id: w.id, name: w.name }))
      setWorkspaces(wsLite)

      const chatResults = await Promise.all(
        wsLite.map(async (w) => {
          const r = await authFetch(`${API_BASE}/api/workspaces/${w.id}/chats`)
          if (!r.ok) return [] as Chat[]
          return (await r.json()) as Chat[]
        }),
      )
      setChats(chatResults.flat())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
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

    const handleVisibility = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      wsClient.off('chat:status-changed', handleStatusChanged)
      wsClient.off('chat:activity', handleActivity)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [refresh])

  return { chats, workspaces, loading, refresh }
}
