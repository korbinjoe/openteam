import { SqliteBaseStore } from './SqliteBaseStore'
import type { Agent } from '../config/types'
import { randomUUID } from 'crypto'
import { createLogger } from '../lib/logger'

const log = createLogger('AgentStore')

/**
 *  name  kebab-case id ASCII /
 *
 *  name  fallback  8  uuid
 *  /^[a-z0-9][a-z0-9-]{0,63}$/ avatarStorage / generate-avatar
 *  ASCII
 */
export const slugify = (name: string): string => {
  const cleaned = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (!cleaned) return randomUUID().slice(0, 8)
  return cleaned
}

export const generateAgentId = (): string => {
  return randomUUID().replace(/-/g, '').slice(0, 8)
}

export class AgentStore extends SqliteBaseStore<Agent> {
  constructor(_filePath?: string) {
    super(_filePath, { tableName: 'agents' })
  }

  get(id: string): Agent | undefined {
    return this.getById(id)
  }

  getByName(name: string): Agent | undefined {
    const row = this.db.prepare('SELECT * FROM agents WHERE name = ?').get(name)
    return row ? this.rowToEntity(row as Record<string, unknown>) : undefined
  }

  async upsert(agent: Agent): Promise<void> {
    if (!agent.id) {
      let candidate = generateAgentId()
      while (this.get(candidate)) {
        candidate = generateAgentId()
      }
      agent.id = candidate
    }
    const existing = this.get(agent.id)
    if (existing) {
      const updated = { ...agent, updatedAt: new Date().toISOString() }
      this.updateById(agent.id, updated as unknown as Agent)
    } else {
      this.insertEntity(agent as unknown as Agent)
    }
  }

  async remove(id: string): Promise<boolean> {
    return this.deleteById(id)
  }

  async importBuiltin(agents: Agent[]): Promise<void> {
    const incomingIds = new Set(agents.map((a) => a.id))
    const transaction = this.db.transaction(() => {
      const staleBuiltins = this.db.prepare(
        "SELECT id FROM agents WHERE source = 'builtin'"
      ).all() as Array<{ id: string }>
      for (const { id } of staleBuiltins) {
        if (!incomingIds.has(id)) {
          this.deleteById(id)
          log.info('Removed stale builtin agent', { agentId: id })
        }
      }

      for (const agent of agents) {
        const existingById = this.get(agent.id)
        if (existingById) {
          if (existingById.source === 'builtin') {
            const updated = { ...agent, source: 'builtin' as const, updatedAt: new Date().toISOString() }
            this.updateById(agent.id, updated as unknown as Agent)
          }
        } else {
          const conflictByName = this.getByName(agent.name)
          if (conflictByName && conflictByName.source === 'builtin') {
            this.deleteById(conflictByName.id)
            log.info('Removed renamed builtin agent', { oldId: conflictByName.id, newId: agent.id })
          }
          this.insertEntity({ ...agent, source: 'builtin' } as unknown as Agent)
        }
      }
    })
    transaction()
  }

  protected rowToEntity(row: Record<string, unknown>): Agent {
    return {
      id: row.id as string,
      name: row.name as string,
      description: row.description as string,
      icon: row.icon as string,
      systemPrompt: JSON.parse(row.system_prompt as string),
      allowedTools: row.allowed_tools ? JSON.parse(row.allowed_tools as string) : undefined,
      disallowedTools: row.disallowed_tools ? JSON.parse(row.disallowed_tools as string) : undefined,
      model: row.model as string | undefined,
      maxTurns: row.max_turns as number | undefined,
      skills: row.skills ? JSON.parse(row.skills as string) : undefined,
      mcpServers: row.mcp_servers ? JSON.parse(row.mcp_servers as string) : undefined,
      hooks: row.hooks ? JSON.parse(row.hooks as string) : undefined,
      subAgentNames: row.sub_agent_names ? JSON.parse(row.sub_agent_names as string) : undefined,
      personality: row.personality ? JSON.parse(row.personality as string) : undefined,
      provider: row.provider as 'claude' | 'codex' | undefined,
      tags: JSON.parse(row.tags as string),
      source: row.source as 'builtin' | 'user',
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string,
    }
  }

  protected entityToRow(entity: Agent): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      description: entity.description ?? '',
      icon: entity.icon ?? '',
      system_prompt: JSON.stringify(entity.systemPrompt),
      allowed_tools: entity.allowedTools ? JSON.stringify(entity.allowedTools) : null,
      disallowed_tools: entity.disallowedTools ? JSON.stringify(entity.disallowedTools) : null,
      model: entity.model ?? null,
      max_turns: entity.maxTurns ?? null,
      skills: entity.skills ? JSON.stringify(entity.skills) : null,
      mcp_servers: entity.mcpServers ? JSON.stringify(entity.mcpServers) : null,
      hooks: entity.hooks ? JSON.stringify(entity.hooks) : null,
      sub_agent_names: entity.subAgentNames ? JSON.stringify(entity.subAgentNames) : null,
      personality: entity.personality ? JSON.stringify(entity.personality) : null,
      provider: entity.provider ?? null,
      tags: JSON.stringify(entity.tags ?? []),
      source: entity.source,
      created_at: entity.createdAt,
      updated_at: entity.updatedAt,
    }
  }
}
