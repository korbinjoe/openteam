import { randomUUID } from 'crypto'
import { SqliteBaseStore } from './SqliteBaseStore'
import { createLogger } from '../lib/logger'
import type { ExecutionLog } from '../config/types'

const logger = createLogger('ExecutionLogStore')
const MAX_LOGS = 1000

export class ExecutionLogStore extends SqliteBaseStore<ExecutionLog> {
  constructor(_filePath?: string) {
    super(_filePath, { tableName: 'execution_logs', maxItems: MAX_LOGS })
  }

  get(id: string): ExecutionLog | undefined {
    return this.getById(id)
  }

  listByChat(chatId: string): ExecutionLog[] {
    const rows = this.db.prepare(
      'SELECT * FROM execution_logs WHERE chat_id = ?'
    ).all(chatId)
    return rows.map((row) => this.rowToEntity(row as Record<string, unknown>))
  }

  listByWorkspace(workspaceId: string): ExecutionLog[] {
    const rows = this.db.prepare(
      'SELECT * FROM execution_logs WHERE workspace_id = ?'
    ).all(workspaceId)
    return rows.map((row) => this.rowToEntity(row as Record<string, unknown>))
  }

  summary(workspaceId: string): {
    totalCost: number
    totalTokens: { input: number; output: number; cacheRead: number; cacheCreation: number }
    totalToolCalls: number
    sessionCount: number
  } {
    const row = this.db.prepare(`
      SELECT
        COALESCE(SUM(total_cost), 0) as total_cost,
        COALESCE(SUM(input_tokens), 0) as input_tokens,
        COALESCE(SUM(output_tokens), 0) as output_tokens,
        COALESCE(SUM(cache_read_tokens), 0) as cache_read_tokens,
        COALESCE(SUM(cache_creation_tokens), 0) as cache_creation_tokens,
        COALESCE(SUM(tool_calls), 0) as tool_calls,
        COUNT(*) as cnt
      FROM execution_logs WHERE workspace_id = ?
    `).get(workspaceId) as {
      total_cost: number; input_tokens: number; output_tokens: number
      cache_read_tokens: number; cache_creation_tokens: number
      tool_calls: number; cnt: number
    }

    return {
      totalCost: row.total_cost,
      totalTokens: {
        input: row.input_tokens,
        output: row.output_tokens,
        cacheRead: row.cache_read_tokens,
        cacheCreation: row.cache_creation_tokens,
      },
      totalToolCalls: row.tool_calls,
      sessionCount: row.cnt,
    }
  }

  async create(params: {
    chatId: string
    workspaceId: string
    agentId: string
    executionMode?: 't0' | 't1' | 't2'
    handoffFrom?: string
    workflowId?: string
  }): Promise<ExecutionLog> {
    const log: ExecutionLog = {
      id: randomUUID(),
      chatId: params.chatId,
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      toolCalls: 0,
      status: 'running',
      executionMode: params.executionMode,
      handoffFrom: params.handoffFrom,
      workflowId: params.workflowId,
      startedAt: new Date().toISOString(),
    }
    this.insertEntity(log as unknown as ExecutionLog)
    return log
  }

  async update(id: string, updates: Partial<ExecutionLog>): Promise<ExecutionLog | undefined> {
    const log = this.get(id)
    if (!log) return undefined
    const merged = { ...log, ...updates }
    this.updateById(id, merged as unknown as ExecutionLog)
    return merged
  }

  listUnsyncedByChat(chatId: string): ExecutionLog[] {
    const rows = this.db.prepare(
      'SELECT * FROM execution_logs WHERE chat_id = ? AND synced_at IS NULL'
    ).all(chatId)
    const records = rows.map((row) => this.rowToEntity(row as Record<string, unknown>))
    logger.debug('listUnsyncedByChat', { chatId, count: records.length })
    return records
  }

  listUnsyncedChatIds(): string[] {
    const rows = this.db.prepare(
      'SELECT DISTINCT chat_id FROM execution_logs WHERE synced_at IS NULL'
    ).all() as Array<{ chat_id: string }>
    const ids = rows.map((r) => r.chat_id)
    logger.debug('listUnsyncedChatIds', { count: ids.length, chatIds: ids.slice(0, 10) })
    return ids
  }

