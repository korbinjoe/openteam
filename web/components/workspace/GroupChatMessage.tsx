import { useWorkspace } from '../../contexts/WorkspaceContext'

export interface GroupMessage {
  type: 'system' | 'handoff' | 'start' | 'msg' | 'tool' | 'done' | 'error' | 'waiting' | 'progress'
  text: string
  agent?: string
  agentId?: string
  agentRole?: 'lead' | 'worker'
  meta?: string
  time?: string
}

interface GroupChatMessageProps {
  msg: GroupMessage
}

const GroupChatMessage = ({ msg }: GroupChatMessageProps) => {
  const { selectAgent } = useWorkspace()

  if (msg.type === 'system') {
    return (
      <div className="text-center my-3">
        <span className="text-[10px] text-text-muted px-2.5 py-[3px] rounded border border-border bg-white/[0.02]">
          {msg.text}
        </span>
      </div>
    )
  }

  if (msg.type === 'handoff') {
    return (
      <div className="flex items-center gap-2 my-2.5 px-2.5 py-1.5 rounded-md bg-accent-brand/[0.04] border border-accent-brand/10">
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="rgb(var(--accent-brand))" strokeWidth="2" strokeLinecap="round">
          <path d="M5 12h14" /><polyline points="12 5 19 12 12 19" />
        </svg>
        <span className="text-[10px] text-accent-brand-light flex-1">{msg.text}</span>
        {msg.time && <span className="font-mono text-[10px] text-text-muted">{msg.time}</span>}
      </div>
    )
  }

  if (msg.type === 'start') {
    return (
      <div className="flex items-center gap-1.5 my-2 mt-3">
        <AgentAvatar agent={msg.agent} role={msg.agentRole} onClick={() => msg.agentId && selectAgent(msg.agentId)} />
        <span
          className="text-[10px] font-semibold text-text-secondary cursor-pointer"
          onClick={() => msg.agentId && selectAgent(msg.agentId)}
        >
          {msg.agent}
        </span>
        <span className="text-[10px] text-text-muted">joined</span>
      </div>
    )
  }

  if (msg.type === 'msg') {
    return (
      <div className="flex items-start gap-2 my-1.5">
        <AgentAvatar agent={msg.agent} role={msg.agentRole} onClick={() => msg.agentId && selectAgent(msg.agentId)} />
        <div className="flex-1">
          <span
            className="text-[10px] font-semibold text-text-secondary cursor-pointer"
            onClick={() => msg.agentId && selectAgent(msg.agentId)}
          >
            {msg.agent}
          </span>
          <div className="text-[11px] text-text-primary leading-relaxed mt-0.5">{msg.text}</div>
        </div>
      </div>
    )
  }

  if (msg.type === 'tool') {
    return (
      <div className="flex items-center gap-2 ml-[26px] my-0.5 text-[10px] text-text-muted">
        <span className="text-accent-yellow">⚡</span>
        <span className="text-text-secondary">{msg.agent}</span>
        <span>{msg.text}</span>
        {msg.meta && <span className="text-text-muted">({msg.meta})</span>}
      </div>
    )
  }

  if (msg.type === 'done') {
    return (
      <div className="flex items-center gap-2 ml-[26px] my-0.5 text-[10px]">
        <span className="text-accent-green">✓</span>
        <span className="text-text-secondary">{msg.agent}</span>
        <span className="text-text-muted">{msg.text}</span>
        {msg.meta && <span className="text-accent-green">{msg.meta}</span>}
      </div>
    )
  }

  if (msg.type === 'error') {
    return (
      <div className="flex items-start gap-2 my-2">
        <AgentAvatar agent={msg.agent} role={msg.agentRole} onClick={() => msg.agentId && selectAgent(msg.agentId)} />
        <div className="flex-1 p-2 px-2.5 rounded-md bg-accent-red/[0.04] border border-accent-red/[0.12]">
          <div className="text-[10px] font-semibold text-text-secondary mb-[3px]">{msg.agent}</div>
          <div className="text-[11px] text-accent-red">✗ {msg.text}</div>
        </div>
      </div>
    )
  }

  if (msg.type === 'waiting') {
    return (
      <div className="flex items-start gap-2 my-2">
        <AgentAvatar agent={msg.agent} role={msg.agentRole} onClick={() => msg.agentId && selectAgent(msg.agentId)} />
        <div className="flex-1 p-2 px-2.5 rounded-md bg-accent-yellow/[0.04] border border-accent-yellow/[0.12]">
          <div className="text-[10px] font-semibold text-text-secondary mb-[3px]">
            {msg.agent} <span className="text-[10px] font-normal text-accent-yellow">needs your input</span>
          </div>
          <div className="text-[11px] text-text-primary">"{msg.text}"</div>
          <div className="flex gap-1.5 mt-1.5">
            <button className="px-2.5 py-1 rounded border border-border bg-accent-brand/[0.06] text-accent-brand-light text-[10px] cursor-pointer">
              Reply
            </button>
            <button
              className="px-2.5 py-1 rounded border border-border bg-transparent text-text-secondary text-[10px] cursor-pointer"
              onClick={() => msg.agentId && selectAgent(msg.agentId)}
            >
              Open 1:1
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (msg.type === 'progress') {
    return (
      <div className="flex items-center gap-2 ml-[26px] my-1 text-[10px]">
        <span className="w-[5px] h-[5px] rounded-full bg-accent-brand animate-pulse" />
        <span className="text-text-secondary">{msg.agent}</span>
        <span className="text-accent-brand-light">{msg.text}</span>
      </div>
    )
  }

  return null
}

const AgentAvatar = ({ agent, role, onClick }: { agent?: string; role?: string; onClick: () => void }) => {
  const isLead = role === 'lead'
  return (
    <div
      className={`w-[22px] h-[22px] rounded flex items-center justify-center cursor-pointer mt-0.5 flex-shrink-0 ${isLead ? 'bg-accent-purple/10' : 'bg-accent-brand/[0.08]'}`}
      onClick={onClick}
    >
      <span className={`text-[11px] font-bold ${isLead ? 'text-accent-purple' : 'text-accent-brand-light'}`}>
        {(agent || '?').charAt(0).toUpperCase()}
      </span>
    </div>
  )
}

export default GroupChatMessage
