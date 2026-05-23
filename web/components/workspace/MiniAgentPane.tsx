import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAgents } from '../../hooks/useAgents'
import { cn } from '../../lib/utils'
import { buildTaskUrl } from './urls'
import { buildTaskOpenUrl } from './TaskSessionRows'
import { Maximize } from './icons'
import type { Chat, ChatMember } from '../workspace/types'

type AgentStatus = 'running' | 'waiting' | 'error' | 'done' | 'idle'

interface MiniAgentPaneProps {
  /** Real chat — when supplied, the pane derives all display from it (chat-quad mode). */
  chat?: Chat
  /** Member-quad mode: pane represents a single agent within `parentChat`. */
  member?: ChatMember
  parentChat?: Chat
  /** Fallback display when no real chat is available (used by empty quad slots). */
  agentId?: string
  agentName?: string
  status?: AgentStatus
  role?: 'lead' | 'worker'
  shortcutKey?: string
  messages?: { type: string; text: string; meta?: string }[]
}

const memberStatusToAgent = (s: ChatMember['status']): AgentStatus => {
  if (s === 'idle') return 'idle'
  return s
}

const taskStatusOf = (chat: Chat): AgentStatus => {
  const taskStatus = (chat as Chat & { taskStatus?: string }).taskStatus
  if (taskStatus === 'error') return 'error'
  if (taskStatus === 'waiting_input' || taskStatus === 'waiting_confirm') return 'waiting'
  if (chat.status === 'running' || taskStatus === 'running') return 'running'
  return 'done'
}

const statusDotColor = (s: AgentStatus): string => {
  if (s === 'error') return 'bg-accent-red'
  if (s === 'waiting') return 'bg-accent-yellow'
  if (s === 'running') return 'bg-accent-brand'
  return 'bg-text-muted'
}

const statusBorderColor = (s: AgentStatus): string => {
  if (s === 'error') return 'border-accent-red/40'
  if (s === 'waiting') return 'border-accent-yellow/40'
  return 'border-border-subtle'
}

// Left stripe — high-urgency stripe for waiting/error so user can locate
// "what needs me" within < 0.5s when returning from being away (pulse-mode)
const statusStripeColor = (s: AgentStatus): string | null => {
  if (s === 'error') return 'bg-accent-red'
  if (s === 'waiting') return 'bg-accent-yellow'
  return null
}

const relativeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

