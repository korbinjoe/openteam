import type { AgentStatusInfo } from '../hooks/useAgentStatus'

const PHASE_LABELS: Record<string, string> = {
  working: 'Working',
  running: 'Running',
  thinking: 'Thinking',
  waiting: 'Waiting',
  'waiting-input': 'Needs input',
  error: 'Error',
  completed: 'Done',
  idle: 'Idle',
}

const PHASE_DOT: Record<string, string> = {
  working: 'bg-accent-running',
  running: 'bg-accent-running',
  thinking: 'bg-accent-running',
  waiting: 'bg-yellow-400',
  'waiting-input': 'bg-yellow-400',
  error: 'bg-red-400',
  completed: 'bg-gray-400',
  idle: 'bg-gray-500',
}

interface AgentStatusRowProps {
  agent: AgentStatusInfo
}

export const AgentStatusRow = ({ agent }: AgentStatusRowProps) => {
  const label = PHASE_LABELS[agent.phase] ?? agent.phase
  const dotColor = PHASE_DOT[agent.phase] ?? 'bg-gray-500'
  const progress = agent.toolCount > 0
    ? Math.round((agent.toolCompleted / agent.toolCount) * 100)
    : 0

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-white/5 rounded-md transition-colors">
      <div className={`w-2 h-2 rounded-full ${dotColor} shrink-0`} />

      {/* Name + Status */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-white/90 text-xs font-medium truncate">
            {agent.agentName}
          </span>
          <span className="text-white/40 text-[10px]">{label}</span>
        </div>
        {agent.currentTool && (
          <div className="text-white/30 text-[10px] truncate mt-0.5">
            {agent.currentTool}
          </div>
        )}
      </div>

      {agent.toolCount > 0 && (
        <div className="flex items-center gap-1.5 shrink-0">
          <div className="w-12 h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-white/40 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-white/30 text-[10px] w-6 text-right">
            {progress}%
          </span>
        </div>
      )}
    </div>
  )
}
