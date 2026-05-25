/**
 * useAllChats — Cross-workspace mission list for the V2 sidebar.
 *
 * Aggregates chats from every workspace and tags each with its workspace meta
 * (id + name) so the sidebar can group missions by workspace. Stays live via the
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
        return next
      }))
    }

    const handleTitleUpdated = ({ chatId, title }: { chatId: string; title: string }) => {
      setChats((prev) => prev.map((c) => c.id === chatId ? { ...c, title } as Chat : c))
    }

    const handleMetaUpdated = ({ chatId, archivedAt, pinnedAt }: { chatId: string; archivedAt: number | null; pinnedAt: number | null }) => {
      setChats((prev) => prev.map((c) => c.id === chatId ? { ...c, archivedAt, pinnedAt } as Chat : c))
    }

    wsClient.on('chat:status-changed', handleStatusChanged)
    wsClient.on('chat:activity', handleActivity)
    wsClient.on('chat:title-updated', handleTitleUpdated)
    wsClient.on('chat:meta-updated', handleMetaUpdated)

    const handleVisibility = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', handleVisibility)

    // Local DOM events from callers that just mutated chats (NewChatForm,
    // AddAgentPicker). Sidebar refreshes without waiting for a WS broadcast.
    const handleChatMutated = () => { void refresh() }
    window.addEventListener('openteam:chat-created', handleChatMutated)
    window.addEventListener('openteam:chat-updated', handleChatMutated)

    return () => {
      wsClient.off('chat:status-changed', handleStatusChanged)
      wsClient.off('chat:activity', handleActivity)
      wsClient.off('chat:title-updated', handleTitleUpdated)
      wsClient.off('chat:meta-updated', handleMetaUpdated)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('openteam:chat-created', handleChatMutated)
      window.removeEventListener('openteam:chat-updated', handleChatMutated)
    }
  }, [refresh])

  return { chats, workspaces, loading, refresh }
}
