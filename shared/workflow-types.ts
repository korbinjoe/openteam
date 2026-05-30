import type { TaskResult } from './agent-message-types'

export interface WorkflowDAG {
  id: string
  chatId: string
  tasks: WorkflowTask[]
  createdAt: string
  createdBy: string
}

export interface WorkflowTask {
  taskId: string
  agentId: string
  description: string
  dependsOn: string[]
  condition?: TaskCondition
  inputMapping?: Record<string, string>
  onFailure: 'stop' | 'skip' | 'retry'
  maxRetries?: number
  timeoutMinutes?: number
}

export interface TaskCondition {
  operator: 'eq' | 'neq' | 'in' | 'has_items' | 'is_empty' | 'and' | 'or'
  field?: string
  value?: string | string[]
  children?: TaskCondition[]
}

export type WorkflowStatus = 'created' | 'running' | 'completed' | 'stopped' | 'suspended'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'suspended'

export interface WorkflowTaskState {
  taskId: string
  agentId: string
  status: TaskStatus
  result?: TaskResult
  failureReason?: string
  retryCount: number
  startedAt?: string
  completedAt?: string
}

export interface WorkflowState {
  workflowId: string
  chatId: string
  status: WorkflowStatus
  dag: WorkflowDAG
  tasks: Record<string, WorkflowTaskState>
  createdAt: string
  updatedAt: string
}

export interface WorkflowResult {
  workflowId: string
  status: 'completed' | 'partial' | 'failed'
  tasks: Array<{
    taskId: string
    status: TaskStatus
    result?: TaskResult
    failureReason?: string
    retryCount?: number
  }>
  completedCount: number
  failedCount: number
  skippedCount: number
}
