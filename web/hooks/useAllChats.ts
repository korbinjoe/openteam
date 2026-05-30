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
import { ACTIVE_PHASES, reconcileMembersFromActivity } from '@/lib/memberStatus'

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
      setChats((prev) => {
        let changed = false
        const next = prev.map((c) => {
          if (c.id !== chatId) return c
          if (c.status === status && (!missionStatus || (c as any).missionStatus === missionStatus)) return c
          changed = true
          return { ...c, status: status as Chat['status'], ...(missionStatus ? { missionStatus } : {}) } as Chat
        })
        return changed ? next : prev
      })
    }

    const handleActivity = (payload: ChatActivityPayload) => {
      const { chatId, phase } = payload
      setChats((prev) => {
        let changed = false
        const next = prev.map((c) => {
          if (c.id !== chatId) return c
          const updated = { ...c } as Chat & { missionStatus?: string }
          if (phase === 'completed') { updated.status = 'stopped'; updated.missionStatus = 'success'; updated.waitingReason = undefined }
          else if (phase === 'error') { updated.status = 'stopped'; updated.missionStatus = 'error'; updated.waitingReason = undefined }
          else if (phase === 'waiting_input') {
            updated.status = 'idle'; updated.missionStatus = 'waiting_input'
            updated.waitingReason = payload.latestMessage?.text
          }
          else if (phase === 'waiting_confirmation') {
            updated.status = 'idle'; updated.missionStatus = 'waiting_confirm'
            updated.waitingReason = payload.latestMessage?.text
          }
          else if (ACTIVE_PHASES.has(phase)) { updated.status = 'running'; updated.missionStatus = 'running'; updated.waitingReason = undefined }
          updated.members = reconcileMembersFromActivity(c.members, payload)
          if (updated.status === c.status
            && updated.missionStatus === (c as any).missionStatus
            && updated.waitingReason === c.waitingReason
            && updated.members === c.members) {
            return c
          }
          changed = true
          return updated
        })
        return changed ? next : prev
      })
    }

    const handleTitleUpdated = ({ chatId, title }: { chatId: string; title: string }) => {
      setChats((prev) => {
        let changed = false
        const next = prev.map((c) => {
          if (c.id !== chatId) return c
          if (c.title === title) return c
          changed = true
          return { ...c, title } as Chat
        })
        return changed ? next : prev
      })
    }

    const handleMetaUpdated = ({ chatId, archivedAt, pinnedAt }: { chatId: string; archivedAt: number | null; pinnedAt: number | null }) => {
      setChats((prev) => {
        let changed = false
        const next = prev.map((c) => {
          if (c.id !== chatId) return c
          if ((c as any).archivedAt === archivedAt && (c as any).pinnedAt === pinnedAt) return c
          changed = true
          return { ...c, archivedAt, pinnedAt } as Chat
        })
        return changed ? next : prev
      })
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
