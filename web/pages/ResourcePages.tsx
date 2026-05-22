import { useParams } from 'react-router-dom'
import AgentsHubPage from './AgentsHubPage'
import AgentEditorPage from './AgentEditorPage'
import CronJobsPage from './CronJobsPage'
import WorkspacesPage from './WorkspacesPage'
import ChatHistoryPage from './ChatHistoryPage'

/** Thin wrappers around shared page bodies that pass workspace-aware route
 *  prefixes so internal navigation (open chat / open workspace / edit agent)
 *  stays inside the active workspace context when present. */

const WS_PREFIX = '/workspace'

const buildAgentsPrefix = (workspaceId: string | undefined): string =>
  workspaceId ? `${WS_PREFIX}/${workspaceId}/agents` : '/agents'

const buildHome = (workspaceId: string | undefined): string =>
  workspaceId ? `${WS_PREFIX}/${workspaceId}` : '/'

export const ResourceAgentsPage = () => {
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  return <AgentsHubPage agentsRoutePrefix={buildAgentsPrefix(workspaceId)} />
}

export const ResourceAgentEditorPage = () => {
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  return <AgentEditorPage agentsRoutePrefix={buildAgentsPrefix(workspaceId)} />
}

export const ResourceCronJobsPage = () => (
  <CronJobsPage workspaceRoutePrefix={WS_PREFIX} chatSegment="task" />
)

export const ResourceWorkspacesPage = () => (
  <WorkspacesPage workspaceRoutePrefix={WS_PREFIX} />
)

export const ResourceChatHistoryPage = () => {
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  return (
    <ChatHistoryPage
      workspaceRoutePrefix={WS_PREFIX}
      homePath={buildHome(workspaceId)}
      chatSegment="task"
    />
  )
}
