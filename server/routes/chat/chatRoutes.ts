import { Router } from 'express'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { homedir } from 'os'
import type { ChatStore } from '../../stores/ChatStore'
import type { ChatService } from '../../services/chat/ChatService'
import type { TokenUsageStore } from '../../stores/TokenUsageStore'
import type { Chat } from '../../config/types'
import type { SessionRegistry } from '../../terminal/SessionRegistry'
import { MemberAggregator } from '../../stores/MemberAggregator'
import { WorktreeManager } from '../../git/WorktreeManager'
import { createLogger } from '../../lib/logger'
import { cwdToClaudeProjectKey } from '../../../shared/projectKey'
import { purgeExpertSessionJsonl, type PurgeResult } from '../../services/sessionFilePurger'

const log = createLogger('ChatRoutes')

interface ChatRouteDeps {
  chatStore: ChatStore
  chatService: ChatService
  tokenUsageStore?: TokenUsageStore
  sessionRegistry?: SessionRegistry
  broadcast?: (msg: Record<string, unknown>) => void
}

const CHAT_UPDATABLE_FIELDS: Array<keyof Chat> = [
  'title',
  'status',
  'expertSessions',
  'model',
  'totalCost',
  'totalTokens',
  'totalToolCalls',
  'lastMessageAt',
  'taskStatus',
  'lastAgentId',
  'teamAgentIds',
  'archivedAt',
  'pinnedAt',
]

const pickUpdatableFields = (body: Record<string, unknown>): Partial<Chat> => {
  const updates: Record<string, unknown> = {}
  for (const key of CHAT_UPDATABLE_FIELDS) {
    if (key in body) {
      updates[key] = body[key]
    }
  }
  return updates as Partial<Chat>
}

