/**
 * GlobalHeartbeatBar —
 *
 *  AgentActivityPanel /
 *  Agent  Agent  +
 *
 * Claude Code CLI  Pondering... (12s · 3.2k tokens · esc to interrupt)
 * OpenTeam  Agent  Agent  +
 */

import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Square } from 'lucide-react'
import { cn } from '@/lib/utils'
import AgentAvatar, { isActivePhase } from '@/components/ui/agent-avatar'
import type { AgentActivity } from '@/types/chat'
import type { AgentPersonality } from '@/types/agentConfig'
import { PHASE_STYLES } from '@/lib/agentPhaseConfig'
import { useRotatingVerb } from '@/lib/statusVerbs'
import { formatTokens } from '@/utils/format'

interface GlobalHeartbeatBarProps {
  expertActivities: Record<string, AgentActivity>
  agentNames?: Record<string, string>
  agentPersonalities?: Record<string, AgentPersonality>
  /**  Agent ChatInstance  handleInterrupt */
  onInterrupt?: () => void
  onAgentClick?: (agentId: string) => void
  className?: string
}

const FILE_OP_VERB: Record<string, string> = {
  create: 'Create',
  edit: 'Edit',
  delete: 'Delete',
  read: 'Read',
}

const formatElapsed = (ms: number): string => {
  if (ms < 1000) return '<1s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return rs > 0 ? `${m}m ${rs}s` : `${m}m`
}

/**  Agent fileOp > toolName >  */
const useActivityDesc = (activity: AgentActivity): string => {
  const { t } = useTranslation('chat')
  const verb = useRotatingVerb(activity.phase)

  if (activity.fileOp) {
    const verbStr = FILE_OP_VERB[activity.fileOp.operation] ?? activity.fileOp.operation
    const path = activity.fileOp.path.split('/').slice(-2).join('/')
    return `${verbStr} ${path}`
  }
  if (activity.currentTool) {
    return t(`activity.toolAction.${activity.currentTool}`, { defaultValue: activity.currentTool })
  }
  return verb
}

/**
 * Stale threshold: if an agent's activity hasn't ticked for this long while
 * still showing an active phase, treat it as dead (CLI likely crashed without
 * emitting a terminal phase). 60s comfortably covers Claude's longest thinking
 * pauses.
 */
const STALE_MS = 60_000

/**
 * Module-level start-time map. Survives component remount (e.g. switching
 * away from a chat and back), so the timer keeps counting from when the
 * agent actually started this run, not from when the bar was last mounted.
 * Cleared when the agent transitions out of active phase.
 */
const agentStartTimes = new Map<string, number>()

const AgentDetailRow = ({ agentId, displayName, activity, elapsed, onClick }: {
  agentId: string
  displayName: string
  activity: AgentActivity
  elapsed: number
  onClick?: (agentId: string) => void
}) => {
  const config = PHASE_STYLES[activity.phase] || PHASE_STYLES.initializing
  const desc = useActivityDesc(activity)
  const isError = activity.phase === 'error'
  const isWaiting = activity.phase === 'waiting_input' || activity.phase === 'waiting_confirmation'

  return (
    <button
      type="button"
      onClick={() => onClick?.(agentId)}
      className={cn(
        'flex items-center gap-1.5 px-1.5 py-0.5 rounded-md transition-colors w-full border text-left',
        isError && 'bg-accent-red/[0.06] border-accent-red/10',
        isWaiting && 'bg-accent-yellow/[0.04] border-accent-yellow/[0.08]',
        !isError && !isWaiting && 'bg-transparent border-transparent',
        onClick ? 'cursor-pointer hover:bg-bg-hover-muted' : 'cursor-default',
      )}
      tabIndex={onClick ? 0 : -1}
      aria-label={`${displayName} - ${desc}`}
    >
      <AgentAvatar name={displayName} agentId={agentId} size="xs" active={isActivePhase(activity.phase)} />
      <span className="text-xs truncate max-w-[80px] text-text-secondary">
        {displayName}
      </span>
      <span className="flex items-center gap-1 text-xs truncate" style={{ color: config.color }}>
        <span
          className="inline-block w-[5px] h-[5px] rounded-full shrink-0"
          style={{
            background: config.color,
            ...(config.pulse ? { animation: 'pulse 1.5s ease-in-out infinite' } : {}),
          }}
        />
        <span className="truncate">{desc}</span>
      </span>
      {activity.toolCount > 0 && (
        <span className="text-xs text-text-muted shrink-0 font-mono">
          {activity.toolCompleted}/{activity.toolCount}
        </span>
      )}
      <span className="flex-1" />
      <span className="text-xs text-text-muted shrink-0 font-mono opacity-70">
        {formatElapsed(elapsed)}
      </span>
    </button>
  )
}

