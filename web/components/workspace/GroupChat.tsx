import { useMemo } from 'react'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useTask } from '../../hooks/useTask'
import { useAgents } from '../../hooks/useAgents'
import { useWhiteboard } from '../../hooks/useWhiteboard'
import GroupChatMessage, { type GroupMessage } from './GroupChatMessage'
import GroupChatInput from './GroupChatInput'
import type { ChatMember } from '../workspace/types'
import type { WhiteboardEntry } from '@shared/whiteboard-types'

// v0 group timeline: map whiteboard entries → GroupMessage. We're not (yet)
// merging per-member JSONL streams here — that's a separate hook (deferred per
// design risk R1). Whiteboard already aggregates the "what matters" signals
// (handoff / progress / decision / error / open_question) across all members
// of a chat, so it gives the group view real content immediately.
const formatTime = (iso: string): string => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const entryToGroupMessage = (
  entry: WhiteboardEntry,
  membersByAgent: Record<string, ChatMember>,
  agentNames: Record<string, string>,
): GroupMessage | null => {
  const member = membersByAgent[entry.by]
  const agentName = agentNames[entry.by] ?? entry.by
  const agentRole: 'lead' | 'worker' | undefined = member?.role
  const time = formatTime(entry.timestamp)
  switch (entry.type) {
    case 'goal':
      return { type: 'system', text: `Goal: ${entry.summary}`, time }
    case 'handoff':
      return { type: 'handoff', text: entry.summary, time }
    case 'progress':
      return { type: 'progress', agent: agentName, agentId: entry.by, agentRole, text: entry.summary }
    case 'decision':
      return { type: 'msg', agent: agentName, agentId: entry.by, agentRole, text: `Decision: ${entry.summary}` }
    case 'open_question':
      return { type: 'waiting', agent: agentName, agentId: entry.by, agentRole, text: entry.summary }
    case 'artifact':
      return { type: 'done', agent: agentName, agentId: entry.by, agentRole, text: entry.summary, meta: 'artifact' }
    case 'constraint':
      return { type: 'msg', agent: agentName, agentId: entry.by, agentRole, text: `Constraint: ${entry.summary}` }
    default:
      return null
  }
}

const GroupChat = () => {
  const { activeChatId } = useWorkspace()
  const { chat, members } = useTask(activeChatId)
  const { agentNames } = useAgents()
  const { goal, active: whiteboardEntries } = useWhiteboard(activeChatId ?? undefined)

  const membersByAgent = useMemo<Record<string, ChatMember>>(
    () => Object.fromEntries(members.map((m) => [m.agentId, m])),
    [members],
  )

  const messages = useMemo<GroupMessage[]>(() => {
    const ordered = goal ? [goal, ...whiteboardEntries] : whiteboardEntries
    const sorted = ordered.slice().sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
    return sorted
      .map((e) => entryToGroupMessage(e, membersByAgent, agentNames))
      .filter((m): m is GroupMessage => m !== null)
  }, [goal, whiteboardEntries, membersByAgent, agentNames])

  if (!chat) {
    return (
      <div className="flex-1 flex items-center justify-center text-[11px] text-text-muted">
        No task selected.
      </div>
    )
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 ? (
          <div className="text-center text-[10px] text-text-muted py-6">
            No activity yet. Send a message below to start.
          </div>
        ) : (
          messages.map((msg, i) => (
            <GroupChatMessage key={i} msg={msg} />
          ))
        )}
      </div>
      <GroupChatInput members={members} agentNames={agentNames} />
    </div>
  )
}

export default GroupChat
