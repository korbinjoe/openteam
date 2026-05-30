import { writeFile, rename, readFile, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import type { TaskResult } from '../../shared/agent-message-types'
import type {
  WorkflowDAG, WorkflowTask, TaskCondition, WorkflowStatus,
  TaskStatus, WorkflowTaskState, WorkflowState, WorkflowResult,
} from '../../shared/workflow-types'
import { createLogger } from '../lib/logger'

const log = createLogger('WorkflowEngine')

const ALLOWED_CONDITION_FIELDS = new Set(['status', 'summary', 'followUp'])
const DEFAULT_TIMEOUT_MINUTES = 30
const DEFAULT_MAX_RETRIES = 1

export class WorkflowEngine extends EventEmitter {
  private state: WorkflowState
  private taskTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private workflowDir: string
  private statePath: string

  constructor(
    dag: WorkflowDAG,
    workflowsRoot: string,
  ) {
    super()
    this.workflowDir = join(workflowsRoot, dag.id)
    this.statePath = join(this.workflowDir, 'state.json')

    const taskStates: Record<string, WorkflowTaskState> = {}
    for (const t of dag.tasks) {
      taskStates[t.taskId] = {
        taskId: t.taskId,
        agentId: t.agentId,
        status: 'pending',
        retryCount: 0,
      }
    }

    this.state = {
      workflowId: dag.id,
      chatId: dag.chatId,
      status: 'created',
      dag,
      tasks: taskStates,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
  }

  static fromCheckpoint(workflowDir: string, stateData: WorkflowState): WorkflowEngine {
    const engine = Object.create(WorkflowEngine.prototype) as WorkflowEngine
    EventEmitter.call(engine)
    engine.workflowDir = workflowDir
    engine.statePath = join(workflowDir, 'state.json')
    engine.taskTimers = new Map()
    engine.state = stateData
    return engine
  }

  get workflowId(): string { return this.state.workflowId }
  get chatId(): string { return this.state.chatId }
  get status(): WorkflowStatus { return this.state.status }

  async initialize(): Promise<void> {
    if (!existsSync(this.workflowDir)) {
      await mkdir(this.workflowDir, { recursive: true })
    }
    await writeFile(join(this.workflowDir, 'dag.json'), JSON.stringify(this.state.dag, null, 2))
    await this.persistCheckpoint()
  }

  getReadyTasks(): WorkflowTask[] {
    return this.state.dag.tasks.filter(t => {
      const ts = this.state.tasks[t.taskId]
      if (!ts || ts.status !== 'pending') return false
      const depsResolved = t.dependsOn.every(dep => {
        const depState = this.state.tasks[dep]
        return depState && (depState.status === 'completed' || depState.status === 'skipped')
      })
      if (!depsResolved) return false
      return this.evaluateCondition(t.condition)
    })
  }

  hasRunnableTasks(): boolean {
    const hasReady = this.getReadyTasks().length > 0
    const hasRunning = Object.values(this.state.tasks).some(t => t.status === 'running')
    return hasReady || hasRunning
  }

  markTaskRunning(taskId: string, agentId?: string): void {
    const ts = this.state.tasks[taskId]
    if (!ts) return
    ts.status = 'running'
    ts.startedAt = new Date().toISOString()
    if (agentId) ts.agentId = agentId
    this.state.status = 'running'
    this.state.updatedAt = new Date().toISOString()

    const task = this.state.dag.tasks.find(t => t.taskId === taskId)
    const timeoutMs = (task?.timeoutMinutes ?? DEFAULT_TIMEOUT_MINUTES) * 60 * 1000
    const timer = setTimeout(() => {
      this.handleTaskTimeout(taskId)
    }, timeoutMs)
    this.taskTimers.set(taskId, timer)

    this.persistCheckpoint().catch(err =>
      log.warn('Checkpoint persist failed', { workflowId: this.workflowId, taskId, error: err instanceof Error ? err.message : String(err) }),
    )
  }

  recordTaskResult(taskId: string, result: TaskResult): void {
    const ts = this.state.tasks[taskId]
    if (!ts) return

    this.clearTimer(taskId)

    const failed = result.status === 'failed'
    ts.status = failed ? 'failed' : 'completed'
    ts.result = result
    ts.completedAt = new Date().toISOString()
    if (failed) ts.failureReason = result.failureReason

    this.state.updatedAt = new Date().toISOString()

    if (failed) {
      this.applyFailurePolicy(taskId)
    }

    this.checkCompletion()
    this.persistCheckpoint().catch(err =>
      log.warn('Checkpoint persist failed', { workflowId: this.workflowId, taskId, error: err instanceof Error ? err.message : String(err) }),
    )
    this.emit('task-resolved', taskId, ts.status)
  }

  recordTaskFailure(taskId: string, reason: string): void {
    const ts = this.state.tasks[taskId]
    if (!ts) return

    this.clearTimer(taskId)
    ts.status = 'failed'
    ts.failureReason = reason
    ts.completedAt = new Date().toISOString()
    this.state.updatedAt = new Date().toISOString()

    this.applyFailurePolicy(taskId)
    this.checkCompletion()
    this.persistCheckpoint().catch(err =>
      log.warn('Checkpoint persist failed', { workflowId: this.workflowId, taskId, error: err instanceof Error ? err.message : String(err) }),
    )
    this.emit('task-resolved', taskId, 'failed')
  }

  reassignTask(taskId: string, newAgentId: string): void {
    const ts = this.state.tasks[taskId]
    if (!ts) return
    log.info('Task reassigned via handoff', { workflowId: this.workflowId, taskId, from: ts.agentId, to: newAgentId })
    ts.agentId = newAgentId
    this.state.updatedAt = new Date().toISOString()
    this.persistCheckpoint().catch(() => {})
  }

  findTaskByCurrentAgent(agentId: string): WorkflowTaskState | undefined {
    return Object.values(this.state.tasks).find(t => t.agentId === agentId && t.status === 'running')
  }

  isAgentPartOfWorkflow(agentId: string): boolean {
    return Object.values(this.state.tasks).some(t => t.agentId === agentId && t.status === 'running')
  }

  shouldRetryTask(taskId: string): boolean {
    const ts = this.state.tasks[taskId]
    if (!ts || ts.status !== 'failed') return false
    const task = this.state.dag.tasks.find(t => t.taskId === taskId)
    if (!task || task.onFailure !== 'retry') return false
    const maxRetries = task.maxRetries ?? DEFAULT_MAX_RETRIES
    return ts.retryCount < maxRetries
  }

  markTaskForRetry(taskId: string): void {
    const ts = this.state.tasks[taskId]
    if (!ts) return
    ts.retryCount += 1
    ts.status = 'pending'
    ts.failureReason = undefined
    ts.result = undefined
    ts.startedAt = undefined
    ts.completedAt = undefined
    this.state.updatedAt = new Date().toISOString()
    log.info('Task queued for retry', { workflowId: this.workflowId, taskId, retryCount: ts.retryCount })
  }

  async suspendAll(): Promise<void> {
    for (const ts of Object.values(this.state.tasks)) {
      if (ts.status === 'running') {
        ts.status = 'suspended'
        this.clearTimer(ts.taskId)
      }
    }
    this.state.status = 'suspended'
    this.state.updatedAt = new Date().toISOString()
    await this.persistCheckpoint()
    log.info('Workflow suspended', { workflowId: this.workflowId })
  }

  resumeFromSuspend(): void {
    for (const ts of Object.values(this.state.tasks)) {
      if (ts.status === 'suspended') {
        ts.status = 'pending'
        ts.startedAt = undefined
      }
    }
    this.state.status = 'running'
    this.state.updatedAt = new Date().toISOString()
    log.info('Workflow resumed from suspend', { workflowId: this.workflowId })
  }

  reconcileWithRunningProcesses(liveAgentIds: Set<string>): void {
    for (const ts of Object.values(this.state.tasks)) {
      if (ts.status === 'running' && !liveAgentIds.has(ts.agentId)) {
        ts.status = 'failed'
        ts.failureReason = 'process_lost_on_restart'
        ts.completedAt = new Date().toISOString()
        log.warn('Orphaned task marked failed', { workflowId: this.workflowId, taskId: ts.taskId, agentId: ts.agentId })
        this.applyFailurePolicy(ts.taskId)
      }
    }
    this.checkCompletion()
    this.state.updatedAt = new Date().toISOString()
  }

  aggregateResults(): WorkflowResult {
    const taskResults = Object.values(this.state.tasks).map(ts => ({
      taskId: ts.taskId,
      status: ts.status,
      result: ts.result,
      failureReason: ts.failureReason,
      retryCount: ts.retryCount > 0 ? ts.retryCount : undefined,
    }))

    const completedCount = taskResults.filter(t => t.status === 'completed').length
    const failedCount = taskResults.filter(t => t.status === 'failed').length
    const skippedCount = taskResults.filter(t => t.status === 'skipped').length

    let status: WorkflowResult['status'] = 'completed'
    if (failedCount > 0 && completedCount > 0) status = 'partial'
    else if (failedCount > 0 && completedCount === 0) status = 'failed'

    return {
      workflowId: this.workflowId,
      status,
      tasks: taskResults,
      completedCount,
      failedCount,
      skippedCount,
    }
  }

  getState(): WorkflowState {
    return this.state
  }

  private evaluateCondition(cond?: TaskCondition): boolean {
    if (!cond) return true
    switch (cond.operator) {
      case 'eq': return this.resolveField(cond.field!) === cond.value
      case 'neq': return this.resolveField(cond.field!) !== cond.value
      case 'in': return Array.isArray(cond.value) && cond.value.includes(this.resolveField(cond.field!) as string)
      case 'has_items': {
        const val = this.resolveField(cond.field!)
        return Array.isArray(val) && val.length > 0
      }
      case 'is_empty': {
        const val = this.resolveField(cond.field!)
        return !Array.isArray(val) || val.length === 0
      }
      case 'and': return cond.children?.every(c => this.evaluateCondition(c)) ?? true
      case 'or': return cond.children?.some(c => this.evaluateCondition(c)) ?? false
    }
  }

  private resolveField(dotPath: string): unknown {
    const dotIdx = dotPath.indexOf('.')
    if (dotIdx < 0) return undefined
    const taskId = dotPath.slice(0, dotIdx)
    const field = dotPath.slice(dotIdx + 1)
    if (!ALLOWED_CONDITION_FIELDS.has(field)) return undefined
    const ts = this.state.tasks[taskId]
    if (!ts?.result) return undefined
    return (ts.result as Record<string, unknown>)[field]
  }

  private applyFailurePolicy(taskId: string): void {
    const task = this.state.dag.tasks.find(t => t.taskId === taskId)
    if (!task) return

    const policy = task.onFailure || 'stop'

    if (policy === 'retry' && this.shouldRetryTask(taskId)) {
      this.markTaskForRetry(taskId)
      return
    }

    if (policy === 'stop') {
      for (const ts of Object.values(this.state.tasks)) {
        if (ts.status === 'pending') {
          ts.status = 'skipped'
          ts.failureReason = `skipped: upstream task ${taskId} failed (stop policy)`
        }
      }
      this.state.status = 'stopped'
    }
  }

  private checkCompletion(): void {
    const allResolved = Object.values(this.state.tasks).every(
      t => t.status === 'completed' || t.status === 'failed' || t.status === 'skipped',
    )
    if (!allResolved) return

    const hasFailed = Object.values(this.state.tasks).some(t => t.status === 'failed')
    if (this.state.status !== 'stopped') {
      this.state.status = hasFailed ? 'stopped' : 'completed'
    }
    this.state.updatedAt = new Date().toISOString()

    const result = this.aggregateResults()
    this.persistResult(result).catch(() => {})
    this.emit('workflow-completed', result)
  }

  private handleTaskTimeout(taskId: string): void {
    const ts = this.state.tasks[taskId]
    if (!ts || ts.status !== 'running') return
    log.warn('Task timed out', { workflowId: this.workflowId, taskId })
    this.emit('task-timeout', taskId, ts.agentId)
  }

  private clearTimer(taskId: string): void {
    const timer = this.taskTimers.get(taskId)
    if (timer) {
      clearTimeout(timer)
      this.taskTimers.delete(taskId)
    }
  }

  async persistCheckpoint(): Promise<void> {
    const data = JSON.stringify(this.state, null, 2)
    const tmpPath = this.statePath + '.tmp'
    await writeFile(tmpPath, data)
    await rename(tmpPath, this.statePath)
  }

  private async persistResult(result: WorkflowResult): Promise<void> {
    const resultPath = join(this.workflowDir, 'result.json')
    await writeFile(resultPath, JSON.stringify(result, null, 2))
  }

  destroy(): void {
    for (const timer of this.taskTimers.values()) {
      clearTimeout(timer)
    }
    this.taskTimers.clear()
    this.removeAllListeners()
  }
}

export async function loadWorkflowState(workflowDir: string): Promise<WorkflowState | null> {
  const statePath = join(workflowDir, 'state.json')
  const tmpPath = statePath + '.tmp'

  if (existsSync(statePath)) {
    try {
      const data = await readFile(statePath, 'utf-8')
      return JSON.parse(data) as WorkflowState
    } catch {
      log.warn('Corrupt state.json, trying tmp fallback', { workflowDir })
    }
  }

  if (existsSync(tmpPath)) {
    try {
      const data = await readFile(tmpPath, 'utf-8')
      return JSON.parse(data) as WorkflowState
    } catch {
      log.warn('Corrupt state.json.tmp', { workflowDir })
    }
  }

  return null
}
