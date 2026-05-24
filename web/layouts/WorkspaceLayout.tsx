import { useEffect, useMemo } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { WorkspaceProvider, useWorkspace } from '../contexts/WorkspaceContext'
import { buildTaskUrl } from '../components/workspace/urls'
import { isSingleAgent } from '../components/workspace/TaskSessionRows'
import { useChatTabs } from '../contexts/ChatTabContext'
import { useWorkspaceChats } from '../hooks/useWorkspaceChats'
import TaskSidebar from '../components/workspace/TaskSidebar'
import WorkspaceToolbar from '../components/workspace/WorkspaceToolbar'
import WorkspaceContent from '../components/workspace/WorkspaceContent'
import CommandPalette from '../components/workspace/CommandPalette'
import AddAgentPicker from '../components/workspace/AddAgentPicker'
import NewChatFullDialog from '../components/chat/modals/NewChatFullDialog'
import { persistLastWorkspace } from '../components/workspace/WorkspaceRedirect'
import useResponsiveLayout from '../components/workspace/useResponsiveLayout'

const WorkspaceLayoutInner = () => {
  const {
    workspaceId,
    activeChatId,
    selectedAgentId,
    panelCollapsed,
    commandPaletteOpen,
    addAgentOpen,
    newTaskOpen,
    newTaskWorkspaceId,
    openCommandPalette,
    closeCommandPalette,
    closeAddAgent,
    openNewTask,
    closeNewTask,
    cycleLayoutMode,
    togglePanel,
    toggleTerminal,
    toggleIde,
  } = useWorkspace()
  const { openTab } = useChatTabs()
  const navigate = useNavigate()
  const { chats, running, awaitingReview } = useWorkspaceChats(workspaceId)

  useResponsiveLayout()

  // Mirror /chat/:chatId into the global ChatTabContext so ChatInstance can mount
  // when V2 chat-aware panes (S2/S3) start consuming activeTabId.
  useEffect(() => {
    if (workspaceId && activeChatId) openTab(activeChatId, workspaceId)
  }, [workspaceId, activeChatId, openTab])

  // URL normalization: a task URL without ?agent= renders task-overview (whiteboard).
  // For single-agent chats the whiteboard is empty by design, so the page looks
  // blank when arrived at via direct link / bookmark / refresh. Redirect to the
  // agent 1:1 view so JSONL replay kicks in. Navigation entry points apply the
  // same rule; this catches the URL-as-entrypoint case.
  useEffect(() => {
    if (!workspaceId || !activeChatId || selectedAgentId) return
    const chat = chats.find((c) => c.id === activeChatId)
    if (!chat || !isSingleAgent(chat)) return
    navigate(buildTaskUrl(workspaceId, activeChatId, chat.primaryAgentId), { replace: true })
  }, [workspaceId, activeChatId, selectedAgentId, chats, navigate])

  useEffect(() => {
    if (workspaceId) persistLastWorkspace(workspaceId)
  }, [workspaceId])

  // ⌘1-4 jumps to the quad chats (active first, then awaiting, then running)
  const quickJumpChats = useMemo(() => {
    const ordered: string[] = []
    const seen = new Set<string>()
    const push = (id: string) => { if (!seen.has(id)) { seen.add(id); ordered.push(id) } }
    if (activeChatId) push(activeChatId)
    awaitingReview.forEach((c) => push(c.id))
    running.forEach((c) => push(c.id))
    chats.forEach((c) => push(c.id))
    return ordered.slice(0, 4)
  }, [activeChatId, awaitingReview, running, chats])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey

      if (e.key === 'Escape') {
        if (commandPaletteOpen) closeCommandPalette()
        else if (newTaskOpen) closeNewTask()
        else if (addAgentOpen) closeAddAgent()
        return
      }

      if (!mod) return

      if (e.key === 'k') {
        e.preventDefault()
        openCommandPalette()
      } else if (e.key === 'n') {
        e.preventDefault()
        openNewTask()
      } else if (e.key === '\\') {
        e.preventDefault()
        cycleLayoutMode()
      } else if (e.key === 'b') {
        e.preventDefault()
        togglePanel()
      } else if (e.key === '`') {
        e.preventDefault()
        toggleTerminal()
      } else if (e.key === 'j') {
        e.preventDefault()
        toggleIde()
      } else if (e.key >= '1' && e.key <= '4') {
        const idx = parseInt(e.key) - 1
        const chatId = quickJumpChats[idx]
        if (chatId && workspaceId) {
          e.preventDefault()
          navigate(buildTaskUrl(workspaceId, chatId))
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [
    commandPaletteOpen,
    addAgentOpen,
    newTaskOpen,
    openCommandPalette,
    closeCommandPalette,
    closeAddAgent,
    openNewTask,
    closeNewTask,
    cycleLayoutMode,
    togglePanel,
    toggleTerminal,
    toggleIde,
    quickJumpChats,
    workspaceId,
    navigate,
  ])

  return (
    <div className="flex h-screen bg-bg-primary overflow-hidden">
      <TaskSidebar collapsed={panelCollapsed} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <WorkspaceToolbar />
        <WorkspaceContent />
      </div>
      <CommandPalette />
      <AddAgentPicker />
      <NewChatFullDialog
        open={newTaskOpen}
        onOpenChange={(open) => (open ? openNewTask() : closeNewTask())}
        currentWorkspaceId={newTaskWorkspaceId ?? workspaceId ?? undefined}
        routePrefix="/workspace"
        chatSegment="task"
      />
    </div>
  )
}

const WorkspaceLayout = () => {
  const { workspaceId, taskId } = useParams<{ workspaceId?: string; taskId?: string }>()
  const [searchParams] = useSearchParams()
  const agentId = searchParams.get('agent')
  return (
    <WorkspaceProvider
      workspaceId={workspaceId ?? null}
      activeChatId={taskId ?? null}
      selectedAgentId={agentId}
    >
      <WorkspaceLayoutInner />
    </WorkspaceProvider>
  )
}

export default WorkspaceLayout
