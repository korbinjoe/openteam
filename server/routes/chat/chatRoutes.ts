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

const log = createLogger('ChatRoutes')

interface ChatRouteDeps {
  chatStore: ChatStore
  chatService: ChatService
  tokenUsageStore?: TokenUsageStore
  sessionRegistry?: SessionRegistry
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

export const createChatRoutes = ({ chatStore, chatService, tokenUsageStore, sessionRegistry }: ChatRouteDeps): Router => {
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

    const deleted = await chatStore.remove(req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Chat not found' })
    res.json({ success: true })
  })

  return router
}
