import MessageToolbar, { hasMultipleAgents } from './messages/MessageToolbar'
import type { AgentActivity } from '@/types/chat'
import type { AgentPersonality } from '@/types/agentConfig'

interface ChatPaneToolbarRowProps {
  filterAgentId: string | null
  onFilterAgentChange: (agentId: string | null) => void
  agentNames: Record<string, string>
  agentPersonalities?: Record<string, AgentPersonality>
  expertActivities?: Record<string, AgentActivity>
  activeAgentIds?: string[]
}

/**
 * Pane-local toolbar row rendered above ChatBody in message mode.
 * Hosts MessageToolbar's agent filter chips. Returns null for
 * single-agent chats so the pane doesn't carry an empty chrome row.
 */
const ChatPaneToolbarRow = ({
  filterAgentId,
  onFilterAgentChange,
  agentNames,
  agentPersonalities,
  expertActivities,
  activeAgentIds,
}: ChatPaneToolbarRowProps) => {
  const showChips = hasMultipleAgents(agentNames, activeAgentIds)
  if (!showChips) return null

  return (
    <div className="flex items-center gap-2 px-3 py-1 border-b border-border-subtle/50">
      <div className="flex-1 min-w-0 overflow-x-auto">
        <MessageToolbar
          filterAgentId={filterAgentId}
          onFilterAgentChange={onFilterAgentChange}
          agentNames={agentNames}
          agentPersonalities={agentPersonalities}
          expertActivities={expertActivities}
          activeAgentIds={activeAgentIds}
        />
      </div>
    </div>
  )
}

export default ChatPaneToolbarRow
