import { nanoid } from 'nanoid'
import { SqliteBaseStore } from './SqliteBaseStore'
import type { Chat, TaskStatus } from '../config/types'
import { generateId } from '../utils/id'
import { createLogger } from '../lib/logger'

const log = createLogger('ChatStore')

const MAX_CHATS = 500

export class ChatStore extends SqliteBaseStore<Chat> {
  constructor(_filePath?: string) {
    super(_filePath, { tableName: 'chats', maxItems: MAX_CHATS })
  }

  get(id: string): Chat | undefined {
    return this.getById(id)
  }

  listByWorkspace(workspaceId: string): Chat[] {
    const rows = this.db.prepare(
      'SELECT * FROM chats WHERE workspace_id = ? ORDER BY last_message_at DESC'
    ).all(workspaceId)
    return rows.map((row) => this.rowToEntity(row as Record<string, unknown>))
  }

  countByWorkspace(): Record<string, number> {
    const rows = this.db.prepare(
      'SELECT workspace_id, COUNT(*) as cnt FROM chats GROUP BY workspace_id'
    ).all() as Array<{ workspace_id: string; cnt: number }>
    const result: Record<string, number> = {}
    for (const row of rows) {
      result[row.workspace_id] = row.cnt
    }
    return result
  }

  listRecent(limit = 10): Chat[] {
    const rows = this.db.prepare(
      'SELECT * FROM chats ORDER BY last_message_at DESC LIMIT ?'
    ).all(limit)
    return rows.map((row) => this.rowToEntity(row as Record<string, unknown>))
  }

  async create(params: {
    id?: string
    workspaceId: string
    title: string
    primaryAgentId: string
    teamAgentIds: string[]
    model?: string
    userId?: string
  }): Promise<Chat> {
    const now = new Date().toISOString()
    const chat: Chat = {
      id: params.id || (params.userId ? generateId(params.userId) : nanoid(8)),
      workspaceId: params.workspaceId,
      title: params.title,
      primaryAgentId: params.primaryAgentId,
      teamAgentIds: params.teamAgentIds,
      model: params.model,
      status: 'running',
      createdAt: now,
      lastMessageAt: now,
    }
    this.insertEntity(chat as unknown as Chat)
    return chat
  }

  async update(id: string, updates: Partial<Chat>): Promise<Chat | undefined> {
    const chat = this.get(id)
    if (!chat) return undefined
    const merged = { ...chat, ...updates }
    this.updateById(id, merged as unknown as Chat)
    return merged
  }

  async remove(id: string): Promise<boolean> {
    return this.deleteById(id)
  }

  protected rowToEntity(row: Record<string, unknown>): Chat {
    return {
      id: row.id as string,
      workspaceId: row.workspace_id as string,
      worktreeSessions: row.worktree_sessions ? JSON.parse(row.worktree_sessions as string) : undefined,
      title: row.title as string,
      primaryAgentId: row.primary_agent_id as string,
      teamAgentIds: JSON.parse(row.team_agent_ids as string),
      expertSessions: row.expert_sessions ? JSON.parse(row.expert_sessions as string) : undefined,
      model: row.model as string | undefined,
      status: row.status as Chat['status'],
      taskStatus: row.task_status as TaskStatus | undefined,
      taskSummary: row.task_summary ? JSON.parse(row.task_summary as string) : undefined,
      totalCost: row.total_cost as number | undefined,
      totalTokens: row.total_tokens ? JSON.parse(row.total_tokens as string) : undefined,
      totalToolCalls: row.total_tool_calls as number | undefined,
      participantAgents: row.participant_agents ? JSON.parse(row.participant_agents as string) : undefined,
      lastAgentId: row.last_agent_id as string | undefined,
      source: (row.source as Chat['source']) ?? 'native',
      externalCwd: (row.external_cwd as string | null) ?? undefined,
      archivedAt: (row.archived_at as number | null) ?? null,
      pinnedAt: (row.pinned_at as number | null) ?? null,
      createdAt: row.created_at as string,
      lastMessageAt: row.last_message_at as string,
    }
  }

  protected entityToRow(entity: Chat): Record<string, unknown> {
    return {
      id: entity.id,
      workspace_id: entity.workspaceId,
      worktree_sessions: entity.worktreeSessions ? JSON.stringify(entity.worktreeSessions) : null,
      title: entity.title,
      primary_agent_id: entity.primaryAgentId,
      team_agent_ids: JSON.stringify(entity.teamAgentIds),
      expert_sessions: entity.expertSessions ? JSON.stringify(entity.expertSessions) : null,
      model: entity.model ?? null,
      status: entity.status,
      task_status: entity.taskStatus ?? null,
      task_summary: entity.taskSummary ? JSON.stringify(entity.taskSummary) : null,
      total_cost: entity.totalCost ?? null,
      total_tokens: entity.totalTokens ? JSON.stringify(entity.totalTokens) : null,
      total_tool_calls: entity.totalToolCalls ?? null,
      participant_agents: entity.participantAgents ? JSON.stringify(entity.participantAgents) : null,
      task_location: null,
      location_history: null,
      device_id: null,
      last_agent_id: entity.lastAgentId ?? null,
      source: entity.source ?? 'native',
      external_cwd: entity.externalCwd ?? null,
      archived_at: entity.archivedAt ?? null,
      pinned_at: entity.pinnedAt ?? null,
      created_at: entity.createdAt,
      last_message_at: entity.lastMessageAt,
    }
  }

  protected evictOrderColumn(): string {
    return 'last_message_at'
  }
}
