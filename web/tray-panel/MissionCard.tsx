import type { TrayMissionDTO } from '@shared/tray-types'

interface MissionCardProps {
  mission: TrayMissionDTO
  onOpen: () => void
}

const RUNNING_PHASES = new Set(['tool_running', 'thinking', 'responding', 'initializing'])

const dotClassForPhase = (phase: string): string => {
  if (phase === 'error') return 'bg-accent-red'
  if (phase === 'waiting_input' || phase === 'waiting_confirmation') return 'bg-accent-yellow'
  if (RUNNING_PHASES.has(phase)) {
    return 'bg-accent-brand relative before:absolute before:inset-0 before:rounded-full before:bg-accent-brand before:animate-ping-soft'
  }
  return 'bg-text-muted'
}

const phaseLabel = (phase: string): string => {
  switch (phase) {
    case 'tool_running': return 'running'
    case 'thinking': return 'thinking'
    case 'responding': return 'responding'
    case 'waiting_input': return 'waiting'
    case 'waiting_confirmation': return 'waiting confirm'
    case 'initializing': return 'starting'
    case 'error': return 'error'
    default: return phase
  }
}

export const MissionCard = ({ mission, onOpen }: MissionCardProps) => {
  const { title, workspaceName, agents, topPhase, totalToolProgress, totalCost } = mission
  const runningAgents = agents.filter((a) => a.phase !== 'completed')

  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-lg border border-border-subtle bg-bg-secondary/60 px-3 py-2 text-left transition-colors hover:bg-bg-secondary hover:border-border focus:outline-none focus:ring-1 focus:ring-accent-brand"
    >
      <div className="flex items-center gap-2">
        <span className={`inline-block h-2 w-2 rounded-full ${dotClassForPhase(topPhase)}`} />
        <span className="flex-1 truncate text-sm font-medium text-text-primary">{title}</span>
        <span className="text-[10px] uppercase tracking-wide text-text-muted">{workspaceName}</span>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {runningAgents.map((agent) => (
          <span
            key={agent.agentId}
            className="inline-flex items-center gap-1 rounded bg-bg-elevated px-1.5 py-0.5 text-[11px] text-text-secondary"
          >
            <span className="font-medium text-text-primary">{agent.agentName}</span>
            <span className="text-text-muted">·</span>
            <span>{phaseLabel(agent.phase)}</span>
            {agent.currentTool && (
              <>
                <span className="text-text-muted">·</span>
                <span className="text-text-muted">{agent.currentTool}</span>
              </>
            )}
          </span>
        ))}
      </div>

      <div className="mt-1.5 flex items-center justify-between text-[11px] text-text-muted">
        <span>
          {totalToolProgress.completed} / {totalToolProgress.total} tools
        </span>
        {totalCost > 0 && <span>${totalCost.toFixed(3)}</span>}
      </div>
    </button>
  )
}
