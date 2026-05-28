import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useMission } from '../../hooks/useMission'
import { useAgents } from '../../hooks/useAgents'
import { useWhiteboard } from '../../hooks/useWhiteboard'
import { useWorkspaceMeta } from '../../hooks/useWorkspaceMeta'
import { Plus } from './icons'
import { cn } from '../../lib/utils'
import { memberStatusDot } from './MissionSessionRows'

const MissionInfoSidebar = () => {
  const { workspaceId, activeChatId, selectAgent, openAddAgent } = useWorkspace()
  const { chat, members } = useMission(activeChatId)
  const { agentNames } = useAgents()
  const { meta } = useWorkspaceMeta(workspaceId)
  const { goal } = useWhiteboard(activeChatId ?? undefined)

  const lead = members.find((m) => m.role === 'lead')
  const workers = members.filter((m) => m.role !== 'lead')

  if (!chat) {
    return (
      <div className="w-[220px] border-r border-border-subtle flex flex-col overflow-y-auto flex-shrink-0 bg-bg-secondary p-3">
        <div className="text-[12px] text-text-muted">No mission selected.</div>
      </div>
    )
  }

  return (
    <div className="w-[220px] border-r border-border-subtle flex flex-col overflow-y-auto flex-shrink-0 bg-bg-secondary p-3">
      {/* Goal — pulled from whiteboard 'goal' entry when present; falls back to chat.title */}
      <div className="mb-3.5">
        <SectionLabel>Goal</SectionLabel>
        <div className="text-[12px] text-text-secondary leading-relaxed">
          {goal?.summary ?? chat.title}
        </div>
        {meta?.name && (
          <div className="font-mono text-[11px] text-text-muted mt-1">{meta.name}</div>
        )}
      </div>

      {/* Team — real members from server enrichment */}
      <div className="mb-3.5">
        <SectionLabel>Team</SectionLabel>
        {lead && (
          <button
            type="button"
            className="w-full flex items-center gap-1.5 mb-1.5 p-1 px-1.5 rounded-[5px] bg-accent-purple/[0.04] hover:bg-accent-purple/[0.08] text-left"
            onClick={() => selectAgent(lead.agentId)}
          >
            <span className={cn('w-[7px] h-[7px] rounded-full', memberStatusDot(lead.status))} />
            <span className="text-[12px] font-medium text-text-primary flex-1 truncate">
              {agentNames[lead.agentId] ?? lead.agentId}
            </span>
            <span className="text-[10px] px-1 rounded-sm bg-accent-purple/10 text-accent-purple font-semibold">LEAD</span>
          </button>
        )}
        {workers.map((m) => (
          <button
            key={m.agentId}
            type="button"
            className="w-full flex items-center gap-1.5 mb-1 py-[3px] px-1.5 pl-4 rounded relative hover:bg-bg-hover text-left"
            onClick={() => selectAgent(m.agentId)}
          >
            <span className="absolute left-[6px] top-0 bottom-0 w-px bg-border" />
            <span className="text-[10px] text-text-muted">↳</span>
            <span className={cn('w-1.5 h-1.5 rounded-full', memberStatusDot(m.status))} />
            <span className="text-[12px] text-text-secondary flex-1 truncate">
              {agentNames[m.agentId] ?? m.agentId}
            </span>
          </button>
        ))}
        <button
          type="button"
          className="flex items-center gap-[5px] p-1 px-1.5 rounded hover:bg-bg-hover text-text-muted mt-1 w-full text-left"
          onClick={() => openAddAgent(chat.id)}
        >
          <Plus size={11} />
          <span className="text-[11px]">Add Agent</span>
        </button>
      </div>

    </div>
  )
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">{children}</div>
)

export default MissionInfoSidebar
