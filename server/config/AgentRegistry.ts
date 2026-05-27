import { readFile, readdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { parse as parseYaml } from 'yaml'
import chokidar from 'chokidar'
import type { AgentDefinition, AgentPersonality, HeartbeatConfig, BootConfig, CliProvider } from './types'
import type { McpServerConfig } from './types'
import { createLogger } from '../lib/logger'
import { parseInstanceId } from '../../shared/utils'

const log = createLogger('AgentRegistry')

interface AgentJsonConfig {
  id: string
  name: string
  description?: string
  workspace?: string
  role?: string
  allowedTools?: string[]
  disallowedTools?: string[]
  skills?: string[]
  subAgentNames?: string[]
  expertAgentIds?: string[]
  provider?: string
  heartbeat?: HeartbeatConfig
  boot?: BootConfig
  mcpServers?: Record<string, McpServerConfig>
}

interface OpenTeamJson {
  workspace?: string
  agents?: {
    defaults?: { model?: string; provider?: string; mcpServers?: Record<string, McpServerConfig> }
    list?: AgentJsonConfig[]
  }
}

interface IdentityResult {
  name?: string
  nickname?: string
  emoji?: string
  animal?: string
}

function parseIdentity(raw: string | null): IdentityResult {
  if (!raw) return {}
  try {
    return (parseYaml(raw) as IdentityResult) ?? {}
  } catch {
    return {}
  }
}

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

async function readOptional(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8')
  } catch {
    return null
  }
}

/**
 *  agent  systemPrompt
 * §6USER > SYSTEM_AGENTS > SYSTEM_TOOLS > IDENTITY > SOUL > AGENTS > TOOLS > yesterday > today > MEMORY
 */
async function loadAgentDir(
  id: string,
  workspaceDir: string,
  sharedDir: string,
  config: AgentJsonConfig,
): Promise<AgentDefinition> {
  const today = formatDate(new Date())
  const yesterday = formatDate(new Date(Date.now() - 86400000))

  const [
    userMd, systemAgentsMd, systemToolsMd, identityMd, soulMd, agentsMd,
    toolsMd, yesterdayMd, todayMd, memoryMd,
  ] = await Promise.all([
    readOptional(join(sharedDir, 'USER.md')),
    readOptional(join(sharedDir, 'AGENTS.md')),
    readOptional(join(sharedDir, 'TOOLS.md')),
    readOptional(join(workspaceDir, 'IDENTITY.md')),
    readOptional(join(workspaceDir, 'SOUL.md')),
    readOptional(join(workspaceDir, 'AGENTS.md')),
    readOptional(join(workspaceDir, 'TOOLS.md')),
    readOptional(join(workspaceDir, 'memory', `${yesterday}.md`)),
    readOptional(join(workspaceDir, 'memory', `${today}.md`)),
    readOptional(join(workspaceDir, 'MEMORY.md')),
  ])

  const parts = [userMd, systemAgentsMd, systemToolsMd, identityMd, soulMd, agentsMd, toolsMd, yesterdayMd, todayMd, memoryMd]
  const content = parts.filter(Boolean).join('\n\n---\n\n')

  const identity = parseIdentity(identityMd)

  return {
    id,
    name: config.name,
    description: config.description ?? '',
    icon: identity.emoji ?? '🤖',
    subAgentNames: config.subAgentNames ?? config.expertAgentIds,
    systemPrompt: { mode: 'append', content },
    skills: config.skills ?? [],
    mcpServers: config.mcpServers ?? {},
    allowedTools: config.allowedTools,
    disallowedTools: config.disallowedTools,
    heartbeat: config.heartbeat,
    boot: config.boot,
    workspaceDir,
    provider: (['claude', 'codex', 'qoder', 'acp'].includes(config.provider ?? '') ? config.provider : undefined) as CliProvider | undefined,
  }
}

/**
 *  .md frontmatter + body AgentDefinition
 */
