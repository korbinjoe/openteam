/**
 * Expert Agent HTTP API
 *  server/index.ts  Lead Agent  MCP Expert Dispatcher
 *
 * HTTP API  WS  expert  connectionId
 *  api  Lead Agent  MCP dispatcher
 *  WS  chat
 */

import { Router } from 'express'
import { join } from 'path'
import type { ExpertHandler } from '../../ws/ExpertHandler'
import type { AgentRegistry } from '../../config/AgentRegistry'
import type { ExecutionPlanManager } from '../../mailbox/ExecutionPlanManager'
import type { WhiteboardManager } from '../../whiteboard/WhiteboardManager'
import type { WorkflowRegistry } from '../../orchestration/WorkflowRegistry'
import { wrapTaskEnvelope, type TaskEnvelope } from '../../../shared/agent-message-types'
import type { HandoffRequest } from '../../../shared/handoff-types'
import { TERMINAL_PHASES, type ExpertEvent } from '../../../shared/expert-event-types'
import { parseAgentId } from '../../ws/ExpertSessionStore'
import { expandSlashCommand } from '../../runtime/SlashCommandResolver'
import { cwdToClaudeProjectKey } from '../../../shared/projectKey'
import { createLogger } from '../../lib/logger'
import { homedir } from 'os'

const log = createLogger('ExpertRoutes')

const API_CONNECTION_ID = '__api__'

interface ExpertRouteDeps {
  expertHandler: ExpertHandler
  agentRegistry: AgentRegistry
  executionPlanManager?: ExecutionPlanManager
  whiteboardManager?: WhiteboardManager
  workflowRegistry?: WorkflowRegistry
  broadcastToChat?: (chatId: string, msg: Record<string, unknown>) => void
}