const SingleAgentRow = ({ agentId, displayName, activity, elapsed, onClick }: {
  agentId: string
  displayName: string
  activity: AgentActivity
  elapsed: number
  onClick?: (agentId: string) => void
}) => {
  const config = PHASE_STYLES[activity.phase] || PHASE_STYLES.initializing
  const desc = useActivityDesc(activity)
  const tokens = activity.tokens

  return (
    <button
      type="button"
      onClick={() => onClick?.(agentId)}
      className={cn(
        'flex items-center gap-2 px-1.5 py-0.5 rounded-md transition-colors flex-1 border-none text-left bg-transparent min-w-0',
        onClick ? 'cursor-pointer hover:bg-bg-hover-muted' : 'cursor-default',
      )}
      tabIndex={onClick ? 0 : -1}
    >
      <AgentAvatar name={displayName} agentId={agentId} size="xs" active={isActivePhase(activity.phase)} />
      <span className="text-xs font-medium text-text-emphasis shrink-0 truncate max-w-[120px]">
        {displayName}
      </span>
      <span className="text-xs truncate min-w-0" style={{ color: config.color }}>
        {desc}
      </span>
      <span className="flex-1 min-w-[4px]" />
      {activity.toolCount > 0 && (
        <span className="text-xs text-text-muted shrink-0 font-mono">
          {activity.toolCompleted}/{activity.toolCount}
        </span>
      )}
      {tokens && (tokens.input > 0 || tokens.output > 0) && (
        <span className="text-xs text-text-muted shrink-0 font-mono opacity-70">
          {formatTokens(tokens.output)} out
        </span>
      )}
      <span className="text-xs text-accent-purple shrink-0 font-mono font-semibold">
        {formatElapsed(elapsed)}
      </span>
    </button>
  )
}

