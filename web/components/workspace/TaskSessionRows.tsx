import { useCallback, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Pin, PinOff, Archive, Plus } from './icons'
import { cn } from '../../lib/utils'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { buildTaskUrl } from './urls'
import type { Chat, ChatMember, ChatMemberStatus } from '../workspace/types'

export const TASK_EXPANDED_KEY = 'openteam:v2-task-expanded'

// Sidebar row indents. Task is root; agents nest under it via larger left padding.
// Keep these in sync — they form the visual hierarchy (task > lead > sub).
const INDENT_AGENT_LEAD = 'pl-9'          // 36px — lead agent under task title
const INDENT_AGENT_SUB = 'pl-[52px]'      // 52px — sub-agent under lead (deeper indent)
const INDENT_ADD_AGENT = 'pl-9'           // 36px — peer of lead agent
const CONNECTOR_LEFT_CLASS = 'left-[30px]' // vertical tree line for sub-agents

export const loadMap = (key: string): Record<string, boolean> => {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

export const saveMap = (key: string, map: Record<string, boolean>) => {
  try { localStorage.setItem(key, JSON.stringify(map)) } catch { /* quota */ }
}

export const chatStatusDot = (chat: Chat): string => {
  if (chat.status === 'running') return 'bg-accent-brand animate-pulse'
  const taskStatus = (chat as Chat & { taskStatus?: string }).taskStatus
  if (taskStatus === 'error') return 'bg-accent-red'
  if (taskStatus === 'waiting_input' || taskStatus === 'waiting_confirm') return 'bg-accent-yellow'
  return 'bg-text-muted'
}

export const memberStatusDot = (status: ChatMemberStatus | undefined): string => {
  switch (status) {
    case 'running': return 'bg-accent-brand animate-pulse'
    case 'waiting': return 'bg-accent-yellow'
    case 'error': return 'bg-accent-red'
    case 'done': return 'bg-accent-green'
    default: return 'bg-text-muted'
  }
}

export const ageLabel = (input: number | string | undefined): string => {
  if (!input) return ''
  const ts = typeof input === 'string' ? new Date(input).getTime() : input
  if (!ts || Number.isNaN(ts)) return ''
  const diff = Date.now() - ts
  const m = Math.floor(diff / 60_000)
  if (m < 1) return 'now'
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  return `${d}d`
}

export const isCompletedStatus = (c: Chat) => c.status === 'stopped' || c.status === 'merged'

// Task-overview is the cross-agent whiteboard timeline. For chats that never
// wrote whiteboard entries (the vast majority of legacy single-agent chats),
// it renders blank — the user expects to see the actual conversation. Route
// "single-team" chats straight to the agent 1:1 view so JSONL replay kicks in.
// Multi-team chats keep the overview so the user gets the cross-agent rollup.
//
// "Single-team" = declared team has only the primary agent. We deliberately
// IGNORE chat.members and expertSessions-derived ad-hoc participants: a chat
// where the user @-mentioned a code-reviewer mid-conversation is still a
// single-agent task from a routing perspective — the lead's JSONL is the
// canonical content the user expects to see on reopen. MemberAggregator
// inflates members[] from expertSessions, which would otherwise misclassify
// these legacy chats as multi-agent and strand the user on an empty whiteboard.
export const isSingleAgent = (chat: Chat): boolean => {
  if (chat.teamAgentIds && chat.teamAgentIds.length > 0) return false
  return !!chat.primaryAgentId
}

export const buildTaskOpenUrl = (chat: Chat): string =>
  isSingleAgent(chat)
    ? buildTaskUrl(chat.workspaceId, chat.id, chat.primaryAgentId)
    : buildTaskUrl(chat.workspaceId, chat.id)

const loadTaskExpandedMap = (): Record<string, boolean> => loadMap(TASK_EXPANDED_KEY)

interface TaskRowProps {
  chat: Chat
  isSelected: boolean
  agentNames: Record<string, string>
  onPin: () => void
  onArchive: () => void
  onAddAgent: () => void
}

export const TaskRow = ({ chat, isSelected, agentNames, onPin, onArchive, onAddAgent }: TaskRowProps) => {
  const navigate = useNavigate()
  const { selectedAgentId } = useWorkspace()
  const [expanded, setExpanded] = useState<boolean>(() => loadTaskExpandedMap()[chat.id] ?? true)

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded((prev) => {
      const next = !prev
      const map = loadTaskExpandedMap()
      map[chat.id] = next
      saveMap(TASK_EXPANDED_KEY, map)
      return next
    })
  }, [chat.id])

  // Single-agent → agent 1:1 (JSONL replay). Multi-agent → task-overview (whiteboard rollup).
  const handleOpen = () => navigate(buildTaskOpenUrl(chat))

  // Prefer server-derived members (carries per-agent status). Fall back to the
  // teamAgentIds shape when the API hasn't enriched yet (legacy callers, race).
  const members = useMemo<Array<{ agentId: string; isLead: boolean; member?: ChatMember }>>(() => {
    if (chat.members && chat.members.length > 0) {
      return chat.members.map((m) => ({ agentId: m.agentId, isLead: m.role === 'lead', member: m }))
    }
    const ids: string[] = [chat.primaryAgentId, ...(chat.teamAgentIds || [])]
    const seen = new Set<string>()
    return ids
      .filter((id) => {
        if (!id || seen.has(id)) return false
        seen.add(id)
        return true
      })
      .map((id, idx) => ({ agentId: id, isLead: idx === 0 }))
  }, [chat.members, chat.primaryAgentId, chat.teamAgentIds])

  const agentCount = members.length

  return (
    <div className="flex flex-col">
      <div
        onClick={handleOpen}
        title={chat.title}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen() } }}
        className={cn(
          'group relative flex items-center gap-[7px] pl-1.5 pr-2 py-1.5 rounded-md cursor-pointer transition-colors',
          isSelected && !selectedAgentId ? 'bg-accent-brand/[0.08]' : 'hover:bg-bg-hover',
        )}
      >
        <button
          onClick={toggle}
          className="w-4 h-4 flex items-center justify-center text-text-muted hover:text-text-secondary -mr-0.5 flex-shrink-0"
          title={expanded ? 'Collapse agents' : 'Expand agents'}
          aria-label={expanded ? 'Collapse agents' : 'Expand agents'}
        >
          <ChevronRight size={9} className={cn('transition-transform', expanded && 'rotate-90')} />
        </button>
        <span className={cn('w-[7px] h-[7px] rounded-full flex-shrink-0', chatStatusDot(chat))} />
        <span className="text-xs font-medium text-text-primary flex-1 truncate">{chat.title}</span>
        {agentCount > 1 && (
          <span className="font-mono text-[10px] px-1.5 rounded bg-bg-tertiary text-text-secondary tabular-nums flex-shrink-0">
            {agentCount}
          </span>
        )}
        <RowHoverActions
          actions={[
            { title: 'Add agent', onClick: onAddAgent, children: <Plus size={11} /> },
            { title: 'Pin task', onClick: onPin, children: <Pin size={11} /> },
            { title: 'Archive task', onClick: onArchive, children: <Archive size={11} /> },
          ]}
        />
      </div>

      {expanded && (
        <div className="flex flex-col">
          {members.map(({ agentId, isLead, member }) => (
            <AgentRow
              key={agentId}
              agentId={agentId}
              agentName={agentNames[agentId] ?? agentId}
              isLead={isLead}
              chat={chat}
              member={member}
              isSelected={isSelected && selectedAgentId === agentId}
            />
          ))}
          <button
            onClick={(e) => { e.stopPropagation(); onAddAgent() }}
            className={cn('flex items-center gap-1.5 pr-2 py-1 rounded-md hover:bg-bg-hover transition-colors text-left', INDENT_ADD_AGENT)}
          >
            <Plus size={11} className="text-text-muted" />
            <span className="text-[11px] text-text-muted">Add Agent</span>
          </button>
        </div>
      )}
    </div>
  )
}

