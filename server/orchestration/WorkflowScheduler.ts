import type { WebSocket } from 'ws'
import type { WorkflowEngine } from './WorkflowEngine'
import type { WorkflowRegistry } from './WorkflowRegistry'
import type { ExpertHandler } from '../ws/ExpertHandler'
import type { ChatStore } from '../stores/ChatStore'
import type { WorkspaceStore } from '../stores/WorkspaceStore'
import type { SessionRegistry } from '../terminal/SessionRegistry'
import type { TaskResult } from '../../shared/agent-message-types'
import type { ChatActivityPayload } from '../terminal/ActivityAggregator'
import { createLogger } from '../lib/logger'

const log = createLogger('WorkflowScheduler')

const API_CONNECTION_ID = '__api__'
const LEAD_AGENT_ID = 'lead'

export interface WorkflowSchedulerDeps {
  workflowRegistry: WorkflowRegistry
  expertHandler: ExpertHandler
  chatStore: ChatStore
  workspaceStore: WorkspaceStore
  sessionRegistry: SessionRegistry
  broadcastToChat: (chatId: string, msg: Record<string, unknown>) => void
}

export class WorkflowScheduler {
  private deps: WorkflowSchedulerDeps
  private wokenLeadTasks = new Set<string>()

  constructor(deps: WorkflowSchedulerDeps) {
    this.deps = deps
  }

  scheduleWorkflow(engine: WorkflowEngine): void {
    this.advanceEngine(engine)
  }

  onAgentExited(chatId: string, agentId: string, exitCode: number, taskCompleted: boolean): void {
    const engine = this.deps.workflowRegistry.findByAgent(agentId)
    if (!engine) {
      log.debug('No workflow found for exited agent', { agentId, chatId, exitCode })
      return
    }

    const taskState = engine.findTaskByCurrentAgent(agentId)
    if (!taskState) {
      log.warn('Workflow found but no matching task for agent', { agentId, chatId, workflowId: engine.workflowId })
      return
    }

    if (this.wokenLeadTasks.has(taskState.taskId)) {
      log.debug('Task already handled by activity-based completion, skipping exit handler', { taskId: taskState.taskId, agentId })
      return
    }

    this.recordAndNotifyLead(engine, taskState.taskId, agentId, taskCompleted)
  }

  onActivityChanged(payload: ChatActivityPayload): void {
    if (!payload.agentActivities) return

    for (const agentActivity of payload.agentActivities) {
      if (agentActivity.phase !== 'waiting_input') continue

      const engine = this.deps.workflowRegistry.findByAgent(agentActivity.agentId)
      if (!engine) continue

      const taskState = engine.findTaskByCurrentAgent(agentActivity.agentId)
      if (!taskState) continue

      if (this.wokenLeadTasks.has(taskState.taskId)) continue

      log.info('Workflow task agent entered waiting_input', {
        workflowId: engine.workflowId,
        taskId: taskState.taskId,
        agentId: agentActivity.agentId,
      })

      this.wokenLeadTasks.add(taskState.taskId)
      this.recordAndNotifyLead(engine, taskState.taskId, agentActivity.agentId, true)
    }
  }

  advanceWorkflow(workflowId: string): { started: string[]; error?: string } {
    const engine = this.deps.workflowRegistry.get(workflowId)
    if (!engine) return { started: [], error: 'workflow_not_found' }

    const readyTasks = engine.getReadyTasks()
    const started: string[] = []

    for (const task of readyTasks) {
      this.startTask(engine, task.taskId, task.agentId, task.description)
      started.push(task.taskId)
    }

    log.info('Lead-driven advance', { workflowId, startedCount: started.length, started })
    return { started }
  }

  private recordAndNotifyLead(engine: WorkflowEngine, taskId: string, agentId: string, taskCompleted: boolean): void {
    const result: TaskResult = {
      taskId,
      executor: agentId,
      status: taskCompleted ? 'completed' : 'failed',
      summary: taskCompleted
        ? `Agent ${agentId} completed task ${taskId}`
        : `Agent ${agentId} failed task ${taskId}`,
      artifacts: [],
      modifiedFiles: [],
      failureReason: taskCompleted ? undefined : `agent_failed`,
    }

    engine.recordTaskResult(taskId, result)

    const readyTasks = engine.getReadyTasks()
    const state = engine.getState()

    this.wakeLeadAgent(engine.chatId, engine.workflowId, {
      event: taskCompleted ? 'task_completed' : 'task_failed',
      completedTaskId: taskId,
      completedBy: agentId,
      workflowStatus: state.status,
      tasks: Object.values(state.tasks).map(t => ({
        taskId: t.taskId,
        agentId: t.agentId,
        status: t.status,
        summary: t.result?.summary,
      })),
      readyTasks: readyTasks.map(t => ({
        taskId: t.taskId,
        agentId: t.agentId,
        description: t.description,
      })),
    })
  }

