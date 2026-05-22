import { useWorkspace } from '../../contexts/WorkspaceContext'
import { Square } from './icons'
import type { ChatMember } from '../workspace/types'

interface GroupChatInputProps {
  members: ChatMember[]
  agentNames: Record<string, string>
}

const GroupChatInput = ({ members, agentNames }: GroupChatInputProps) => {
  const { taskChatTargetIndex, cycleTargetAgent } = useWorkspace()
  const target = members.length > 0 ? members[taskChatTargetIndex % members.length] : undefined
  const targetName = target ? (agentNames[target.agentId] ?? target.agentId) : '?'

  return (
    <div className="px-3 py-2 border-t border-border-subtle flex items-center gap-1.5 flex-shrink-0">
      <div className="flex-1 flex items-center gap-1.5 px-3 py-2 rounded-[7px] border border-border bg-bg-tertiary">
        <button
          type="button"
          className="text-[11px] text-accent-brand-light font-semibold cursor-pointer px-1.5 py-px rounded-[3px] bg-accent-brand/[0.08] whitespace-nowrap disabled:opacity-50"
          onClick={() => cycleTargetAgent(members.length)}
          disabled={members.length === 0}
          title={members.length > 1 ? 'Click to switch target agent' : 'Single member — nothing to switch'}
        >
          @{targetName}
        </button>
        <input
          className="flex-1 bg-transparent border-none outline-none text-xs text-text-primary font-sans placeholder:text-text-muted"
          placeholder={target ? `Message ${targetName}…` : 'No members in this task'}
          disabled={!target}
        />
        <span className="font-mono text-[10px] text-text-muted">↵</span>
      </div>
      <button
        type="button"
        className="w-7 h-7 rounded-md border border-accent-red/20 bg-accent-red/[0.06] flex items-center justify-center cursor-pointer"
        title="Stop"
      >
        <Square size={9} className="text-accent-red" />
      </button>
    </div>
  )
}

export default GroupChatInput
