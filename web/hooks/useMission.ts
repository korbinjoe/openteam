/**
 * useMission — single-mission slice of useAllChats.
 *
 * Returns the chat (with server-derived `members[]`) for a given missionId, plus
 * loading state. Used by V2 MissionOverview / GroupChat / WorkspaceToolbar to read
 * real data without each component refetching.
 *
 * Backed by useAllChats so cache + WS subscriptions are shared.
 */

import { useMemo } from 'react'
import { useAllChats } from './useAllChats'
import type { Chat, ChatMember } from '@/components/workspace/types'

export interface V2MissionResult {
  chat: Chat | null
  members: ChatMember[]
  loading: boolean
}

export const useMission = (missionId: string | null | undefined): V2MissionResult => {
  const { chats, loading } = useAllChats()
  return useMemo(() => {
    const chat = missionId ? chats.find((c) => c.id === missionId) ?? null : null
    return {
      chat,
      members: chat?.members ?? [],
      loading,
    }
  }, [chats, missionId, loading])
}
