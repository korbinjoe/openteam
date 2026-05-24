import { useWorkspace } from '../../contexts/WorkspaceContext'
import AgentSessionItem from './AgentSessionItem'
import { Plus } from './icons'
import { cn } from '../../lib/utils'

type AgentStatus = 'running' | 'waiting' | 'error' | 'done'

interface TaskAgent {
  id: string
  agent: string
  status: AgentStatus
  time: string
  role: 'lead' | 'worker'
  dispatch: 'user' | 'auto'
  handoffFrom?: string
}

interface Task {
  id: string
  name: string
  workspace: string
  status: string
  agents: TaskAgent[]
}

interface TaskGroupItemProps {
  task: Task
  isSelected: boolean
}

const statusPriority = (s: AgentStatus): number => {
  if (s === 'error') return 0
  if (s === 'waiting') return 1
  if (s === 'running') return 2
  return 3
}

const taskStatusColor = (agents: TaskAgent[]): string => {
  const worst = Math.min(...agents.map((a) => statusPriority(a.status)))
  if (worst === 0) return 'bg-accent-red'
  if (worst === 1) return 'bg-accent-yellow'
  if (worst === 2) return 'bg-accent-brand'
  return 'bg-text-muted'
}

const TaskGroupItem = ({ task, isSelected }: TaskGroupItemProps) => {
  const { expandedTasks, toggleTask, openTaskOverview, openAddAgent } = useWorkspace()
  const expanded = expandedTasks[task.id] !== false

  const hasRunning = task.agents.some((a) => a.status === 'running')

  return (
    <div className="mb-0.5">
      {/* Task header row */}
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
          onClick={(e) => { e.stopPropagation(); toggleTask(task.id) }}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>

        {/* Status dot */}
        <span
          className={cn('w-[7px] h-[7px] rounded-full flex-shrink-0', taskStatusColor(task.agents), hasRunning && 'animate-pulse')}
        />

        {/* Task name */}
        <span
          className="text-xs font-medium text-text-primary flex-1 truncate"
          onClick={() => openTaskOverview(task.id)}
        >
          {task.name}
        </span>

        {/* Agent count badge */}
        {task.agents.length > 1 && (
          <span className="text-[10px] px-[5px] py-px rounded-[3px] bg-accent-brand/10 text-accent-brand-light font-semibold">
            {task.agents.length}
          </span>
        )}
      </div>

      {/* Expanded agents */}
      {expanded && (
        <>
          {task.agents.map((agent) => (
            <AgentSessionItem key={agent.id} agent={agent} taskId={task.id} />
          ))}
          {/* Add Agent row */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 pl-8 rounded-[5px] cursor-pointer hover:bg-bg-hover transition-colors"
            onClick={(e) => { e.stopPropagation(); openAddAgent(task.id) }}
          >
            <Plus size={10} className="text-text-muted" />
            <span className="text-[10px] text-text-muted">Add Agent</span>
          </div>
        </>
      )}
    </div>
  )
}

export default TaskGroupItem
