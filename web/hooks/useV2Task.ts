/**
 * useV2Task — single-task slice of useV2AllChats.
 *
 * Returns the chat (with server-derived `members[]`) for a given taskId, plus
 * loading state. Used by V2 TaskOverview / GroupChat / WorkspaceToolbar to read
 * real data without each component refetching.
 *
 * Backed by useV2AllChats so cache + WS subscriptions are shared.
 */

import { useMemo } from 'react'
import { useV2AllChats } from './useV2AllChats'
import type { Chat, ChatMember } from '@/components/workspace/types'

export interface V2TaskResult {
  chat: Chat | null
  members: ChatMember[]
  loading: boolean
}

export const useV2Task = (taskId: string | null | undefined): V2TaskResult => {
  const { chats, loading } = useV2AllChats()
  return useMemo(() => {
    const chat = taskId ? chats.find((c) => c.id === taskId) ?? null : null
    return {
      chat,
      members: chat?.members ?? [],
      loading,
    }
  }, [chats, taskId, loading])
}
