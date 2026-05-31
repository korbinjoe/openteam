/**
 * AgentSwitcherModal — ⌘K / Ctrl+K
 *  MentionMenu  Agent item  MRU localStorage
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import AgentAvatar from '@/components/ui/agent-avatar'
import type { AgentSummary } from '@/types/agentConfig'
import type { AgentActivity, AgentPhase } from '@/types/chat'

const MRU_STORAGE_KEY = 'openteam:agent-switcher:mru'
const MRU_CAP = 10

const PHASE_COLOR: Record<AgentPhase | 'idle', string> = {
  idle: 'rgb(var(--text-muted))',
  initializing: 'rgb(var(--text-muted))',
  thinking: 'rgb(var(--accent-running))',
  tool_running: 'rgb(var(--accent-running))',
  responding: 'rgb(var(--accent-running))',
  waiting_input: 'rgb(var(--text-muted))',
  waiting_confirmation: 'rgb(var(--accent-yellow, --accent-brand))',
  completed: 'rgb(var(--accent-green))',
  error: 'rgb(var(--accent-red))',
}

const loadMru = (): string[] => {
  try {
    const raw = localStorage.getItem(MRU_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

const saveMru = (list: string[]) => {
  try {
    localStorage.setItem(MRU_STORAGE_KEY, JSON.stringify(list.slice(0, MRU_CAP)))
  } catch { /* ignore quota */ }
}

interface Props {
  open: boolean
  agents: AgentSummary[]
  activities: Record<string, AgentActivity>
  currentAgentId?: string | null
  onSelect: (agent: AgentSummary) => void
  onClose: () => void
}

const AgentSwitcherModal = ({ open, agents, activities, currentAgentId, onSelect, onClose }: Props) => {
  const { t } = useTranslation('chat')
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const highlightPendingRef = useRef(false)
  useEffect(() => {
    if (!open) return
    setQuery('')
    setIndex(0)
    highlightPendingRef.current = true
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [open])

  const sorted = useMemo(() => {
    if (!agents.length) return [] as AgentSummary[]
    const mru = loadMru()
    const mruRank = new Map(mru.map((id, i) => [id, i]))

    const q = query.trim().toLowerCase()
    const matches = q
      ? agents.filter((a) =>
          (a.id ?? a.name).toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
        )
      : agents

    return [...matches].sort((a, b) => {
      const idA = a.id ?? a.name
      const idB = b.id ?? b.name
      const ra = mruRank.has(idA) ? mruRank.get(idA)! : Number.MAX_SAFE_INTEGER
      const rb = mruRank.has(idB) ? mruRank.get(idB)! : Number.MAX_SAFE_INTEGER
      if (ra !== rb) return ra - rb
      return a.name.localeCompare(b.name)
    })
  }, [agents, query])

  useEffect(() => {
    if (!highlightPendingRef.current || !currentAgentId) return
    highlightPendingRef.current = false
    const idx = sorted.findIndex((a) => (a.id ?? a.name) === currentAgentId)
    if (idx >= 0) setIndex(idx)
  }, [sorted, currentAgentId])

  useEffect(() => {
    if (index >= sorted.length) setIndex(0)
  }, [sorted.length, index])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-agent-idx="${index}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const handlePick = useCallback((agent: AgentSummary) => {
    const id = agent.id ?? agent.name
    const prev = loadMru()
    const next = [id, ...prev.filter((x) => x !== id)]
    saveMru(next)
    onSelect(agent)
    onClose()
  }, [onSelect, onClose])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (sorted.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndex((i) => (i >= sorted.length - 1 ? 0 : i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndex((i) => (i <= 0 ? sorted.length - 1 : i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      handlePick(sorted[Math.min(index, sorted.length - 1)])
    }
  }, [sorted, index, handlePick, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[15vh] bg-black/40"
      onMouseDown={onClose}
    >
      <div
        onMouseDown={(e) => e.stopPropagation()}
        className="w-[480px] max-w-[90vw] bg-bg-elevated border border-border rounded-lg shadow-2xl overflow-hidden"
      >
        <div className="flex items-center gap-2 px-3 py-2.5 border-b border-border-subtle">
          <Search size={14} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setIndex(0) }}
            onKeyDown={handleKeyDown}
            placeholder={t('agentSwitcher.placeholder')}
            className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary placeholder:text-text-muted"
          />
        </div>
        <div ref={listRef} className="max-h-[320px] overflow-y-auto py-1">
          {sorted.length === 0 && (
            <div className="px-3 py-4 text-xs text-text-muted text-center">
              {t('mention.noMatches', 'No matches')}
            </div>
          )}
          {sorted.map((agent, i) => {
            const phase = (activities[agent.id ?? agent.name]?.phase ?? 'idle') as AgentPhase | 'idle'
            const selected = i === index
            return (
              <div
                key={agent.name}
                data-agent-idx={i}
                onMouseEnter={() => setIndex(i)}
                onMouseDown={(e) => { e.preventDefault(); handlePick(agent) }}
                className={cn(
                  'flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors',
                  selected ? 'bg-accent-brand/[0.08]' : 'bg-transparent',
                )}
              >
                <AgentAvatar name={agent.name} agentId={agent.id} size="xs" />
                <span className={cn(
                  'text-sm font-medium truncate',
                  selected ? 'text-accent-brand' : 'text-text-primary',
                )}>
                  {agent.name}
                </span>
                <span className="ml-auto flex items-center gap-1 shrink-0">
                  <span
                    className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: PHASE_COLOR[phase] || PHASE_COLOR.idle }}
                  />
                  <span className="text-xs text-text-secondary">
                    {t(`activity.phase.${phase}`, { defaultValue: phase })}
                  </span>
                </span>
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-between px-3 py-1.5 border-t border-border-subtle text-[11px] text-text-muted">
          <span>{t('agentSwitcher.footer')}</span>
        </div>
      </div>
    </div>
  )
}

export default AgentSwitcherModal
