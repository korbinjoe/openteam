/**
 * MemoryStore — Agent
 *
 *  Agent
 *  Agent  system prompt
 */

import { randomUUID } from 'crypto'
import { SqliteBaseStore } from './SqliteBaseStore'
import type { AgentMemory, MemoryCategory } from '../config/types'

export class MemoryStore extends SqliteBaseStore<AgentMemory> {
  constructor(_filePath?: string) {
    super(_filePath, { tableName: 'agent_memories', maxItems: 2000 })
  }

  get(id: string): AgentMemory | undefined {
    return this.getById(id)
  }

  listByAgent(agentId: string): AgentMemory[] {
    const rows = this.db.prepare(
      'SELECT * FROM agent_memories WHERE agent_id = ? ORDER BY importance DESC, updated_at DESC'
    ).all(agentId)
    return rows.map((row) => this.rowToEntity(row as Record<string, unknown>))
  }

  listByCategory(agentId: string, category: MemoryCategory): AgentMemory[] {
    const rows = this.db.prepare(
      'SELECT * FROM agent_memories WHERE agent_id = ? AND category = ? ORDER BY importance DESC'
    ).all(agentId, category)
    return rows.map((row) => this.rowToEntity(row as Record<string, unknown>))
  }

  getForPromptInjection(agentId: string, limit = 20): AgentMemory[] {
    const rows = this.db.prepare(
      'SELECT * FROM agent_memories WHERE agent_id = ? ORDER BY importance DESC, updated_at DESC LIMIT ?'
    ).all(agentId, limit)
    return rows.map((row) => this.rowToEntity(row as Record<string, unknown>))
  }

  async create(params: {
    agentId: string
    category?: MemoryCategory
    content: string
    source?: string
    chatId?: string
    importance?: number
  }): Promise<AgentMemory> {
    const now = new Date().toISOString()
    const memory: AgentMemory = {
      id: randomUUID(),
      agentId: params.agentId,
      category: params.category ?? 'general',
      content: params.content,
      source: params.source,
      chatId: params.chatId,
      importance: params.importance ?? 1,
      createdAt: now,
      updatedAt: now,
    }
    this.insertEntity(memory)
    return memory
  }

  async update(id: string, params: Partial<Pick<AgentMemory, 'content' | 'category' | 'importance'>>): Promise<AgentMemory | undefined> {
    const existing = this.getById(id)
    if (!existing) return undefined

    const updated = {
      ...existing,
      ...params,
      updatedAt: new Date().toISOString(),
    }
    this.updateById(id, updated)
    return updated
  }

  async remove(id: string): Promise<boolean> {
    return this.deleteById(id)
  }

  async clearByAgent(agentId: string): Promise<number> {
    const result = this.db.prepare(
      'DELETE FROM agent_memories WHERE agent_id = ?'
    ).run(agentId)
    return result.changes
  }

  getBySource(agentId: string, source: string): AgentMemory | undefined {
    const row = this.db.prepare(
      'SELECT * FROM agent_memories WHERE agent_id = ? AND source = ?'
    ).get(agentId, source)
    return row ? this.rowToEntity(row as Record<string, unknown>) : undefined
  }

  listAllSources(): string[] {
    const rows = this.db.prepare(
      'SELECT source FROM agent_memories WHERE source IS NOT NULL'
    ).all() as Array<{ source: string }>
    return rows.map((r) => r.source)
  }

  countByAgent(agentId: string): number {
    const result = this.db.prepare(
      'SELECT COUNT(*) as cnt FROM agent_memories WHERE agent_id = ?'
    ).get(agentId) as { cnt: number }
    return result.cnt
  }

  protected rowToEntity(row: Record<string, unknown>): AgentMemory {
    return {
      id: row.id as string,
      agentId: row.agent_id as string,
      category: row.category as MemoryCategory,
      content: row.content as string,
      source: row.source as string | undefined,
      chatId: row.chat_id as string | undefined,
      importance: row.importance as number,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }
  }

  protected entityToRow(entity: AgentMemory): Record<string, unknown> {
    return {
      id: entity.id,
      agent_id: entity.agentId,
      category: entity.category,
      content: entity.content,
      source: entity.source ?? null,
      chat_id: entity.chatId ?? null,
      importance: entity.importance,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    }
  }

  protected evictOrderColumn(): string {
    return 'updated_at'
  }
}