const MiniAgentPane = ({ chat, member, parentChat, agentId, agentName, status, role, shortcutKey, messages = [] }: MiniAgentPaneProps) => {
  const { workspaceId, activeChatId, selectedAgentId, selectAgent, setLayoutMode } = useWorkspace()
  const navigate = useNavigate()

  if (member && parentChat) return (
    <MemberBackedPane
      member={member}
      parentChat={parentChat}
      isActive={selectedAgentId === member.agentId && activeChatId === parentChat.id}
      shortcutKey={shortcutKey}
    />
  )

  if (chat) return (
    <ChatBackedPane
      chat={chat}
      isActive={activeChatId === chat.id}
      shortcutKey={shortcutKey}
      onSelect={() => workspaceId && navigate(buildTaskOpenUrl(chat))}
      onZoom={() => {
        if (!workspaceId) return
        navigate(buildTaskOpenUrl(chat))
        setLayoutMode('single')
      }}
    />
  )

  // Legacy prop-driven mode kept for empty placeholder slots
  const effectiveStatus = status ?? 'done'
  const stripeColor = statusStripeColor(effectiveStatus)
  const isSelected = !!agentId && selectedAgentId === agentId

  return (
    <div className="bg-bg-primary flex flex-col overflow-hidden relative">
      {isSelected && <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent-brand z-10" />}
      {stripeColor && <div className={cn('absolute top-0 bottom-0 left-0 w-1', stripeColor)} />}
      <div
        className={cn(
          'h-7 flex items-center px-2 gap-[5px] border-b bg-bg-tertiary cursor-pointer flex-shrink-0',
          statusBorderColor(effectiveStatus),
          stripeColor && 'pl-3',
        )}
        onClick={() => agentId && selectAgent(agentId)}
        onDoubleClick={() => { if (agentId) { selectAgent(agentId); setLayoutMode('split') } }}
      >
        <span className={cn('w-1.5 h-1.5 rounded-full', statusDotColor(effectiveStatus), effectiveStatus === 'running' && 'animate-pulse')} />
        <span className={cn(
          'text-[12px] flex-1',
          isSelected ? 'font-semibold text-accent-brand-light' : 'font-medium text-text-primary',
          effectiveStatus === 'error' && 'text-accent-red',
          effectiveStatus === 'waiting' && 'text-accent-yellow',
        )}>
          {agentName ?? 'Agent'}
        </span>
        {role === 'lead' && (
          <span className="text-[10px] px-1 rounded-sm bg-accent-purple/10 text-accent-purple font-bold">LEAD</span>
        )}
        {shortcutKey && (
          <span className="font-mono text-[10px] text-text-muted">⌘{shortcutKey}</span>
        )}
      </div>

      <div className={cn(
        'flex-1 py-1.5 pr-2 font-mono text-[11px] leading-relaxed text-text-secondary overflow-hidden',
        stripeColor ? 'pl-3' : 'pl-2',
      )}>
        {messages.slice(-4).map((msg, i) => (
          <MiniMessage key={i} msg={msg} />
        ))}
      </div>
    </div>
  )
}

const ChatBackedPane = ({ chat, isActive, shortcutKey, onSelect, onZoom }: {
  chat: Chat
  isActive: boolean
  shortcutKey?: string
  onSelect: () => void
  onZoom: () => void
}) => {
  const status = taskStatusOf(chat)
  const stripeColor = statusStripeColor(status)
  const lastActivity = chat.lastMessageAt ? relativeAgo(chat.lastMessageAt) : null

  return (
    <div className="group bg-bg-primary flex flex-col overflow-hidden relative">
      {isActive && <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent-brand z-10" />}
      {stripeColor && <div className={cn('absolute top-0 bottom-0 left-0 w-1', stripeColor)} />}
      <div
        className={cn(
          'h-7 flex items-center px-2 gap-[5px] border-b bg-bg-tertiary cursor-pointer flex-shrink-0',
          statusBorderColor(status),
          stripeColor && 'pl-3',
        )}
        onClick={onSelect}
        onDoubleClick={onZoom}
        title={`${chat.title} · double-click to zoom`}
      >
        <span className={cn('w-1.5 h-1.5 rounded-full', statusDotColor(status), status === 'running' && 'animate-pulse')} />
        <span className={cn(
          'text-[12px] flex-1 truncate',
          isActive ? 'font-semibold text-accent-brand-light' : 'font-medium text-text-primary',
          status === 'error' && 'text-accent-red',
          status === 'waiting' && 'text-accent-yellow',
        )}>
          {chat.title}
        </span>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onZoom() }}
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

      <div className={cn(
        'flex-1 px-2.5 py-2 flex flex-col gap-1.5 text-text-secondary overflow-hidden',
        stripeColor && 'pl-3',
      )}>
        <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
          <span className="font-mono text-text-secondary">{chat.primaryAgentId}</span>
          {chat.model && <span className="font-mono text-text-muted">· {chat.model}</span>}
        </div>
        {status === 'waiting' && (
          <div className="px-1.5 py-1 rounded bg-accent-yellow/[0.06] border border-accent-yellow/15 text-[11px] text-accent-yellow">
            ⚠ Awaiting your input
          </div>
        )}
        {status === 'error' && (
          <div className="px-1.5 py-1 rounded bg-accent-red/[0.06] border border-accent-red/15 text-[11px] text-accent-red">
            ✗ Task stopped on error
          </div>
        )}
        {status === 'running' && (
          <div className="flex items-center gap-1.5 text-[11px] text-accent-brand-light">
            <span className="w-1 h-1 rounded-full bg-accent-brand animate-pulse" />
            <span>Running…</span>
          </div>
        )}
        <div className="mt-auto flex items-center gap-2 text-[10px] text-text-muted font-mono tabular-nums">
          {lastActivity && <span>{lastActivity}</span>}
          {chat.totalCost != null && chat.totalCost > 0 && (
            <span>· ${chat.totalCost.toFixed(2)}</span>
          )}
        </div>
      </div>
    </div>
  )
}

