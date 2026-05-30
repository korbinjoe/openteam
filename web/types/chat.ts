
export interface ModelUsageSnapshot {
  model: string
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  costUsd: number
}

export type AgentPhase =
  | 'initializing'
  | 'thinking'
  | 'tool_running'
  | 'responding'
  | 'waiting_input'
  | 'waiting_confirmation'
  | 'completed'
  | 'error'

export const WORKING_PHASES: ReadonlySet<AgentPhase> = new Set([
  'initializing',
  'thinking',
  'tool_running',
  'responding',
])

/**  Send/Enter phase  completed  FIFO  */
export interface QueuedMessage {
  id: string
  text: string
  mentions: Array<{ id: string; name: string }>
  images: Array<{ data: string; mediaType: string; preview: string }>
  targetAgentId: string | null
  enqueuedAt: number
}

export interface AgentActivity {
  phase: AgentPhase
  background: boolean
  currentTool?: string
  toolCount: number
  toolCompleted: number
  hasText: boolean
  cost?: number
  tokens?: { input: number; output: number; cacheRead?: number; cacheCreation?: number }
  modelUsage?: ModelUsageSnapshot[]
  fileOp?: {
    path: string
    operation: 'create' | 'edit' | 'delete' | 'read'
  }
  exitReason?: 'user_stop' | 'timeout' | 'model_switch'
  updatedAt: number
}

export interface ToolUseInfo {
  toolName: string
  toolId: string
  input: string
  status: 'running' | 'completed'
}

export interface ToolResultInfo {
  toolUseId: string
  content: string
  isError?: boolean
}

export interface ResultStats {
  durationMs?: number
  costUsd?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  numTurns?: number
}

export interface Message {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: number
  type?: 'text' | 'toolUse' | 'toolResult' | 'thinking' | 'plan' | 'error' | 'stats'
  toolUse?: ToolUseInfo
  toolResult?: ToolResultInfo
  stats?: ResultStats
  thinkingSummary?: string
  model?: string
  jsonlUuid?: string
  turnIndex?: number
  apiCallId?: string
  agentId?: string
  mentions?: Array<{ id: string; name: string }>
  images?: Array<{ data: string; mediaType: string }>
  /** true  agent text  partial-text chunk  messages_batch  */
  streaming?: boolean
}

export interface ConversationRecord {
  sessionId: string
  cliSessionId?: string
  title: string
  timestamp: number
  messages: Message[]
  model: string | null
  messageCount: number
  workingDirectory?: string
  worktree?: WorktreeMetadata
  groupActivities?: Record<string, AgentActivity>
}

/** Worktree localStorage  */
export interface WorktreeMetadata {
  path: string
  branch: string
  baseBranch: string
  repoRoot: string
}

/** Worktree Session server/config/types.ts */
export interface WorktreeSession {
  id: string
  workspaceId: string
  repositoryId: string
  worktreePath: string
  branch: string
  baseBranch: string
  status: 'active' | 'merged' | 'abandoned'
  createdAt: string
}

export interface ExpertActivitySnapshot {
  agentId: string
  agentName: string
  phase: string
  currentTool?: string
  toolCount: number
  toolCompleted: number
  cost?: number
}

/** Dashboard /  Chat Lead + Experts  */
export interface ChatActivityPayload {
  chatId: string
  phase: string
  currentTool?: string
  toolCount: number
  toolCompleted: number
  cost?: number
  logLine?: string
  exitReason?: 'user_stop' | 'timeout' | 'model_switch'
  expertActivities?: ExpertActivitySnapshot[]
  /** Server's actual field name for per-agent activity (see ActivityAggregator).
   *  `expertActivities` above is a legacy alias that the server never populates;
   *  consumers should prefer `agentActivities`. */
  agentActivities?: ExpertActivitySnapshot[]
  latestMessage?: { role: 'user' | 'agent' | 'assistant'; text: string; at: number }
}
/** localStorage  messages/groupActivities */
export interface HistoryMetadata {
  sessionId: string
  cliSessionId?: string
  title: string
  timestamp: number
  messageCount: number
  model: string | null
  workingDirectory?: string
  worktree?: WorktreeMetadata
}
