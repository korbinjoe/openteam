import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { API_BASE, authFetch } from '@/config/api'

interface WorkspaceConfig {
  projectId: string
  projectName: string
  primaryAgentId: string
  teamAgentIds: string[]
  rootDirectory: string
  createdAt: string
}

interface Task {
  id: string
  type: string
  title: string
  status: string
  priority: string
  assignedTo?: string
  dependencies: string[]
  createdAt: string
  updatedAt: string
}

interface AgentSession {
  agentId: string
  agentName: string
  status: string
  currentTask?: string
  lastHeartbeatAt?: string
  history: {
    missionsCompleted: number
    missionsFailed: number
    lastActiveAt?: string
  }
}

import './MultiAgentPanel.css'

const PanelCard = ({ title, extra, className, children }: {
  title: string
  extra?: React.ReactNode
  className?: string
  children: React.ReactNode
}) => (
  <div className={cn('rounded-md border border-border bg-bg-secondary', className)}>
    <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
      <span className="text-xs font-semibold text-text-primary">{title}</span>
      {extra && <div className="flex items-center gap-2">{extra}</div>}
    </div>
    <div className="p-3">{children}</div>
  </div>
)

const StatusTag = ({ children, color }: { children: React.ReactNode; color?: string }) => {
  const colorClass = color === 'red'
    ? 'bg-red-500/10 text-red-400 border-red-500/20'
    : color === 'blue'
      ? 'bg-accent-brand/10 text-accent-brand border-accent-brand/20'
      : color === 'green'
        ? 'bg-green-500/10 text-green-400 border-green-500/20'
        : 'bg-bg-tertiary text-text-secondary border-border-subtle'
  return (
    <span className={cn('inline-block rounded border px-1.5 py-0.5 text-xs', colorClass)}>
      {children}
    </span>
  )
}

