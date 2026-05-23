import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useWorkspaceMeta } from '../../hooks/useWorkspaceMeta'
import { useWorkspaceChats } from '../../hooks/useWorkspaceChats'
import { useAgents } from '../../hooks/useAgents'
import LayoutControls from './LayoutControls'
import { UsersGroup, ChevronRight, FolderGit } from './icons'
import { cn } from '../../lib/utils'
import { buildTaskUrl } from './urls'
import { memberStatusDot, ageLabel } from './TaskSessionRows'
import type { Chat, ChatMember } from '../workspace/types'

// Unified workspace bar — replaces the old 38px Toolbar + 28px StatusBar pair.
// Layout: [crumb · chat info] · flex spacer · [branch · tools · elapsed] · [layout][ide]
// Terminal button lives inside WebIDEPanel's tab bar (the only IDE-column header).

const WorkspaceToolbar = () => {
  const { viewMode, workspaceId, activeChatId, selectedAgentId } = useWorkspace()
  const { meta } = useWorkspaceMeta(workspaceId)
  const { chats } = useWorkspaceChats(workspaceId)
  const chat = activeChatId ? chats.find((c) => c.id === activeChatId) : undefined
  // Pick the active member's lastMessageAt as the elapsed label, when in agent
  // mode and the server has enriched members.
  const activeMember = selectedAgentId ? chat?.members?.find((m) => m.agentId === selectedAgentId) : undefined
  const duration = activeMember ? ageLabel(activeMember.lastMessageAt) : null

  return (
    <div className="h-8 border-b border-border-subtle flex items-center px-3 gap-2 flex-shrink-0 bg-bg-tertiary">
      <WorkspaceCrumb name={meta?.name ?? workspaceId ?? '—'} repoCount={meta?.repositories.length ?? 0} />
      <ChevronRight size={11} className="text-text-muted flex-shrink-0" />
      {viewMode === 'task-overview' ? <TaskInfoBar /> : <ActiveChatInfoBar />}

      <span className="flex-1" />

      <StatusChips duration={duration} chat={chat} />
      <Separator />
      <LayoutControls />
    </div>
  )
}

const Separator = () => <span className="w-px h-3.5 bg-border flex-shrink-0" />

const StatusChips = ({ duration, chat }: { duration: string | null; chat?: Chat }) => {
  const toolCalls = chat?.totalToolCalls ?? null
  const cost = chat?.totalCost ?? null
  // Aggregate live agent state at the toolbar level so users can locate
  // "what needs me" without entering each pane (pulse-mode return).
  const members = chat?.members ?? []
  const runningCount = members.filter((m) => m.status === 'running').length
  const errorCount = members.filter((m) => m.status === 'error').length
  const waitingCount = members.filter((m) => m.status === 'waiting').length

  return (
    <div className="flex items-center gap-2 font-mono text-[10px] text-text-muted">
      {errorCount > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-[3px] bg-accent-red/10 text-accent-red font-semibold tabular-nums" title={`${errorCount} agent(s) errored`}>
          <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
          {errorCount}
        </span>
      )}
      {waitingCount > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-[3px] bg-accent-yellow/10 text-accent-yellow font-semibold tabular-nums" title={`${waitingCount} agent(s) waiting on input`}>
          <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow" />
          {waitingCount}
        </span>
      )}
      {runningCount > 0 && (
        <span className="inline-flex items-center gap-1 px-1.5 py-px rounded-[3px] bg-accent-brand/10 text-accent-brand-light font-semibold tabular-nums" title={`${runningCount} agent(s) running`}>
          <span className="w-1.5 h-1.5 rounded-full bg-accent-brand animate-pulse" />
          {runningCount}
        </span>
      )}
      {typeof cost === 'number' && cost > 0 && (
        <span className="hidden md:inline truncate tabular-nums" title="Total cost">${cost.toFixed(2)}</span>
      )}
      {typeof toolCalls === 'number' && toolCalls > 0 && (
        <span className="hidden lg:inline truncate tabular-nums">{toolCalls} tools</span>
      )}
      {duration && (
        <span className="text-accent-purple tabular-nums">{duration}</span>
      )}
    </div>
  )
}

const WorkspaceCrumb = ({ name, repoCount }: { name: string; repoCount: number }) => (
  <div className="flex items-center gap-1.5 min-w-0 max-w-[200px]">
    <FolderGit size={12} className="text-text-muted flex-shrink-0" />
    <span className="text-[11px] font-medium text-text-secondary truncate" title={name}>{name}</span>
    {repoCount > 0 && (
      <span className="font-mono text-[10px] text-text-muted tabular-nums flex-shrink-0">{repoCount}</span>
    )}
  </div>
)

// Max sibling agents to render as inline dots before collapsing the rest into "+N".
const SIBLING_DOTS_MAX = 4

