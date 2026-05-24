import { Outlet, useParams } from 'react-router-dom'
import { WorkspaceProvider, useWorkspace } from '../contexts/WorkspaceContext'
import MissionSidebar from '../components/workspace/MissionSidebar'
import NewChatFullDialog from '../components/chat/modals/NewChatFullDialog'

/** Resource shell — same MissionSidebar chrome as the workspace view, but with
 *  the right pane delegated to a nested page via <Outlet />. Used for routes
 *  that show settings/agents/skills/etc. without an active mission. */
const ResourceLayoutInner = () => {
  const { panelCollapsed, workspaceId, newMissionOpen, newMissionWorkspaceId, openNewMission, closeNewMission } = useWorkspace()

  return (
    <div className="flex h-screen bg-bg-primary overflow-hidden">
      <MissionSidebar collapsed={panelCollapsed} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Outlet />
      </div>
      <NewChatFullDialog
        open={newMissionOpen}
        onOpenChange={(open) => (open ? openNewMission() : closeNewMission())}
        currentWorkspaceId={newMissionWorkspaceId ?? workspaceId ?? undefined}
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
