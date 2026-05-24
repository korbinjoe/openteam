import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronRight, Pin, PinOff, Archive, Plus, Trash } from './icons'
import { cn } from '../../lib/utils'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { buildMissionUrl } from './urls'
import { removeAgentFromChat, deleteChatWithJsonl, formatPurgeFailures } from '../../services/chatService'
import type { Chat, ChatMember, ChatMemberStatus } from '../workspace/types'

// Sidebar expansion is intentionally session-local and not persisted: the
// sidebar is a cross-workspace overview, and remembering "everything expanded"
// across reloads buries the signal in noise. Only the currently focused
// mission auto-opens to show its agents; everything else stays collapsed until
// the user explicitly drills in.

// Sidebar row indents. Mission is root; all agents (lead + workers) sit as peers
// directly beneath it. The data model has no parent/child relation between
// agents — `role` only distinguishes lead from worker, so they must render at
// the same indent.
const INDENT_AGENT = 'pl-9'      // 36px — every agent row, peer of "Add Agent"
const INDENT_ADD_AGENT = 'pl-9'  // 36px — peer of agent rows

export const memberStatusDot = (status: ChatMemberStatus | undefined): string => {
  switch (status) {
    case 'running': return 'bg-accent-brand animate-pulse'
    case 'waiting': return 'bg-accent-yellow'
    case 'error': return 'bg-accent-red'
    case 'done': return 'bg-accent-green'
    default: return 'bg-text-muted'
  }
}

// Mission-level dot rolls up from members[] using the same worst-wins priority
// the server uses (MemberAggregator.rollupStatus): error > waiting > running >
// done > idle. This keeps the mission row and the agent rows below it in the
// same color vocabulary — yellow at chat level only when *some* member is in
// `waiting` (i.e. waiting_confirmation), never for the between-turn idle.
const ROLLUP_PRIORITY: ChatMemberStatus[] = ['error', 'waiting', 'running', 'done', 'idle']

