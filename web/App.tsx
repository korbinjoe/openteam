import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { ElectronNavigator } from './components/ElectronNavigator'
import WorkspaceRedirect from './components/workspace/WorkspaceRedirect'

const WorkspaceLayout = lazy(() => import('./layouts/WorkspaceLayout'))
const ResourceLayout = lazy(() => import('./layouts/ResourceLayout'))

const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const UpdateManagerPage = lazy(() => import('./pages/UpdateManagerPage'))
const MentionInputDemo = lazy(() => import('./pages/MentionInputDemo'))
const QueuedMessagesBarDemo = lazy(() => import('./pages/QueuedMessagesBarDemo'))
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'))

const AgentsHubPage = lazy(() => import('./pages/AgentsHubPage'))
const AgentEditorPage = lazy(() => import('./pages/AgentEditorPage'))
const CronJobsPage = lazy(() => import('./pages/CronJobsPage'))
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage'))
const ChatHistoryPage = lazy(() => import('./pages/ChatHistoryPage'))

const RouteFallback = () => (
  <div style={{
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'rgb(var(--text-muted))',
    fontSize: 13,
  }}
  >
    Loading...
  </div>
)

const App = () => (
  <Suspense fallback={<RouteFallback />}>
    <ElectronNavigator />
    <Routes>
      <Route path="/auth/callback" element={<AuthCallbackPage />} />
      {import.meta.env.DEV && (
        <>
          <Route path="/demo/mention" element={<MentionInputDemo />} />
          <Route path="/demo/queue" element={<QueuedMessagesBarDemo />} />
        </>
      )}
      {/* Root redirect → last-visited workspace (or /workspaces if none) */}
      <Route path="/" element={<WorkspaceRedirect />} />
      {/* Workspace shell — nested params drive WorkspaceContext */}
      <Route path="/workspace/:workspaceId" element={<WorkspaceLayout />} />
      <Route path="/workspace/:workspaceId/mission/:missionId" element={<WorkspaceLayout />} />
      {/* Resource pages — single canonical top-level URL per page. */}
      <Route element={<ResourceLayout />}>
        <Route path="/workspaces" element={<WorkspacesPage />} />
        <Route path="/agents" element={<AgentsHubPage />} />
        <Route path="/agents/:id/edit" element={<AgentEditorPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/cron-jobs" element={<CronJobsPage />} />
        <Route path="/missions" element={<ChatHistoryPage />} />
        {/* "chat" is the storage primitive; "mission" is the user-facing name (ADR-2). */}
        <Route path="/tasks" element={<Navigate to="/missions" replace />} />
        <Route path="/chats" element={<Navigate to="/missions" replace />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/updates" element={<UpdateManagerPage />} />
      </Route>
      {/* Backward-compatible redirects for the legacy workspace-scoped variants.
       *  Every removed path lands on its canonical top-level URL so existing
       *  bookmarks keep working. */}
      <Route path="/workspace/:workspaceId/workspaces" element={<Navigate to="/workspaces" replace />} />
      <Route path="/workspace/:workspaceId/agents" element={<Navigate to="/agents" replace />} />
      <Route path="/workspace/:workspaceId/agents/:id/edit" element={<LegacyAgentEditorRedirect />} />
      <Route path="/workspace/:workspaceId/skills" element={<Navigate to="/skills" replace />} />
      <Route path="/workspace/:workspaceId/cron-jobs" element={<Navigate to="/cron-jobs" replace />} />
      <Route path="/workspace/:workspaceId/chats" element={<Navigate to="/missions" replace />} />
      <Route path="/workspace/:workspaceId/tasks" element={<Navigate to="/missions" replace />} />
      <Route path="/workspace/:workspaceId/missions" element={<Navigate to="/missions" replace />} />
      <Route path="/workspace/:workspaceId/settings" element={<Navigate to="/settings" replace />} />
      <Route path="/workspace/:workspaceId/admin" element={<Navigate to="/admin" replace />} />
      <Route path="/workspace/:workspaceId/updates" element={<Navigate to="/updates" replace />} />
      {/* Legacy per-task URL → preserve id under the new mission URL. */}
      <Route path="/workspace/:workspaceId/task/:taskId" element={<LegacyMissionRedirect />} />
    </Routes>
  </Suspense>
)

/** /workspace/:wsId/agents/:id/edit → /agents/:id/edit (preserves the agent id). */
const LegacyAgentEditorRedirect = () => {
  const { id } = useParams<{ id: string }>()
  return <Navigate to={id ? `/agents/${id}/edit` : '/agents'} replace />
}

/** /workspace/:wsId/task/:taskId → /workspace/:wsId/mission/:taskId. */
const LegacyMissionRedirect = () => {
  const { workspaceId, taskId } = useParams<{ workspaceId: string; taskId: string }>()
  if (!workspaceId || !taskId) return <Navigate to="/" replace />
  return <Navigate to={`/workspace/${workspaceId}/mission/${taskId}`} replace />
}

export default App
