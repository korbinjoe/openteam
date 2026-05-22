/**
 * useTask — single-task slice of useAllChats.
 *
 * Returns the chat (with server-derived `members[]`) for a given taskId, plus
 * loading state. Used by V2 TaskOverview / GroupChat / WorkspaceToolbar to read
 * real data without each component refetching.
 *
 * Backed by useAllChats so cache + WS subscriptions are shared.
 */

import { useMemo } from 'react'
import { useAllChats } from './useAllChats'
import type { Chat, ChatMember } from '@/components/workspace/types'

export interface V2TaskResult {
  chat: Chat | null
  members: ChatMember[]
  loading: boolean
}

export const useTask = (taskId: string | null | undefined): V2TaskResult => {
  const { chats, loading } = useAllChats()
  return useMemo(() => {
    const chat = taskId ? chats.find((c) => c.id === taskId) ?? null : null
    return {
      chat,
      members: chat?.members ?? [],
      loading,
    }
  }, [chats, taskId, loading])
}
