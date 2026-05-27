/**
 * ExpertResumeHandler - Expert Agent
 *
 *  ExpertHandler
 * -  Chat resumeFromChat
 * - Re-attach  Agent session
 * - Dead Agent
 */

import type { WebSocket } from 'ws'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ChatStore } from '../stores/ChatStore'
import type { AgentStore } from '../stores/AgentStore'
import type { SessionRegistry } from '../terminal/SessionRegistry'
import { parseConversationFile, createParserState, type ParsedMessage } from '../terminal/ConversationParser'
import { codexOutputParser } from '../terminal/CodexParser'
import { ExpertSessionStore, compositeKey, parseAgentId, parseChatId } from './ExpertSessionStore'
import { StreamJsonManager } from '../terminal/StreamJsonManager'
import { acpUpdateToWSMessage } from '../acp/ACPToFrontendBridge'
import type { CliProvider, ExpertSessionInfo } from '../config/types'
import { createLogger } from '../lib/logger'
import { trackEvent } from '../lib/eventTracker'
import { cwdToClaudeProjectKey } from '../../shared/projectKey'
import { scanPluginSlashCommands, scanProjectSlashCommands } from '../runtime/PluginCommandsScanner'

const log = createLogger('ExpertResume')

export interface ExpertResumeDeps {
  chatStore: ChatStore
  agentStore: AgentStore
  sessionRegistry: SessionRegistry
  store: ExpertSessionStore
  sendTo: (connectionId: string, msg: Record<string, unknown>) => void
  handleStart: (
    ws: WebSocket,
    payload: { agentId: string; task?: string; cwd?: string; resumeSessionId?: string; chatId?: string; cols?: number; rows?: number },
    connectionId: string,
  ) => Promise<void>
}

