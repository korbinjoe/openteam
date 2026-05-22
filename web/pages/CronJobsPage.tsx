import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Plus, Clock, Play, Trash2, ChevronDown, ChevronRight, CheckCircle2, XCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { isElectron, ELECTRON_TITLEBAR_PADDING } from '../utils/env'
import { getWebSocketClient } from '../services/WebSocketClient'
import { authFetch } from '@/config/api'
import CronJobForm, { type CronJobFormData } from '../components/cron/CronJobForm'
import NLInputDialog from '../components/cron/NLInputDialog'
import type { CronJob } from '../types/cron'

interface Workspace {
  id: string
  name: string
}

interface Agent {
  name: string
  description: string
  role: string
}

interface CronJobsPageProps {
  /** Prefix used to build chat-open links. */
  workspaceRoutePrefix?: string
  /** URL segment for the chat/task id. */
  chatSegment?: string
}

const CronJobsPage = ({ workspaceRoutePrefix = '/workspace', chatSegment = 'task' }: CronJobsPageProps = {}) => {
  const { t } = useTranslation(['cron', 'common'])
  const navigate = useNavigate()

  const [jobs, setJobs] = useState<CronJob[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [agents, setAgents] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [nlDialogOpen, setNlDialogOpen] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [editingJob, setEditingJob] = useState<CronJob | null>(null)
  const [prefillData, setPrefillData] = useState<Partial<CronJobFormData> | null>(null)
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null)

  const fetchJobs = useCallback(async () => {
    try {
      const res = await authFetch('/api/cron-jobs')
      if (res.ok) setJobs(await res.json())
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchJobs()
    authFetch('/api/workspaces').then((r) => r.json()).then(setWorkspaces).catch(() => {})
    authFetch('/api/agents').then((r) => r.json()).then(setAgents).catch(() => {})
  }, [fetchJobs])

  useEffect(() => {
    const ws = getWebSocketClient()
    const handleStarted = () => fetchJobs()
    const handleFinished = () => fetchJobs()
    ws.on('cron:job-started', handleStarted)
    ws.on('cron:job-finished', handleFinished)
    return () => {
      ws.off('cron:job-started', handleStarted)
      ws.off('cron:job-finished', handleFinished)
    }
  }, [fetchJobs])

  const handleCreate = async (data: CronJobFormData) => {
    const res = await authFetch('/api/cron-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      toast.success(t('toast.created', { name: data.name }))
      fetchJobs()
    }
  }

  const handleEdit = async (data: CronJobFormData) => {
    if (!editingJob) return
    const res = await authFetch(`/api/cron-jobs/${editingJob.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (res.ok) {
      toast.success(t('toast.updated', { name: data.name }))
      setEditingJob(null)
      fetchJobs()
    }
  }

  const handleToggleEnabled = async (job: CronJob) => {
    const endpoint = job.enabled ? 'disable' : 'enable'
    await authFetch(`/api/cron-jobs/${job.id}/${endpoint}`, { method: 'POST' })
    fetchJobs()
  }

  const handleRunNow = async (job: CronJob) => {
    const res = await authFetch(`/api/cron-jobs/${job.id}/run-now`, { method: 'POST' })
    if (res.ok) {
      toast.success(t('toast.triggered', { name: job.name }))
    } else {
      const err = await res.json().catch(() => ({ error: 'Unknown error' }))
      toast.error(err.error)
    }
  }

  const handleDelete = async (job: CronJob) => {
    if (!window.confirm(t('deleteConfirm', { name: job.name }))) return
    await authFetch(`/api/cron-jobs/${job.id}`, { method: 'DELETE' })
    toast.success(t('toast.deleted', { name: job.name }))
    fetchJobs()
  }

  const formatTrigger = (job: CronJob) => {
    const tr = job.trigger
    if (tr.kind === 'cron') return `cron: ${tr.expression}${tr.timezone ? ` (${tr.timezone})` : ''}`
    if (tr.kind === 'once') return `${t('form.triggerOnce')}: ${new Date(tr.at).toLocaleString()}`
    if (tr.kind === 'interval') {
      const ms = tr.intervalMs
      if (ms >= 86400000) return `${t('form.triggerInterval')}: ${ms / 86400000} ${t('form.days')}`
      if (ms >= 3600000) return `${t('form.triggerInterval')}: ${ms / 3600000} ${t('form.hours')}`
      return `${t('form.triggerInterval')}: ${ms / 60000} ${t('form.minutes')}`
    }
    return ''
  }

  const formatTime = (iso?: string) => {
    if (!iso) return t('neverRun')
    const diff = Date.now() - new Date(iso).getTime()
    const minutes = Math.floor(diff / 60000)
    if (minutes < 1) return t('common:time.justNow')
    if (minutes < 60) return t('common:time.minutesAgo', { count: minutes })
    const hours = Math.floor(minutes / 60)
    if (hours < 24) return t('common:time.hoursAgo', { count: hours })
    return t('common:time.daysAgo', { count: Math.floor(hours / 24) })
  }

  const getWorkspaceName = (id: string) =>
    workspaces.find((ws) => ws.id === id)?.name || id.slice(0, 8)

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-secondary">
        <Loader2 size={20} className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col bg-bg-primary">
      {/* Header */}
      <div
        className="h-9 border-b border-border-subtle flex items-center px-2.5 gap-1.5 shrink-0"
        style={{ paddingLeft: isElectron ? ELECTRON_TITLEBAR_PADDING : 10 }}
      >
        <Clock size={14} className="text-text-emphasis" />
        <span className="text-xs font-semibold text-text-emphasis">{t('title')}</span>
        <span className="flex-1" />
        <button
          onClick={() => { setEditingJob(null); setPrefillData(null); setNlDialogOpen(true) }}
          tabIndex={0}
          aria-label={t('newTask')}
          className="inline-flex items-center gap-1 rounded bg-accent-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Plus size={12} />
          {t('newTask')}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6 max-w-3xl mx-auto w-full">

      {/* Job list */}
      {jobs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-text-secondary">
          <Clock size={40} className="mb-3 opacity-20" />
          <p className="text-sm font-medium mb-1">{t('empty.title')}</p>
          <p className="text-xs mb-4">{t('empty.description')}</p>
          <button
            onClick={() => { setEditingJob(null); setPrefillData(null); setNlDialogOpen(true) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setEditingJob(null); setPrefillData(null); setNlDialogOpen(true) } }}
            tabIndex={0}
            aria-label={t('newTask')}
            className="px-3 py-1.5 text-xs rounded-md bg-accent-brand text-white hover:opacity-90"
          >
            {t('newTask')}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const isExpanded = expandedJobId === job.id
            const lastExec = job.executions[job.executions.length - 1]
            const isRunning = lastExec?.status === 'running'

            return (
              <div key={job.id} className="rounded-lg border border-border bg-bg-secondary/50 overflow-hidden">
                {/* Job header */}
                <div className="px-4 py-3">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary">{job.name}</span>
                      {isRunning && (
                        <span className="flex items-center gap-1 text-xs text-amber-500">
                          <Loader2 size={10} className="animate-spin" />
                          {t('status.running')}
                        </span>
                      )}
                    </div>
                    {/* Enable toggle */}
                    <button
                      onClick={() => handleToggleEnabled(job)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleToggleEnabled(job) }}
                      tabIndex={0}
                      aria-label={job.enabled ? t('disable') : t('enable')}
                      className={cn(
                        'relative w-8 h-[18px] rounded-full transition-colors',
                        job.enabled ? 'bg-emerald-500' : 'bg-border',
                      )}
                    >
                      <span className={cn(
                        'absolute top-0.5 w-3.5 h-3.5 rounded-full bg-white transition-transform',
                        job.enabled ? 'left-[17px]' : 'left-0.5',
                      )} />
                    </button>
                  </div>

                  <div className="text-xs text-text-secondary space-y-0.5">
                    <p>{formatTrigger(job)} · {getWorkspaceName(job.workspaceId)}</p>
                    <p>
                      {t('lastRun')}: {formatTime(job.lastRunAt)}
                      {lastExec && lastExec.status !== 'running' && (
                        <span className={cn('ml-1', lastExec.status === 'success' ? 'text-emerald-500' : 'text-red-500')}>
                          {lastExec.status === 'success' ? '✓' : '✗'}
                        </span>
                      )}
                      <span className="mx-1.5">·</span>
                      {t('nextRun')}: {job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : t('neverRun')}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 mt-2">
                    <button
                      onClick={() => setExpandedJobId(isExpanded ? null : job.id)}
                      onKeyDown={(e) => { if (e.key === 'Enter') setExpandedJobId(isExpanded ? null : job.id) }}
                      tabIndex={0}
                      aria-label={t('executions')}
                      className="flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
                    >
                      {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                      {t('executions')} ({job.executions.length})
                    </button>
                    <div className="flex-1" />
                    <ActionButton
                      onClick={() => { setEditingJob(job); setFormOpen(true) }}
                      label={t('common:action.edit')}
                    />
                    <ActionButton
                      onClick={() => handleRunNow(job)}
                      label={t('runNow')}
                      icon={<Play size={11} />}
                    />
                    <ActionButton
                      onClick={() => handleDelete(job)}
                      label={t('common:action.delete')}
                      icon={<Trash2 size={11} />}
                      danger
                    />
                  </div>
                </div>

                {/* Execution history */}
                {isExpanded && (
                  <div className="border-t border-border-subtle bg-bg-primary/50">
                    {job.executions.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-text-secondary">{t('noExecutions')}</p>
                    ) : (
                      [...job.executions].reverse().map((exec) => (
                        <div key={exec.id} className="flex items-center gap-3 px-4 py-2 text-xs border-b border-border-subtle last:border-0">
                          {exec.status === 'success' && <CheckCircle2 size={13} className="text-emerald-500 shrink-0" />}
                          {exec.status === 'failed' && <XCircle size={13} className="text-red-500 shrink-0" />}
                          {exec.status === 'running' && <Loader2 size={13} className="text-amber-500 animate-spin shrink-0" />}
                          <span className="text-text-secondary w-28 shrink-0">
                            {new Date(exec.startedAt).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className={cn(
                            'font-medium',
                            exec.status === 'success' ? 'text-emerald-500' : exec.status === 'failed' ? 'text-red-500' : 'text-amber-500',
                          )}>
                            {t(`status.${exec.status}`)}
                          </span>
                          {exec.finishedAt && (
                            <span className="text-text-secondary">
                              {Math.round((new Date(exec.finishedAt).getTime() - new Date(exec.startedAt).getTime()) / 1000)}s
                            </span>
                          )}
                          {exec.errorMessage && (
                            <span className="text-red-400 truncate flex-1">{exec.errorMessage}</span>
                          )}
                          {exec.chatId && (() => {
                            // Cron-spawned chats are always single-agent (one job → one agentId).
                            // V2 task URL without `?agent=` lands on the empty whiteboard
                            // overview; append the cron's agentId so it routes into the
                            // 1:1 ChatInstance where the real JSONL conversation renders.
                            const base = `${workspaceRoutePrefix}/${job.workspaceId}/${chatSegment}/${exec.chatId}`
                            const target = chatSegment === 'task' && job.agentId
                              ? `${base}?agent=${encodeURIComponent(job.agentId)}`
                              : base
                            return (
                            <button
                              onClick={() => navigate(target)}
                              onKeyDown={(e) => { if (e.key === 'Enter') navigate(target) }}
                              tabIndex={0}
                              aria-label="View chat"
                              className="text-accent-brand hover:underline shrink-0"
                            >
                              {t('notifications:viewChat', { defaultValue: 'View chat' })}
                            </button>
                            )
                          })()}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <NLInputDialog
        open={nlDialogOpen}
        onClose={() => setNlDialogOpen(false)}
        onParsed={(data) => {
          setPrefillData(data)
          setFormOpen(true)
        }}
        onSkip={() => {
          setPrefillData(null)
          setFormOpen(true)
        }}
      />

      <CronJobForm
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditingJob(null); setPrefillData(null) }}
        onSubmit={editingJob ? handleEdit : handleCreate}
        initialData={editingJob}
        prefillData={prefillData}
        workspaces={workspaces}
        agents={agents}
      />
      </div>
    </div>
  )
}

const ActionButton = ({ onClick, label, icon, danger }: {
  onClick: () => void
  label: string
  icon?: React.ReactNode
  danger?: boolean
}) => (
  <button
    onClick={onClick}
    onKeyDown={(e) => { if (e.key === 'Enter') onClick() }}
    tabIndex={0}
    aria-label={label}
    className={cn(
      'flex items-center gap-1 px-2 py-1 text-xs rounded border border-border transition-colors',
      danger
        ? 'text-red-400 hover:bg-red-500/10 hover:border-red-500/30'
        : 'text-text-secondary hover:text-text-primary hover:bg-bg-hover-muted',
    )}
  >
    {icon}
    {label}
  </button>
)

export default CronJobsPage
