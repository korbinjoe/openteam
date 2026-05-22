import { useWorkspace } from '../../contexts/WorkspaceContext'
import ChatInstance from '../chat/ChatInstance'
import { useWorkspaceChats } from '../../hooks/useWorkspaceChats'

const ChatPane = () => {
  const { workspaceId, activeChatId, ideMountNode } = useWorkspace()
  const { chats } = useWorkspaceChats(workspaceId)

  if (!workspaceId) {
    return <EmptyState title="No workspace" hint="Open a workspace to start working." />
  }

  if (!activeChatId) {
    return (
      <EmptyState
        title="No task selected"
        hint={chats.length > 0
          ? 'Pick a task from the sidebar — or press ⌘N to dispatch a new one.'
          : 'Press ⌘N to dispatch your first task.'}
      />
    )
  }

  // Mount the real V1 ChatInstance. When V2 IDEPanel has registered a mount node,
  // ChatInstance portals RightPanel into it; otherwise it's hidden (War Room tab,
  // no chat active, IDE collapsed without a target).
  return (
    <ChatInstance
      key={activeChatId}
      chatId={activeChatId}
      workspaceId={workspaceId}
      isActive
      hideRightPanel
      rightPanelMountNode={ideMountNode}
    />
  )
}

const EmptyState = ({ title, hint }: { title: string; hint: string }) => (
  <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
    <div className="text-sm font-medium text-text-secondary mb-1">{title}</div>
    <div className="text-xs text-text-muted max-w-sm leading-relaxed">{hint}</div>
  </div>
)

export default ChatPane
