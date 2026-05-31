import { cn } from '@/lib/utils'
import type { DevSnapshot, DevWorkflowPayload, DevWhiteboardPayload, PipelineSnapshot } from '@/hooks/useDevPanel'
import { Section } from './helpers'

interface DevOverviewTabProps {
  snapshot: DevSnapshot
  workflow: DevWorkflowPayload | null
  whiteboard: DevWhiteboardPayload | null
  pipeline: PipelineSnapshot | null
}

const StatusDot = ({ status }: { status: string }) => {
  const color = status === 'running' ? 'bg-blue-400' :
    status === 'completed' || status === 'done' ? 'bg-green-400/60' :
    status === 'failed' || status === 'error' ? 'bg-red-400' :
    status === 'waiting' || status === 'waiting_input' ? 'bg-yellow-400' :
    'bg-zinc-500'
  return <div className={cn('w-2 h-2 rounded-full shrink-0', color)} />
}

const formatCost = (cost: number) => cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`
const formatDuration = (ms: number) => ms < 1000 ? `${ms}ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60000).toFixed(1)}m`

export const DevOverviewTab = ({ snapshot, workflow, whiteboard, pipeline }: DevOverviewTabProps) => {
  const totalCost = snapshot.sessions.reduce((acc, s) => {
    const usage = s.activity.modelUsage
    return acc + Object.values(usage).reduce((sum, u) => sum + (u.cost ?? 0), 0)
  }, 0)

  const activeSessions = snapshot.sessions.filter((s) => s.status === 'active')
  const runningSessions = activeSessions.filter((s) => s.activity.phase !== 'completed' && s.activity.phase !== 'waiting_input')

  return (
    <div className="p-3 space-y-3">
      {/* Status Bar */}
      <Section title="Status">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="flex items-center gap-2">
            <StatusDot status={snapshot.chat?.status ?? 'idle'} />
            <span className="text-zinc-400">Chat:</span>
            <span className="text-zinc-200 font-mono">{snapshot.chat?.status ?? 'unknown'}</span>
          </div>
          <div className="flex items-center gap-2">
            <StatusDot status={workflow?.status ?? 'idle'} />
            <span className="text-zinc-400">Workflow:</span>
            <span className="text-zinc-200 font-mono">{workflow?.status ?? 'none'}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Agents:</span>
            <span className="text-zinc-200">{runningSessions.length} running / {activeSessions.length} total</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-zinc-400">Health:</span>
            <div className={cn(
              'w-2 h-2 rounded-full',
              pipeline?.health === 'green' ? 'bg-green-400' :
              pipeline?.health === 'yellow' ? 'bg-yellow-400' :
              pipeline?.health === 'red' ? 'bg-red-400' : 'bg-zinc-600',
            )} />
            <span className="text-zinc-200 font-mono">{pipeline?.health ?? 'unknown'}</span>
          </div>
        </div>
      </Section>

      {/* Cost Summary */}
      <Section title="Token Usage">
        <div className="text-[11px] space-y-1">
          <div className="flex items-center justify-between text-zinc-300">
            <span>Total Cost</span>
            <span className="font-mono text-zinc-100">{formatCost(totalCost)}</span>
          </div>
          {snapshot.sessions.filter((s) => {
            const usage = Object.values(s.activity.modelUsage)
            return usage.some((u) => u.cost > 0)
          }).map((s) => {
            const cost = Object.values(s.activity.modelUsage).reduce((sum, u) => sum + (u.cost ?? 0), 0)
            return (
              <div key={s.sessionId} className="flex items-center justify-between text-zinc-500">
                <span className="truncate max-w-[60%]">{s.agentName}</span>
                <span className="font-mono">{formatCost(cost)}</span>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Whiteboard Digest */}
      {whiteboard && (whiteboard.goal || whiteboard.active.length > 0) && (
        <Section title={`Whiteboard (${whiteboard.totalActive} active)`}>
          <div className="text-[11px] space-y-1">
            {whiteboard.goal && (
              <div className="flex items-start gap-2">
                <span className="text-blue-400 shrink-0 font-medium">GOAL</span>
                <span className="text-zinc-300">{whiteboard.goal.summary}</span>
              </div>
            )}
            {whiteboard.active.slice(-5).map((entry) => (
              <div key={entry.id} className="flex items-start gap-2">
                <span className={cn(
                  'shrink-0 font-mono text-[10px] px-1 rounded',
                  entry.type === 'decision' ? 'bg-purple-900/50 text-purple-300' :
                  entry.type === 'progress' ? 'bg-green-900/50 text-green-300' :
                  entry.type === 'open_question' ? 'bg-yellow-900/50 text-yellow-300' :
                  entry.type === 'constraint' ? 'bg-red-900/50 text-red-300' :
                  'bg-zinc-800 text-zinc-400',
                )}>
                  {entry.type}
                </span>
                <span className="text-zinc-400 truncate">{entry.summary}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Agent Activity Grid */}
      <Section title="Agent Activity">
        <div className="space-y-1">
          {snapshot.sessions.length === 0 ? (
            <div className="text-[11px] text-zinc-600 italic">No active sessions</div>
          ) : (
            snapshot.sessions.map((s) => (
              <div key={s.sessionId} className="flex items-center gap-2 text-[11px]">
                <StatusDot status={s.activity.phase} />
                <span className="text-zinc-300 truncate max-w-[30%]">{s.agentName}</span>
                <span className="text-zinc-500 font-mono">{s.activity.phase}</span>
                {s.activity.currentTool && (
                  <span className="text-zinc-600 font-mono truncate">→ {s.activity.currentTool}</span>
                )}
                {s.activity.toolCount > 0 && (
                  <span className="text-zinc-600 ml-auto shrink-0">
                    {s.activity.toolCompleted}/{s.activity.toolCount}
                  </span>
                )}
                {workflow?.totalElapsedMs && s.streamJson?.spawnedAt && (
                  <span className="text-zinc-600 font-mono shrink-0">
                    {formatDuration(Date.now() - s.streamJson.spawnedAt)}
                  </span>
                )}
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  )
}