const ActiveChatInfoBar = () => {
  const { workspaceId, activeChatId, selectedAgentId } = useWorkspace()
  const { chats } = useWorkspaceChats(workspaceId)
  const { agentNames } = useAgents()
  const navigate = useNavigate()
  const chat = activeChatId ? chats.find((c) => c.id === activeChatId) : undefined

  if (!chat) {
    return <span className="text-[11px] text-text-muted">No task selected</span>
  }

  // Members source-of-truth: server-derived members[] when present, else synth
  // from primaryAgentId + teamAgentIds so the toolbar still functions pre-enrich.
  const members: ChatMember[] = chat.members && chat.members.length > 0
    ? chat.members
    : synthMembers(chat)

  const active = selectedAgentId ? members.find((m) => m.agentId === selectedAgentId) : undefined
  const siblings = selectedAgentId ? members.filter((m) => m.agentId !== selectedAgentId) : []

  // No agent selected (defensive — viewMode === 'agent' implies selectedAgentId
  // is set, but covers the brief window during URL transitions).
  if (!active) {
    return (
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="text-xs font-semibold text-text-primary truncate max-w-[260px]" title={chat.title}>{chat.title}</span>
        <MemberCountBadge count={members.length} />
      </div>
    )
  }

  const activeName = agentNames[active.agentId] ?? active.agentId
  const handleBackToTask = () => {
    if (!workspaceId) return
    navigate(buildTaskUrl(workspaceId, chat.id))
  }

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', memberStatusDot(active.status))} />
      <span className="text-xs font-semibold text-text-primary truncate max-w-[180px]" title={activeName}>
        {activeName}
      </span>
      <span className="text-[10px] text-text-muted flex-shrink-0">in</span>
      <button
        type="button"
        onClick={handleBackToTask}
        title={`Back to ${chat.title}`}
        className="text-[11px] text-text-secondary hover:text-text-primary underline-offset-2 hover:underline truncate max-w-[200px] flex-shrink min-w-0"
      >
        {chat.title}
      </button>
      {siblings.length > 0 && (
        <SiblingDots
          siblings={siblings}
          agentNames={agentNames}
          onSelect={(agentId) => {
            if (!workspaceId) return
            navigate(buildTaskUrl(workspaceId, chat.id, agentId))
          }}
        />
      )}
      {chat.model && (
        <span className="font-mono text-[10px] text-text-muted hidden lg:inline flex-shrink-0">{chat.model}</span>
      )}
    </div>
  )
}

const synthMembers = (chat: Chat): ChatMember[] => {
  const ids = [chat.primaryAgentId, ...(chat.teamAgentIds || [])].filter(Boolean)
  const seen = new Set<string>()
  return ids
    .filter((id) => (seen.has(id) ? false : (seen.add(id), true)))
    .map((agentId, idx) => ({
      agentId,
      role: (idx === 0 ? 'lead' : 'worker') as ChatMember['role'],
      status: 'idle' as ChatMember['status'],
      lastMessageAt: chat.lastMessageAt,
    }))
}

const MemberCountBadge = ({ count }: { count: number }) => (
  count > 1 ? (
    <span className="font-mono text-[10px] px-1 py-px rounded-sm bg-accent-brand/[0.1] text-accent-brand-light font-semibold tabular-nums flex-shrink-0">
      {count}
    </span>
  ) : null
)

const SiblingDots = ({ siblings, agentNames, onSelect }: {
  siblings: ChatMember[]
  agentNames: Record<string, string>
  onSelect: (agentId: string) => void
}) => {
  const visible = siblings.slice(0, SIBLING_DOTS_MAX)
  const overflow = siblings.length - visible.length
  return (
    <div className="flex items-center gap-1 ml-1 flex-shrink-0">
      {visible.map((m) => {
        const name = agentNames[m.agentId] ?? m.agentId
        return (
          <button
            key={m.agentId}
            type="button"
            onClick={() => onSelect(m.agentId)}
            aria-label={`Switch to ${name}`}
            title={`Switch to ${name}`}
            className={cn(
              'w-2.5 h-2.5 rounded-full flex-shrink-0 ring-1 ring-transparent hover:ring-accent-brand-light/60 transition-shadow',
              memberStatusDot(m.status),
            )}
          />
        )
      })}
      {overflow > 0 && (
        <span className="font-mono text-[10px] text-text-muted tabular-nums">+{overflow}</span>
      )}
    </div>
  )
}

const TaskInfoBar = () => {
  const { workspaceId, selectedTaskId } = useWorkspace()
  const { chats } = useWorkspaceChats(workspaceId)
  const chat = selectedTaskId ? chats.find((c) => c.id === selectedTaskId) : undefined
  const title = chat?.title ?? selectedTaskId ?? 'No task selected'

  return (
    <div className="flex items-center gap-2">
      <UsersGroup size={12} className="text-accent-brand" />
      <span className="text-xs font-semibold text-text-primary">Task Chat</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded-[3px] bg-accent-purple/10 text-accent-purple font-semibold">
        GROUP
      </span>
      <span className="text-[11px] text-text-secondary truncate">{title}</span>
    </div>
  )
}

export default WorkspaceToolbar