export const AgentRow = ({ agentId, agentName, isLead, chat, member, isSelected }: {
  agentId: string
  agentName: string
  isLead: boolean
  chat: Chat
  member?: ChatMember
  isSelected: boolean
}) => {
  const navigate = useNavigate()
  // Agent 1:1 navigation: includes ?agent= so viewMode becomes 'agent'.
  const handleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigate(buildTaskUrl(chat.workspaceId, chat.id, agentId))
  }
  // Per-member status when available; fall back to parent chat rollup so legacy
  // payloads (no members[]) still light up.
  const dotClass = member ? memberStatusDot(member.status) : chatStatusDot(chat)
  const ageInput = member?.lastMessageAt ?? chat.lastMessageAt
  return (
    <button
      onClick={handleOpen}
      title={`${agentName}${isLead ? ' · lead' : ''}`}
      className={cn(
        'group relative flex items-center gap-1.5 py-[5px] rounded-md transition-colors text-left',
        isLead ? `${INDENT_AGENT_LEAD} pr-2` : `${INDENT_AGENT_SUB} pr-2`,
        isSelected ? 'bg-accent-brand/[0.08]' : 'hover:bg-bg-hover',
      )}
    >
      {!isLead && (
        <>
          <span className={cn('absolute top-0 bottom-0 w-px bg-border', CONNECTOR_LEFT_CLASS)} aria-hidden />
          <span className="text-[11px] text-text-muted -ml-1 mr-0 flex-shrink-0">↳</span>
        </>
      )}
      <span className={cn('w-[6px] h-[6px] rounded-full flex-shrink-0', dotClass)} />
      {isLead && (
        <LeadStar className={cn('flex-shrink-0', isSelected ? 'text-accent-brand-light' : 'text-text-muted')} />
      )}
      <span className={cn(
        'text-[12px] truncate flex-1',
        isSelected ? 'text-accent-brand-light font-medium' : 'text-text-secondary',
      )}>
        {agentName}
      </span>
      <span className="font-mono text-[11px] text-text-muted tabular-nums flex-shrink-0">
        {ageLabel(ageInput)}
      </span>
    </button>
  )
}

