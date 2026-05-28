/**
 * Expert Agent HTTP API
 *  server/index.ts  Lead Agent  MCP Expert Dispatcher
 *
 * HTTP API  WS  expert  connectionId
 *  api  Lead Agent  MCP dispatcher
 *  WS  chat
 */

import { Router } from 'express'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ExpertHandler } from '../../ws/ExpertHandler'
import type { AgentRegistry } from '../../config/AgentRegistry'
import type { MailboxManager } from '../../mailbox/MailboxManager'
import type { ExecutionPlanManager } from '../../mailbox/ExecutionPlanManager'
import { MAILBOX_ROOT } from '../../config/paths'
import { wrapTaskEnvelope, createAgentMessage, type TaskEnvelope } from '../../../shared/agent-message-types'
import { TERMINAL_PHASES, type ExpertEvent } from '../../../shared/expert-event-types'
import { parseAgentId } from '../../ws/ExpertSessionStore'
import { expandSlashCommand } from '../../runtime/SlashCommandResolver'
import { createLogger } from '../../lib/logger'

const log = createLogger('ExpertRoutes')

const API_CONNECTION_ID = '__api__'

interface ExpertRouteDeps {
  expertHandler: ExpertHandler
  agentRegistry: AgentRegistry
  mailboxManager?: MailboxManager
  executionPlanManager?: ExecutionPlanManager
}

export const createExpertRoutes = (deps: ExpertRouteDeps): Router => {
  const router = Router()
  const { expertHandler, agentRegistry, mailboxManager, executionPlanManager } = deps

  const inboxCursors = new Map<string, Record<string, number>>()

  /** cursor map keychatId + instanceId  chat  */
  const cursorKey = (chatId: string, instanceId: string) => `${chatId}::${instanceId}`

  const loadInboxCursor = (chatId: string, instanceId: string): Record<string, number> => {
    const ck = cursorKey(chatId, instanceId)
    const cached = inboxCursors.get(ck)
    if (cached) return cached
    const cursorsDir = join(MAILBOX_ROOT, chatId, '.cursors')
    const cursorFile = join(cursorsDir, `inbox-${instanceId}.json`)
    if (existsSync(cursorFile)) {
      try {
        const data = JSON.parse(readFileSync(cursorFile, 'utf-8')) as Record<string, number>
        inboxCursors.set(ck, data)
        return data
      } catch { /* corrupt cursor file, start fresh */ }
    }
    return {}
  }

  const saveInboxCursor = (chatId: string, instanceId: string, cursors: Record<string, number>): void => {
    const cursorsDir = join(MAILBOX_ROOT, chatId, '.cursors')
    if (!existsSync(cursorsDir)) mkdirSync(cursorsDir, { recursive: true })
    const cursorFile = join(cursorsDir, `inbox-${instanceId}.json`)
    try {
      writeFileSync(cursorFile, JSON.stringify(cursors), 'utf-8')
    } catch { /* cursor save failure is non-critical */ }
  }

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

    if (mailboxManager && reqChatId) {
      try {
        const dispatcherInstanceId = req.body.dispatcherInstanceId || 'lead'
        const assignMsg = createAgentMessage('task:assign', {
          from: dispatcherInstanceId,
          to: instanceId,
          chatId: reqChatId,
          taskId: envelope.taskId,
          payload: envelope,
        })
        mailboxManager.writeMessage(reqChatId, dispatcherInstanceId, instanceId, assignMsg)
      } catch (err) {
        log.warn('Failed to write task:assign to mailbox', { taskId: envelope.taskId, error: err instanceof Error ? err.message : String(err) })
      }
    }

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

  router.get('/api/expert/inbox/:instanceId', (req, res) => {
    const { instanceId } = req.params
    const chatId = req.query.chatId as string

    if (!chatId || !mailboxManager) {
      return res.json({ status: 'ok', messages: [] })
    }

    const prevCursors = loadInboxCursor(chatId, instanceId)
    const { messages, cursors: newCursors } = mailboxManager.readInbox(chatId, instanceId, prevCursors)
    inboxCursors.set(cursorKey(chatId, instanceId), newCursors)
    saveInboxCursor(chatId, instanceId, newCursors)

    res.json({ status: 'ok', messages })
  })

  router.get('/api/expert/progress/:agentId', (req, res) => {
    const { agentId } = req.params
    const connectionId = (req.query.connectionId as string) || undefined

    if (!mailboxManager) {
      return res.json({ status: 'ok', messages: [] })
    }

    const running = expertHandler.getRunning(agentId, connectionId)
    if (!running) {
      return res.json({ status: 'not_found', messages: [] })
    }

    const { messages } = mailboxManager.readOutbox(running.chatId, agentId)
    const progressMessages = messages.filter(m =>
      m.type === 'task:progress' ||
      m.type === 'task:milestone' ||
      m.type === 'task:completed' ||
      m.type === 'task:failed' ||
      m.type === 'task:blocked'
    )

    res.json({ status: 'ok', messages: progressMessages })
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

    let unsubMailbox: (() => void) | undefined
    if (mailboxManager) {
      unsubMailbox = mailboxManager.onMessage((msgChatId, from, to, msg) => {
        if (msgChatId !== chatId) return
        if (msg.type === 'task:input_required') {
          const event: ExpertEvent = { type: 'task:input_required', from, taskId: msg.taskId || '', summary: (msg.payload as any)?.question || '' }
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        } else if (msg.type === 'task:completed') {
          const event: ExpertEvent = { type: 'task:completed', from, taskId: msg.taskId || '', summary: (msg.payload as any)?.summary || 'done' }
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        } else if (msg.type === 'task:failed') {
          const event: ExpertEvent = { type: 'task:failed', from, taskId: msg.taskId || '', error: (msg.payload as any)?.failureReason || 'unknown' }
          res.write(`data: ${JSON.stringify(event)}\n\n`)
        }
      })
    }

    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n') } catch {}
    }, 30000)

    req.on('close', () => {
      unsubActivity()
      unsubMailbox?.()
      clearInterval(heartbeat)
    })
  })

  router.post('/api/expert/clear-completed', (req, res) => {
    const { connectionId } = req.body || {}
    const resolvedConnectionId = connectionId || API_CONNECTION_ID
    const clearedCount = expertHandler.clearCompleted(resolvedConnectionId)
    res.json({ success: true, clearedCount })
  })

  return router
}