function parseMdAgent(filename: string, raw: string, agentsDir: string): AgentDefinition | null {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!fmMatch) {
    log.warn('Missing YAML frontmatter', { filename })
    return null
  }

  const meta = parseYaml(fmMatch[1]) as Record<string, unknown>
  const body = fmMatch[2].trim()
  const id = filename.replace(/\.md$/, '')

  if (!meta.name) {
    log.warn('Frontmatter missing required field (name)', { filename })
    return null
  }

  const rawP = meta.personality as Record<string, unknown> | undefined
  const personality: AgentPersonality | undefined = rawP?.nickname ? {
    nickname: String(rawP.nickname),
    animal: String(rawP.animal ?? ''),
    emoji: String(rawP.emoji ?? ''),
    tone: (['formal', 'casual', 'playful'].includes(String(rawP.tone)) ? String(rawP.tone) : 'casual') as AgentPersonality['tone'],
    verbosity: (['concise', 'moderate', 'detailed'].includes(String(rawP.verbosity)) ? String(rawP.verbosity) : 'moderate') as AgentPersonality['verbosity'],
    persona: String(rawP.persona ?? ''),
  } : undefined

  return {
    id,
    name: String(meta.name),
    description: String(meta.description ?? ''),
    icon: String(meta.icon ?? (rawP?.emoji ? String(rawP.emoji) : '🤖')),
    subAgentNames: Array.isArray(meta.subAgentNames)
      ? meta.subAgentNames.map(String)
      : Array.isArray(meta.expertAgentIds)
        ? meta.expertAgentIds.map(String)
        : undefined,
    personality,
    provider: (['claude', 'codex', 'qoder', 'acp'].includes(String(meta.provider ?? '')) ? String(meta.provider) : undefined) as CliProvider | undefined,
    systemPrompt: { mode: 'append', content: body },
    skills: Array.isArray(meta.skills) ? meta.skills.map(String) : [],
    mcpServers: (meta.mcpServers as Record<string, McpServerConfig>) ?? {},
    allowedTools: Array.isArray(meta.allowedTools) ? meta.allowedTools.map(String) : undefined,
    disallowedTools: Array.isArray(meta.disallowedTools) ? meta.disallowedTools.map(String) : undefined,
    workspaceDir: join(agentsDir, id),
  }
}

/**
 * AgentRegistry —
 * 1. agentsDir/  openteam.json PROJECT_ROOT
 * 2. agentsDir/  .md  agent
 *
 *  agentsDir  ai-assets/agents/per-agent
 * sharedDir  ai-assets/system/ Agent
 */
export class AgentRegistry {
  private agents = new Map<string, AgentDefinition>()
  private agentsDir: string
  private sharedDir: string
  private openteamJsonPath: string
  /** ~/.openteam/openteam.json */
  private userOpenteamJsonPath: string
  private watcher: ReturnType<typeof chokidar.watch> | null = null
  private reloadTimer: ReturnType<typeof setTimeout> | null = null
  private onReloadCallbacks: Array<() => void> = []
  private _configVersion = 0

  constructor(agentsDir: string, sharedDir: string, openteamJsonPath?: string, userOpenteamJsonPath?: string) {
    this.agentsDir = agentsDir
    this.sharedDir = sharedDir
    this.openteamJsonPath = openteamJsonPath ?? join(agentsDir, '..', '..', 'openteam.json')
    this.userOpenteamJsonPath = userOpenteamJsonPath ?? join(agentsDir, '..', 'openteam.json')
  }

  async load(): Promise<void> {
    await this.loadAll()
    this.watch()
  }

  private async loadAll(): Promise<void> {
    this.agents.clear()

    const loaded = await this.loadFromConfigJson()
    if (!loaded) {
      await this.loadFromMdFiles()
    }

    await this.mergeUserConfig()

    log.info('Loaded agents', {
      count: this.agents.size,
      agents: [...this.agents.keys()].join(', '),
      format: loaded ? 'openteam.json' : 'md-files',
    })
  }

  /**
   *  openteam.json + per-agent
   * @returns true
   */
  private async loadFromConfigJson(): Promise<boolean> {
    const raw = await readOptional(this.openteamJsonPath)
    if (!raw) return false

    let config: OpenTeamJson
    try {
      config = JSON.parse(raw) as OpenTeamJson
    } catch (err) {
      log.warn('Failed to parse openteam.json', { error: String(err) })
      return false
    }

    const list = config.agents?.list
    if (!list || list.length === 0) {
      log.warn('openteam.json has no agents.list')
      return false
    }

    const defaults = config.agents?.defaults

    for (const agentConfig of list) {
      try {
        const workspaceDir = join(this.agentsDir, agentConfig.id)
        const sharedDir = this.sharedDir

        const def = await loadAgentDir(agentConfig.id, workspaceDir, sharedDir, agentConfig)
        if (defaults?.mcpServers) {
          def.mcpServers = { ...defaults.mcpServers, ...def.mcpServers }
        }
        this.agents.set(def.id, def)
      } catch (err) {
        log.warn('Failed to load agent from openteam.json', {
          agentId: agentConfig.id,
          error: String(err),
        })
      }
    }

    return this.agents.size > 0
  }

