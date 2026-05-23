/**
 * ExternalSessionRow — single-row representation of an un-adopted local CLI
 * jsonl session (Claude or Codex). Shape-mirrors `TaskRow` so the sidebar can
 * mix native and external sessions in one mtime-sorted list without visual
 * dissonance. Click anywhere on the row triggers POST /adopt + navigates
 * straight into the resulting chat.
 *
 * Adoption is idempotent server-side; `adopting` blocks the double-fire that
 * happens on rapid clicks.
 */

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, authFetch } from '@/config/api'
import type { CliProviderKind } from '@/hooks/useExternalCwds'
import type { ExternalSession } from '@/hooks/useExternalCwdSessions'
import { cn } from '../../lib/utils'
import { ChevronRight } from './icons'
import { buildTaskUrl } from './urls'
import { ageLabel } from './TaskSessionRows'

interface ExternalSessionRowProps {
  session: ExternalSession
  onAdopted?: (sessionId: string) => void
}

export const ExternalSessionRow = ({ session, onAdopted }: ExternalSessionRowProps) => {
  const navigate = useNavigate()
  const [adopting, setAdopting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const label = session.firstUserMessage?.trim()
    || `${session.sessionId.slice(0, 8)}…`

  const handleAdopt = useCallback(async () => {
    if (adopting) return
    setAdopting(true)
    setError(null)
    try {
      const res = await authFetch(
        `${API_BASE}/api/external-sessions/${encodeURIComponent(session.id)}/adopt`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
      )
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        setError(body.error ?? `HTTP ${res.status}`)
        return
      }
      const { chatId } = (await res.json()) as { chatId: string }
      onAdopted?.(session.id)
      window.dispatchEvent(new Event('openteam:chat-created'))
      try {
        const chatRes = await authFetch(`${API_BASE}/api/chats/${chatId}`)
        if (chatRes.ok) {
          const chat = (await chatRes.json()) as { workspaceId: string; primaryAgentId: string }
          navigate(buildTaskUrl(chat.workspaceId, chatId, chat.primaryAgentId))
          return
        }
      } catch {
        // fall through
      }
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAdopting(false)
    }
  }, [adopting, session.id, navigate, onAdopted])

  return (
    <div
      onClick={handleAdopt}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void handleAdopt() } }}
      title={`${session.provider} · ${session.cwd}\n${label}`}
      className={cn(
        'group relative flex items-center gap-[7px] pl-1.5 pr-2 py-1.5 rounded-md cursor-pointer transition-colors',
        'hover:bg-bg-hover',
        adopting && 'opacity-60 cursor-progress',
      )}
    >
      {/* Provider marker: 2px left bar. Replaces the old colored badge so the
          row stays visually quiet while still distinguishing claude vs codex. */}
      <span
        aria-hidden
        className={cn(
          'absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-r-sm',
          PROVIDER_BAR[session.provider],
        )}
      />
      {/* Chevron slot kept for visual alignment with TaskRow even though
          external rows have no children to expand. */}
      <span className="w-4 h-4 flex items-center justify-center text-text-muted -mr-0.5 flex-shrink-0">
        <ChevronRight size={9} />
      </span>
      <span className="w-[7px] h-[7px] rounded-full bg-text-muted flex-shrink-0" />
      <span className="text-xs text-text-primary flex-1 truncate">{label}</span>
      {error && (
        <span className="text-[10px] text-accent-red" title={error}>!</span>
      )}
      <span className="font-mono text-[11px] text-text-muted tabular-nums flex-shrink-0">
        {ageLabel(session.mtimeMs)}
      </span>
    </div>
  )
}

// Left-bar color per CLI provider. Low-saturation so it identifies without
// shouting — meant to be glanceable, not informative on first read.
const PROVIDER_BAR: Record<CliProviderKind, string> = {
  claude: 'bg-accent-purple/60',
  codex: 'bg-accent-green/60',
}
