import { useWorkspace } from '../../contexts/WorkspaceContext'
import { cn } from '../../lib/utils'

type AgentStatus = 'running' | 'waiting' | 'error' | 'done'

interface AgentSessionItemProps {
  agent: {
    id: string
    agent: string
    status: AgentStatus
    time: string
    role: 'lead' | 'worker'
    dispatch: 'user' | 'auto'
    handoffFrom?: string
  }
  missionId?: string
}

const statusDotColor = (s: AgentStatus): string => {
  if (s === 'error') return 'bg-accent-red'
  if (s === 'waiting') return 'bg-accent-yellow'
  if (s === 'running') return 'bg-accent-brand'
  return 'bg-text-muted'
}

const AgentSessionItem = ({ agent }: AgentSessionItemProps) => {
  const { selectedAgentId, viewMode, selectAgent } = useWorkspace()
  const isSelected = viewMode === 'agent' && selectedAgentId === agent.id
  const isAutoDispatch = agent.dispatch === 'auto'

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 py-[5px] px-2.5 rounded-[5px] cursor-pointer relative transition-colors',
        isAutoDispatch ? 'pl-[38px]' : 'pl-8',
        isSelected ? 'bg-accent-brand/[0.08]' : 'hover:bg-bg-hover',
      )}
      onClick={() => selectAgent(agent.id)}
    >
      {/* Vertical connector line for auto-dispatched */}
      {isAutoDispatch && (
        <span className="absolute left-6 top-0 bottom-0 w-px bg-border" />
      )}

      {/* Handoff indicator */}
      {agent.handoffFrom && (
        <span className="text-[10px] text-text-muted -mr-0.5">↳</span>
      )}

      {/* Status dot */}
      <span
        className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', statusDotColor(agent.status), agent.status === 'running' && 'animate-pulse')}
      />

      {/* Agent name */}
      <span
        className={cn(
          'text-[12px] flex-1 truncate',
          isSelected ? 'text-accent-brand-light font-medium' : 'text-text-secondary',
        )}
      >
        {agent.agent}
      </span>

      {/* Role badge - LEAD */}
      {agent.role === 'lead' && (
        <span className="text-[10px] px-1 rounded-sm bg-accent-purple/10 text-accent-purple font-semibold">
          LEAD
        </span>
      )}

      {/* Auto dispatch badge */}
      {isAutoDispatch && (
        <span className="text-[10px] px-1 rounded-sm bg-accent-green/[0.08] text-accent-green">
          auto
        </span>
      )}

      {/* Duration */}
      <span className="font-mono text-[11px] text-text-muted">{agent.time}</span>
    </div>
  )
}

export default AgentSessionItem
