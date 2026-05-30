import { Router } from 'express'
import type { WorkflowRegistry } from '../../orchestration/WorkflowRegistry'
import type { WorkflowDAG, WorkflowTask } from '../../../shared/workflow-types'
import { createLogger } from '../../lib/logger'

const log = createLogger('WorkflowRoutes')

interface WorkflowRouteDeps {
  workflowRegistry: WorkflowRegistry
}

const generateWorkflowId = (): string => {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 6)
  return `wf-${ts}-${rand}`
}

export const createWorkflowRoutes = (deps: WorkflowRouteDeps): Router => {
  const router = Router()
  const { workflowRegistry } = deps

  router.post('/api/workflow/create', async (req, res) => {
    const { chatId, createdBy, dag } = req.body as {
      chatId?: string
      createdBy?: string
      dag?: { tasks: WorkflowTask[] }
    }

    if (!chatId || !dag?.tasks?.length) {
      return res.status(400).json({ error: 'chatId and dag.tasks are required' })
    }

    const workflowId = generateWorkflowId()
    const fullDag: WorkflowDAG = {
      id: workflowId,
      chatId,
      tasks: dag.tasks.map(t => ({
        ...t,
        onFailure: t.onFailure || 'stop',
      })),
      createdAt: new Date().toISOString(),
      createdBy: createdBy || 'lead',
    }

    try {
      const engine = await workflowRegistry.createWorkflow(fullDag)
      log.info('Workflow created via API', { workflowId, chatId, taskCount: fullDag.tasks.length })

      res.json({
        success: true,
        workflowId,
        chatId,
        taskCount: fullDag.tasks.length,
        status: engine.status,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      log.error('Workflow creation failed', { chatId, error: errorMsg })
      res.status(500).json({ error: errorMsg })
    }
  })

  router.post('/api/workflow/resume', async (req, res) => {
    const { workflowId } = req.body as { workflowId?: string }
    if (!workflowId) {
      return res.status(400).json({ error: 'workflowId is required' })
    }

    const engine = workflowRegistry.get(workflowId)
    if (!engine) {
      return res.status(404).json({ error: `Workflow ${workflowId} not found` })
    }

    if (engine.status !== 'suspended' && engine.status !== 'stopped') {
      return res.status(400).json({ error: `Workflow is ${engine.status}, cannot resume` })
    }

    engine.resumeFromSuspend()
    log.info('Workflow resumed via API', { workflowId })

    res.json({
      success: true,
      workflowId,
      status: engine.status,
      readyTasks: engine.getReadyTasks().map(t => ({ taskId: t.taskId, agentId: t.agentId })),
    })
  })

  router.get('/api/workflow/list', (req, res) => {
    const status = req.query.status as string | undefined
    const workflows = workflowRegistry.list(status)
    res.json({ workflows })
  })

  router.get('/api/workflow/:workflowId', (req, res) => {
    const engine = workflowRegistry.get(req.params.workflowId)
    if (!engine) {
      return res.status(404).json({ error: 'Workflow not found' })
    }
    res.json({
      workflowId: engine.workflowId,
      chatId: engine.chatId,
      status: engine.status,
      state: engine.getState(),
      readyTasks: engine.getReadyTasks().map(t => ({ taskId: t.taskId, agentId: t.agentId })),
    })
  })

  router.get('/api/workflow/:workflowId/result', (req, res) => {
    const engine = workflowRegistry.get(req.params.workflowId)
    if (!engine) {
      return res.status(404).json({ error: 'Workflow not found' })
    }
    res.json(engine.aggregateResults())
  })

  return router
}
