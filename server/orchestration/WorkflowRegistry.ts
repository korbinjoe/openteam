import { readdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { WorkflowEngine, loadWorkflowState } from './WorkflowEngine'
import type { WorkflowDAG, WorkflowResult, WorkflowState } from '../../shared/workflow-types'
import type { SessionRegistry } from '../terminal/SessionRegistry'
import { createLogger } from '../lib/logger'

const log = createLogger('WorkflowRegistry')

const WORKFLOWS_ROOT = join(homedir(), '.openteam', 'workflows')

interface WorkflowRegistryDeps {
  whiteboardManager?: { appendEntry(chatId: string, entry: Record<string, unknown>): void }
  broadcastToChat?: (chatId: string, msg: Record<string, unknown>) => void
}

export class WorkflowRegistry {
  private engines = new Map<string, WorkflowEngine>()
  private deps: WorkflowRegistryDeps = {}

  setDeps(deps: WorkflowRegistryDeps): void {
    this.deps = deps
  }

  getWorkflowsRoot(): string {
    return WORKFLOWS_ROOT
  }

  async createWorkflow(dag: WorkflowDAG): Promise<WorkflowEngine> {
    const engine = new WorkflowEngine(dag, WORKFLOWS_ROOT)
    await engine.initialize()
    this.wireCompletionEvents(engine)
    this.engines.set(dag.id, engine)
    log.info('Workflow created', { workflowId: dag.id, chatId: dag.chatId, taskCount: dag.tasks.length })
    return engine
  }

  get(workflowId: string): WorkflowEngine | undefined {
    return this.engines.get(workflowId)
  }

  findByChatId(chatId: string): WorkflowEngine[] {
    return Array.from(this.engines.values()).filter(e => e.chatId === chatId)
  }

  findByAgent(agentId: string): WorkflowEngine | undefined {
    for (const engine of this.engines.values()) {
      if (engine.isAgentPartOfWorkflow(agentId)) return engine
    }
    return undefined
  }

  list(statusFilter?: string): Array<{ workflowId: string; chatId: string; status: string }> {
    const result: Array<{ workflowId: string; chatId: string; status: string }> = []
    for (const engine of this.engines.values()) {
      if (!statusFilter || engine.status === statusFilter) {
        result.push({ workflowId: engine.workflowId, chatId: engine.chatId, status: engine.status })
      }
    }
    return result
  }

  remove(workflowId: string): void {
    const engine = this.engines.get(workflowId)
    if (engine) {
      engine.destroy()
      this.engines.delete(workflowId)
    }
  }

  async suspendAll(): Promise<void> {
    const promises: Promise<void>[] = []
    for (const engine of this.engines.values()) {
      if (engine.status === 'running') {
        promises.push(engine.suspendAll())
      }
    }
    await Promise.allSettled(promises)
    log.info('All workflows suspended', { count: promises.length })
  }

  private wireCompletionEvents(engine: WorkflowEngine): void {
    engine.on('workflow-completed', (result: WorkflowResult) => {
      const chatId = engine.chatId
      const summary = `Workflow ${engine.workflowId}: ${result.completedCount}/${result.tasks.length} tasks done (${result.status})`

      if (this.deps.whiteboardManager) {
        try {
          this.deps.whiteboardManager.appendEntry(chatId, {
            type: 'progress',
            by: 'workflow-engine',
            summary: summary.slice(0, 80),
            tags: ['workflow', result.status],
          })
        } catch {}
      }

      if (this.deps.broadcastToChat) {
        this.deps.broadcastToChat(chatId, {
          type: 'workflow:completed',
          payload: {
            workflowId: engine.workflowId,
            chatId,
            status: result.status,
            completedCount: result.completedCount,
            failedCount: result.failedCount,
            totalCount: result.tasks.length,
          },
        })
      }

      log.info('Workflow completed', { workflowId: engine.workflowId, status: result.status, completed: result.completedCount, failed: result.failedCount })
    })
  }

  async reconcileOnStartup(sessionRegistry: SessionRegistry): Promise<void> {
    if (!existsSync(WORKFLOWS_ROOT)) return

    const dirs = readdirSync(WORKFLOWS_ROOT, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)

    const liveAgentIds = new Set<string>()
    for (const dir of dirs) {
      const wfDir = join(WORKFLOWS_ROOT, dir)
      const tmpState = await loadWorkflowState(wfDir)
      if (!tmpState) continue
      for (const ts of Object.values(tmpState.tasks)) {
        if (ts.status === 'running') {
          const session = sessionRegistry.findByChat(tmpState.chatId, ts.agentId)
          if (session) liveAgentIds.add(ts.agentId)
        }
      }
    }

    for (const dir of dirs) {
      const wfDir = join(WORKFLOWS_ROOT, dir)
      const state = await loadWorkflowState(wfDir)
      if (!state) continue
      if (state.status !== 'running' && state.status !== 'suspended') continue

      const engine = WorkflowEngine.fromCheckpoint(wfDir, state)
      this.wireCompletionEvents(engine)

      if (state.status === 'suspended') {
        engine.resumeFromSuspend()
      } else {
        engine.reconcileWithRunningProcesses(liveAgentIds)
      }

      this.engines.set(engine.workflowId, engine)
      log.info('Recovered workflow on startup', { workflowId: engine.workflowId, status: engine.status })
    }
  }
}
