
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import AgentAvatar from '@/components/ui/agent-avatar'
import type { AgentActivity } from '@/types/chat'
import type { AgentPersonality } from '@/types/agentConfig'

interface MessageToolbarProps {
  filterAgentId: string | null
  onFilterAgentChange: (agentId: string | null) => void
  agentNames: Record<string, string>
  /** agentId → personality */
  agentPersonalities?: Record<string, AgentPersonality>
  expertActivities?: Record<string, AgentActivity>
  activeAgentIds?: string[]
}

const PHASE_DOT_COLORS: Record<string, string> = {
  thinking: 'rgb(var(--accent-purple))',
  tool_running: 'rgb(var(--accent-brand))',
  responding: 'rgb(var(--accent-green))',
  completed: 'rgb(var(--accent-green))',
  waiting_input: 'rgb(var(--accent-yellow, 234 179 8))',
  waiting_confirmation: 'rgb(var(--accent-yellow, 234 179 8))',
  error: 'rgb(var(--accent-red))',
}

const MessageToolbar = ({
  filterAgentId,
  onFilterAgentChange,
  agentNames,
  agentPersonalities,
  expertActivities,
  activeAgentIds,
}: MessageToolbarProps) => {
  const { t } = useTranslation('chat')
  const agentIds = activeAgentIds ?? Object.keys(agentNames)

  if (agentIds.length <= 1) return null

  return (
    <div className="flex items-center gap-1 overflow-x-auto">
      <FilterChip
        active={filterAgentId === null}
        onClick={() => onFilterAgentChange(null)}
        label={t('filter.all')}
      />
      {agentIds.map((agentId) => {
        const personality = agentPersonalities?.[agentId]
        const displayName = personality?.nickname || agentNames[agentId] || agentId
        const activity = expertActivities?.[agentId]
        const phaseColor = activity ? PHASE_DOT_COLORS[activity.phase] : undefined
        const isActive = activity && !['completed', 'waiting_input'].includes(activity.phase)

        return (
          <FilterChip
            key={agentId}
            active={filterAgentId === agentId}
            onClick={() => onFilterAgentChange(filterAgentId === agentId ? null : agentId)}
            label={displayName}
            avatar={<AgentAvatar name={displayName} agentId={agentId} size="xs" />}
            statusDot={phaseColor}
            pulse={!!isActive}
          />
        )
      })}
    </div>
  )
}

/** Visibility helper mirroring MessageToolbar's internal "render if >1 chip" rule. */
export const hasMultipleAgents = (
  agentNames: Record<string, string>,
  activeAgentIds?: string[],
): boolean => (activeAgentIds ?? Object.keys(agentNames)).length > 1

/* ── Filter Chip ────────────────────────────────────────── */

const FilterChip = ({
  active,
  onClick,
  label,
  avatar,
  statusDot,
  pulse,
}: {
  active: boolean
  onClick: () => void
  label: string
  avatar?: React.ReactNode
  statusDot?: string
  pulse?: boolean
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'flex items-center gap-1 px-1.5 py-0.5 text-xs rounded-md transition-colors cursor-pointer border shrink-0',
      active
        ? 'bg-accent-brand/10 border-accent-brand/30 text-accent-brand font-medium'
        : 'bg-transparent border-transparent text-text-secondary hover:text-text-secondary hover:bg-bg-hover-subtle',
    )}
    tabIndex={0}
    aria-pressed={active}
    aria-label={label}
  >
    {avatar}
    <span className="truncate max-w-[60px]">{label}</span>
    {statusDot && (
      <span
        className={cn('w-1.5 h-1.5 rounded-full shrink-0', pulse && 'animate-pulse')}
        style={{ background: statusDot }}
      />
    )}
  </button>
)

export default MessageToolbar