export const createExpertRoutes = (deps: ExpertRouteDeps): Router => {
  const router = Router()
  const { expertHandler, agentRegistry, executionPlanManager, whiteboardManager, workflowRegistry, broadcastToChat } = deps

  router.post('/api/expert/start', async (req, res) => {
    const { agentId, task, taskEnvelope, instanceSuffix, connectionId, chatId: reqChatId } = req.body as {
      agentId: string
      task?: string
      taskEnvelope?: TaskEnvelope
      instanceSuffix?: string
      connectionId?: string
      chatId?: string
    }

    const instanceId = instanceSuffix ? `${agentId}#${instanceSuffix}` : agentId
    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' })
    }

    const taskDescription = task || taskEnvelope?.description
    if (!taskDescription) {
      return res.status(400).json({ error: 'task or taskEnvelope.description is required' })
    }

    const envelope: TaskEnvelope = taskEnvelope
      ? { ...taskEnvelope, instanceSuffix: taskEnvelope.instanceSuffix || instanceSuffix }
      : { ...wrapTaskEnvelope(agentId, taskDescription), instanceSuffix }

    // Create plan.md
    let planPath: string | undefined
    if (executionPlanManager) {
      try {
        planPath = executionPlanManager.createPlan(envelope, 'lead')
      } catch {
      }
    }

    const cwd = req.body.cwd || process.cwd()
    const expandedTask = await expandSlashCommand(taskDescription, cwd)

    const resolvedTask = `[Task ID: ${envelope.taskId}]
[Execution Plan: ~/.openteam/tasks/${envelope.taskId}/plan.md]
${envelope.priority ? `[Priority: ${envelope.priority}]` : ''}

${expandedTask}`

    const agentDef = agentRegistry.get(agentId)
    if (!agentDef) {
      return res.status(404).json({ error: `Expert ${agentId} not found` })
    }
    const resolvedConnectionId = connectionId || API_CONNECTION_ID

    const alreadyRunning = expertHandler.getRunning(instanceId, resolvedConnectionId)
    if (alreadyRunning && alreadyRunning.acpClient.isAlive()) {
      return res.json({
        success: true,
        agentId,
        instanceId,
        taskId: envelope.taskId,
        sessionId: alreadyRunning.sessionId,
        agentName: agentDef.name,
        alreadyRunning: true,
      })
    }

    const errors: any[] = []
    const realWs = expertHandler.getConnectionWs(resolvedConnectionId)
    if (!realWs) {
      log.warn('[DIAG] getConnectionWs returned undefined — using mock WS, all expert:data will be LOST', { resolvedConnectionId, agentId: instanceId })
    } else {
      log.info('[DIAG] getConnectionWs OK — using real WS', { resolvedConnectionId, agentId: instanceId })
    }
    const ws = realWs ?? {
      send: (data: string) => {
        const msg = JSON.parse(data)
        if (msg.type === 'expert:error') errors.push(msg.payload)
      },
      readyState: 1,
    } as any

    await expertHandler.handleStart(ws, { agentId: instanceId, task: resolvedTask, cwd: req.body.cwd, chatId: reqChatId }, resolvedConnectionId)

    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0].message })
    }

    expertHandler.setRunningMeta(instanceId, 'taskEnvelopeId', envelope.taskId, resolvedConnectionId)

    const running = expertHandler.getRunning(instanceId, resolvedConnectionId)
    res.json({
      success: true,
      agentId,
      instanceId,
      taskId: envelope.taskId,
      sessionId: running?.sessionId,
      agentName: agentDef.name,
      planPath,
    })
  })

  router.get('/api/expert/list', (req, res) => {
    const connectionId = (req.query.connectionId as string) || undefined
    if (connectionId) {
      res.json({ experts: expertHandler.getExpertListForConnection(connectionId) })
    } else {
      res.json({ experts: expertHandler.getExpertList() })
    }
  })

  router.get('/api/expert/team-status', (req, res) => {
    const chatId = req.query.chatId as string
    if (!chatId) {
      return res.status(400).json({ error: 'chatId is required' })
    }
    const agents = expertHandler.getTeamStatus(chatId)
    res.json({
      agents,
      allCompleted: agents.length > 0 && agents.every(a => a.phase === 'completed' || a.phase === 'waiting_input'),
      timestamp: new Date().toISOString(),
    })
  })

  router.post('/api/expert/stop', (req, res) => {
    const { agentId, connectionId, chatId: reqChatId } = req.body
    if (!agentId) {
      return res.status(400).json({ error: 'agentId is required' })
    }

    const running = expertHandler.getRunning(agentId, connectionId)
    if (!running) {
      return res.status(404).json({ error: `Expert ${agentId} is not running` })
    }

    const resolvedConnectionId = connectionId || running.connectionId || API_CONNECTION_ID
    const resolvedChatId = reqChatId || running.chatId
    const errors: any[] = []
    const mockWs = {
      send: (data: string) => {
        const msg = JSON.parse(data)
        if (msg.type === 'expert:error') errors.push(msg.payload)
      },
      readyState: 1,
    } as any
    expertHandler.handleStop(mockWs, { agentId, chatId: resolvedChatId }, resolvedConnectionId)
    if (errors.length > 0) {
      return res.status(400).json({ error: errors[0].message })
    }
    res.json({ success: true, agentId })
  })

  router.post('/api/expert/input', (req, res) => {
    const { agentId, data, connectionId } = req.body
    if (!agentId || !data) {
      return res.status(400).json({ error: 'agentId and data are required' })
    }

    const running = expertHandler.getRunning(agentId, connectionId)
    if (!running) {
      return res.status(404).json({ error: `Expert ${agentId} is not running` })
    }

    const cleanData = data.endsWith('\r') ? data.slice(0, -1) : data
    running.acpClient.write(cleanData)
    res.json({ success: true, ready: expertHandler.isReady(agentId, connectionId) })
  })

  router.post('/api/expert/stop-all', (req, res) => {
    const { connectionId } = req.body || {}
    const resolvedConnectionId = connectionId || API_CONNECTION_ID
    const mockWs = { send: () => {}, readyState: 1 } as any
    expertHandler.handleStopAll(mockWs, resolvedConnectionId)
    res.json({ success: true })
  })

  router.get('/api/expert/messages/:agentId', (req, res) => {
    const { agentId } = req.params
    const connectionId = (req.query.connectionId as string) || undefined

    const messages = expertHandler.getExpertMessages(agentId, connectionId)
    const activity = expertHandler.getExpertActivity(agentId, connectionId)

    if (messages === null) {
      return res.json({ status: 'not_found', messages: [], activity: null })
    }

    res.json({ status: 'ok', messages, activity })
  })

  // FetchTaskResult（result.md）
  router.get('/api/expert/result/:taskId', (req, res) => {
    const { taskId } = req.params

    if (!executionPlanManager) {
      return res.json({ status: 'not_found' })
    }

    const result = executionPlanManager.readResult(taskId)
    const plan = executionPlanManager.readPlan(taskId)

    if (!result && !plan) {
      return res.json({ status: 'not_found' })
    }

    res.json({ status: 'ok', result, plan })
  })

  router.get('/api/expert/events', (req, res) => {
    const chatId = req.query.chatId as string
    if (!chatId) {
      return res.status(400).json({ error: 'chatId is required' })
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    })

    const store = expertHandler.getExpertStore()

    const unsubActivity = store.onActivityChange((_key, eventChatId, agentId, activity) => {
      if (eventChatId !== chatId) return
      if (!TERMINAL_PHASES.has(activity.phase)) return
      const event: ExpertEvent = { type: 'phase', agentId, phase: activity.phase, tool: activity.currentTool }
      res.write(`data: ${JSON.stringify(event)}\n\n`)
    })

    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n') } catch {}
    }, 30000)

    req.on('close', () => {
      unsubActivity()
      clearInterval(heartbeat)
    })
  })

  router.post('/api/expert/clear-completed', (req, res) => {
    const { connectionId } = req.body || {}
    const resolvedConnectionId = connectionId || API_CONNECTION_ID
    const clearedCount = expertHandler.clearCompleted(resolvedConnectionId)
    res.json({ success: true, clearedCount })
  })

  const MAX_HANDOFF_CHAIN_DEPTH = 2

  router.post('/api/expert/handoff', async (req, res) => {
    const { from, to, chatId, task, context, reason } = req.body as HandoffRequest & { reason?: string }

    if (!from || !to || !chatId || !task) {
      return res.status(400).json({ status: 'error', reason: 'from, to, chatId, and task are required' })
    }
    if (from === to) {
      return res.status(400).json({ status: 'error', reason: 'Cannot handoff to self' })
    }

    const targetDef = agentRegistry.get(to)
    if (!targetDef) {
      return res.status(404).json({ status: 'error', reason: `Target agent ${to} not found` })
    }

    const store = expertHandler.getExpertStore()
    const sourceEntries = store.collectByChatId(chatId)
    const sourceMatch = sourceEntries.find(({ key }) => parseAgentId(key) === from)
    if (!sourceMatch) {
      return res.status(404).json({ status: 'error', reason: `Source agent ${from} not found running in chat ${chatId}` })
    }

    const sourceEntry = sourceMatch.expert
    const connectionId = sourceEntry.connectionId

    const dispatchChain: string[] = (store.getMeta(sourceMatch.key, 'dispatchChain') as string[] | undefined) ?? [from]
    if (dispatchChain.length > MAX_HANDOFF_CHAIN_DEPTH) {
      return res.status(400).json({ status: 'error', reason: `Handoff chain depth exceeded (max ${MAX_HANDOFF_CHAIN_DEPTH})` })
    }

    const ws = expertHandler.getConnectionWs(connectionId)
    if (!ws) {
      return res.status(500).json({ status: 'error', reason: 'No WebSocket connection for source agent' })
    }

    try {
      if (whiteboardManager) {
        whiteboardManager.appendEntry(chatId, {
          type: 'handoff',
          by: from,
          summary: `Handoff ${from} → ${to}: ${(reason || task).slice(0, 60)}`,
          refs: { files: context?.relevantFiles },
          tags: ['handoff', from, to],
        })
      }

      const previousContext = {
        agentName: sourceEntry.agentName,
        lastMessage: context?.workDoneSoFar,
        jsonlPath: sourceEntry.cliSessionId
          ? join(homedir(), '.claude', 'projects',
              cwdToClaudeProjectKey(sourceEntry.cwd),
              `${sourceEntry.cliSessionId}.jsonl`)
          : undefined,
      }

      const handoffTask = [
        `[Handoff from ${from}]`,
        context?.originalUserMessage ? `[Original request: ${context.originalUserMessage}]` : '',
        context?.workDoneSoFar ? `[Work done so far: ${context.workDoneSoFar}]` : '',
        context?.keyFindings?.length ? `[Key findings: ${context.keyFindings.join('; ')}]` : '',
        '',
        task,
      ].filter(Boolean).join('\n')

      await expertHandler.handleStart(ws, {
        agentId: to,
        task: handoffTask,
        chatId,
        cwd: sourceEntry.cwd,
        previousContext,
      }, connectionId)

      const targetEntry = store.findRunning(to, connectionId, chatId)
      if (targetEntry) {
        const targetKey = `${connectionId}::${chatId}::${to}`
        store.setMeta(targetKey, 'dispatchChain', [...dispatchChain, to])
        store.setMeta(targetKey, 'handoffFrom', from)
      }

      if (workflowRegistry) {
        const wfEngine = workflowRegistry.findByAgent(from)
        if (wfEngine) {
          const wfTask = wfEngine.findTaskByCurrentAgent(from)
          if (wfTask) {
            wfEngine.reassignTask(wfTask.taskId, to)
          }
        }
      }

      if (broadcastToChat) {
        broadcastToChat(chatId, {
          type: 'expert:handoff',
          payload: {
            chatId,
            sourceAgentId: from,
            targetAgentId: to,
            reason: reason || task.slice(0, 100),
            sourceSessionId: sourceEntry.sessionId,
          },
        })
      }

      log.info('Handoff successful', { from, to, chatId, connectionId })

      res.json({
        status: 'ok',
        targetSessionId: targetEntry?.sessionId,
      })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      log.error('Handoff failed', { from, to, chatId, error: errorMsg })

      if (whiteboardManager) {
        try {
          whiteboardManager.appendEntry(chatId, {
            type: 'handoff',
            by: from,
            summary: `Handoff failed ${from} → ${to}: ${errorMsg.slice(0, 50)}`,
            tags: ['handoff', 'failed', from, to],
          })
        } catch {}
      }

      if (broadcastToChat) {
        broadcastToChat(chatId, {
          type: 'expert:handoff-failed',
          payload: { chatId, sourceAgentId: from, targetAgentId: to, error: errorMsg },
        })
      }

      res.status(500).json({ status: 'error', reason: errorMsg })
    }
  })

  return router
}
