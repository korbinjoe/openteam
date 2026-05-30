import { useWorkspace } from '../../contexts/WorkspaceContext'
import AgentSessionItem from './AgentSessionItem'
import { Plus } from './icons'
import { cn } from '../../lib/utils'

type AgentStatus = 'running' | 'waiting' | 'waiting_input' | 'error' | 'done'

interface MissionAgent {
  id: string
  agent: string
  status: AgentStatus
  time: string
  role: 'lead' | 'worker'
  dispatch: 'user' | 'auto'
  handoffFrom?: string
}

interface Mission {
  id: string
  name: string
  workspace: string
  status: string
  agents: MissionAgent[]
}

interface MissionGroupItemProps {
  mission: Mission
  isSelected: boolean
}

const statusPriority = (s: AgentStatus): number => {
  if (s === 'error') return 0
  if (s === 'waiting') return 1
  if (s === 'running') return 2
  return 3
}

const missionStatusColor = (agents: MissionAgent[]): string => {
  const worst = Math.min(...agents.map((a) => statusPriority(a.status)))
  if (worst === 0) return 'bg-accent-red'
  if (worst === 1) return 'bg-accent-yellow'
  if (worst === 2) return 'bg-accent-brand'
  return 'bg-text-muted'
}

const MissionGroupItem = ({ mission, isSelected }: MissionGroupItemProps) => {
  const { expandedMissions, toggleMission, openMissionOverview, openAddAgent } = useWorkspace()
  const expanded = expandedMissions[mission.id] !== false

  const hasRunning = mission.agents.some((a) => a.status === 'running')

  return (
    <div className="mb-0.5">
      {/* Mission header row */}
      <div
        className={cn(
          'flex items-center gap-[7px] px-2.5 py-1.5 rounded-md cursor-pointer transition-colors',
          isSelected ? 'bg-accent-brand/[0.08]' : 'hover:bg-bg-hover',
        )}
      >
        {/* Expand chevron */}
        <svg
          width={8}
          height={8}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          className={cn('text-text-muted flex-shrink-0 transition-transform duration-150', expanded && 'rotate-90')}
          onClick={(e) => { e.stopPropagation(); toggleMission(mission.id) }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        {/* Status dot */}
        <span
          className={cn('w-[7px] h-[7px] rounded-full flex-shrink-0', missionStatusColor(mission.agents), hasRunning && 'animate-pulse')}
        />

        {/* Mission name */}
        <span
          className="text-xs font-medium text-text-primary flex-1 truncate"
          onClick={() => openMissionOverview(mission.id)}
        >
          {mission.name}
        </span>

        {/* Agent count badge */}
        {mission.agents.length > 1 && (
          <span className="text-[10px] px-[5px] py-px rounded-[3px] bg-accent-brand/10 text-accent-brand-light font-semibold">
            {mission.agents.length}
          </span>
        )}
      </div>

      {/* Expanded agents */}
      {expanded && (
        <>
          {mission.agents.map((agent) => (
            <AgentSessionItem key={agent.id} agent={agent} missionId={mission.id} />
          ))}
          {/* Add Agent row */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 pl-8 rounded-[5px] cursor-pointer hover:bg-bg-hover transition-colors"
            onClick={(e) => { e.stopPropagation(); openAddAgent(mission.id) }}
          >
            <Plus size={10} className="text-text-muted" />
            <span className="text-[10px] text-text-muted">Add Agent</span>
          </div>
        </>
      )}
    </div>
  )
}

export default MissionGroupItem