export const createChatRoutes = ({ chatStore, chatService, tokenUsageStore, sessionRegistry, broadcast }: ChatRouteDeps): Router => {
  const router = Router()
  const memberAggregator = new MemberAggregator(sessionRegistry)

  const enrichWithMembers = <T extends Chat>(chats: T[]): T[] => {
    return chats.map((chat) => ({ ...chat, members: memberAggregator.enrich(chat) }))
  }

  const enrichWithTokenUsage = <T extends Chat>(chats: T[]): (T & { usedModels?: string[] })[] => {
    if (!tokenUsageStore || chats.length === 0) return chats
    const chatIds = chats.map((c) => c.id)
    const usageMap = tokenUsageStore.summaryByChats(chatIds)
    return chats.map((chat) => {
      const usage = usageMap.get(chat.id)
      if (!usage) return chat
      return {
        ...chat,
        totalCost: usage.totalCost ?? chat.totalCost,
        totalTokens: (usage.totalInput > 0 || usage.totalOutput > 0 || usage.totalCacheRead > 0 || usage.totalCacheCreation > 0)
          ? { input: usage.totalInput, output: usage.totalOutput, cacheRead: usage.totalCacheRead, cacheCreation: usage.totalCacheCreation }
          : chat.totalTokens,
        usedModels: usage.models.length > 0 ? usage.models : undefined,
      }
    })
  }

  router.get('/api/chats/recent', (req, res) => {
    const limit = Number(req.query.limit) || 10
    const chats = chatStore.listRecent(limit)
    const enriched = enrichWithMembers(enrichWithTokenUsage(chats))

    if (sessionRegistry) {
      const activities = sessionRegistry.getActiveActivities()
      const withActivity = enriched.map((chat) => {
        const activity = activities[chat.id]
        return activity ? { ...chat, activity } : chat
      })
      return res.json(withActivity)
    }

    res.json(enriched)
  })

  router.get('/api/workspaces/:id/chats', (req, res) => {
    const chats = chatStore.listByWorkspace(req.params.id)
    res.json(enrichWithMembers(enrichWithTokenUsage(chats)))
  })

  /** worktreePath → chat  PendingChangesPanel  */
  router.get('/api/workspaces/:id/worktree-chat-map', (req, res) => {
    const chats = chatStore.listByWorkspace(req.params.id)
    const map: Record<string, { chatId: string; chatTitle: string }> = {}
    for (const chat of chats) {
      if (!chat.worktreeSessions) continue
      for (const wt of chat.worktreeSessions) {
        map[wt.worktreePath] = { chatId: chat.id, chatTitle: chat.title }
      }
    }
    res.json(map)
  })

  /**  ChatService  Chat Worktree  */
  router.post('/api/workspaces/:id/chats', async (req, res) => {
    try {
      const chat = await chatService.createChat({
        workspaceId: req.params.id,
        title: req.body.title,
        model: req.body.model,
      })
      res.status(201).json(chat)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create chat' })
    }
  })

  router.get('/api/chats/:id', (req, res) => {
    const chat = chatStore.get(req.params.id)
    if (!chat) return res.status(404).json({ error: 'Chat not found' })
    const [enriched] = enrichWithMembers(enrichWithTokenUsage([chat]))
    res.json(enriched)
  })

  router.put('/api/chats/:id', async (req, res) => {
    try {
      const updates = pickUpdatableFields(req.body)
      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No updatable fields provided' })
      }
      const chat = await chatStore.update(req.params.id, updates)
      if (!chat) return res.status(404).json({ error: 'Chat not found' })
      if (broadcast && typeof updates.title === 'string') {
        broadcast({ type: 'chat:title-updated', payload: { chatId: chat.id, title: updates.title } })
      }
      if (broadcast && ('archivedAt' in updates || 'pinnedAt' in updates)) {
        broadcast({
          type: 'chat:meta-updated',
          payload: {
            chatId: chat.id,
            archivedAt: chat.archivedAt ?? null,
            pinnedAt: chat.pinnedAt ?? null,
          },
        })
      }
      res.json(chat)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update chat' })
    }
  })

  router.get('/api/chats/:id/sessions', (req, res) => {
    const chat = chatStore.get(req.params.id)
    if (!chat) return res.status(404).json({ error: 'Chat not found' })

    const sessions = chat.expertSessions ?? {}
    const result = Object.entries(sessions).map(([agentId, session]) => {
      const provider = session.provider || 'claude'
      let jsonlPath: string | null = null

      if (provider === 'claude') {
        const projectKey = cwdToClaudeProjectKey(session.cwd)
        const absPath = join(homedir(), '.claude', 'projects', projectKey, `${session.cliSessionId}.jsonl`)
        if (existsSync(absPath)) jsonlPath = absPath
      }

      return {
        agentId,
        cliSessionId: session.cliSessionId,
        provider,
        cwd: session.cwd,
        exitCode: session.exitCode,
        jsonlPath,
      }
    })

    res.json({
      chatId: chat.id,
      sessions: result,
    })
  })

  router.delete('/api/chats/:id', async (req, res) => {
    const chat = chatStore.get(req.params.id)
    if (!chat) return res.status(404).json({ error: 'Chat not found' })

    const purgeJsonl = req.query.purgeJsonl === '1' || req.query.purgeJsonl === 'true'

    // Guard against deleting JSONL files a CLI is actively writing to. The
    // persisted `chat.status` is unreliable here — ChatStore.create seeds it as
    // 'running' on creation regardless of whether any session has actually
    // started, so checking it alone would block delete on a brand-new mission
    // that never had a turn. Use the live member rollup instead (same source
    // the per-agent DELETE route already uses), which derives status from
    // SessionRegistry activity.
    if (purgeJsonl) {
      const liveMembers = memberAggregator.enrich(chat)
      if (liveMembers.some((m) => m.status === 'running')) {
        return res.status(409).json({ error: 'Cannot purge a running chat. Stop it first.' })
      }
    }

    if (chat.worktreeSessions && chat.worktreeSessions.length > 0) {
      for (const wt of chat.worktreeSessions) {
        try {
          const abs = resolve(wt.worktreePath)
          const idx = abs.lastIndexOf('/.worktrees/')
          if (idx === -1) continue
          const repoRoot = abs.slice(0, idx)
          const normalizedRepo = resolve(repoRoot)
          if (normalizedRepo !== repoRoot || repoRoot.includes('..')) continue
          const manager = new WorktreeManager(repoRoot)
          await manager.remove(wt.worktreePath, { force: true })
        } catch (err) {
          log.warn('Failed to clean worktree', { worktreePath: wt.worktreePath, error: err instanceof Error ? err.message : String(err) })
        }
      }
    }

    const purged: PurgeResult[] = []
    if (purgeJsonl && chat.expertSessions) {
      for (const [agentId, session] of Object.entries(chat.expertSessions)) {
        purged.push(purgeExpertSessionJsonl(session, { chatId: chat.id, agentId }))
      }
    }

    const deleted = await chatStore.remove(req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Chat not found' })
    res.json({ success: true, purged })
  })

  router.delete('/api/chats/:id/sessions/:agentId', async (req, res) => {
    const { id: chatId, agentId } = req.params
    const chat = chatStore.get(chatId)
    if (!chat) return res.status(404).json({ error: 'Chat not found' })

    const session = chat.expertSessions?.[agentId]
    if (!session) return res.status(404).json({ error: 'Expert session not found for this agent' })

    const member = memberAggregator.enrich(chat).find((m) => m.agentId === agentId)
    if (member?.status === 'running') {
      return res.status(409).json({ error: 'Cannot remove a running agent session. Stop it first.' })
    }

    const purged = purgeExpertSessionJsonl(session, { chatId, agentId })

    const nextSessions = { ...chat.expertSessions }
    delete nextSessions[agentId]
    const updated = await chatStore.update(chatId, { expertSessions: nextSessions })
    if (!updated) return res.status(404).json({ error: 'Chat not found' })

    const [enriched] = enrichWithMembers(enrichWithTokenUsage([updated]))
    res.json({ chat: enriched, purged })
  })

  return router
}
