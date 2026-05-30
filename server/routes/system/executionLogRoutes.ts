import { Router } from 'express'
import type { ExecutionLogStore } from '../../stores/ExecutionLogStore'

export const createExecutionLogRoutes = (store: ExecutionLogStore): Router => {
  const router = Router()

  router.get('/api/execution-logs', (req, res) => {
    const { chatId, workspaceId } = req.query
    if (chatId) {
      res.json(store.listByChat(chatId as string))
    } else if (workspaceId) {
      res.json(store.listByWorkspace(workspaceId as string))
    } else {
      res.json(store.list())
    }
  })

  router.post('/api/execution-logs', async (req, res) => {
    try {
      const log = await store.create(req.body)
      res.status(201).json(log)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create log' })
    }
  })

  router.put('/api/execution-logs/:id', async (req, res) => {
    try {
      const log = await store.update(req.params.id, req.body)
      if (!log) return res.status(404).json({ error: 'Log not found' })
      res.json(log)
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to update log' })
    }
  })

  router.get('/api/execution-logs/summary', (req, res) => {
    const { workspaceId } = req.query
    if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' })
    res.json(store.summary(workspaceId as string))
  })

  router.get('/api/execution-logs/orchestration-metrics', (req, res) => {
    const { workspaceId } = req.query
    res.json(store.orchestrationMetrics(workspaceId as string | undefined))
  })

  return router
}