  markSynced(chatId: string): void {
    const result = this.db.prepare(
      'UPDATE execution_logs SET synced_at = ? WHERE chat_id = ? AND synced_at IS NULL'
    ).run(new Date().toISOString(), chatId)
    logger.debug('markSynced', { chatId, rowsAffected: result.changes })
  }

  orchestrationMetrics(workspaceId?: string): {
    byMode: Record<string, number>
    handoffCount: number
    workflowCount: number
  } {
    const whereClause = workspaceId ? 'WHERE workspace_id = ?' : ''
    const params = workspaceId ? [workspaceId] : []

    const modeRows = this.db.prepare(
      `SELECT execution_mode, COUNT(*) as cnt FROM execution_logs ${whereClause} GROUP BY execution_mode`
    ).all(...params) as Array<{ execution_mode: string | null; cnt: number }>

    const byMode: Record<string, number> = {}
    for (const r of modeRows) {
      byMode[r.execution_mode || 'unset'] = r.cnt
    }

    const handoffRow = this.db.prepare(
      `SELECT COUNT(*) as cnt FROM execution_logs ${whereClause ? whereClause + ' AND' : 'WHERE'} handoff_from IS NOT NULL`
    ).get(...params) as { cnt: number }

    const workflowRow = this.db.prepare(
      `SELECT COUNT(DISTINCT workflow_id) as cnt FROM execution_logs ${whereClause ? whereClause + ' AND' : 'WHERE'} workflow_id IS NOT NULL`
    ).get(...params) as { cnt: number }

    return {
      byMode,
      handoffCount: handoffRow.cnt,
      workflowCount: workflowRow.cnt,
    }
  }

  async cleanup(maxAgeDays = 30): Promise<number> {
    const cutoff = new Date(Date.now() - maxAgeDays * 86400000).toISOString()
    const result = this.db.prepare(
      'DELETE FROM execution_logs WHERE started_at < ?'
    ).run(cutoff)
    return result.changes
  }

  protected rowToEntity(row: Record<string, unknown>): ExecutionLog {
    const inputTokens = (row.input_tokens as number) || 0
    const outputTokens = (row.output_tokens as number) || 0
    const cacheReadTokens = (row.cache_read_tokens as number) || 0
    const cacheCreationTokens = (row.cache_creation_tokens as number) || 0
    return {
      id: row.id as string,
      chatId: row.chat_id as string,
      workspaceId: row.workspace_id as string,
      agentId: row.agent_id as string,
      totalCost: row.total_cost as number | undefined,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens: (inputTokens || outputTokens)
        ? { input: inputTokens, output: outputTokens, cacheRead: cacheReadTokens, cacheCreation: cacheCreationTokens }
        : undefined,
      toolCalls: row.tool_calls as number,
      duration: row.duration as number | undefined,
      status: row.status as ExecutionLog['status'],
      executionMode: (row.execution_mode as ExecutionLog['executionMode']) || undefined,
      handoffFrom: (row.handoff_from as string) || undefined,
      workflowId: (row.workflow_id as string) || undefined,
      startedAt: row.started_at as string,
      completedAt: row.completed_at as string | undefined,
      syncedAt: (row.synced_at as string) || undefined,
    }
  }

  protected entityToRow(entity: ExecutionLog): Record<string, unknown> {
    return {
      id: entity.id,
      chat_id: entity.chatId,
      workspace_id: entity.workspaceId,
      agent_id: entity.agentId,
      total_cost: entity.totalCost ?? null,
      input_tokens: entity.inputTokens,
      output_tokens: entity.outputTokens,
      cache_read_tokens: entity.cacheReadTokens,
      cache_creation_tokens: entity.cacheCreationTokens,
      tool_calls: entity.toolCalls,
      duration: entity.duration ?? null,
      status: entity.status,
      execution_mode: entity.executionMode ?? null,
      handoff_from: entity.handoffFrom ?? null,
      workflow_id: entity.workflowId ?? null,
      started_at: entity.startedAt,
      completed_at: entity.completedAt ?? null,
      synced_at: entity.syncedAt ?? null,
    }
  }

  protected evictOrderColumn(): string {
    return 'started_at'
  }
}