export const PinnedRow = ({ chat, age, isSelected, agentNames, onUnpin, onArchive }: {
  chat: Chat
  age: string
  isSelected: boolean
  agentNames: Record<string, string>
  onUnpin: () => void
  onArchive: () => void
}) => {
  const navigate = useNavigate()
  const handleOpen = () => navigate(buildTaskOpenUrl(chat))
  return (
    <button
      onClick={handleOpen}
      title={`${chat.title} · ${agentNames[chat.primaryAgentId] ?? chat.primaryAgentId}`}
      className={cn(
        'group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors w-full text-left',
        isSelected ? 'bg-accent-brand/[0.08]' : 'hover:bg-bg-hover',
      )}
    >
      <Pin size={11} className="text-accent-brand flex-shrink-0" />
      <span className="text-xs font-medium text-text-primary flex-1 truncate">{chat.title}</span>
      <RowEndSlotWithLabel
        label={age}
        actions={[
          { title: 'Unpin task', onClick: onUnpin, children: <PinOff size={11} /> },
          { title: 'Archive task', onClick: onArchive, children: <Archive size={11} /> },
        ]}
      />
    </button>
  )
}

export const CompletedRow = ({ chat, isSelected, archived, agentNames, onPin, onUnarchive }: {
  chat: Chat
  isSelected: boolean
  archived: boolean
  agentNames: Record<string, string>
  onPin: () => void
  onUnarchive?: () => void
}) => {
  const navigate = useNavigate()
  const handleOpen = () => navigate(buildTaskOpenUrl(chat))
  return (
    <button
      onClick={handleOpen}
      title={`${chat.title} · ${agentNames[chat.primaryAgentId] ?? chat.primaryAgentId}${archived ? ' · archived' : ''}`}
      className={cn(
        'group relative flex items-center gap-2 px-2.5 py-[5px] rounded-md cursor-pointer opacity-60 hover:bg-bg-hover hover:opacity-100 transition-all w-full text-left',
        isSelected && 'bg-accent-brand/[0.08] opacity-100',
      )}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-text-muted flex-shrink-0" />
      <span className="text-[12px] text-text-secondary flex-1 truncate">{chat.title}</span>
      <RowHoverActions
        actions={[
          { title: 'Pin task', onClick: onPin, children: <Pin size={11} /> },
          ...(onUnarchive ? [{ title: 'Restore from archive', onClick: onUnarchive, children: <Archive size={11} /> }] : []),
        ]}
      />
    </button>
  )
}

interface RowAction {
  title: string
  onClick: () => void
  children: React.ReactNode
}

// Filled 5-point star used as a quiet lead marker on AgentRow. Sits inline
// before the agent name — replaces the old colorful LEAD/auto badges.
const LeadStar = ({ className }: { className?: string }) => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className={className} aria-label="Lead">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
)

const ActionButtons = ({ actions }: { actions: RowAction[] }) => (
  <>
    {actions.map((a, i) => (
      <span
        key={i}
        role="button"
        tabIndex={-1}
        onClick={(e) => { e.stopPropagation(); a.onClick() }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.stopPropagation(); e.preventDefault(); a.onClick()
          }
        }}
        title={a.title}
        aria-label={a.title}
        className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover cursor-pointer"
      >
        {a.children}
      </span>
    ))}
  </>
)

const RowHoverActions = ({ actions }: { actions: RowAction[] }) => (
  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100 bg-bg-secondary/95 backdrop-blur-sm rounded px-0.5">
    <ActionButtons actions={actions} />
  </span>
)

const RowEndSlotWithLabel = ({ label, actions }: { label: React.ReactNode; actions: RowAction[] }) => (
  <span className="relative flex items-center justify-end ml-auto min-w-[36px] flex-shrink-0">
    <span className="text-[10px] text-text-muted transition-opacity duration-100 group-hover:opacity-0">{label}</span>
    <span className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
      <ActionButtons actions={actions} />
    </span>
  </span>
)