export const chatStatusDot = (chat: Chat): string => {
  const members = chat.members ?? []
  if (members.length === 0) {
    // Legacy payload without enriched members[]: fall back to the chat-level
    // running flag. Anything else stays neutral.
    return chat.status === 'running' ? 'bg-accent-brand animate-pulse' : 'bg-text-muted'
  }
  for (const status of ROLLUP_PRIORITY) {
    if (members.some((m) => m.status === status)) return memberStatusDot(status)
  }
  return 'bg-text-muted'
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

// Mission-overview is the cross-agent whiteboard timeline. For chats that never
// wrote whiteboard entries (the vast majority of legacy single-agent chats),
// it renders blank — the user expects to see the actual conversation. Route
// "single-team" chats straight to the agent 1:1 view so JSONL replay kicks in.
// Multi-team chats keep the overview so the user gets the cross-agent rollup.
//
// "Single-team" = declared team has only the primary agent. We deliberately
// IGNORE chat.members and expertSessions-derived ad-hoc participants: a chat
// where the user @-mentioned a code-reviewer mid-conversation is still a
// single-agent mission from a routing perspective — the lead's JSONL is the
// canonical content the user expects to see on reopen. MemberAggregator
// inflates members[] from expertSessions, which would otherwise misclassify
// these legacy chats as multi-agent and strand the user on an empty whiteboard.
export const isSingleAgent = (chat: Chat): boolean => {
  if (chat.teamAgentIds && chat.teamAgentIds.length > 0) return false
  return !!chat.primaryAgentId
}

export const buildMissionOpenUrl = (chat: Chat): string =>
  isSingleAgent(chat)
    ? buildMissionUrl(chat.workspaceId, chat.id, chat.primaryAgentId)
    : buildMissionUrl(chat.workspaceId, chat.id)

interface MissionRowProps {
  chat: Chat
  isSelected: boolean
  agentNames: Record<string, string>
  // togglePin: same callback for pin and unpin (it's a toggle in the hook).
  // The icon and tooltip flip based on `isPinned` so the action reads correctly.
  onPin: () => void
  onArchive: () => void
  onAddAgent: () => void
  isPinned?: boolean
}

export const MissionRow = ({ chat, isSelected, agentNames, onPin, onArchive, onAddAgent, isPinned = false }: MissionRowProps) => {
  const navigate = useNavigate()
  const { selectedAgentId } = useWorkspace()
  // Default collapsed; the selected mission auto-opens to surface its agents.
  // No persistence — each session starts clean.
  const [expanded, setExpanded] = useState<boolean>(isSelected)

  // Navigating to a mission should reveal its agents even if the row was mounted
  // collapsed. We only auto-open (never auto-close) so a user who manually
  // collapses the active mission keeps it collapsed.
  useEffect(() => {
    if (isSelected) setExpanded(true)
  }, [isSelected])

  const toggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    setExpanded((prev) => !prev)
  }, [])

  // Single-agent → agent 1:1 (JSONL replay). Multi-agent → mission-overview (whiteboard rollup).
  const handleOpen = () => navigate(buildMissionOpenUrl(chat))

  const handleDeleteTask = useCallback(async () => {
    if (!window.confirm(
      `Delete mission "${chat.title}" and all its local CLI session files?\n\nThis cannot be undone.`,
    )) return
    try {
      const result = await deleteChatWithJsonl(chat.id)
      const failures = formatPurgeFailures(result.purged)
      if (failures.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('Some JSONL files could not be deleted:\n' + failures.join('\n'))
      }
      window.dispatchEvent(new CustomEvent('openteam:chat-updated', { detail: { chatId: chat.id } }))
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('deleteChatWithJsonl failed', err)
    }
  }, [chat.id, chat.title])

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
        {isPinned && (
          <Pin size={9} className="text-accent-brand flex-shrink-0 -ml-0.5" />
        )}
        <span className="text-[12px] font-medium text-text-primary flex-1 truncate">{chat.title}</span>
        {agentCount > 1 && (
          <span className="font-mono text-[10px] px-1.5 rounded bg-bg-tertiary text-text-secondary tabular-nums flex-shrink-0">
            {agentCount}
          </span>
        )}
        <span
          className="font-mono text-[10px] text-text-muted tabular-nums flex-shrink-0 transition-opacity duration-100 group-hover:opacity-0"
          title={`Created ${new Date(chat.createdAt).toLocaleString()}`}
        >
          {ageLabel(chat.createdAt)}
        </span>
        <RowHoverActions
          actions={[
            { title: 'Add agent', onClick: onAddAgent, children: <Plus size={11} /> },
            isPinned
              ? { title: 'Unpin mission', onClick: onPin, children: <PinOff size={11} /> }
              : { title: 'Pin mission', onClick: onPin, children: <Pin size={11} /> },
            { title: 'Archive mission', onClick: onArchive, children: <Archive size={11} /> },
            { title: 'Delete mission (purges local CLI session files)', onClick: handleDeleteTask, children: <Trash size={11} /> },
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
    navigate(buildMissionUrl(chat.workspaceId, chat.id, agentId))
  }
  // Per-member status when available; fall back to parent chat rollup so legacy
  // payloads (no members[]) still light up.
  const dotClass = member ? memberStatusDot(member.status) : chatStatusDot(chat)
  const ageInput = member?.lastMessageAt ?? chat.lastMessageAt

  // Worker rows: per-agent removal (deletes that agent's session + JSONL).
  // Lead rows: there's no "remove just the lead" operation — semantically
  // deleting the lead == deleting the whole mission, so the Trash on the lead
  // row triggers mission-level deletion. Either way we hide the Trash if the
  // agent is currently running.
  const removable = member?.status !== 'running'
  const handleRemove = useCallback(async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation()
    if (!removable) return
    if (isLead) {
      if (!window.confirm(
        `Delete mission "${chat.title}" and all its local CLI session files?\n\nThis cannot be undone.`,
      )) return
      try {
        const result = await deleteChatWithJsonl(chat.id)
        const failures = formatPurgeFailures(result.purged)
        if (failures.length > 0) {
          // eslint-disable-next-line no-console
          console.warn('Some JSONL files could not be deleted:\n' + failures.join('\n'))
        }
        window.dispatchEvent(new CustomEvent('openteam:chat-updated', { detail: { chatId: chat.id } }))
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('deleteChatWithJsonl failed', err)
      }
      return
    }
    if (!window.confirm(`Remove ${agentName} from this mission and delete its local session file?`)) return
    try {
      const result = await removeAgentFromChat(chat.id, agentId)
      const failures = formatPurgeFailures([result.purged])
      if (failures.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('Failed to purge JSONL:\n' + failures.join('\n'))
      }
      window.dispatchEvent(new CustomEvent('openteam:chat-updated', { detail: { chatId: chat.id } }))
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('removeAgentFromChat failed', err)
    }
  }, [removable, isLead, agentName, chat.id, chat.title, agentId])

  return (
    <div
      onClick={handleOpen}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpen(e as unknown as React.MouseEvent) } }}
      role="button"
      tabIndex={0}
      title={`${agentName}${isLead ? ' · lead' : ''}`}
      className={cn(
        'group relative flex items-center gap-1.5 py-[5px] pr-2 rounded-md transition-colors text-left cursor-pointer',
        INDENT_AGENT,
        isSelected ? 'bg-accent-brand/[0.08]' : 'hover:bg-bg-hover',
      )}
    >
      <span className={cn('w-[6px] h-[6px] rounded-full flex-shrink-0', dotClass)} />
      <span className={cn(
        'text-[11px] truncate flex-1',
        isSelected ? 'text-accent-brand-light font-medium' : 'text-text-secondary',
      )}>
        {agentName}
      </span>
      <span className="font-mono text-[10px] text-text-muted tabular-nums flex-shrink-0 transition-opacity duration-100 group-hover:opacity-0">
        {ageLabel(ageInput)}
      </span>
      {removable && (
        <span
          role="button"
          tabIndex={-1}
          onClick={handleRemove}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleRemove(e) }}
          title={isLead
            ? 'Delete mission (purges local CLI session files)'
            : 'Remove from mission (deletes local session file)'}
          aria-label={isLead ? 'Delete mission' : 'Remove from mission'}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-bg-hover cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity duration-100"
        >
          <Trash size={11} />
        </span>
      )}
    </div>
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
  const handleOpen = () => navigate(buildMissionOpenUrl(chat))
  const handleDeleteTask = useCallback(async () => {
    if (!window.confirm(
      `Delete mission "${chat.title}" and all its local CLI session files?\n\nThis cannot be undone.`,
    )) return
    try {
      const result = await deleteChatWithJsonl(chat.id)
      const failures = formatPurgeFailures(result.purged)
      if (failures.length > 0) {
        // eslint-disable-next-line no-console
        console.warn('Some JSONL files could not be deleted:\n' + failures.join('\n'))
      }
      window.dispatchEvent(new CustomEvent('openteam:chat-updated', { detail: { chatId: chat.id } }))
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('deleteChatWithJsonl failed', err)
    }
  }, [chat.id, chat.title])
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
      <span
        className="font-mono text-[10px] text-text-muted tabular-nums flex-shrink-0 transition-opacity duration-100 group-hover:opacity-0"
        title={`Created ${new Date(chat.createdAt).toLocaleString()}`}
      >
        {ageLabel(chat.createdAt)}
      </span>
      <RowHoverActions
        actions={[
          { title: 'Pin mission', onClick: onPin, children: <Pin size={11} /> },
          ...(onUnarchive ? [{ title: 'Restore from archive', onClick: onUnarchive, children: <Archive size={11} /> }] : []),
          { title: 'Delete mission (purges local CLI session files)', onClick: handleDeleteTask, children: <Trash size={11} /> },
        ]}
      />
    </button>
  )
}

export interface RowAction {
  title: string
  onClick: () => void
  children: React.ReactNode
}

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

export const RowHoverActions = ({ actions }: { actions: RowAction[] }) => (
  <span className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100 bg-bg-secondary/95 backdrop-blur-sm rounded px-0.5">
    <ActionButtons actions={actions} />
  </span>
)

export const RowEndSlotWithLabel = ({ label, actions }: { label: React.ReactNode; actions: RowAction[] }) => (
  <span className="relative flex items-center justify-end ml-auto min-w-[36px] flex-shrink-0">
    <span className="text-[10px] text-text-muted transition-opacity duration-100 group-hover:opacity-0">{label}</span>
    <span className="absolute right-0 top-1/2 -translate-y-1/2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-100">
      <ActionButtons actions={actions} />
    </span>
  </span>
)
