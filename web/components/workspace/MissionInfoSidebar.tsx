import { useMemo } from 'react'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useTask } from '../../hooks/useTask'
import { useAgents } from '../../hooks/useAgents'
import { useWhiteboard } from '../../hooks/useWhiteboard'
import { useWorkspaceMeta } from '../../hooks/useWorkspaceMeta'
import { Plus } from './icons'
import { cn } from '../../lib/utils'
import { memberStatusDot } from './TaskSessionRows'
import type { WhiteboardEntry, WhiteboardEntryType } from '@shared/whiteboard-types'

// Whiteboard entry types we surface in the per-task timeline. Picks the signals
// a returning user needs to see at a glance: who-handed-off-to-whom, progress
// milestones, blockers, key decisions.
const TIMELINE_TYPES: ReadonlySet<WhiteboardEntryType> = new Set([
  'handoff', 'progress', 'open_question', 'decision', 'goal',
])

const timelineDotColor = (type: WhiteboardEntryType) => {
  if (type === 'open_question') return 'bg-accent-yellow'
  if (type === 'handoff') return 'bg-accent-brand'
  if (type === 'progress') return 'bg-accent-green'
  if (type === 'decision') return 'bg-accent-purple'
  return 'bg-text-muted'
}

const formatTime = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const TaskInfoSidebar = () => {
  const { workspaceId, activeChatId, selectAgent, openAddAgent } = useWorkspace()
  const { chat, members } = useTask(activeChatId)
  const { agentNames } = useAgents()
  const { meta } = useWorkspaceMeta(workspaceId)
  const { goal, active: whiteboardEntries } = useWhiteboard(activeChatId ?? undefined)

  const lead = members.find((m) => m.role === 'lead')
  const workers = members.filter((m) => m.role !== 'lead')

  // Timeline: surface handoff / progress / decision / open_question entries.
  // Sort newest-first since users skim from the top.
  const timeline = useMemo<WhiteboardEntry[]>(() => {
    const all = goal ? [goal, ...whiteboardEntries] : whiteboardEntries
    return all
      .filter((e) => TIMELINE_TYPES.has(e.type))
      .slice()
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
      .slice(0, 12)
  }, [goal, whiteboardEntries])

  if (!chat) {
    return (
      <div className="w-[220px] border-r border-border-subtle flex flex-col overflow-y-auto flex-shrink-0 bg-bg-secondary p-3">
        <div className="text-[12px] text-text-muted">No task selected.</div>
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

      {/* Timeline — whiteboard-derived */}
      <div className="mb-3.5">
        <SectionLabel>Timeline</SectionLabel>
        {timeline.length === 0 ? (
          <div className="text-[11px] text-text-muted italic">No activity yet.</div>
        ) : (
          timeline.map((ev, i) => (
            <div key={ev.id} className="flex items-start gap-1.5 mb-1.5 relative">
              {i < timeline.length - 1 && (
                <div className="absolute left-[3px] top-[9px] bottom-[-3px] w-px bg-border" />
              )}
              <span className={cn('w-[7px] h-[7px] rounded-full mt-0.5 flex-shrink-0', timelineDotColor(ev.type))} />
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-text-secondary truncate" title={ev.summary}>
                  {ev.summary}
                </div>
                <div className="font-mono text-[10px] text-text-muted">
                  {ev.by} · {formatTime(ev.timestamp)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <div className="text-[10px] font-bold uppercase tracking-wide text-text-muted mb-1.5">{children}</div>
)

export default TaskInfoSidebar
