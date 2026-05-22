import { useParams } from 'react-router-dom'
import AgentsHubPage from '../AgentsHubPage'
import AgentEditorPage from '../AgentEditorPage'
import SkillsPage from '../SkillsPage'
import CronJobsPage from '../CronJobsPage'
import WorkspacesPage from '../WorkspacesPage'
import ChatHistoryPage from '../ChatHistoryPage'
import SettingsPage from '../SettingsPage'

/** V2 thin wrappers around V1 pages that pass V2-aware route prefixes so
 *  internal navigation (open chat / open workspace / edit agent) stays inside
 *  the /v2/* tree instead of escaping back to V1 MainLayout. */

const V2_WS_PREFIX = '/v2/workspace'

const buildAgentsPrefix = (workspaceId: string | undefined): string =>
  workspaceId ? `${V2_WS_PREFIX}/${workspaceId}/agents` : '/v2/agents'

const buildHome = (workspaceId: string | undefined): string =>
  workspaceId ? `${V2_WS_PREFIX}/${workspaceId}` : '/v2'

export const V2AgentsPage = () => {
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  return <AgentsHubPage agentsRoutePrefix={buildAgentsPrefix(workspaceId)} />
}

export const V2AgentEditorPage = () => {
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  return <AgentEditorPage agentsRoutePrefix={buildAgentsPrefix(workspaceId)} />
}

export const V2SkillsPage = () => <SkillsPage />

export const V2CronJobsPage = () => (
  <CronJobsPage workspaceRoutePrefix={V2_WS_PREFIX} chatSegment="task" />
)

export const V2WorkspacesPage = () => (
  <WorkspacesPage workspaceRoutePrefix={V2_WS_PREFIX} />
)

export const V2ChatHistoryPage = () => {
  const { workspaceId } = useParams<{ workspaceId?: string }>()
  return (
    <ChatHistoryPage
      workspaceRoutePrefix={V2_WS_PREFIX}
      homePath={buildHome(workspaceId)}
      chatSegment="task"
    />
  )
}

export const V2SettingsPage = () => <SettingsPage />