  /**
   * Legacy format: load from agentsDir/*.md files
   */
  private async loadFromMdFiles(): Promise<void> {
    try {
      const files = await readdir(this.agentsDir)
      const mdFiles = files.filter((f) => f.endsWith('.md'))

      for (const file of mdFiles) {
        try {
          const raw = await readFile(join(this.agentsDir, file), 'utf-8')
          const def = parseMdAgent(file, raw, this.agentsDir)
          if (def) this.agents.set(def.id, def)
        } catch (err) {
          log.warn(`Failed to load ${file}`, { error: String(err) })
        }
      }
    } catch (err) {
      log.warn('Failed to read agents dir', { error: String(err) })
    }
  }

  /**
   *  ~/.openteam/openteam.json
   *  id agentmcpServers allowedTools/disallowedTools
   *  id agent
   */
  private async mergeUserConfig(): Promise<void> {
    const raw = await readOptional(this.userOpenteamJsonPath)
    if (!raw) return

    let config: OpenTeamJson
    try {
      config = JSON.parse(raw) as OpenTeamJson
    } catch (err) {
      log.warn('Failed to parse user openteam.json', { error: String(err) })
      return
    }

    const list = config.agents?.list
    if (!list || list.length === 0) return

    let mergedCount = 0
    let addedCount = 0
    for (const userAgent of list) {
      const existing = this.agents.get(userAgent.id)
      if (existing) {
        const mergedConfig = await this.deepMergeAgentConfig(userAgent.id, userAgent)
        if (mergedConfig) {
          try {
            const workspaceDir = join(this.agentsDir, userAgent.id)
            const def = await loadAgentDir(userAgent.id, workspaceDir, this.sharedDir, mergedConfig)
            this.agents.set(def.id, def)
            mergedCount++
          } catch (err) {
            log.warn('Failed to merge user agent config', { agentId: userAgent.id, error: String(err) })
          }
        }
      } else {
        try {
          const workspaceDir = join(this.agentsDir, userAgent.id)
          const def = await loadAgentDir(userAgent.id, workspaceDir, this.sharedDir, userAgent)
          this.agents.set(def.id, def)
          addedCount++
        } catch (err) {
          log.warn('Failed to load user agent', { agentId: userAgent.id, error: String(err) })
        }
      }
    }

    if (mergedCount > 0 || addedCount > 0) {
      log.info('Merged user openteam.json', { merged: mergedCount, added: addedCount })
    }
  }

  private async deepMergeAgentConfig(agentId: string, userOverride: AgentJsonConfig): Promise<AgentJsonConfig | null> {
    const projectRaw = await readOptional(this.openteamJsonPath)
    if (!projectRaw) return userOverride

    let projectConfig: OpenTeamJson
    try {
      projectConfig = JSON.parse(projectRaw) as OpenTeamJson
    } catch {
      return userOverride
    }

    const base = projectConfig.agents?.list?.find((a) => a.id === agentId)
    if (!base) return userOverride

    // - allowedTools / disallowedTools: Array dedupMerge
    const merged: AgentJsonConfig = { ...base }

    if (userOverride.name !== undefined) merged.name = userOverride.name
    if (userOverride.description !== undefined) merged.description = userOverride.description
    if (userOverride.workspace !== undefined) merged.workspace = userOverride.workspace
    if (userOverride.role !== undefined) merged.role = userOverride.role
    if (userOverride.skills !== undefined) merged.skills = userOverride.skills
    if (userOverride.subAgentNames !== undefined) merged.subAgentNames = userOverride.subAgentNames
    if (userOverride.expertAgentIds !== undefined) merged.expertAgentIds = userOverride.expertAgentIds
    if (userOverride.provider !== undefined) merged.provider = userOverride.provider
    if (userOverride.heartbeat !== undefined) merged.heartbeat = userOverride.heartbeat
    if (userOverride.boot !== undefined) merged.boot = userOverride.boot

    if (userOverride.mcpServers) {
      merged.mcpServers = { ...(base.mcpServers || {}), ...userOverride.mcpServers }
    }

    // allowedTools: Array dedupMerge
    if (userOverride.allowedTools) {
      const baseTools = base.allowedTools || []
      merged.allowedTools = [...new Set([...baseTools, ...userOverride.allowedTools])]
    }

    // disallowedTools: Array dedupMerge
    if (userOverride.disallowedTools) {
      const baseTools = base.disallowedTools || []
      merged.disallowedTools = [...new Set([...baseTools, ...userOverride.disallowedTools])]
    }

    return merged
  }

