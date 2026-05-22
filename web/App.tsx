import { lazy, Suspense } from 'react'
import { Routes, Route } from 'react-router-dom'
import MainLayout from './layouts/MainLayout'
import { ElectronNavigator } from './components/ElectronNavigator'
import V2WorkspaceRedirect, { V2ChatToTaskRedirect } from './components/workspace-v2/V2WorkspaceRedirect'

const WorkspaceLayout = lazy(() => import('./layouts/WorkspaceLayout'))
const V2ResourceLayout = lazy(() => import('./layouts/V2ResourceLayout'))

const ChatPage = lazy(() => import('./pages/ChatPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const ChatTabContainer = lazy(() => import('./components/chat/ChatTabContainer'))
const AgentsHubPage = lazy(() => import('./pages/AgentsHubPage'))
const AgentEditorPage = lazy(() => import('./pages/AgentEditorPage'))
const WorkspacesPage = lazy(() => import('./pages/WorkspacesPage'))
const SkillsPage = lazy(() => import('./pages/SkillsPage'))
const WorkspaceDetailPage = lazy(() => import('./pages/WorkspaceDetailPage'))
const ChatHistoryPage = lazy(() => import('./pages/ChatHistoryPage'))
const CronJobsPage = lazy(() => import('./pages/CronJobsPage'))
const AdminPage = lazy(() => import('./pages/AdminPage'))
const UpdateManagerPage = lazy(() => import('./pages/UpdateManagerPage'))
const MentionInputDemo = lazy(() => import('./pages/MentionInputDemo'))
const QueuedMessagesBarDemo = lazy(() => import('./pages/QueuedMessagesBarDemo'))
const AuthCallbackPage = lazy(() => import('./pages/AuthCallbackPage'))

// V2 resource page wrappers — reuse V1 page bodies inside V2 chrome.
const V2AgentsPage = lazy(() => import('./pages/v2/V2ResourcePages').then((m) => ({ default: m.V2AgentsPage })))
const V2AgentEditorPage = lazy(() => import('./pages/v2/V2ResourcePages').then((m) => ({ default: m.V2AgentEditorPage })))
const V2SkillsPage = lazy(() => import('./pages/v2/V2ResourcePages').then((m) => ({ default: m.V2SkillsPage })))
const V2CronJobsPage = lazy(() => import('./pages/v2/V2ResourcePages').then((m) => ({ default: m.V2CronJobsPage })))
const V2WorkspacesPage = lazy(() => import('./pages/v2/V2ResourcePages').then((m) => ({ default: m.V2WorkspacesPage })))
const V2ChatHistoryPage = lazy(() => import('./pages/v2/V2ResourcePages').then((m) => ({ default: m.V2ChatHistoryPage })))
const V2SettingsPage = lazy(() => import('./pages/v2/V2ResourcePages').then((m) => ({ default: m.V2SettingsPage })))

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
      {/* V2 workspace — nested params drive WorkspaceContext */}
      <Route path="/v2" element={<V2WorkspaceRedirect />} />
      <Route path="/v2/workspace/:workspaceId" element={<WorkspaceLayout />} />
      <Route path="/v2/workspace/:workspaceId/task/:taskId" element={<WorkspaceLayout />} />
      {/* Back-compat: redirect old /chat/:chatId URLs to /task/:taskId */}
      <Route path="/v2/workspace/:workspaceId/chat/:taskId" element={<V2ChatToTaskRedirect />} />
      {/* V2 resource pages — same chrome (TaskSidebar), V1 page bodies, V2-aware nav */}
      <Route element={<V2ResourceLayout />}>
        <Route path="/v2/workspaces" element={<V2WorkspacesPage />} />
        <Route path="/v2/agents" element={<V2AgentsPage />} />
        <Route path="/v2/agents/:id/edit" element={<V2AgentEditorPage />} />
        <Route path="/v2/skills" element={<V2SkillsPage />} />
        <Route path="/v2/cron-jobs" element={<V2CronJobsPage />} />
        <Route path="/v2/chats" element={<V2ChatHistoryPage />} />
        <Route path="/v2/settings" element={<V2SettingsPage />} />
      </Route>
      <Route path="/v2/workspace/:workspaceId" element={<V2ResourceLayout />}>
        <Route path="workspaces" element={<V2WorkspacesPage />} />
        <Route path="agents" element={<V2AgentsPage />} />
        <Route path="agents/:id/edit" element={<V2AgentEditorPage />} />
        <Route path="skills" element={<V2SkillsPage />} />
        <Route path="cron-jobs" element={<V2CronJobsPage />} />
        <Route path="chats" element={<V2ChatHistoryPage />} />
        <Route path="settings" element={<V2SettingsPage />} />
      </Route>
      <Route path="/" element={<MainLayout />}>
        <Route index element={<ChatTabContainer />} />
        {/* Chats */}
        <Route path="chats" element={<ChatHistoryPage />} />
        {/* Workspaces */}
        <Route path="workspaces" element={<WorkspacesPage />} />
        <Route path="workspace/:workspaceId" element={<WorkspaceDetailPage />} />
        <Route path="workspace/:workspaceId/chat/:chatId?" element={<ChatPage />} />
        {/* Agent management */}
        <Route path="agents" element={<AgentsHubPage />} />
        <Route path="agents/:id/edit" element={<AgentEditorPage />} />
        <Route path="skills" element={<SkillsPage />} />
        <Route path="cron-jobs" element={<CronJobsPage />} />
        {/* Teams — single-team model, no separate builder */}
        {/* Other */}
        <Route path="admin" element={<AdminPage />} />
        <Route path="updates" element={<UpdateManagerPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  </Suspense>
)

export default App
