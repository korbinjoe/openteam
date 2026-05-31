import type { WebSocket } from 'ws'
import type { WorkflowEngine } from './WorkflowEngine'
import type { WorkflowRegistry } from './WorkflowRegistry'
import type { ExpertHandler } from '../ws/ExpertHandler'
import type { ChatStore } from '../stores/ChatStore'
import type { WorkspaceStore } from '../stores/WorkspaceStore'
import type { TaskResult } from '../../shared/agent-message-types'
import { createLogger } from '../lib/logger'

const log = createLogger('WorkflowScheduler')

const API_CONNECTION_ID = '__api__'

export interface WorkflowSchedulerDeps {
  workflowRegistry: WorkflowRegistry
  expertHandler: ExpertHandler
  chatStore: ChatStore
  workspaceStore: WorkspaceStore
  broadcastToChat: (chatId: string, msg: Record<string, unknown>) => void
}

export class WorkflowScheduler {
  private deps: WorkflowSchedulerDeps

  constructor(deps: WorkflowSchedulerDeps) {
    this.deps = deps
  }

  scheduleWorkflow(engine: WorkflowEngine): void {
    this.wireEngineEvents(engine)
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

    const result: TaskResult = {
      taskId: taskState.taskId,
      executor: agentId,
      status: taskCompleted ? 'completed' : 'failed',
      summary: taskCompleted ? `Agent ${agentId} completed successfully` : `Agent ${agentId} failed (exit code ${exitCode})`,
      artifacts: [],
      modifiedFiles: [],
      failureReason: taskCompleted ? undefined : `exit_code_${exitCode}`,
    }

    engine.recordTaskResult(taskState.taskId, result)
  }

  private wireEngineEvents(engine: WorkflowEngine): void {
    engine.on('task-resolved', () => {
      this.advanceEngine(engine)
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