const MultiAgentPanel = () => {
  const { t } = useTranslation(['settings', 'common'])
  const [workspace, setWorkspace] = useState<WorkspaceConfig | null>(null)
  const [tasks, setTasks] = useState<Task[]>([])
  const [sessions, setSessions] = useState<AgentSession[]>([])
  const [loadingWorkspace, setLoadingWorkspace] = useState(false)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [scheduling, setScheduling] = useState(false)

  const loadWorkspace = async () => {
    setLoadingWorkspace(true)
    try {
      const res = await authFetch(`${API_BASE}/api/multi-agent/workspace`)
      if (res.status === 404) {
        setWorkspace(null)
      } else {
        const data = await res.json()
        setWorkspace(data)
      }
    } catch {
      toast.error(t('settings:multiAgent.loadWorkspaceFailed'))
    } finally {
      setLoadingWorkspace(false)
    }
  }

  const initWorkspace = async () => {
    setLoadingWorkspace(true)
    try {
      const res = await authFetch(`${API_BASE}/api/multi-agent/workspace/init`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || t('settings:multiAgent.initFailed'))
      toast.success(t('settings:multiAgent.workspaceInitialized'))
      await loadWorkspace()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:multiAgent.initWorkspaceFailed'))
    } finally {
      setLoadingWorkspace(false)
    }
  }

  const loadTasks = async () => {
    setLoadingTasks(true)
    try {
      const res = await authFetch(`${API_BASE}/api/multi-agent/tasks`)
      const data: Task[] = await res.json()
      setTasks(data)
    } catch {
      toast.error(t('settings:multiAgent.loadTasksFailed'))
    } finally {
      setLoadingTasks(false)
    }
  }

  const loadSessions = async () => {
    setLoadingSessions(true)
    try {
      const res = await authFetch(`${API_BASE}/api/multi-agent/sessions`)
      const data: AgentSession[] = await res.json()
      setSessions(data)
    } catch {
      toast.error(t('settings:multiAgent.loadSessionsFailed'))
    } finally {
      setLoadingSessions(false)
    }
  }

  const triggerSchedule = async () => {
    setScheduling(true)
    try {
      const res = await authFetch(`${API_BASE}/api/multi-agent/schedule`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || t('settings:multiAgent.scheduleFailed'))
      toast.success(t('settings:multiAgent.scheduleDone'))
      await Promise.all([loadTasks(), loadSessions()])
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('settings:multiAgent.triggerScheduleFailed'))
    } finally {
      setScheduling(false)
    }
  }

  useEffect(() => {
    loadWorkspace()
    loadTasks()
    loadSessions()
  }, [])

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Workspace Card */}
      <PanelCard
        title="Workspace"
        extra={
          <>
            <button
              onClick={loadWorkspace}
              disabled={loadingWorkspace}
              className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
              tabIndex={0}
              aria-label={t('common:action.refresh')}
            >
              {loadingWorkspace ? t('settings:multiAgent.loading') : t('common:action.refresh')}
            </button>
            <button
              onClick={initWorkspace}
              disabled={loadingWorkspace}
              className="rounded bg-accent-brand px-2 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50"
              tabIndex={0}
              aria-label={t('settings:multiAgent.initWorkspace')}
            >
              {loadingWorkspace ? t('settings:multiAgent.loading') : t('settings:multiAgent.initWorkspace')}
            </button>
          </>
        }
      >
        {workspace ? (
          <div className="space-y-0.5 text-xs text-text-primary">
            <div>Project ID: {workspace.projectId}</div>
            <div>Project Name: {workspace.projectName}</div>
            <div>Primary: {workspace.primaryAgentId}</div>
            <div>Team: {workspace.teamAgentIds.join(', ')}</div>
            <div>Root: {workspace.rootDirectory}</div>
          </div>
        ) : (
          <div className="text-xs text-text-secondary">
            {t('settings:multiAgent.workspaceNotInit')}
          </div>
        )}
      </PanelCard>

      {/* Tasks Card */}
      <PanelCard
        title="Tasks"
        className="min-h-[200px] flex-1"
        extra={
          <>
            <button
              onClick={loadTasks}
              disabled={loadingTasks}
              className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
              tabIndex={0}
              aria-label={t('common:action.refresh')}
            >
              {loadingTasks ? t('settings:multiAgent.loading') : t('common:action.refresh')}
            </button>
            <button
              onClick={triggerSchedule}
              disabled={scheduling}
              className="rounded bg-accent-brand px-2 py-1 text-xs text-white hover:opacity-90 disabled:opacity-50"
              tabIndex={0}
              aria-label={t('settings:multiAgent.triggerSchedule')}
            >
              {scheduling ? t('settings:multiAgent.scheduling') : t('settings:multiAgent.triggerSchedule')}
            </button>
          </>
        }
      >
        {loadingTasks ? (
          <div className="py-4 text-center text-xs text-text-secondary">{t('settings:multiAgent.loading')}</div>
        ) : tasks.length === 0 ? (
          <div className="py-4 text-center text-xs text-text-secondary">{t('settings:multiAgent.noTasks')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-xs text-text-secondary">
                  <th className="w-[180px] pb-2 pr-3 font-medium">{t('settings:multiAgent.tableHeaders.id')}</th>
                  <th className="pb-2 pr-3 font-medium">{t('settings:multiAgent.tableHeaders.title')}</th>
                  <th className="w-20 pb-2 pr-3 font-medium">{t('settings:multiAgent.tableHeaders.type')}</th>
                  <th className="w-20 pb-2 pr-3 font-medium">{t('settings:multiAgent.tableHeaders.status')}</th>
                  <th className="w-20 pb-2 pr-3 font-medium">{t('settings:multiAgent.tableHeaders.priority')}</th>
                  <th className="w-[120px] pb-2 pr-3 font-medium">{t('settings:multiAgent.tableHeaders.assignedTo')}</th>
                  <th className="w-[160px] pb-2 font-medium">{t('settings:multiAgent.tableHeaders.dependencies')}</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id} className="border-b border-border-subtle last:border-0">
                    <td className="py-1.5 pr-3 text-text-secondary">{task.id}</td>
                    <td className="py-1.5 pr-3 text-text-primary">{task.title}</td>
                    <td className="py-1.5 pr-3 text-text-secondary">{task.type}</td>
                    <td className="py-1.5 pr-3"><StatusTag>{task.status}</StatusTag></td>
                    <td className="py-1.5 pr-3">
                      <StatusTag color={task.priority === 'high' ? 'red' : task.priority === 'medium' ? 'blue' : undefined}>
                        {task.priority}
                      </StatusTag>
                    </td>
                    <td className="py-1.5 pr-3 text-text-secondary">{task.assignedTo || '-'}</td>
                    <td className="py-1.5 text-text-secondary">{task.dependencies?.length ? task.dependencies.join(', ') : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>

      {/* Agent Sessions Card */}
      <PanelCard
        title={t('settings:multiAgent.agentSessions')}
        className="min-h-[200px] flex-1"
        extra={
          <button
            onClick={loadSessions}
            disabled={loadingSessions}
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary disabled:opacity-50"
            tabIndex={0}
            aria-label={t('common:action.refresh')}
          >
            {loadingSessions ? t('settings:multiAgent.loading') : t('common:action.refresh')}
          </button>
        }
      >
        {loadingSessions ? (
          <div className="py-4 text-center text-xs text-text-secondary">{t('settings:multiAgent.loading')}</div>
        ) : sessions.length === 0 ? (
          <div className="py-4 text-center text-xs text-text-secondary">{t('settings:multiAgent.noSessions')}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border-subtle text-xs text-text-secondary">
                  <th className="w-[140px] pb-2 pr-3 font-medium">{t('settings:multiAgent.tableHeaders.agent')}</th>
                  <th className="w-[140px] pb-2 pr-3 font-medium">{t('settings:multiAgent.tableHeaders.name')}</th>
                  <th className="w-20 pb-2 pr-3 font-medium">{t('settings:multiAgent.tableHeaders.status')}</th>
                  <th className="w-[180px] pb-2 pr-3 font-medium">{t('settings:multiAgent.tableHeaders.currentTask')}</th>
                  <th className="w-[120px] pb-2 font-medium">{t('settings:multiAgent.tableHeaders.completedFailed')}</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => (
                  <tr key={session.agentId} className="border-b border-border-subtle last:border-0">
                    <td className="py-1.5 pr-3 text-text-secondary">{session.agentId}</td>
                    <td className="py-1.5 pr-3 text-text-primary">{session.agentName}</td>
                    <td className="py-1.5 pr-3">
                      <StatusTag color={session.status === 'idle' ? 'green' : session.status === 'busy' ? 'blue' : undefined}>
                        {session.status}
                      </StatusTag>
                    </td>
                    <td className="py-1.5 pr-3 text-text-secondary">{session.currentTask || '-'}</td>
                    <td className="py-1.5 text-text-secondary">{session.history.missionsCompleted}/{session.history.missionsFailed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>
    </div>
  )
}

export default MultiAgentPanel
