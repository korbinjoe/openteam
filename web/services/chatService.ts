/**
 * chatService — chat / expert-session deletion helpers.
 *
 * Wraps the API endpoints that purge local CLI JSONL files alongside the
 * chat / expert-session records they reference.
 */

import { API_BASE } from '@/config/api'
import { api } from './api'

export interface PurgeResult {
  agentId?: string
  provider: 'claude' | 'codex'
  path: string | null
  deleted: boolean
  error?: string
}

export interface DeleteChatResult {
  success: boolean
  purged: PurgeResult[]
}

export interface RemoveAgentSessionResult {
  chat: unknown
  purged: PurgeResult
}

export const deleteChatWithJsonl = (chatId: string): Promise<DeleteChatResult> =>
  api.delete<DeleteChatResult>(`${API_BASE}/api/chats/${encodeURIComponent(chatId)}?purgeJsonl=1`)

export const removeAgentFromChat = (chatId: string, agentId: string): Promise<RemoveAgentSessionResult> =>
  api.delete<RemoveAgentSessionResult>(
    `${API_BASE}/api/chats/${encodeURIComponent(chatId)}/sessions/${encodeURIComponent(agentId)}`,
  )

export const formatPurgeFailures = (purged: PurgeResult[]): string[] =>
  purged.filter((p) => !p.deleted && p.error).map((p) => `${p.path ?? '(no path)'}: ${p.error}`)
