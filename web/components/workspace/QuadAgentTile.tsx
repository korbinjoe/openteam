import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import ChatInstance from '../chat/ChatInstance'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAgents } from '../../hooks/useAgents'
import { cn } from '../../lib/utils'
import { buildMissionUrl } from './urls'
import { Maximize } from './icons'
import type { Chat, ChatMember } from './types'

type AgentStatus = 'running' | 'waiting' | 'waiting_input' | 'error' | 'done' | 'idle'

const memberStatus = (s: ChatMember['status']): AgentStatus => (s === 'idle' ? 'idle' : s)

const dotColor = (s: AgentStatus): string => {
  if (s === 'error') return 'bg-accent-red'
  if (s === 'waiting') return 'bg-accent-yellow'
  if (s === 'waiting_input') return 'bg-accent-yellow/60'
  if (s === 'running') return 'bg-accent-brand'
  return 'bg-text-muted'
}

const stripeColor = (s: AgentStatus): string | null => {
  if (s === 'error') return 'bg-accent-red'
  if (s === 'waiting') return 'bg-accent-yellow'
  if (s === 'waiting_input') return 'bg-accent-yellow/60'
  return null
}

interface Props {
  member: ChatMember
  parentChat: Chat
  shortcutKey?: string
}

/** Quad cell: a real ChatInstance scoped to one agent of the active mission.
 *  Uses ChatInstance.agentScopeOverride to lock the conversation to this member,
 *  independent of the workspace-level selectedAgentId. */
const QuadAgentTile = ({ member, parentChat, shortcutKey }: Props) => {
  const { workspaceId, activeChatId, selectedAgentId, setLayoutMode } = useWorkspace()
  const { agentNames } = useAgents()
  const navigate = useNavigate()

  const status = memberStatus(member.status)
  const stripe = stripeColor(status)
  const isActive = selectedAgentId === member.agentId && activeChatId === parentChat.id
  const name = agentNames[member.agentId] ?? member.agentId

  const handleFocus = useCallback(() => {
    if (!workspaceId) return
    navigate(buildMissionUrl(workspaceId, parentChat.id, member.agentId))
  }, [workspaceId, parentChat.id, member.agentId, navigate])

  const handleZoom = useCallback(() => {
    if (!workspaceId) return
    navigate(buildMissionUrl(workspaceId, parentChat.id, member.agentId))
    setLayoutMode('single')
  }, [workspaceId, parentChat.id, member.agentId, navigate, setLayoutMode])

  if (!workspaceId || !activeChatId) return null

  return (
    <div
      className="group bg-bg-primary flex flex-col overflow-hidden relative"
      onMouseDown={(e) => {
        // Single-click on the header focuses; clicks inside the chat body still bubble
        // up to ChatInstance's own handlers, so this won't steal text selection there.
        if ((e.target as HTMLElement).closest('[data-quad-header]')) return
      }}
    >
      {isActive && <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent-brand z-10 pointer-events-none" />}
      {stripe && <div className={cn('absolute top-0 bottom-0 left-0 w-1 z-10 pointer-events-none', stripe)} />}

      <div
        data-quad-header
        className={cn(
          'h-7 flex items-center px-2 gap-[5px] border-b border-border-subtle bg-bg-tertiary cursor-pointer flex-shrink-0',
          stripe && 'pl-3',
        )}
        onClick={handleFocus}
        onDoubleClick={handleZoom}
        title={`${name} · double-click to zoom`}
      >
        <span className={cn('w-1.5 h-1.5 rounded-full', dotColor(status), status === 'running' && 'animate-pulse')} />
        <span className={cn(
          'text-[12px] flex-1 truncate',
          isActive ? 'font-semibold text-accent-brand-light' : 'font-medium text-text-primary',
          status === 'error' && 'text-accent-red',
          status === 'waiting' && 'text-accent-yellow',
        )}>
          {name}
        </span>
        {member.role === 'lead' && (
          <span className="text-[10px] px-1 rounded-sm bg-accent-purple/10 text-accent-purple font-bold">LEAD</span>
        )}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleZoom() }}
          aria-label="Zoom to single layout"
          title="Zoom (double-click anywhere)"
          className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-bg-hover text-text-muted hover:text-text-secondary"
        >
          <Maximize size={11} />
        </button>
        {shortcutKey && (
          <span className="font-mono text-[10px] text-text-muted">⌘{shortcutKey}</span>
        )}
      </div>

      <div className={cn('flex-1 min-h-0 overflow-hidden', stripe && 'pl-1')}>
        <ChatInstance
          key={`${parentChat.id}:${member.agentId}`}
          chatId={parentChat.id}
          workspaceId={workspaceId}
          isActive={isActive}
          hideRightPanel
          agentScopeOverride={member.agentId}
        />
      </div>
    </div>
  )
}

export default QuadAgentTile
