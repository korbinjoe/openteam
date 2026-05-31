import { Router } from 'express'
import { createHash } from 'crypto'
import { basename } from 'path'
import { type WorkspaceStore } from '../../stores/WorkspaceStore'
import type { ChatStore } from '../../stores/ChatStore'
import type { ChatService } from '../../services/chat/ChatService'
import { detectGitRepo } from '../../git/WorktreeManager'

interface WorkspaceRouteDeps {
  workspaceStore: WorkspaceStore
  chatStore: ChatStore
  chatService: ChatService
}

export const createWorkspaceApiRoutes = ({ workspaceStore, chatStore, chatService }: WorkspaceRouteDeps): Router => {
  const router = Router()

  router.get('/api/workspaces', (_req, res) => {
    const workspaces = workspaceStore.listSorted()
    const chatCounts = chatStore.countByWorkspace()
    res.json(workspaces.map((ws) => ({
      ...ws,
      chatCount: chatCounts[ws.id] ?? 0,
    })))
  })

  router.post('/api/workspaces', async (req, res) => {
    try {
      const userId = undefined
      const workspace = await workspaceStore.create({ ...req.body, userId })
      res.status(201).json(workspace)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create workspace' })
    }
  })

  /**
   * Quick Start Workspace →  Chat →  { workspace, chat }
   *  repoPath  repoPaths
   */
  router.post('/api/workspaces/quick-start', async (req, res) => {
    try {
      const { repoPath, repoPaths, model, agentId, workspaceId, title, skipChat } = req.body

      const paths: string[] = Array.isArray(repoPaths) && repoPaths.length > 0
        ? repoPaths.filter((p: unknown) => typeof p === 'string' && p)
        : (typeof repoPath === 'string' && repoPath ? [repoPath] : [])

      if (paths.length === 0) {
        return res.status(400).json({ error: 'repoPath or repoPaths is required' })
      }

      let isExisting = false
      let workspace = (typeof workspaceId === 'string' && workspaceId)
        ? workspaceStore.get(workspaceId)
        : (paths.length === 1
            ? workspaceStore.findByRepoPath(paths[0])
            : workspaceStore.findByRepoPaths(paths))

      const agentTeam = typeof agentId === 'string' && agentId
        ? { primaryAgentId: agentId, teamAgentIds: [] as string[] }
        : undefined

      if (!workspace) {
        const userId = undefined
        workspace = await workspaceStore.create({
          repositories: paths.map((path) => ({ path })),
          agentTeam,
          userId,
        })
      } else {
        isExisting = true
        await workspaceStore.update(workspace.id, { ...(agentTeam ? { agentTeam } : {}) })
      }

      if (skipChat) {
        return res.status(201).json({ workspace, isExisting })
      }

      const chat = await chatService.createChat({
        workspaceId: workspace.id,
        title: (typeof title === 'string' && title.trim()) || 'New Session',
        model,
      })

      res.status(201).json({ workspace, chat, isExisting })
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Quick start failed' })
    }
  })

  router.get('/api/workspaces/:id', (req, res) => {
    const ws = workspaceStore.get(req.params.id)
    if (!ws) return res.status(404).json({ error: 'Workspace not found' })
    res.json(ws)
  })

  router.put('/api/workspaces/:id', async (req, res) => {
    try {
      const ws = await workspaceStore.update(req.params.id, req.body)
      if (!ws) return res.status(404).json({ error: 'Workspace not found' })
      res.json(ws)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update workspace' })
    }
  })

  router.delete('/api/workspaces/:id', async (req, res) => {
    if (workspaceStore.isDefaultWorkspaceId(req.params.id)) {
      return res.status(403).json({ error: 'Cannot delete the default workspace' })
    }
    const deleted = await workspaceStore.remove(req.params.id)
    if (!deleted) return res.status(404).json({ error: 'Workspace not found' })
    res.json({ success: true })
  })

  router.post('/api/workspaces/:id/repositories', async (req, res) => {
    try {
      const { path: repoPath } = req.body
      if (!repoPath || typeof repoPath !== 'string') {
        return res.status(400).json({ error: 'path is required' })
      }

      const ws = workspaceStore.get(req.params.id)
      if (!ws) return res.status(404).json({ error: 'Workspace not found' })

      if (ws.repositories.some((r) => r.path === repoPath)) {
        return res.status(409).json({ error: 'Repository already exists in this workspace' })
      }

      const gitInfo = await detectGitRepo(repoPath)

      const newRepo = {
        id: createHash('sha256').update(repoPath).digest('hex').slice(0, 12),
        path: repoPath,
        name: basename(repoPath),
        gitInfo: gitInfo.isGit
          ? { currentBranch: gitInfo.currentBranch }
          : undefined,
      }

      const updated = await workspaceStore.update(req.params.id, {
        repositories: [...ws.repositories, newRepo],
      })
      res.status(201).json(updated)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to add repository' })
    }
  })

  router.delete('/api/workspaces/:id/repositories/:repoId', async (req, res) => {
    try {
      if (workspaceStore.isDefaultWorkspaceId(req.params.id)) {
        return res.status(403).json({ error: 'Cannot remove repositories from the default workspace' })
      }
      const ws = workspaceStore.get(req.params.id)
      if (!ws) return res.status(404).json({ error: 'Workspace not found' })

      const filtered = ws.repositories.filter((r) => r.id !== req.params.repoId)
      if (filtered.length === ws.repositories.length) {
        return res.status(404).json({ error: 'Repository not found' })
      }

      const updated = await workspaceStore.update(req.params.id, {
        repositories: filtered,
      })
      res.json(updated)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to remove repository' })
    }
  })

  return router
}
