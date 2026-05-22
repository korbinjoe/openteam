import { Outlet, useParams } from 'react-router-dom'
import { WorkspaceProvider, useWorkspace } from '../contexts/WorkspaceContext'
import TaskSidebar from '../components/workspace-v2/TaskSidebar'
import NewChatFullDialog from '../components/chat/modals/NewChatFullDialog'

/** V2 resource shell — same TaskSidebar chrome as the workspace view, but with
 *  the right pane delegated to a nested page via <Outlet />. Used for /v2 routes
 *  that show settings/agents/skills/etc. without leaving V2 context. */
const V2ResourceLayoutInner = () => {
  const { panelCollapsed, workspaceId, newTaskOpen, openNewTask, closeNewTask } = useWorkspace()

  return (
    <div className="flex h-screen bg-bg-primary overflow-hidden">
      <TaskSidebar collapsed={panelCollapsed} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Outlet />
      </div>
      <NewChatFullDialog
        open={newTaskOpen}
        onOpenChange={(open) => (open ? openNewTask() : closeNewTask())}
        currentWorkspaceId={workspaceId ?? undefined}
        routePrefix="/v2/workspace"
        chatSegment="task"
      />
    </div>
  )
}

const V2ResourceLayout = () => {
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  return (
    <WorkspaceProvider workspaceId={workspaceId ?? null} activeChatId={null}>
      <V2ResourceLayoutInner />
    </WorkspaceProvider>
  )
}

export default V2ResourceLayout
