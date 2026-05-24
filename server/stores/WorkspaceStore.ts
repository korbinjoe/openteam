import { createHash } from 'crypto'
import { nanoid } from 'nanoid'
import { basename, join } from 'path'
import { generateId } from '../utils/id'
import { mkdirSync } from 'fs'
import { SqliteBaseStore } from './SqliteBaseStore'
import type { Workspace, Repository } from '../config/types'
import { createLogger } from '../lib/logger'
import { OPENTEAM_HOME } from '../config/paths'

const log = createLogger('WorkspaceStore')

const DEFAULT_WORKSPACE_NAME = 'Default'
const DEFAULT_WORKSPACE_PATH = join(OPENTEAM_HOME, 'workspace')

export class WorkspaceStore extends SqliteBaseStore<Workspace> {
  constructor(_filePath?: string) {
    super(_filePath, { tableName: 'workspaces' })
  }

  isDefaultWorkspace(ws: Workspace): boolean {
    return ws.name.toLowerCase() === DEFAULT_WORKSPACE_NAME.toLowerCase()
  }

  isDefaultWorkspaceId(id: string): boolean {
    const ws = this.get(id)
    return ws ? this.isDefaultWorkspace(ws) : false
  }

  /**
   *  id='default' workspace  ID
   * chatsexecution_logscron_jobs
   *  'default'
   */
  migrateDefaultId(): void {
    const row = this.db.prepare("SELECT id FROM workspaces WHERE id = 'default'").get() as { id: string } | undefined
    if (!row) return

    const newId = nanoid(10)
    this.db.pragma('foreign_keys = OFF')
    try {
      this.db.transaction(() => {
        this.db.prepare("UPDATE workspaces SET id = ? WHERE id = 'default'").run(newId)
        this.db.prepare("UPDATE chats SET workspace_id = ? WHERE workspace_id = 'default'").run(newId)
        this.db.prepare("UPDATE execution_logs SET workspace_id = ? WHERE workspace_id = 'default'").run(newId)
        this.db.prepare("UPDATE cron_jobs SET workspace_id = ? WHERE workspace_id = 'default'").run(newId)
        this.db.prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(DEFAULT_WORKSPACE_NAME, newId)
      })()
    } finally {
      this.db.pragma('foreign_keys = ON')
    }
    log.info('Default workspace ID migrated', { oldId: 'default', newId })
  }

  ensureDefault(): Workspace {
    const all = this.list()
    const existing = all.find((w) => this.isDefaultWorkspace(w))
    if (existing) return existing

    mkdirSync(DEFAULT_WORKSPACE_PATH, { recursive: true })

    const now = new Date().toISOString()
    const workspace: Workspace = {
      id: nanoid(10),
      name: DEFAULT_WORKSPACE_NAME,
      repositories: [{
        id: createHash('sha256').update(DEFAULT_WORKSPACE_PATH).digest('hex').slice(0, 12),
        path: DEFAULT_WORKSPACE_PATH,
        name: 'workspace',
      }],
      lastAccessedAt: now,
      createdAt: now,
    }
    this.insertEntity(workspace as unknown as Workspace)
    log.info('Default workspace created', { id: workspace.id, path: DEFAULT_WORKSPACE_PATH })
    return workspace
  }

  get(id: string): Workspace | undefined {
    return this.getById(id)
  }

  findByRepoPath(repoPath: string): Workspace | undefined {
    const all = this.list()
    return all.find((w) =>
      w.repositories.length === 1 && w.repositories[0].path === repoPath,
    )
  }

  findByRepoPaths(paths: string[]): Workspace | undefined {
    const sorted = [...paths].sort()
    const all = this.list()
    return all.find((w) => {
      if (w.repositories.length !== paths.length) return false
      const wSorted = w.repositories.map((r) => r.path).sort()
      return wSorted.every((p, i) => p === sorted[i])
    })
  }

  async create(params: {
    name?: string
    repositories: Array<{ path: string; gitInfo?: Repository['gitInfo'] }>
    agentTeam?: { primaryAgentId: string; teamAgentIds: string[] }
    userId?: string
  }): Promise<Workspace> {
    const now = new Date().toISOString()
    const repos: Repository[] = params.repositories.map((r) => ({
      id: createHash('sha256').update(r.path).digest('hex').slice(0, 12),
      path: r.path,
      name: basename(r.path),
      gitInfo: r.gitInfo,
    }))

    const workspace: Workspace = {
      id: params.userId ? generateId(params.userId, 2, 8) : nanoid(10),
      name: params.name || repos[0]?.name || 'Untitled',
      repositories: repos,
      agentTeam: params.agentTeam,
      lastAccessedAt: now,
      createdAt: now,
    }

    this.insertEntity(workspace as unknown as Workspace)
    return workspace
  }

  async update(id: string, updates: Partial<Workspace>): Promise<Workspace | undefined> {
    const ws = this.get(id)
    if (!ws) return undefined
    const merged = { ...ws, ...updates, lastAccessedAt: new Date().toISOString() }
    this.updateById(id, merged as unknown as Workspace)
    return merged
  }

  async remove(id: string): Promise<boolean> {
    if (this.isDefaultWorkspaceId(id)) return false
    return this.deleteById(id)
  }

  listSorted(): Workspace[] {
    const rows = this.db.prepare(
      'SELECT * FROM workspaces ORDER BY last_accessed_at DESC'
    ).all()
    return rows.map((row) => this.rowToEntity(row as Record<string, unknown>))
  }

  protected rowToEntity(row: Record<string, unknown>): Workspace {
    return {
      id: row.id as string,
      name: row.name as string,
      repositories: JSON.parse(row.repositories as string),
      agentTeam: row.agent_team ? JSON.parse(row.agent_team as string) : undefined,
      worktreeEnabled: row.worktree_enabled === 1,
      lastAccessedAt: row.last_accessed_at as string,
      createdAt: row.created_at as string,
    }
  }

  protected entityToRow(entity: Workspace): Record<string, unknown> {
    return {
      id: entity.id,
      name: entity.name,
      repositories: JSON.stringify(entity.repositories),
      agent_team: entity.agentTeam ? JSON.stringify(entity.agentTeam) : null,
      worktree_enabled: entity.worktreeEnabled ? 1 : 0,
      last_accessed_at: entity.lastAccessedAt,
      created_at: entity.createdAt,
    }
  }
}
