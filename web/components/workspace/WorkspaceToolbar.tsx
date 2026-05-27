import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useWorkspaceChats } from '../../hooks/useWorkspaceChats'
import { useAgents } from '../../hooks/useAgents'
import LayoutControls from './LayoutControls'
import { UsersGroup, ChevronRight } from './icons'
import { cn } from '../../lib/utils'
import { buildMissionUrl, buildWorkspaceUrl } from './urls'
import { memberStatusDot } from './MissionSessionRows'
import type { Chat, ChatMember } from '../workspace/types'

// Unified workspace bar — replaces the old 38px Toolbar + 28px StatusBar pair.
// Layout: [crumb · chat info] · flex spacer · [layout][ide]
// Terminal button lives inside WebIDEPanel's tab bar (the only IDE-column header).

const WorkspaceToolbar = () => {
  const { viewMode, workspaceId, activeChatId } = useWorkspace()
  const navigate = useNavigate()

  const handleGoHome = () => {
    if (!workspaceId) return
    navigate(buildWorkspaceUrl(workspaceId))
  }

  if (!activeChatId) {
    return (
      <div className="h-8 border-b border-border-subtle flex items-center px-3 gap-2 flex-shrink-0 bg-bg-tertiary">
        <span className="text-[11px] font-semibold text-text-secondary">OpenTeam</span>
        <ChevronRight size={11} className="text-text-muted flex-shrink-0" />
        <span className="text-[11px] font-medium text-text-secondary">Home</span>
        <span className="flex-1" />
      </div>
    )
  }

  return (
    <div className="h-8 border-b border-border-subtle flex items-center px-3 gap-2 flex-shrink-0 bg-bg-tertiary">
      <BrandCrumb onClick={handleGoHome} />
      <ChevronRight size={11} className="text-text-muted flex-shrink-0" />
      {viewMode === 'mission-overview' ? <MissionInfoBar /> : <ActiveChatInfoBar />}

      <span className="flex-1" />

      <LayoutControls />
    </div>
  )
}

const BrandCrumb = ({ onClick }: { onClick: () => void }) => (
  <button
    type="button"
    onClick={onClick}
    className="text-[11px] font-semibold text-text-secondary hover:text-text-primary transition-colors"
  >
    OpenTeam
  </button>
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
    return <span className="text-[11px] text-text-muted">No mission selected</span>
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
    navigate(buildMissionUrl(workspaceId, chat.id))
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
            navigate(buildMissionUrl(workspaceId, chat.id, agentId))
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

const MissionInfoBar = () => {
  const { workspaceId, selectedMissionId } = useWorkspace()
  const { chats } = useWorkspaceChats(workspaceId)
  const chat = selectedMissionId ? chats.find((c) => c.id === selectedMissionId) : undefined
  const title = chat?.title ?? selectedMissionId ?? 'No mission selected'

  return (
    <div className="flex items-center gap-2">
      <UsersGroup size={12} className="text-accent-brand" />
      <span className="text-xs font-semibold text-text-primary">Mission Chat</span>
      <span className="text-[10px] px-1.5 py-0.5 rounded-[3px] bg-accent-purple/10 text-accent-purple font-semibold">
        GROUP
      </span>
      <span className="text-[11px] text-text-secondary truncate">{title}</span>
    </div>
  )
}

export default WorkspaceToolbar
