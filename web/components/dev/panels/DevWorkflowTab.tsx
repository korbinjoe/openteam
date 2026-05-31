import { useState } from 'react'
import { cn } from '@/lib/utils'
import type { DevWorkflowPayload, DevWorkflowTask } from '@/hooks/useDevPanel'
import { Section } from './helpers'

interface DevWorkflowTabProps {
  workflow: DevWorkflowPayload | null
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-zinc-500',
  running: 'bg-blue-400',
  completed: 'bg-green-400/60',
  failed: 'bg-red-400',
  skipped: 'bg-zinc-600',
  suspended: 'bg-yellow-400',
}

const formatDuration = (ms: number | null) => {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

const getDepthLevel = (task: DevWorkflowTask, tasks: DevWorkflowTask[]): number => {
  if (task.dependsOn.length === 0) return 0
  let maxDepth = 0
  for (const depId of task.dependsOn) {
    const dep = tasks.find((t) => t.taskId === depId)
    if (dep) maxDepth = Math.max(maxDepth, getDepthLevel(dep, tasks) + 1)
  }
  return maxDepth
}

const TaskRow = ({ task, depth, tasks }: { task: DevWorkflowTask; depth: number; tasks: DevWorkflowTask[] }) => {
  const [expanded, setExpanded] = useState(false)
  const dependencyNames = task.dependsOn
    .map((id) => tasks.find((t) => t.taskId === id)?.agentId ?? id)
    .join(', ')

  return (
    <div>
      <div
        className="flex items-center gap-2 py-1 px-2 hover:bg-zinc-800/50 cursor-pointer text-[11px]"
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter') setExpanded(!expanded) }}
        role="button"
        tabIndex={0}
      >
        {depth > 0 && (
          <span className="text-zinc-700 shrink-0">{'└'}</span>
        )}
        <div className={cn('w-2 h-2 rounded-full shrink-0', STATUS_COLORS[task.status] ?? 'bg-zinc-600')} />
        <span className="text-zinc-300 font-mono shrink-0">{task.agentId}</span>
        <span className="text-zinc-500 truncate flex-1">{task.description}</span>
        <span className="text-zinc-600 font-mono shrink-0">{formatDuration(task.durationMs)}</span>
        {task.retryCount > 0 && (
          <span className="text-yellow-500 text-[10px] shrink-0">retry:{task.retryCount}</span>
        )}
      </div>
      {expanded && (
        <div className="text-[10px] text-zinc-500 pl-8 pb-1 space-y-0.5" style={{ paddingLeft: `${24 + depth * 16}px` }}>
          <div>Task ID: <span className="font-mono text-zinc-400">{task.taskId}</span></div>
          <div>Status: <span className="font-mono text-zinc-400">{task.status}</span></div>
          {dependencyNames && <div>Depends: <span className="text-zinc-400">{dependencyNames}</span></div>}
          {task.startedAt && <div>Started: <span className="font-mono text-zinc-400">{new Date(task.startedAt).toLocaleTimeString()}</span></div>}
          {task.completedAt && <div>Completed: <span className="font-mono text-zinc-400">{new Date(task.completedAt).toLocaleTimeString()}</span></div>}
          {task.failureReason && <div className="text-red-400">Failure: {task.failureReason}</div>}
        </div>
      )}
    </div>
  )
}

export const DevWorkflowTab = ({ workflow }: DevWorkflowTabProps) => {
  if (!workflow || !workflow.workflowId) {
    return (
      <div className="flex items-center justify-center h-32 text-xs text-zinc-600">
        No active workflow
      </div>
    )
  }

  const completedCount = workflow.tasks.filter((t) => t.status === 'completed').length
  const failedCount = workflow.tasks.filter((t) => t.status === 'failed').length
  const runningCount = workflow.tasks.filter((t) => t.status === 'running').length

  return (
    <div className="p-3 space-y-3">
      <Section title={`Workflow: ${workflow.workflowId.slice(0, 8)}`}>
        <div className="flex items-center gap-3 text-[11px] mb-2">
          <span className={cn(
            'px-1.5 py-0.5 rounded font-mono',
            workflow.status === 'running' ? 'bg-blue-900/50 text-blue-300' :
            workflow.status === 'completed' ? 'bg-green-900/50 text-green-300' :
            workflow.status === 'stopped' ? 'bg-red-900/50 text-red-300' :
            'bg-zinc-800 text-zinc-400',
          )}>
            {workflow.status}
          </span>
          <span className="text-zinc-500">
            {completedCount}/{workflow.tasks.length} done
            {failedCount > 0 && <span className="text-red-400 ml-1">({failedCount} failed)</span>}
            {runningCount > 0 && <span className="text-blue-400 ml-1">({runningCount} running)</span>}
          </span>
          {workflow.totalElapsedMs !== null && (
            <span className="text-zinc-600 font-mono ml-auto">{formatDuration(workflow.totalElapsedMs)}</span>
          )}
        </div>
      </Section>

      <Section title="Tasks">
        <div className="divide-y divide-zinc-800/50">
          {workflow.tasks.map((task) => (
            <TaskRow
              key={task.taskId}
              task={task}
              depth={getDepthLevel(task, workflow.tasks)}
              tasks={workflow.tasks}
            />
          ))}
        </div>
      </Section>
    </div>
  )
}