const MemberBackedPane = ({ member, parentChat, isActive, shortcutKey }: {
  member: ChatMember
  parentChat: Chat
  isActive: boolean
  shortcutKey?: string
}) => {
  const { workspaceId, setLayoutMode } = useWorkspace()
  const { agentNames } = useAgents()
  const navigate = useNavigate()
  const status = memberStatusToAgent(member.status)
  const stripeColor = statusStripeColor(status)
  const lastActivity = member.lastMessageAt ? relativeAgo(member.lastMessageAt) : null
  const name = agentNames[member.agentId] ?? member.agentId

  const handleSelect = () => {
    if (!workspaceId) return
    navigate(buildTaskUrl(workspaceId, parentChat.id, member.agentId))
  }
  const handleZoom = () => {
    if (!workspaceId) return
    navigate(buildTaskUrl(workspaceId, parentChat.id, member.agentId))
    setLayoutMode('single')
  }

  return (
    <div className="group bg-bg-primary flex flex-col overflow-hidden relative">
      {isActive && <div className="absolute top-0 left-0 right-0 h-0.5 bg-accent-brand z-10" />}
      {stripeColor && <div className={cn('absolute top-0 bottom-0 left-0 w-1', stripeColor)} />}
      <div
        className={cn(
          'h-7 flex items-center px-2 gap-[5px] border-b bg-bg-tertiary cursor-pointer flex-shrink-0',
          statusBorderColor(status),
          stripeColor && 'pl-3',
        )}
        onClick={handleSelect}
        onDoubleClick={handleZoom}
        title={`${name} · double-click to zoom`}
      >
        <span className={cn('w-1.5 h-1.5 rounded-full', statusDotColor(status), status === 'running' && 'animate-pulse')} />
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

      <div className={cn(
        'flex-1 px-2.5 py-2 flex flex-col gap-1.5 text-text-secondary overflow-hidden',
        stripeColor && 'pl-3',
      )}>
        <div className="text-[11px] text-text-muted truncate" title={parentChat.title}>
          in <span className="text-text-secondary">{parentChat.title}</span>
        </div>
        {status === 'waiting' && (
          <div className="px-1.5 py-1 rounded bg-accent-yellow/[0.06] border border-accent-yellow/15 text-[11px] text-accent-yellow">
            ⚠ Awaiting input
          </div>
        )}
        {status === 'error' && (
          <div className="px-1.5 py-1 rounded bg-accent-red/[0.06] border border-accent-red/15 text-[11px] text-accent-red">
            ✗ Stopped on error
          </div>
        )}
        {status === 'running' && (
          <div className="flex items-center gap-1.5 text-[11px] text-accent-brand-light">
            <span className="w-1 h-1 rounded-full bg-accent-brand animate-pulse" />
            <span>Running…</span>
          </div>
        )}
        {member.lastMessage ? (
          <div className="text-[11px] text-text-secondary line-clamp-3" title={member.lastMessage}>
            {member.lastMessage}
          </div>
        ) : (
          <div className="text-[11px] text-text-muted italic">No activity yet</div>
        )}
        <div className="mt-auto flex items-center gap-2 text-[10px] text-text-muted font-mono tabular-nums">
          {lastActivity && <span>{lastActivity}</span>}
        </div>
      </div>
    </div>
  )
}

const MiniMessage = ({ msg }: { msg: { type: string; text: string; meta?: string } }) => {
  if (msg.type === 'done') return <div><span className="text-accent-green">✓</span> {msg.text}</div>
  if (msg.type === 'tool') return <div><span className="text-accent-yellow">⚡</span> {msg.text}</div>
  if (msg.type === 'error') return (
    <div className="mt-1 p-[5px] rounded bg-accent-red/[0.06] border border-accent-red/10 text-accent-red text-[11px]">
      ✗ {msg.text}
    </div>
  )
  if (msg.type === 'waiting') return (
    <div className="mt-1 p-[5px] rounded bg-accent-yellow/[0.06] border border-accent-yellow/10 text-accent-yellow text-[11px]">
      ⚠ {msg.text}
    </div>
  )
  if (msg.type === 'progress') return (
    <div className="text-accent-brand-light mt-[3px]">● {msg.text}</div>
  )
  return null
}

export default MiniAgentPane
