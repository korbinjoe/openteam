import type { ChatActivityPayload } from '../../types/chat'

export const DIR_HISTORY_STORAGE_KEY = 'openteam:dir-picker-history'
export const LAST_SESSION_KEY = 'openteam:last-session'
export const HIDDEN_WORKSPACES_KEY = 'openteam:hidden-quick-workspaces'
export const QUICK_ORDER_KEY = 'openteam:quick-items-order'

export interface LastSessionConfig {
  repos: string[]
  model: string
  agentId?: string
}

export interface DirEntry {
  name: string
  path: string
}

export interface WorkspaceInfo {
  id: string
  name: string
  repositories: Array<{ path: string; name: string }>
  agentTeam?: { primaryAgentId: string; teamAgentIds: string[] }
  chatCount: number
  lastAccessedAt: string
}

/**  chatId  ChatActivityPayload RecentChat.activity */
export type ChatActivity = Omit<ChatActivityPayload, 'chatId'>

export interface RecentChat {
  id: string
  workspaceId: string
  title: string
  primaryAgentId: string
  status: string
  lastMessageAt: string
  activity?: ChatActivity
  missionStatus?: string
  missionSummary?: {
    lastMessage?: string
    errorMessage?: string
    durationSec?: number
  }
  totalCost?: number
  totalTokens?: { input: number; output: number; cacheRead?: number; cacheCreation?: number }
  totalToolCalls?: number
}

export interface QuickItem {
  type: 'repo' | 'workspace'
  label: string
  paths: string[]
  lastUsed: number
  workspaceId?: string
}
