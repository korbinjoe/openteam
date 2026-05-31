/**
 * ConfigCompiler - Agent
 *  Agent  +  Claude CLI
 */

import { join, resolve, isAbsolute, dirname } from 'path'
import { readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { readFile, writeFile, unlink, mkdir } from 'fs/promises'
import { randomUUID } from 'crypto'
import type { Agent, AgentPersonality, AgentMemory, McpServerConfig, CliProvider, HooksConfig, HookEntry } from '../config/types'
import type { SkillManager } from '../config/SkillManager'
import type { MemoryStore } from '../stores/MemoryStore'
import type { WhiteboardManager } from '../whiteboard/WhiteboardManager'
import { ContextBriefing } from '../whiteboard/ContextBriefing'
import { isWhiteboardOnDemandEnabled } from './featureFlags'
import { HooksConfigManager } from './HooksConfigManager'
import { resolveCliCommandAsync } from '../lib/resolveCliCommand'
import { createLogger } from '../lib/logger'
import { silentlyIgnore } from '../lib/silentlyIgnore'

const log = createLogger('ConfigCompiler')

export interface CompiledAgentConfig {
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string
  settingsPath?: string
  presetSessionId?: string
  cleanup: () => Promise<void>
}

export interface CompileContext {
  repositories: Array<{
    path: string
    worktreePath?: string
  }>
  serverPort: number
  availableExperts?: Array<{
    name: string
    description: string
  }>
  /**  session  Claude session ID */
  resumeSessionId?: string
  connectionId?: string
  skipPermissions?: boolean
  /** ~/.openteam/system/ Agent  */
  sharedWorkspaceDir?: string
  chatId?: string
  /**  Agent  ID fullstack-engineer#1 */
  instanceId?: string
  dispatchChain?: string[]
  previousContext?: {
    agentName: string
    lastMessage?: string
    jsonlPath?: string
  }
}

export class ConfigCompiler {
  private _projectRoot: string

  constructor(
    private skillManager: SkillManager,
    private hooksConfigManager: HooksConfigManager,
    private memoryStore?: MemoryStore,
    _unused?: unknown,
    projectRoot?: string,
    /**
     * WhiteboardManager  ——
     *  snapshot  system prompt  agentInstanceId  cursor
     *  latestSeq PostToolUse hook  diff
     *  ExpertLifecycle.briefing.maybeWrapTask
     */
    private whiteboardManager?: WhiteboardManager,
  ) {
    this._projectRoot = projectRoot || process.cwd()
  }

  private get projectRoot(): string {
    return this._projectRoot
  }

  /**
   * @param llmEnv  agent.model
   *    settings.json  env  openteam UI  model/
   *    ~/.claude/settings.jsonCodex provider  settings.json
   */
  async compile(
    agent: Agent,
    context: CompileContext,
    provider?: CliProvider,
    llmEnv?: Record<string, string>,
  ): Promise<CompiledAgentConfig> {
    const effectiveProvider: CliProvider = provider || 'claude'
    switch (effectiveProvider) {
      case 'codex':
        return this.compileForCodex(agent, context)
      case 'claude':
      case 'acp':
      case 'qoder':
        break
      default: {
        const _exhaustive: never = effectiveProvider
        throw new Error(`Unknown CLI provider: ${_exhaustive}`)
      }
    }

    const args: string[] = []
    const env: Record<string, string> = {}
    const cleanupFns: Array<() => Promise<void>> = []

    const cwd = this.resolveCwd(context)

    const systemHooks = this.collectSkillHooks(agent)

    const envOverrides: Record<string, string> = { ...(llmEnv || {}) }
    if (agent.model) {
      envOverrides.ANTHROPIC_MODEL = agent.model
    }

    // ── Step 0: Resume Mode ──
    if (context.resumeSessionId) {
      args.push('--resume', context.resumeSessionId)
      args.push('--print', '--verbose')
      args.push('--output-format', 'stream-json')
      args.push('--input-format', 'stream-json')
      args.push('--include-partial-messages')
      args.push('--replay-user-messages')

      const envSkipPerms = process.env.OPENTEAM_SKIP_PERMISSIONS === 'true'
      if (context.skipPermissions === true || envSkipPerms) {
        args.push('--dangerously-skip-permissions')
      }
      const resumeSessionKey = `resume-${Date.now()}`
      const resumeSettingsPath = await this.hooksConfigManager.writeConfig(
        resumeSessionKey,
        agent.hooks,
        [cwd, this.projectRoot],
        systemHooks,
        envOverrides,
      )
      args.push('--settings', resumeSettingsPath)

      const resumeEnv: Record<string, string> = {}
      if (context.chatId) resumeEnv.OPENTEAM_CHAT_ID = context.chatId
      if (context.instanceId) resumeEnv.OPENTEAM_INSTANCE_ID = context.instanceId
      resumeEnv.EXPERT_API_BASE = `http://localhost:${context.serverPort}`
      resumeEnv.EXPERT_CONNECTION_ID = context.connectionId || ''

      await this.writeEnvFile(context, resumeEnv)

      return {
        command: effectiveProvider === 'qoder' ? 'qodercli' : 'claude',
        args,
        env: resumeEnv,
        cwd,
        cleanup: async () => {
          await silentlyIgnore(() => this.hooksConfigManager.cleanup(resumeSessionKey), 'hooks cleanup for resume session')
        },
      }
    }

    args.push('--dangerously-skip-permissions')

    for (const repo of context.repositories) {
      const dir = repo.worktreePath || repo.path
      args.push('--add-dir', dir)
    }

    const promptContent = this.buildPromptContent(agent, context)

    if (promptContent.trim()) {
      if (agent.systemPrompt.mode === 'replace') {
        args.push('--system-prompt', promptContent)
      } else {
        args.push('--append-system-prompt', promptContent)
      }
    }

    if (agent.allowedTools?.length) {
      for (const tool of agent.allowedTools) {
        if (tool.startsWith('mcp__handoff__')) continue
        args.push('--allowedTools', tool)
      }
      if (agent.mcpServers?.playwright) {
        const playwrightTools = [
          'mcp__playwright__browser_navigate',
          'mcp__playwright__browser_snapshot',
          'mcp__playwright__browser_click',
          'mcp__playwright__browser_type',
          'mcp__playwright__browser_go_back',
          'mcp__playwright__browser_wait',
          'mcp__playwright__browser_close',
          'mcp__playwright__browser_screenshot',
          'mcp__playwright__browser_tab_list',
          'mcp__playwright__browser_tab_new',
          'mcp__playwright__browser_tab_close',
        ]
        for (const tool of playwrightTools) {
          if (!agent.allowedTools.includes(tool)) {
            args.push('--allowedTools', tool)
          }
        }
      }
    }
    if (agent.disallowedTools?.length) {
      for (const tool of agent.disallowedTools) {
        args.push('--disallowedTools', tool)
      }
    }
    for (const tool of ['EnterPlanMode', 'ExitPlanMode']) {
      args.push('--disallowedTools', tool)
    }
    if (agent.model) {
      args.push('--model', agent.model)
    }
    if (agent.maxTurns) {
      args.push('--max-turns', String(agent.maxTurns))
    }

    const presetSessionId = randomUUID()

    if (context.chatId) {
      env.OPENTEAM_CHAT_ID = context.chatId
    }
    if (context.instanceId) {
      env.OPENTEAM_INSTANCE_ID = context.instanceId
    }
    if (context.dispatchChain?.length) {
      env.OPENTEAM_DISPATCH_CHAIN = JSON.stringify(context.dispatchChain)
    }

    const mcpServers: Record<string, McpServerConfig> = {
      ...(agent.mcpServers || {}),
    }

    env.EXPERT_API_BASE = `http://localhost:${context.serverPort}`
    env.EXPERT_CONNECTION_ID = context.connectionId || ''
    if (context.availableExperts?.length) {
      env.AVAILABLE_EXPERTS = JSON.stringify(context.availableExperts)
    }

    for (const srv of Object.values(mcpServers)) {
      if (srv.args?.length) {
        srv.args = srv.args.map(a => (!isAbsolute(a) && a.includes('/') && !a.includes('://') && !a.startsWith('@')) ? resolve(this.projectRoot, a) : a)
      }
    }

    for (const srv of Object.values(mcpServers)) {
      if (srv.command === 'npx' && srv.args?.[0] === 'tsx') {
        const tsxDist = join(this.projectRoot, 'node_modules', 'tsx', 'dist')
        const preflight = join(tsxDist, 'preflight.cjs')
        const loader = join(tsxDist, 'esm', 'index.mjs')
        const scriptArgs = srv.args.slice(1)
        const resolvedNode = await resolveCliCommandAsync('node') || process.execPath
        srv.command = resolvedNode
        if (existsSync(preflight) && existsSync(loader)) {
          srv.args = ['--require', preflight, '--import', `file://${loader}`, ...scriptArgs]
        } else {
          srv.args = ['--experimental-strip-types', ...scriptArgs]
        }
      }
    }

    if (Object.keys(mcpServers).length > 0) {
      const mcpConfig = JSON.stringify({ mcpServers })
      args.push('--mcp-config', mcpConfig)
    }

    // ── Step 5: Hooks + env Override ──
    const sessionKey = `${agent.name}-${Date.now()}`
    const settingsPath = await this.hooksConfigManager.writeConfig(
      sessionKey,
      agent.hooks,
      [cwd, this.projectRoot],
      systemHooks,
      envOverrides,
    )
    args.push('--settings', settingsPath)
    cleanupFns.push(() => this.hooksConfigManager.cleanup(sessionKey))

    // ── Step 6: stream-json ModeParameters（Claude provider DefaultEnable） ──
    args.push('--print', '--verbose')
    args.push('--output-format', 'stream-json')
    args.push('--input-format', 'stream-json')
    args.push('--include-partial-messages')
    args.push('--replay-user-messages')

    await this.writeEnvFile(context, env)

    return {
      command: effectiveProvider === 'qoder' ? 'qodercli' : 'claude',
      args,
      env,
      cwd,
      settingsPath,
      presetSessionId,
      cleanup: async () => {
        for (const fn of cleanupFns) {
          await silentlyIgnore(fn, 'config compile cleanup')
        }
      },
    }
  }

  private async compileForCodex(agent: Agent, context: CompileContext): Promise<CompiledAgentConfig> {
    const args: string[] = []
    const cleanupFns: Array<() => Promise<void>> = []

    args.push('exec')
    args.push('--json')

    args.push('--dangerously-bypass-approvals-and-sandbox')

    if (agent.model) {
      args.push('--model', agent.model)
    }

    const promptContent = this.buildPromptContent(agent, context)

    const cwd = this.resolveCwd(context)

    if (promptContent.trim()) {
      const codexHome = resolve(homedir(), '.codex')
      await mkdir(codexHome, { recursive: true })
      const overridePath = join(codexHome, 'AGENTS.override.md')

      let fileContent: string | null = null
      try {
        fileContent = await readFile(overridePath, 'utf-8')
      } catch {
      }

      const OPENTEAM_MARKER = '<!-- OpenTeam Agent Instructions -->'
      const userOriginal = fileContent !== null
        ? fileContent.split(OPENTEAM_MARKER)[0].trimEnd()
        : null

      const newContent = userOriginal
        ? `${userOriginal}\n\n${OPENTEAM_MARKER}\n${promptContent}`
        : promptContent

      await writeFile(overridePath, newContent, 'utf-8')
      log.info('Wrote ~/.codex/AGENTS.override.md', { agentName: agent.name })

      cleanupFns.push(async () => {
        try {
          if (userOriginal) {
            await writeFile(overridePath, userOriginal, 'utf-8')
          } else {
            await unlink(overridePath)
          }
          log.info('Cleaned up ~/.codex/AGENTS.override.md', { agentName: agent.name })
        } catch {
        }
      })
    }

    const codexHooks = this.buildCodexHooksJson(agent)
    if (codexHooks) {
      const codexDir = join(cwd, '.codex')
      await mkdir(codexDir, { recursive: true })
      const codexHooksPath = join(codexDir, 'hooks.json')

      let existingContent: string | null = null
      try {
        existingContent = await readFile(codexHooksPath, 'utf-8')
      } catch { /* Filedoes not exist */ }

      let merged = codexHooks
      if (existingContent) {
        try {
          const existing = JSON.parse(existingContent) as { hooks?: Record<string, unknown[]> }
          if (existing.hooks?.Stop) {
            merged = {
              hooks: {
                ...existing.hooks,
                Stop: [...(existing.hooks.Stop as unknown[]), ...codexHooks.hooks.Stop],
              },
            }
          }
        } catch { /* invalid existing hooks.json, overwrite */ }
      }

      await writeFile(codexHooksPath, JSON.stringify(merged, null, 2), 'utf-8')
      log.info('Wrote .codex/hooks.json', { agentName: agent.name })
      cleanupFns.push(async () => {
        try {
          if (existingContent) {
            await writeFile(codexHooksPath, existingContent, 'utf-8')
          } else {
            await unlink(codexHooksPath)
          }
        } catch { /* cleanup best-effort */ }
      })
    }

    // --session-id, --allowedTools, --mcp-config, --settings, --resume

    const env: Record<string, string> = {}
    env.EXPERT_API_BASE = `http://localhost:${context.serverPort}`
    if (context.chatId) env.OPENTEAM_CHAT_ID = context.chatId
    if (context.instanceId) env.OPENTEAM_INSTANCE_ID = context.instanceId
    if (context.connectionId) env.EXPERT_CONNECTION_ID = context.connectionId

    return {
      command: 'codex',
      args,
      env,
      cwd,
      cleanup: async () => {
        for (const fn of cleanupFns) {
          await silentlyIgnore(fn, 'config compile cleanup')
        }
      },
    }
  }

  private buildCodexHooksJson(agent: Agent): { hooks: { Stop: unknown[] } } | null {
    const systemHooks = this.collectSkillHooks(agent)
    if (!systemHooks?.Stop?.length) return null

    const stopEntries = systemHooks.Stop.map((entry) => ({
      hooks: entry.hooks.map((h) => ({
        type: h.type,
        command: h.command,
        ...(h.timeout ? { timeout: h.timeout } : {}),
      })),
    }))

    return { hooks: { Stop: stopEntries } }
  }

  /** base prompt + skills + personality + memory +  */
  private buildPromptContent(agent: Agent, context?: CompileContext): string {
    let content = agent.systemPrompt?.content || ''

    const allSkillDirs = this.skillManager.listSkills()
      .map((s) => this.skillManager.getSkillDir(s.name))
      .filter((d): d is string => !!d)
    const scriptToDir = new Map<string, string>()
    for (const dir of allSkillDirs) {
      const scriptsDir = join(dir, 'scripts')
      try {
        for (const entry of readdirSync(scriptsDir)) {
          if (statSync(join(scriptsDir, entry)).isFile()) {
            if (scriptToDir.has(entry)) {
              log.warn('Duplicate skill script name', { script: entry, kept: scriptToDir.get(entry), skipped: dir })
              continue
            }
            scriptToDir.set(entry, dir)
          }
        }
      } catch { /* scripts dir may not exist */ }
    }

    content = this.substituteSkillDirInAgentPrompt(content, scriptToDir)

    const skillNames = Array.from(new Set([...(agent.skills ?? []), 'whiteboard']))
    const skillContents = skillNames
      .map((name) => {
        const skill = this.skillManager.getSkill(name)
        const dir = this.skillManager.getSkillDir(name)
        if (!skill || !dir) return null
        return skill.content.replaceAll('{SKILL_DIR}', dir)
      })
      .filter((s): s is string => !!s)
    if (skillContents.length > 0) {
      content += '\n\n' + skillContents.join('\n\n')
    }

    if (agent.personality) {
      content += this.buildPersonalityPrompt(agent.personality)
    }

    if (this.memoryStore) {
      const memoryPrompt = this.buildMemoryPrompt(agent.name)
      if (memoryPrompt) content += memoryPrompt
    }

    if (agent.workspaceDir) {
      const today = this.formatToday()
      content += `\n\n## Workspace Path\n\nYour workspace absolute path：\`${agent.workspaceDir}\`\nWhen writing memory files, use absolute paths：\n- Today's log → \`${agent.workspaceDir}/memory/${today}.md\`\n- Long-term memory → \`${agent.workspaceDir}/MEMORY.md\``
    }

    if (context?.chatId && context?.instanceId) {
      const isDispatcher = !!(agent.subAgentNames && agent.subAgentNames.length > 0)
      content += this.buildMailboxProtocolPrompt(context.chatId, context.instanceId, isDispatcher)
    }

    if (context?.previousContext) {
      const { agentName, lastMessage, jsonlPath } = context.previousContext
      let block = `\n\n## Previous Agent Context\n\nThe previous colleague ${agentName} just worked in this session.\n`
      if (lastMessage) {
        block += `\nTheir last message：\n---\n${lastMessage}\n---\n`
      }
      if (jsonlPath) {
        block += `\nIf you need more context, you can read the full conversation record file：\`${jsonlPath}\`\n`
      }
      content += block
    }

    if (
      this.whiteboardManager
      && context?.chatId
      && isWhiteboardOnDemandEnabled()
    ) {
      try {
        const briefing = new ContextBriefing(this.whiteboardManager)
        const brief = briefing.buildForAgent({
          chatId: context.chatId,
          agentId: agent.id,
          agentName: agent.name,
          agentTags: agent.tags,
        })
        if (brief.trim()) {
          content += `\n\n---\n\n${brief}`
        }
        if (context.instanceId) {
          this.whiteboardManager.setCursor(
            context.chatId,
            context.instanceId,
            this.whiteboardManager.getLatestSeq(context.chatId),
          )
        }
      } catch (err) {
        log.warn('whiteboard briefing injection failed', {
          chatId: context.chatId,
          agentId: agent.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return content
  }

  /**
   *  agent prompt  `{SKILL_DIR}/scripts/<scriptName>`  skill
   *  scriptName
   */
  private async writeEnvFile(context: CompileContext, env: Record<string, string>): Promise<void> {
    if (!context.chatId || !context.instanceId) return
    const envDir = join(homedir(), '.openteam', 'tmp', 'env')
    await mkdir(envDir, { recursive: true })
    const envPath = join(envDir, `${context.chatId}-${context.instanceId}.env`)
    const keys = ['EXPERT_API_BASE', 'OPENTEAM_CHAT_ID', 'OPENTEAM_INSTANCE_ID', 'EXPERT_CONNECTION_ID']
    const lines = keys
      .filter(k => env[k] !== undefined)
      .map(k => `export ${k}="${env[k]}"`)
    await writeFile(envPath, lines.join('\n') + '\n', 'utf-8')
  }

  private substituteSkillDirInAgentPrompt(
    content: string,
    scriptToDir: Map<string, string>,
  ): string {
    return content.replace(/\{SKILL_DIR\}\/scripts\/([\w.\-]+)/g, (match, scriptName) => {
      const dir = scriptToDir.get(scriptName)
      if (!dir) {
        log.warn('Unresolved {SKILL_DIR} placeholder in agent prompt', { scriptName })
        return match
      }
      return `${dir}/scripts/${scriptName}`
    })
  }

  private formatToday(): string {
    const d = new Date()
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  }

  private resolveCwd(context: CompileContext): string {
    const primary = context.repositories[0]
    if (!primary) return process.cwd()
    return primary.worktreePath || primary.path
  }

  /**
   *  agent  skills  hooksSKILL.md frontmatter hooks
   * whiteboard  agent prompt
   */
  private collectSkillHooks(agent: Agent): HooksConfig | undefined {
    const skillNames = Array.from(new Set([...(agent.skills ?? []), 'whiteboard']))
    const merged: HooksConfig = {}
    const events = ['PreToolUse', 'PostToolUse', 'Notification', 'Stop'] as const

    for (const name of skillNames) {
      const skill = this.skillManager.getSkill(name)
      if (!skill?.hooks) continue
      for (const event of events) {
        const cmds = skill.hooks[event]
        if (!cmds?.length) continue
        const entries: HookEntry[] = cmds.map((c) => ({
          ...(c.matcher ? { matcher: c.matcher } : {}),
          hooks: [{ type: 'command' as const, command: c.command, ...(c.timeout ? { timeout: c.timeout } : {}) }],
        }))
        merged[event] = [...(merged[event] ?? []), ...entries]
      }
    }

    return Object.keys(merged).length ? merged : undefined
  }

  private buildMemoryPrompt(agentName: string): string | null {
    if (!this.memoryStore) return null
    const memories = this.memoryStore.getForPromptInjection(agentName, 20)
    if (memories.length === 0) return null

    const grouped = memories.reduce<Record<string, AgentMemory[]>>((acc, m) => {
      if (!acc[m.category]) acc[m.category] = []
      acc[m.category].push(m)
      return acc
    }, {})

    let prompt = '\n\n## Cross-Session Memory\n\nBelow are memories accumulated from your past interactions. Use them as reference：\n'
    for (const [category, items] of Object.entries(grouped)) {
      prompt += `\n### ${category}\n`
      for (const m of items) {
        prompt += `- ${m.content}\n`
      }
    }
    return prompt
  }

  private buildMailboxProtocolPrompt(chatId: string, instanceId: string, isDispatcher = false): string {
    return `

## Task Communication Protocol

### Execution Plan（plan.md）
After accepting a task, create an execution plan at \`~/.openteam/tasks/{taskId}/plan.md\` ：
- After each sub-step, update plan.md to check it off
- After context compression, re-read plan.md to restore progress
- When blocked, record the reason in plan.md's 'Blockers' section
- When task is done, generate final result from plan.md`
  }

  private buildPersonalityPrompt(p: AgentPersonality): string {
    const toneGuide = {
      formal: 'Use a formal, professional tone, list key points clearly',
      casual: 'Communicate in a relaxed natural tone, like chatting with a colleague',
      playful: 'Communicate with a lively and fun tone, add light-hearted expressions',
    }
    const verbosityGuide = {
      concise: 'Report results in the shortest sentences, omit process details',
      moderate: 'Describe key steps and results adequately without over-expanding',
      detailed: 'Explain thought process and decision rationale for each step in detail',
    }

    return `

## Communication Style

Your short name is"${p.nickname}"（${p.emoji}），${p.persona}。
Follow this communication style：
- ${toneGuide[p.tone]}
- ${verbosityGuide[p.verbosity]}
- Briefly describe what was done and key outputs when completing tasks
- When collaborating with other agents, use their short names
- When encountering decisions that need user input, give your recommendation then ask`
  }
}
