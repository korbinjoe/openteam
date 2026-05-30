// ── CLI Provider ──

export type CliProvider = 'claude' | 'codex' | 'acp' | 'qoder'

export interface AgentPersonality {
  nickname: string
  animal: string
  emoji: string
  tone: 'formal' | 'casual' | 'playful'
  verbosity: 'concise' | 'moderate' | 'detailed'
  persona: string
}

export interface Agent {
  id: string
  name: string
  description: string
  icon: string

  systemPrompt: {
    mode: 'replace' | 'append'
    content: string
  }

  allowedTools?: string[]
  disallowedTools?: string[]
  model?: string
  maxTurns?: number
  skills?: string[]
  mcpServers?: Record<string, McpServerConfig>
  hooks?: HooksConfig

  subAgentNames?: string[]

  personality?: AgentPersonality

  provider?: CliProvider

  heartbeat?: HeartbeatConfig

  boot?: BootConfig

  workspaceDir?: string

  tags: string[]
  source: 'builtin' | 'user'
  createdAt: string
  updatedAt: string
}

export interface McpServerConfig {
  transport: 'stdio' | 'sse' | 'http'
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
}

export interface HooksConfig {
  PreToolUse?: HookEntry[]
  PostToolUse?: HookEntry[]
  Notification?: HookEntry[]
  Stop?: HookEntry[]
}

export interface HookEntry {
  matcher?: string
  hooks: Array<{
    type: 'command'
    command: string
    timeout?: number
  }>
}

// ── Workspace ──

export interface Workspace {
  id: string
  name: string
  repositories: Repository[]
  agentTeam?: {
    primaryAgentId: string
    teamAgentIds: string[]
  }
  /**  Chat  Git Worktree  false */
  worktreeEnabled?: boolean
  lastAccessedAt: string
  createdAt: string
}

export interface Repository {
  id: string
  path: string
  name: string
  gitInfo?: {
    currentBranch?: string
    remoteUrl?: string
  }
}

// ── Worktree Session ──

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

export interface ExpertSessionInfo {
  cliSessionId: string
  provider?: CliProvider
  cwd: string
  exitCode?: number
  taskCompleted?: boolean
}

export type ChatMemberStatus = 'running' | 'waiting' | 'waiting_input' | 'error' | 'idle' | 'done'

export type ChatMemberRole = 'lead' | 'worker'

export interface ChatMember {
  agentId: string
  role: ChatMemberRole
  status: ChatMemberStatus
  lastMessageAt: string
  lastMessage?: string
  cliSessionId?: string
}

export type TaskStatus =
  | 'running'
  | 'waiting_input'
  | 'waiting_confirm'
  | 'success'
  | 'error'
  | 'timeout'
  | 'interrupted'

export interface TaskSummary {
  lastMessage?: string
  errorMessage?: string
  durationSec?: number
}

// ── Chat ──

export interface Chat {
  id: string
  workspaceId: string
  worktreeSessions?: WorktreeSession[]
  title: string
  primaryAgentId: string
  teamAgentIds: string[]
  /** Expert Agent  session agentId → { cliSessionId, provider?, cwd } */
  expertSessions?: Record<string, ExpertSessionInfo>
  model?: string
  status: 'running' | 'idle' | 'stopped' | 'merged'
  taskStatus?: TaskStatus
  taskSummary?: TaskSummary
  totalCost?: number
  totalTokens?: { input: number; output: number; cacheRead?: number; cacheCreation?: number }
  totalToolCalls?: number
  participantAgents?: string[]
  lastAgentId?: string
  /** Per-agent live state, derived by MemberAggregator on read. Optional because
   *  it is enrichment, not persistence — every API surface that returns Chat
   *  to the client SHOULD populate this via enrichWithMembers(). */
  members?: ChatMember[]
  /** Origin of the chat. 'native' = created in OpenTeam; 'external' = adopted
   *  from a pre-existing local CLI jsonl (Claude Code / Codex). Defaults to
   *  'native' for legacy rows. */
  source?: 'native' | 'external'
  /** When the adopted chat's working directory does not match any registered
   *  workspace, the original cwd is preserved here so the sidebar can still
   *  group it correctly. Always null for native chats. */
  externalCwd?: string
  /** User explicitly archived the chat (ms since epoch). Null means not
   *  manually archived; the sidebar's auto-archive rule may still hide it. */
  archivedAt?: number | null
  /** User pinned the chat to the top of the sidebar (ms since epoch). */
  pinnedAt?: number | null
  createdAt: string
  lastMessageAt: string
}