  private wakeLeadAgent(chatId: string, workflowId: string, progress: Record<string, unknown>): void {
    const prompt = this.buildLeadPrompt(workflowId, progress)

    const leadSession = this.deps.sessionRegistry.findByChat(chatId, LEAD_AGENT_ID)
    if (leadSession && leadSession.acpClient?.isAlive()) {
      const phase = leadSession.activitySnapshot?.phase
      if (phase === 'waiting_input' || phase === 'waiting_confirmation') {
        log.info('Waking existing Lead agent with workflow progress', { chatId, workflowId })
        leadSession.acpClient.prompt(leadSession.sessionId, prompt).catch(err => {
          log.error('Failed to prompt Lead agent', { chatId, error: err instanceof Error ? err.message : String(err) })
        })
        return
      }
      log.info('Lead agent is busy, queuing will happen on next idle', { chatId, workflowId, phase })
      return
    }

    log.info('Starting Lead agent for workflow progress', { chatId, workflowId })
    this.startLeadAgent(chatId, prompt)
  }

  private buildLeadPrompt(workflowId: string, progress: Record<string, unknown>): string {
    const p = progress as {
      event: string
      completedTaskId: string
      completedBy: string
      workflowStatus: string
      tasks: Array<{ taskId: string; agentId: string; status: string; summary?: string }>
      readyTasks: Array<{ taskId: string; agentId: string; description: string }>
    }

    const taskLines = p.tasks.map(t => {
      const icon = t.status === 'completed' ? '[done]' :
                   t.status === 'running' ? '[running]' :
                   t.status === 'failed' ? '[FAILED]' :
                   t.status === 'pending' ? '[pending]' : `[${t.status}]`
      return `  ${icon} ${t.taskId} (${t.agentId})${t.summary ? ': ' + t.summary : ''}`
    }).join('\n')

    const readyLines = p.readyTasks.length > 0
      ? p.readyTasks.map(t => `  - ${t.taskId} → ${t.agentId}: ${t.description.slice(0, 100)}`).join('\n')
      : '  (none)'

    return `[Workflow progress: ${workflowId}]

Event: ${p.event === 'task_completed' ? 'Task completed' : 'Task failed'}
Task: ${p.completedTaskId} by ${p.completedBy}
Workflow status: ${p.workflowStatus}

All tasks:
${taskLines}

Ready to start:
${readyLines}

Review the completed work, then advance the workflow:
- Use \`team-status.sh\` to check agent states if needed
- Use \`advance-workflow.sh '${workflowId}'\` to start all ready tasks
- Or use \`handoff.sh\` to dispatch specific tasks with custom instructions`
  }

  private startLeadAgent(chatId: string, prompt: string): void {
    const connections = this.deps.expertHandler.getConnectionsViewingChat(chatId)
    const connectionId = connections[0] || API_CONNECTION_ID
    const realWs = this.deps.expertHandler.getConnectionWs(connectionId)
    const ws: WebSocket = realWs ?? { send: () => {}, readyState: 1 } as any

    const cwd = this.resolveCwd(chatId)

    this.deps.expertHandler.handleStart(ws, {
      agentId: LEAD_AGENT_ID,
      task: prompt,
      chatId,
      cwd,
    }, connectionId).catch(err => {
      log.error('Failed to start Lead agent for workflow', { chatId, error: err instanceof Error ? err.message : String(err) })
    })
  }

  private advanceEngine(engine: WorkflowEngine): void {
    if (engine.status === 'stopped' || engine.status === 'completed') return

    const readyTasks = engine.getReadyTasks()
    for (const task of readyTasks) {
      this.startTask(engine, task.taskId, task.agentId, task.description)
    }
  }

  private resolveCwd(chatId: string): string | undefined {
    const chat = this.deps.chatStore.get(chatId)
    if (!chat?.workspaceId) return undefined
    const workspace = this.deps.workspaceStore.get(chat.workspaceId)
    return workspace?.repositories[0]?.path
  }

  private async startTask(engine: WorkflowEngine, taskId: string, agentId: string, description: string): Promise<void> {
    const chatId = engine.chatId

    engine.markTaskRunning(taskId, agentId)
    log.info('Starting workflow task', { workflowId: engine.workflowId, taskId, agentId })

    try {
      const connections = this.deps.expertHandler.getConnectionsViewingChat(chatId)
      const connectionId = connections[0] || API_CONNECTION_ID
      const realWs = this.deps.expertHandler.getConnectionWs(connectionId)
      const ws: WebSocket = realWs ?? { send: () => {}, readyState: 1 } as any

      const cwd = this.resolveCwd(chatId)

      await this.deps.expertHandler.handleStart(ws, {
        agentId,
        task: `[Workflow task: ${taskId}]\n\n${description}`,
        chatId,
        cwd,
      }, connectionId)

      log.info('Workflow task agent started', { workflowId: engine.workflowId, taskId, agentId })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      log.error('Failed to start workflow task agent', { workflowId: engine.workflowId, taskId, agentId, error: errorMsg })
      engine.recordTaskFailure(taskId, `agent_start_failed: ${errorMsg}`)

      this.deps.broadcastToChat(chatId, {
        type: 'workflow:task-start-failed',
        payload: { workflowId: engine.workflowId, taskId, agentId, error: errorMsg },
      })
    }
  }
}