  private watch(): void {
    if (this.watcher) return

    const watchPaths = [this.agentsDir, this.sharedDir]
    if (existsSync(this.openteamJsonPath)) {
      watchPaths.push(this.openteamJsonPath)
    }
    if (existsSync(this.userOpenteamJsonPath)) {
      watchPaths.push(this.userOpenteamJsonPath)
    }

    try {
      this.watcher = chokidar.watch(watchPaths, {
        ignoreInitial: true,
        depth: 2,
        awaitWriteFinish: { stabilityThreshold: 300 },
      })

      const scheduleReload = (path: string) => {
        if (this.reloadTimer) clearTimeout(this.reloadTimer)
        this.reloadTimer = setTimeout(() => {
          log.info('Detected change, reloading', { path })
          this.reload()
        }, 300)
      }

      this.watcher.on('change', scheduleReload)
      this.watcher.on('add', scheduleReload)
      this.watcher.on('unlink', scheduleReload)
      this.watcher.on('error', (err) => {
        log.warn('Watch error', { error: String(err) })
      })

      log.info('Watching agents directory for changes', { depth: 2 })
    } catch (err) {
      log.warn('Failed to watch agents dir', { error: String(err) })
    }
  }

  async reload(): Promise<void> {
    await this.loadAll()
    this._configVersion++
    log.info('Reloaded agents', { count: this.agents.size, version: this._configVersion })
    this.onReloadCallbacks.forEach((cb) => cb())
  }

  onReload(callback: () => void): void {
    this.onReloadCallbacks.push(callback)
  }

  stopWatching(): void {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer)
      this.reloadTimer = null
    }
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  async reloadAgentDir(agentId: string): Promise<AgentDefinition | null> {
    const existing = this.agents.get(agentId)
    if (!existing?.workspaceDir) return null

    const agentConfig = await this.findAgentConfig(agentId)
    if (!agentConfig) return null

    try {
      const freshDef = await loadAgentDir(agentId, existing.workspaceDir, this.sharedDir, agentConfig)
      this.agents.set(agentId, freshDef)
      return freshDef
    } catch (err) {
      log.warn('Failed to reload agent dir', { agentId, error: String(err) })
      return null
    }
  }

  private async findAgentConfig(agentId: string): Promise<AgentJsonConfig | null> {
    let base: AgentJsonConfig | null = null
    let userOverride: AgentJsonConfig | null = null

    for (const [path, target] of [[this.openteamJsonPath, 'project'], [this.userOpenteamJsonPath, 'user']] as const) {
      const raw = await readOptional(path)
      if (!raw) continue
      try {
        const config = JSON.parse(raw) as OpenTeamJson
        const found = config.agents?.list?.find((a) => a.id === agentId)
        if (found) {
          if (target === 'project') base = found
          else userOverride = found
        }
      } catch { /* ignore */ }
    }

    if (base && userOverride) {
      return await this.deepMergeAgentConfig(agentId, userOverride)
    }
    return base || userOverride
  }

  get configVersion(): number {
    return this._configVersion
  }

  get(id: string): AgentDefinition | undefined {
    const direct = this.agents.get(id)
    if (direct) return direct
    const { baseId } = parseInstanceId(id)
    return baseId !== id ? this.agents.get(baseId) : undefined
  }

  getByName(name: string): AgentDefinition | undefined {
    return this.list().find((a) => a.name === name)
  }

  list(): AgentDefinition[] {
    return [...this.agents.values()]
  }

  listSummary(): Array<Pick<AgentDefinition, 'id' | 'name' | 'description' | 'icon' | 'subAgentNames' | 'personality'>> {
    return this.list().map(({ id, name, description, icon, subAgentNames, personality }) => ({
      id, name, description, icon, subAgentNames, personality,
    }))
  }

  remove(id: string): boolean {
    return this.agents.delete(id)
  }
}
