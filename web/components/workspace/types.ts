import type { WorktreeSession } from '@/types/chat'

export interface Repository {
  id: string
  path: string
  name: string
  gitInfo?: { currentBranch?: string; remoteUrl?: string }
}

export interface Workspace {
  id: string
  name: string
  repositories: Repository[]
  agentTeam?: { primaryAgentId: string; teamAgentIds: string[] }
  worktreeEnabled?: boolean
  lastAccessedAt: string
  createdAt: string
}

export type ChatMemberStatus = 'running' | 'waiting' | 'error' | 'idle' | 'done'

export type ChatMemberRole = 'lead' | 'worker'

export interface ChatMember {
  agentId: string
  role: ChatMemberRole
  status: ChatMemberStatus
  lastMessageAt: string
  lastMessage?: string
  cliSessionId?: string
}

export interface Chat {
  id: string
  workspaceId: string
  title: string
  primaryAgentId: string
  teamAgentIds: string[]
  model?: string
  usedModels?: string[]
  status: 'running' | 'idle' | 'stopped' | 'merged'
  totalCost?: number
  totalTokens?: { input: number; output: number; cacheRead?: number; cacheCreation?: number }
  totalToolCalls?: number
  worktreeSessions?: WorktreeSession[]
  /** Per-agent live state enriched by the server. Optional because legacy
   *  read paths may not yet pass through enrichWithMembers. */
  members?: ChatMember[]
  /** 'native' for chats created in OpenTeam, 'external' for adopted local
   *  Claude/Codex jsonl sessions. Defaults to 'native' server-side. */
  source?: 'native' | 'external'
  /** Original cwd for adopted external chats. Always set when source='external'. */
  externalCwd?: string
  /** User explicitly archived (ms since epoch). Null/undefined means not
   *  manually archived; auto-archive may still hide the chat client-side. */
  archivedAt?: number | null
  /** User pinned to top of sidebar (ms since epoch). */
  pinnedAt?: number | null
  createdAt: string
  lastMessageAt: string
}