export const createExpertResumeHandler = (deps: ExpertResumeDeps) => {
  const { chatStore, agentStore, sessionRegistry, store, sendTo, handleStart } = deps

  /** Agent spawn key=chatId::agentId → { count, lastFailedAt } */
  const spawnFailures = new Map<string, { count: number; lastFailedAt: number }>()
  const SPAWN_FAILURE_MAX = 2
  const SPAWN_FAILURE_COOLDOWN_MS = 60_000

  /**
   *  provider  JSONL
   * Claude: ~/.claude/projects/<cwd-key>/<cliSessionId>.jsonl（ConversationParser）
   * Codex : ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<threadId>.jsonl（CodexParser）
   */
  const readMessagesFromJsonl = (
    cwd: string,
    cliSessionId: string,
    provider: CliProvider = 'claude',
  ): ParsedMessage[] | null => {
    if (provider === 'codex') {
      return readCodexRollout(cliSessionId)
    }
    const projectKey = cwdToClaudeProjectKey(cwd)
    const jsonlPath = join(homedir(), '.claude', 'projects', projectKey, `${cliSessionId}.jsonl`)
    if (!existsSync(jsonlPath)) return null
    const msgs = parseConversationFile(jsonlPath)
    return msgs.length > 0 ? msgs : null
  }

  /**
   *  Codex rollout JSONL
   * rollout-<ISO-timestamp>-<threadId>.jsonlthreadId  cliSessionId
   * exec  7  +
   */
  const readCodexRollout = (threadId: string): ParsedMessage[] | null => {
    if (!threadId) return null
    const sessionsRoot = join(homedir(), '.codex', 'sessions')
    if (!existsSync(sessionsRoot)) return null

    const now = Date.now()
    for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
      const d = new Date(now - dayOffset * 86_400_000)
      const yyyy = String(d.getUTCFullYear())
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
      const dd = String(d.getUTCDate()).padStart(2, '0')
      const dayDir = join(sessionsRoot, yyyy, mm, dd)
      const found = findRolloutInDir(dayDir, threadId)
      if (found) return parseCodexFile(found)
    }

    try {
      for (const year of readdirSync(sessionsRoot)) {
        const yearDir = join(sessionsRoot, year)
        for (const month of readdirSync(yearDir)) {
          const monthDir = join(yearDir, month)
          for (const day of readdirSync(monthDir)) {
            const dayDir = join(monthDir, day)
            const found = findRolloutInDir(dayDir, threadId)
            if (found) return parseCodexFile(found)
          }
        }
      }
    } catch {
    }
    return null
  }

  const findRolloutInDir = (dir: string, threadId: string): string | null => {
    if (!existsSync(dir)) return null
    try {
      const files = readdirSync(dir)
      const match = files.find((f) => f.startsWith('rollout-') && f.endsWith(`-${threadId}.jsonl`))
      return match ? join(dir, match) : null
    } catch {
      return null
    }
  }

  const parseCodexFile = (path: string): ParsedMessage[] | null => {
    try {
      const raw = readFileSync(path, 'utf8')
      const lines = raw.split('\n')
      const state = createParserState()
      const { newMessages } = codexOutputParser.parseNewLines(lines, 0, state)
      const all = state.messages.length > 0 ? state.messages : newMessages
      return all.length > 0 ? all : null
    } catch (err) {
      log.warn('Failed to parse Codex rollout', { path, err: err instanceof Error ? err.message : String(err) })
      return null
    }
  }

  const buildMessageMergeKey = (msg: ParsedMessage): string => {
    if (msg.jsonlUuid) {
      return `uuid:${msg.jsonlUuid}:${msg.type}:${msg.role}`
    }
    if (msg.type === 'toolUse' && msg.toolUse) {
      return `toolUse:${msg.toolUse.toolId}:${msg.turnIndex ?? -1}`
    }
    if (msg.type === 'toolResult' && msg.toolResult) {
      return `toolResult:${msg.toolResult.toolUseId}:${msg.turnIndex ?? -1}`
    }
    if (msg.type === 'stats') {
      return `stats:${msg.turnIndex ?? -1}`
    }
    return `fallback:${msg.role}:${msg.type}:${msg.timestamp}:${msg.content}`
  }

  const mergeReplayMessages = (
    historyMessages: ParsedMessage[] | null,
    memoryMessages: ParsedMessage[] | null,
    ctx: { agentId: string; source: 'resend' | 'reattach'; provider: CliProvider },
  ): ParsedMessage[] | null => {
    const history = historyMessages ?? []
    const memory = memoryMessages ?? []
    if (history.length === 0 && memory.length === 0) return null

    const merged: ParsedMessage[] = []
    const seen = new Set<string>()
    const appendUnique = (items: ParsedMessage[]) => {
      for (const item of items) {
        const key = buildMessageMergeKey(item)
        if (seen.has(key)) continue
        seen.add(key)
        merged.push(item)
      }
    }

    appendUnique(history)
    appendUnique(memory)
    merged.sort((a, b) => a.timestamp - b.timestamp)

    log.debug('Merged replay messages', {
      agentId: ctx.agentId,
      source: ctx.source,
      provider: ctx.provider,
      historyCount: history.length,
      memoryCount: memory.length,
      mergedCount: merged.length,
    })

    return merged.length > 0 ? merged : null
  }

  /**
   *  acpClient.replayMessages ACP pipeline
   *  acpUpdateToWSMessage  + sendTo
   */
  const replayMessagesTo = (
    connectionId: string,
    bridgeCtx: { agentId: string; sessionId: string; chatId: string },
    messages: ParsedMessage[],
    acpClient: import('../acp/ACPClient').ACPClient | undefined,
    source: 'resend' | 'reattach' | 'dead-replay',
  ): void => {
    if (messages.length === 0) return
    if (acpClient) {
      acpClient.replayMessages(messages, 'full')
      log.debug('replayMessagesTo via ACP', { source, count: messages.length, ...bridgeCtx })
      return
    }
    const wsMsg = acpUpdateToWSMessage({
      sessionUpdate: '_openteam/messages_batch',
      messages: messages as unknown as import('../../shared/acp-types').OpenTeamParsedMessage[],
      replacedStatsId: null,
      batchType: 'full',
    }, bridgeCtx)
    if (wsMsg) {
      sendTo(connectionId, wsMsg as unknown as Record<string, unknown>)
      log.debug('replayMessagesTo via Bridge', { source, count: messages.length, ...bridgeCtx })
    }
  }

  /**
   * Agent  JSONL
   *  completed  tab +
   */
  const replayHistoryForDeadSession = (
    connectionId: string,
    agentId: string,
    chatId: string,
    cliSessionId: string,
    cwd: string,
    provider: CliProvider = 'claude',
    exitCode?: number,
  ): boolean => {
    const messages = readMessagesFromJsonl(cwd, cliSessionId, provider)
    if (!messages || messages.length === 0) {
      log.warn('No JSONL history for dead session', { agentId, cliSessionId, provider, cwd })
      return false
    }

    const agent = agentStore.get(agentId)
    const agentName = agent?.name || agentId
    const agentIcon = agent?.icon || ''

    sendTo(connectionId, {
      type: 'expert:started',
      payload: { agentId, chatId, sessionId: cliSessionId, agentName, agentIcon, status: 'completed' },
    })

    replayMessagesTo(
      connectionId,
      { agentId, sessionId: cliSessionId, chatId },
      messages,
      undefined,
      'dead-replay',
    )

    sendTo(connectionId, {
      type: 'expert:exit',
      payload: { agentId, chatId, exitCode: exitCode ?? 0 },
    })

    log.info('Replayed history for dead session', { agentId, chatId, messageCount: messages.length })
    return true
  }

  const resumeFromChat = async (
    ws: WebSocket,
    chatId: string,
    connectionId: string,
  ): Promise<void> => {
    log.debug('resumeFromChat called', { chatId, connectionId })
    const chat = chatStore.get(chatId)
    log.debug('resumeFromChat chat data', { chatId, hasChat: !!chat, hasExpertSessions: !!chat?.expertSessions, expertSessionsCount: chat?.expertSessions ? Object.keys(chat.expertSessions).length : 0 })

    const sessions: Array<[string, ExpertSessionInfo]> =
      chat?.expertSessions ? Object.entries(chat.expertSessions) : []

    const knownAgentIds = new Set(sessions.map(([aid]) => aid))
    const aliveSessions = sessionRegistry.findAllByChat(chatId)
    for (const alive of aliveSessions) {
      if (!alive.agentId || knownAgentIds.has(alive.agentId)) continue
      if (!alive.streamManager.isAlive()) continue
      sessions.push([alive.agentId, { cliSessionId: alive.cliSessionId || '', cwd: alive.cwd }])
      log.info('Discovered orphan alive session from registry', { agentId: alive.agentId, chatId, sessionId: alive.sessionId })
    }

    if (sessions.length === 0) {
      log.debug('resumeFromChat: no sessions to resume', { chatId })
      return
    }

    // Resume paths (re-attach / scrollback / dead-replay) never spawn the CLI,
    // so the `cli-init` event in ExpertEventWiring doesn't fire — meaning our
    // command merge there is bypassed. Scan plugins + project commands here and
    // push to every agent we resume.
    const commandsPromise = (async (resumeCwd: string) => {
      const [pluginCmds, projectCmds] = await Promise.all([
        scanPluginSlashCommands(),
        scanProjectSlashCommands(resumeCwd),
      ])
      return [...pluginCmds, ...projectCmds]
    })(chat?.worktreeSessions?.[0]?.worktreePath || process.cwd()).catch((err) => {
      log.warn('Commands scan failed during resume', {
        chatId,
        error: err instanceof Error ? err.message : String(err),
      })
      return [] as string[]
    })
    const pushPluginCommands = (agentId: string) => {
      commandsPromise.then((commands) => {
        if (commands.length === 0) return
        sendTo(connectionId, {
          type: 'expert:slash-commands',
          payload: { agentId, chatId, commands },
        })
      })
    }

    const toResume: typeof sessions = []
    const toResendScrollback: string[] = []
    for (const [agentId, sessionInfo] of sessions) {
      if (store.has(compositeKey(connectionId, chatId, agentId))) {
        toResendScrollback.push(agentId)
      } else {
        toResume.push([agentId, sessionInfo])
      }
    }

    for (const agentId of toResendScrollback) {
      const existingSession = sessionRegistry.findByChat(chatId, agentId)
      if (!existingSession || !existingSession.streamManager.isAlive()) continue

      sendTo(connectionId, {
        type: 'expert:started',
        payload: {
          agentId,
          chatId,
          sessionId: existingSession.sessionId,
          agentName: existingSession.agentName,
          agentIcon: existingSession.agentIcon || '',
          status: 'running',
          cwd: existingSession.cwd,
        },
      })

      pushPluginCommands(agentId)

      existingSession.streamManager.forceRedraw()

      const sessionProvider = existingSession.streamManager.getProvider()
      const memoryMessages = existingSession.streamManager.getCurrentMessages()
      const historyMessages = existingSession.cliSessionId && existingSession.cwd
        ? readMessagesFromJsonl(existingSession.cwd, existingSession.cliSessionId, sessionProvider)
        : null
      const messages = mergeReplayMessages(historyMessages, memoryMessages, {
        agentId,
        source: 'resend',
        provider: sessionProvider,
      })
      if (messages && messages.length > 0) {
        replayMessagesTo(
          connectionId,
          { agentId, sessionId: existingSession.sessionId, chatId },
          messages,
          existingSession.acpClient,
          'resend',
        )
      } else if (!existingSession.streamManager.isWatcherReady()) {
        log.warn('Same-connection resend: JSONL file not found, message history unavailable', { agentId, chatId })
      }

      const lastActivity = store.getActivity(compositeKey(connectionId, chatId, agentId))
      sendTo(connectionId, {
        type: 'expert:activity',
        payload: {
          agentId, chatId, sessionId: existingSession.sessionId,
          activity: lastActivity ?? { phase: 'waiting_input', background: false, toolCount: 0, toolCompleted: 0, hasText: false, updatedAt: Date.now() },
        },
      })

      log.debug('Same-connection resend', { agentId, messages: messages?.length ?? 0 })
    }

    if (toResume.length === 0) return

    const fallbackCwd = chat?.worktreeSessions?.[0]?.worktreePath || process.cwd()

    log.info('Resuming experts from chat', { count: toResume.length, chatId, connectionId })
    trackEvent('chat', 'chat.resumed', { chatId, connectionId, agentCount: toResume.length })

    const deadPtyResumes: Array<{ agentId: string; cliSessionId: string; cwd: string; provider: CliProvider }> = []

    for (const [agentId, sessionInfo] of toResume) {
      const existingSession = sessionRegistry.findByChat(chatId, agentId)
      if (existingSession && existingSession.streamManager.isAlive()) {
        sessionRegistry.attach(existingSession.sessionId, ws, connectionId)

        const newKey = compositeKey(connectionId, chatId, agentId)
        const oldKey = [...store.runningEntries()].map(([k]) => k).find(
          (k) => parseAgentId(k) === agentId && parseChatId(k) === chatId && k !== newKey,
        )
        if (oldKey) {
          store.migrateKey(oldKey, newKey, connectionId)
        } else if (!store.has(newKey)) {
          if (!existingSession.acpClient) {
            log.warn('Re-attach skipped: no acpClient on session', { agentId, sessionId: existingSession.sessionId })
            continue
          }
          store.set(newKey, {
            sessionId: existingSession.sessionId,
            acpClient: existingSession.acpClient,
            agentName: existingSession.agentName,
            agentIcon: existingSession.agentIcon || '',
            cwd: existingSession.cwd,
            cliSessionId: existingSession.cliSessionId,
            provider: (typeof sessionInfo === 'object' && sessionInfo.provider) || undefined,
            connectionId,
            chatId,
          })
        }

        log.debug('Re-attach sendTo check', { connectionId, oldKey: oldKey ?? 'none', newKey })
        sendTo(connectionId, {
          type: 'expert:started',
          payload: {
            agentId,
            chatId,
            sessionId: existingSession.sessionId,
            agentName: existingSession.agentName,
            agentIcon: existingSession.agentIcon || '',
            status: 'running',
            cwd: existingSession.cwd,
          },
        })

        pushPluginCommands(agentId)

        const lastActivity = store.getActivity(compositeKey(connectionId, chatId, agentId))
        sendTo(connectionId, {
          type: 'expert:activity',
          payload: {
            agentId, chatId, sessionId: existingSession.sessionId,
            activity: lastActivity ?? { phase: 'waiting_input', background: false, toolCount: 0, toolCompleted: 0, hasText: false, updatedAt: Date.now() },
          },
        })

        existingSession.streamManager.forceRedraw()

        const sessionProvider = existingSession.streamManager.getProvider()
        const memoryMessages = existingSession.streamManager.getCurrentMessages()
        const historyMessages = existingSession.cliSessionId && existingSession.cwd
          ? readMessagesFromJsonl(existingSession.cwd, existingSession.cliSessionId, sessionProvider)
          : null
        const reAttachMessages = mergeReplayMessages(historyMessages, memoryMessages, {
          agentId,
          source: 'reattach',
          provider: sessionProvider,
        })
        if (reAttachMessages && reAttachMessages.length > 0) {
          replayMessagesTo(
            connectionId,
            { agentId, sessionId: existingSession.sessionId, chatId },
            reAttachMessages,
            existingSession.acpClient,
            'reattach',
          )
        } else if (!existingSession.streamManager.isWatcherReady()) {
          log.warn('Re-attach: JSONL file not found, message history unavailable', { agentId, chatId, sessionId: existingSession.sessionId })
        }

        log.info('Re-attached agent', { agentId, connectionId, sessionId: existingSession.sessionId, messages: reAttachMessages?.length ?? 0, watcherReady: existingSession.streamManager.isWatcherReady() })
        continue
      }

      const cliSessionId = typeof sessionInfo === 'string'
        ? sessionInfo
        : sessionInfo.cliSessionId
      const cwd = (typeof sessionInfo === 'object' && sessionInfo.cwd) || fallbackCwd
      const provider = ((typeof sessionInfo === 'object' && sessionInfo.provider) || 'claude') as CliProvider
      const storedExitCode = typeof sessionInfo === 'object' ? sessionInfo.exitCode : undefined

      if (!existsSync(cwd)) {
        log.warn('Resume skipped: original CWD no longer exists', { agentId, cwd })
        sendTo(connectionId, {
          type: 'expert:resume-failed',
          payload: {
            agentId,
            chatId,
            agentName: agentId,
            reason: 'cwd_not_found',
            message: `Original working directory no longer exists: ${cwd}`,
          },
        })
        continue
      }

      if (replayHistoryForDeadSession(connectionId, agentId, chatId, cliSessionId, cwd, provider, storedExitCode)) {
        log.info('Replayed from JSONL, skipping --resume spawn', { agentId, chatId, provider })
        pushPluginCommands(agentId)
        continue
      }

      if (provider === 'codex') {
        log.info('Codex resume skipped: rollout not found', { agentId, cliSessionId })
        sendTo(connectionId, {
          type: 'expert:resume-failed',
          payload: {
            agentId,
            chatId,
            agentName: agentId,
            reason: 'codex_rollout_missing',
            message: 'Codex session record is no longer available, cannot restore history messages',
          },
        })
        continue
      }

      const failKey = `${chatId}::${agentId}`
      const failRecord = spawnFailures.get(failKey)
      if (failRecord && failRecord.count >= SPAWN_FAILURE_MAX) {
        if (Date.now() - failRecord.lastFailedAt < SPAWN_FAILURE_COOLDOWN_MS) {
          log.info('Skip resume: spawn failure cooldown', { agentId, failCount: failRecord.count })
          sendTo(connectionId, {
            type: 'expert:resume-failed',
            payload: {
              agentId,
              chatId,
              agentName: agentId,
              reason: 'spawn_cooldown',
              message: `Agent start failed ${failRecord.count} consecutive times, retry available in ${Math.ceil((SPAWN_FAILURE_COOLDOWN_MS - (Date.now() - failRecord.lastFailedAt)) / 1000)}s`,
            },
          })
          continue
        }
        spawnFailures.delete(failKey)
      }

      deadPtyResumes.push({ agentId, cliSessionId, cwd, provider })
    }

    if (deadPtyResumes.length > 0) {
      log.info('Resuming dead sessions in parallel', { count: deadPtyResumes.length })
      const results = await Promise.allSettled(
        deadPtyResumes.map(async ({ agentId, cliSessionId, cwd }) => {
          log.info('Resuming dead session', { agentId, cliSessionId })
          await handleStart(ws, { agentId, cwd, chatId, resumeSessionId: cliSessionId }, connectionId)
          spawnFailures.delete(`${chatId}::${agentId}`)
        }),
      )
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === 'rejected') {
          const { agentId, cliSessionId, cwd, provider: failedProvider } = deadPtyResumes[i]
          const error = String((results[i] as PromiseRejectedResult).reason)
          const isCommandNotFound = error.includes('Command not found')
          log.error('Failed to resume agent from chat', { agentId, error, isCommandNotFound })
          trackEvent('chat', 'chat.resume_failed', { agentId, chatId, error, isCommandNotFound })

          const failKey = `${chatId}::${agentId}`
          const prev = spawnFailures.get(failKey)
          spawnFailures.set(failKey, { count: (prev?.count ?? 0) + 1, lastFailedAt: Date.now() })

          if (isCommandNotFound) {
            sendTo(connectionId, {
              type: 'expert:resume-failed',
              payload: {
                agentId,
                chatId,
                agentName: agentId,
                reason: 'command_not_found',
                message: 'CLI tool not installed, please install Claude Code or Codex CLI first',
              },
            })
            continue
          }

          const replayed = replayHistoryForDeadSession(connectionId, agentId, chatId, cliSessionId, cwd, failedProvider)
          if (!replayed) {
            sendTo(connectionId, {
              type: 'expert:resume-failed',
              payload: {
                agentId,
                chatId,
                agentName: agentId,
                reason: 'start_failed',
                message: error,
              },
            })
          }
        }
      }
    }
  }

  return { resumeFromChat }
}