// ── Execution Log ──

export interface ExecutionLog {
  id: string
  chatId: string
  workspaceId: string
  agentId: string
  totalCost?: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
  /** @deprecated  Store  4  */
  totalTokens?: { input: number; output: number; cacheRead?: number; cacheCreation?: number }
  toolCalls: number
  duration?: number
  status: 'running' | 'completed' | 'error'
  startedAt: string
  completedAt?: string
  syncedAt?: string
}

export interface SkillHookCommand {
  command: string
  timeout?: number
  matcher?: string
}

export interface SkillHooksConfig {
  PreToolUse?: SkillHookCommand[]
  PostToolUse?: SkillHookCommand[]
  Notification?: SkillHookCommand[]
  Stop?: SkillHookCommand[]
}

export interface SkillDefinition {
  name: string
  description: string
  content: string
  allowedTools?: string
  hooks?: SkillHooksConfig
  enabled: boolean
  source: 'builtin' | 'custom'
  filePath?: string
}

export type CronTrigger =
  | { kind: 'cron'; expression: string; timezone?: string }
  | { kind: 'once'; at: string }
  | { kind: 'interval'; intervalMs: number }

export interface CronJobExecution {
  id: string
  startedAt: string
  finishedAt?: string
  status: 'running' | 'success' | 'failed'
  chatId?: string
  exitCode?: number
  errorMessage?: string
}

export interface CronJob {
  id: string
  name: string
  description?: string
  workspaceId: string
  agentId?: string
  model?: string
  trigger: CronTrigger
  prompt: string
  enabled: boolean
  retryOnFailure: boolean
  maxRetries: number
  createdAt: string
  updatedAt: string
  lastRunAt?: string
  nextRunAt?: string
  executions: CronJobExecution[]
}

// ── Notification（Notification） ──

export type NotificationCategory =
  | 'cron_success'
  | 'cron_failed'
  | 'system'

export interface Notification {
  id: string
  category: NotificationCategory
  title: string
  body: string
  read: boolean
  createdAt: string
  link?: string
  meta?: {
    chatId?: string
    cronJobId?: string
    workspaceId?: string
  }
}

export interface HeartbeatConfig {
  every: string       // duration: '30m', '1h'
  prompt?: string
  enabled?: boolean
}

export interface BootConfig {
  enabled?: boolean
  prompt?: string
}

/** AgentDefinition — AgentRegistry  openteam.json +  */
export interface AgentDefinition {
  id: string
  name: string
  description: string
  icon: string
  subAgentNames?: string[]
  personality?: AgentPersonality
  provider?: CliProvider
  systemPrompt: { mode: 'replace' | 'append'; content: string }
  skills: string[]
  mcpServers: Record<string, McpServerConfig>
  allowedTools?: string[]
  disallowedTools?: string[]
  heartbeat?: HeartbeatConfig
  boot?: BootConfig
  workspaceDir?: string
}

/**  AgentDefinition  V2 Agent */
export const agentDefToAgent = (def: AgentDefinition): Agent => {
  const now = new Date().toISOString()
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    icon: def.icon,
    systemPrompt: def.systemPrompt,
    allowedTools: def.allowedTools,
    disallowedTools: def.disallowedTools,
    skills: def.skills,
    mcpServers: def.mcpServers && Object.keys(def.mcpServers).length > 0
      ? def.mcpServers : undefined,
    subAgentNames: def.subAgentNames,
    personality: def.personality,
    provider: def.provider,
    heartbeat: def.heartbeat,
    boot: def.boot,
    workspaceDir: def.workspaceDir,
    tags: [],
    source: 'builtin',
    createdAt: now,
    updatedAt: now,
  }
}

// ── Agent Memory & Growth ──

export type MemoryCategory = 'general' | 'preference' | 'context' | 'feedback' | 'skill'

export interface AgentMemory {
  id: string
  agentId: string
  category: MemoryCategory
  content: string
  source?: string
  chatId?: string
  importance: number
  createdAt: string
  updatedAt: string
}

export type GrowthMetric = 'tasks_completed' | 'bugs_fixed' | 'reviews_done' | 'deploys' | 'xp'

export interface AgentGrowth {
  id: string
  agentId: string
  metric: GrowthMetric
  value: number
  level: number
  updatedAt: string
}
