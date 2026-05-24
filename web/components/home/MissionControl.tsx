import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Zap, AlertTriangle, Clock, ArrowRight, AlertCircle, CheckCircle2, Sparkles } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useChatTabs } from '@/contexts/ChatTabContext'
import { PHASE_STYLES } from '@/lib/agentPhaseConfig'
import type { AgentPhase } from '@/types/chat'

interface ActiveSession {
  chatId: string
  title: string
  workspaceId: string
  phase: AgentPhase
}

interface MissionControlProps {
  tabPhases?: Map<string, AgentPhase>
  onSessionClick?: (chatId: string) => void
  className?: string
}

const classifyPhase = (phase: AgentPhase): 'working' | 'error' | 'waiting' | 'idle' | 'completed' => {
  if (phase === 'thinking' || phase === 'tool_running' || phase === 'responding') return 'working'
  if (phase === 'error') return 'error'
  if (phase === 'waiting_input' || phase === 'waiting_confirmation') return 'waiting'
  if (phase === 'completed') return 'completed'
  return 'idle'
}

const STATUS_CONFIG = {
  working: { icon: Zap, color: 'text-accent-brand-light', bg: 'bg-accent-brand/10', border: 'border-accent-brand/15', label: 'Running' },
  error: { icon: AlertTriangle, color: 'text-accent-red', bg: 'bg-accent-red/[0.06]', border: 'border-accent-red/15', label: 'Error' },
  waiting: { icon: Clock, color: 'text-accent-yellow', bg: 'bg-accent-yellow/[0.04]', border: 'border-accent-yellow/15', label: 'Waiting' },
} as const

