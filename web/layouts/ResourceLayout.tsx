import { Outlet, useParams } from 'react-router-dom'
import { WorkspaceProvider, useWorkspace } from '../contexts/WorkspaceContext'
import TaskSidebar from '../components/workspace/TaskSidebar'
import NewChatFullDialog from '../components/chat/modals/NewChatFullDialog'

/** Resource shell — same TaskSidebar chrome as the workspace view, but with
 *  the right pane delegated to a nested page via <Outlet />. Used for routes
 *  that show settings/agents/skills/etc. without an active task. */
const ResourceLayoutInner = () => {
  const { panelCollapsed, workspaceId, newTaskOpen, newTaskWorkspaceId, openNewTask, closeNewTask } = useWorkspace()

  return (
    <div className="flex h-screen bg-bg-primary overflow-hidden">
      <TaskSidebar collapsed={panelCollapsed} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Outlet />
      </div>
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

const ResourceLayout = () => {
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  return (
    <WorkspaceProvider workspaceId={workspaceId ?? null} activeChatId={null}>
      <ResourceLayoutInner />
    </WorkspaceProvider>
  )
}

export default ResourceLayout
