import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
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

// V2 resource page wrappers — workspace-aware page bodies inside the V2 chrome.
const ResourceAgentsPage = lazy(() => import('./pages/ResourcePages').then((m) => ({ default: m.ResourceAgentsPage })))
const ResourceAgentEditorPage = lazy(() => import('./pages/ResourcePages').then((m) => ({ default: m.ResourceAgentEditorPage })))
const ResourceCronJobsPage = lazy(() => import('./pages/ResourcePages').then((m) => ({ default: m.ResourceCronJobsPage })))
const ResourceWorkspacesPage = lazy(() => import('./pages/ResourcePages').then((m) => ({ default: m.ResourceWorkspacesPage })))
const ResourceChatHistoryPage = lazy(() => import('./pages/ResourcePages').then((m) => ({ default: m.ResourceChatHistoryPage })))

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
      <Route path="/demo/mention" element={<MentionInputDemo />} />
      <Route path="/demo/queue" element={<QueuedMessagesBarDemo />} />
      {/* Root redirect → last-visited workspace (or /workspaces if none) */}
      <Route path="/" element={<WorkspaceRedirect />} />
      {/* Workspace shell — nested params drive WorkspaceContext */}
      <Route path="/workspace/:workspaceId" element={<WorkspaceLayout />} />
      <Route path="/workspace/:workspaceId/task/:taskId" element={<WorkspaceLayout />} />
      {/* Resource pages — same chrome (TaskSidebar), no active workspace */}
      <Route element={<ResourceLayout />}>
        <Route path="/workspaces" element={<ResourceWorkspacesPage />} />
        <Route path="/agents" element={<ResourceAgentsPage />} />
        <Route path="/agents/:id/edit" element={<ResourceAgentEditorPage />} />
        <Route path="/skills" element={<SkillsPage />} />
        <Route path="/cron-jobs" element={<ResourceCronJobsPage />} />
        <Route path="/chats" element={<ResourceChatHistoryPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
        <Route path="/updates" element={<UpdateManagerPage />} />
      </Route>
      {/* Resource pages — workspace-scoped variants share the same chrome */}
      <Route path="/workspace/:workspaceId" element={<ResourceLayout />}>
        <Route path="workspaces" element={<ResourceWorkspacesPage />} />
        <Route path="agents" element={<ResourceAgentsPage />} />
        <Route path="agents/:id/edit" element={<ResourceAgentEditorPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="cron-jobs" element={<ResourceCronJobsPage />} />
        <Route path="chats" element={<ResourceChatHistoryPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="updates" element={<UpdateManagerPage />} />
      </Route>
    </Routes>
  </Suspense>
)

export default App