const MissionControl = ({ tabPhases, onSessionClick, className }: MissionControlProps) => {
  const { tabs, activateTab } = useChatTabs()
  const { t } = useTranslation('home')

  const activeSessions = useMemo(() => {
    if (!tabPhases || tabPhases.size === 0) return []
    const sessions: ActiveSession[] = []
    for (const tab of tabs) {
      const phase = tabPhases.get(tab.chatId)
      if (!phase) continue
      const cls = classifyPhase(phase)
      if (cls !== 'idle' && cls !== 'completed') {
        sessions.push({ chatId: tab.chatId, title: tab.title, workspaceId: tab.workspaceId, phase })
      }
    }
    sessions.sort((a, b) => {
      const order = { error: 0, waiting: 1, working: 2, idle: 3, completed: 4 }
      return (order[classifyPhase(a.phase)] ?? 3) - (order[classifyPhase(b.phase)] ?? 3)
    })
    return sessions
  }, [tabs, tabPhases])

  const counts = useMemo(() => {
    let working = 0, errors = 0, waiting = 0, completed = 0
    if (tabPhases) {
      for (const phase of tabPhases.values()) {
        const cls = classifyPhase(phase)
        if (cls === 'working') working++
        else if (cls === 'error') errors++
        else if (cls === 'waiting') waiting++
        else if (cls === 'completed') completed++
      }
    }
    return { working, errors, waiting, completed, total: working + errors + waiting }
  }, [tabPhases])

  const handleClick = (chatId: string) => {
    if (onSessionClick) {
      onSessionClick(chatId)
    } else {
      activateTab(chatId)
    }
  }

  const needsAttention = counts.errors + counts.waiting

  return (
    <div className={cn('w-full mb-6', className)}>
      {/* Section label */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
          {t('missionControl', { defaultValue: 'Mission Control' })}
        </span>
        <span className="flex-1 h-px bg-border-subtle/40" />
      </div>

      {/* Attention Banner */}
      {needsAttention > 0 && (
        <div className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-lg mb-4 border',
          counts.errors > 0
            ? 'bg-accent-red/[0.05] border-accent-red/15'
            : 'bg-accent-yellow/[0.04] border-accent-yellow/15',
        )}>
          <div className={cn(
            'w-7 h-7 rounded-lg flex items-center justify-center shrink-0',
            counts.errors > 0 ? 'bg-accent-red/10' : 'bg-accent-yellow/10',
          )}>
            <AlertCircle size={14} className={counts.errors > 0 ? 'text-accent-red' : 'text-accent-yellow'} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-text-emphasis">
              {t('attentionNeeded', { count: needsAttention, defaultValue: '{{count}} missions need your attention' })}
            </div>
            <div className="text-[11px] text-text-secondary mt-0.5">
              {counts.waiting > 0 && t('waitingCount', { count: counts.waiting, defaultValue: '{{count}} waiting for input' })}
              {counts.waiting > 0 && counts.errors > 0 && ' · '}
              {counts.errors > 0 && t('errorCount', { count: counts.errors, defaultValue: '{{count}} encountered an error' })}
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              const first = activeSessions[0]
              if (first) handleClick(first.chatId)
            }}
            className="text-[11px] px-3 py-1 rounded-md border bg-transparent cursor-pointer transition-colors shrink-0 border-accent-red/20 text-accent-red hover:bg-accent-red/10"
          >
            {t('reviewAll', { defaultValue: 'Review' })}
          </button>
        </div>
      )}

      {/* Stats Row — always visible */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        <div className="p-3 rounded-lg border border-border bg-bg-secondary">
          <div className="flex items-center gap-1.5 mb-2">
            <span className={cn('w-1.5 h-1.5 rounded-full bg-accent-brand-light', counts.working > 0 && 'animate-pulse')} />
            <span className="text-[10px] text-text-secondary font-medium">{t('statsRunning', { defaultValue: 'Running' })}</span>
          </div>
          <div className="text-xl font-bold text-text-emphasis font-mono">{counts.working}</div>
        </div>
        <div className={cn('p-3 rounded-lg border', counts.waiting > 0 ? 'border-accent-yellow/15 bg-accent-yellow/[0.03]' : 'border-border bg-bg-secondary')}>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow" />
            <span className={cn('text-[10px] font-medium', counts.waiting > 0 ? 'text-accent-yellow' : 'text-text-secondary')}>
              {t('statsWaiting', { defaultValue: 'Needs Input' })}
            </span>
          </div>
          <div className={cn('text-xl font-bold font-mono', counts.waiting > 0 ? 'text-accent-yellow' : 'text-text-emphasis')}>{counts.waiting}</div>
        </div>
        <div className={cn('p-3 rounded-lg border', counts.errors > 0 ? 'border-accent-red/15 bg-accent-red/[0.03]' : 'border-border bg-bg-secondary')}>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
            <span className={cn('text-[10px] font-medium', counts.errors > 0 ? 'text-accent-red' : 'text-text-secondary')}>
              {t('statsError', { defaultValue: 'Error' })}
            </span>
          </div>
          <div className={cn('text-xl font-bold font-mono', counts.errors > 0 ? 'text-accent-red' : 'text-text-emphasis')}>{counts.errors}</div>
        </div>
        <div className="p-3 rounded-lg border border-border bg-bg-secondary">
          <div className="flex items-center gap-1.5 mb-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green" />
            <span className="text-[10px] text-text-secondary font-medium">{t('statsDone', { defaultValue: 'Done' })}</span>
          </div>
          <div className="text-xl font-bold text-text-emphasis font-mono">{counts.completed}</div>
        </div>
      </div>

      {/* Active Missions */}
      {activeSessions.length > 0 ? (
        <>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {t('activeTasks', { defaultValue: 'Active Missions' })}
            </span>
            <span className="flex-1 h-px bg-border-subtle/40" />
          </div>

          <div className="flex flex-col gap-1.5">
            {activeSessions.slice(0, 5).map((session) => {
              const cls = classifyPhase(session.phase)
              const config = STATUS_CONFIG[cls as keyof typeof STATUS_CONFIG]
              if (!config) return null
              const phaseStyle = PHASE_STYLES[session.phase] || PHASE_STYLES.initializing

              return (
                <button
                  key={session.chatId}
                  type="button"
                  onClick={() => handleClick(session.chatId)}
                  className={cn(
                    'group flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg transition-all text-left w-full cursor-pointer border',
                    config.bg, config.border,
                    'hover:brightness-110',
                  )}
                >
                  <span
                    className={cn('w-2 h-2 rounded-full shrink-0', cls === 'working' && 'animate-pulse')}
                    style={{ background: phaseStyle.color }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-text-emphasis truncate">
                        {session.title || 'Untitled'}
                      </span>
                      <span className={cn(
                        'text-[10px] px-2 py-px rounded font-medium shrink-0',
                        cls === 'error' && 'bg-accent-red/15 text-accent-red',
                        cls === 'waiting' && 'bg-accent-yellow/15 text-accent-yellow',
                        cls === 'working' && 'bg-accent-brand/10 text-accent-brand-light',
                      )}>
                        {t(`sessionStatus.${cls}`, { defaultValue: config.label }).toUpperCase()}
                      </span>
                    </div>
                  </div>
                  {cls === 'waiting' && (
                    <span className="text-[11px] px-2.5 py-0.5 rounded-md bg-accent-yellow text-bg-primary font-semibold shrink-0">
                      {t('reply', { defaultValue: 'Reply' })}
                    </span>
                  )}
                  {cls === 'error' && (
                    <span className="text-[11px] px-2.5 py-0.5 rounded-md border border-accent-red/30 text-accent-red font-medium shrink-0">
                      {t('view', { defaultValue: 'View' })}
                    </span>
                  )}
                  {cls === 'working' && (
                    <ArrowRight size={12} className="text-text-muted opacity-0 group-hover:opacity-100 shrink-0 transition-opacity" />
                  )}
                </button>
              )
            })}
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <Sparkles size={16} className="text-text-muted opacity-40" />
          <span className="text-[11px] text-text-muted">
            {t('noActiveTasks', { defaultValue: 'No active missions — start a new session below' })}
          </span>
        </div>
      )}

      {/* Completed sessions */}
      {counts.completed > 0 && (
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
              {t('completedToday', { defaultValue: 'Completed' })}
            </span>
            <span className="text-[10px] text-text-muted font-mono">{counts.completed}</span>
            <span className="flex-1 h-px bg-border-subtle/40" />
          </div>
          <div className="flex flex-col gap-0.5">
            {tabs
              .filter((tab) => {
                const phase = tabPhases?.get(tab.chatId)
                return phase && classifyPhase(phase) === 'completed'
              })
              .slice(0, 3)
              .map((tab) => (
                <button
                  key={tab.chatId}
                  type="button"
                  onClick={() => handleClick(tab.chatId)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg transition-colors text-left w-full hover:bg-bg-hover-subtle cursor-pointer border-none bg-transparent"
                >
                  <CheckCircle2 size={13} className="text-accent-green shrink-0" />
                  <span className="text-xs text-text-primary truncate flex-1">{tab.title || 'Untitled'}</span>
                  <ArrowRight size={10} className="text-text-muted opacity-0 group-hover:opacity-100 shrink-0" />
                </button>
              ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default MissionControl