const GlobalHeartbeatBar = ({
  expertActivities,
  agentNames,
  agentPersonalities,
  onInterrupt,
  onAgentClick,
  className,
}: GlobalHeartbeatBarProps) => {
  const { t } = useTranslation('chat')

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const activeEntries = useMemo(() => {
    const entries = Object.entries(expertActivities).filter(([, a]) => {
      if (!isActivePhase(a.phase)) return false
      if (now - a.updatedAt > STALE_MS) return false
      return true
    })
    const priority = (phase: string) => {
      if (phase === 'error') return 0
      if (phase === 'waiting_input' || phase === 'waiting_confirmation') return 1
      return 2
    }
    return entries.sort(([, a], [, b]) => priority(a.phase) - priority(b.phase))
  }, [expertActivities, now])
  const hasActiveWork = activeEntries.length > 0
  const activeCount = activeEntries.length

  const urgencyCounts = useMemo(() => {
    let errors = 0
    let waiting = 0
    for (const [, a] of activeEntries) {
      if (a.phase === 'error') errors++
      if (a.phase === 'waiting_input' || a.phase === 'waiting_confirmation') waiting++
    }
    return { errors, waiting }
  }, [activeEntries])

  const activeIds = useMemo(() => new Set(activeEntries.map(([id]) => id)), [activeEntries])
  for (const [id] of activeEntries) {
    if (!agentStartTimes.has(id)) agentStartTimes.set(id, Date.now())
  }
  for (const id of Array.from(agentStartTimes.keys())) {
    if (!activeIds.has(id)) agentStartTimes.delete(id)
  }

  const perAgentElapsed = useMemo(() => {
    const m = new Map<string, number>()
    for (const [id] of activeEntries) {
      const start = agentStartTimes.get(id) ?? now
      m.set(id, Math.max(0, now - start))
    }
    return m
  }, [activeEntries, now])

  const overallElapsed = useMemo(() => {
    let earliest = now
    for (const [id] of activeEntries) {
      const start = agentStartTimes.get(id) ?? now
      if (start < earliest) earliest = start
    }
    return Math.max(0, now - earliest)
  }, [activeEntries, now])

  const totalTokens = useMemo(() => {
    let input = 0
    let output = 0
    for (const [, a] of activeEntries) {
      if (a.tokens) {
        input += a.tokens.input ?? 0
        output += a.tokens.output ?? 0
      }
    }
    return { input, output }
  }, [activeEntries])

  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!hasActiveWork || !onInterrupt) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const ae = document.activeElement as HTMLElement | null
      if (ae) {
        const tag = ae.tagName.toLowerCase()
        if (tag === 'input' || tag === 'textarea' || ae.isContentEditable) return
        if (ae.closest('.xterm')) return
      }
      e.preventDefault()
      onInterrupt()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [hasActiveWork, onInterrupt])

  if (!hasActiveWork) return null

  const isSingle = activeCount === 1
  const Chevron = expanded ? ChevronDown : ChevronRight

  if (isSingle) {
    const [agentId, activity] = activeEntries[0]
    const personality = agentPersonalities?.[agentId]
    const displayName = personality?.nickname || agentNames?.[agentId] || agentId
    return (
      <div className={cn('shrink-0 border-t border-border-subtle/60 px-2 py-1 flex items-center gap-2', className)}>
        <SingleAgentRow
          agentId={agentId}
          displayName={displayName}
          activity={activity}
          elapsed={perAgentElapsed.get(agentId) ?? 0}
          onClick={onAgentClick}
        />
        {onInterrupt && (
          <button
            type="button"
            onClick={onInterrupt}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border-subtle bg-bg-hover-subtle text-text-muted text-xs cursor-pointer hover:bg-bg-hover-muted hover:text-text-primary transition-colors shrink-0"
            title={t('heartbeat.interruptHint')}
            aria-label={t('heartbeat.interrupt')}
          >
            <Square size={8} fill="currentColor" />
            <span className="font-mono">esc</span>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={cn('shrink-0 border-t border-border-subtle/60', className)}>
      {/* Summary row */}
      <div className="flex items-center gap-2 px-2 py-1">
        <button
          type="button"
          onClick={() => setExpanded((p) => !p)}
          className="flex items-center gap-1.5 flex-1 min-w-0 border-none bg-transparent cursor-pointer hover:bg-bg-hover-muted rounded-md px-1.5 py-0.5 transition-colors text-left"
          aria-label={expanded ? t('heartbeat.collapseAgentList') : t('heartbeat.expandAgentList')}
        >
          <Chevron size={11} className="text-text-muted opacity-60 shrink-0" />
          <span className="text-xs font-semibold text-text-emphasis shrink-0">
            {t('heartbeat.activeCount', { count: activeCount })}
          </span>
          {urgencyCounts.errors > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent-red/10 text-accent-red font-semibold shrink-0">
              <span className="w-[5px] h-[5px] rounded-full bg-accent-red" />
              {urgencyCounts.errors} {t('heartbeat.error', { defaultValue: 'error' })}
            </span>
          )}
          {urgencyCounts.waiting > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-accent-yellow/10 text-accent-yellow font-semibold shrink-0">
              <span className="w-[5px] h-[5px] rounded-full bg-accent-yellow" />
              {urgencyCounts.waiting} {t('heartbeat.waiting', { defaultValue: 'waiting' })}
            </span>
          )}
          <span className="flex-1 min-w-[4px]" />
          {(totalTokens.input > 0 || totalTokens.output > 0) && (
            <span className="text-xs text-text-muted shrink-0 font-mono opacity-70">
              {formatTokens(totalTokens.output)} out
            </span>
          )}
          <span className="text-xs text-accent-purple shrink-0 font-mono font-semibold">
            {formatElapsed(overallElapsed)}
          </span>
        </button>
        {onInterrupt && (
          <button
            type="button"
            onClick={onInterrupt}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded-md border border-border-subtle bg-bg-hover-subtle text-text-muted text-xs cursor-pointer hover:bg-bg-hover-muted hover:text-text-primary transition-colors shrink-0"
            title={t('heartbeat.interruptAllHint')}
            aria-label={t('heartbeat.interruptAll')}
          >
            <Square size={8} fill="currentColor" />
            <span className="font-mono">esc</span>
          </button>
        )}
      </div>

      {expanded && (
        <div className="px-3 pb-1.5 flex flex-col gap-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
          {activeEntries.map(([agentId, activity]) => {
            const personality = agentPersonalities?.[agentId]
            const displayName = personality?.nickname || agentNames?.[agentId] || agentId
            return (
              <AgentDetailRow
                key={agentId}
                agentId={agentId}
                displayName={displayName}
                activity={activity}
                elapsed={perAgentElapsed.get(agentId) ?? 0}
                onClick={onAgentClick}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}

export default GlobalHeartbeatBar
