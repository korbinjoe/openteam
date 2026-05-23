/**
 * ExternalSessionRow — sidebar row for an un-adopted local CLI session
 * (Claude or Codex jsonl on disk). Click triggers POST /adopt + navigates
 * into the resulting chat.
 *
 * Adoption is idempotent server-side; we still guard with `adopting` to
 * prevent double-fire on rapid clicks.
 */

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, authFetch } from '@/config/api'
import type { CliProviderKind } from '@/hooks/useExternalCwds'
import type { ExternalSession } from '@/hooks/useExternalCwdSessions'
import { cn } from '../../lib/utils'
import { buildTaskUrl } from './urls'
import { ageLabel } from './TaskSessionRows'

interface ExternalSessionRowProps {
  session: ExternalSession
  onAdopted?: (chatId: string) => void
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
      // Notify caller so list can drop this row optimistically.
      onAdopted?.(chatId)
      // Fire global event so sidebar refetches groups (drops un-adopted count).
      window.dispatchEvent(new Event('openteam:chat-created'))
      // Workspace id is unknown to us — the server resolved/created one. Resolve
      // by fetching the chat row briefly; cheaper path is to round-trip the
      // workspace through the adoption response. We keep it small: read the
      // chat back once so navigation lands on the correct workspace url.
      try {
        const chatRes = await authFetch(`${API_BASE}/api/chats/${chatId}`)
        if (chatRes.ok) {
          const chat = (await chatRes.json()) as { workspaceId: string; primaryAgentId: string }
          navigate(buildTaskUrl(chat.workspaceId, chatId, chat.primaryAgentId))
          return
        }
      } catch {
        // Fall back to current workspace path or root if chat read fails.
      }
      navigate('/')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setAdopting(false)
    }
  }, [adopting, session.id, navigate, onAdopted])

  return (
    <button
      onClick={handleAdopt}
      disabled={adopting}
      title={`${session.provider} · ${session.cwd}\n${label}`}
      className={cn(
        'group flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-md text-left transition-colors',
        'hover:bg-bg-hover',
        adopting && 'opacity-60 cursor-progress',
      )}
    >
      <ProviderBadge provider={session.provider} />
      <span className="text-[11px] text-text-secondary flex-1 truncate">
        {label}
      </span>
      {error && (
        <span className="text-[10px] text-accent-red" title={error}>!</span>
      )}
      <span className="font-mono text-[10px] text-text-muted tabular-nums flex-shrink-0">
        {ageLabel(session.mtimeMs)}
      </span>
    </button>
  )
}

const PROVIDER_STYLES: Record<CliProviderKind, string> = {
  claude: 'bg-accent-purple/[0.12] text-accent-purple',
  codex: 'bg-accent-green/[0.12] text-accent-green',
}

export const ProviderBadge = ({ provider }: { provider: CliProviderKind }) => (
  <span
    className={cn(
      'font-mono text-[9px] uppercase tracking-wide px-1 py-px rounded-sm flex-shrink-0',
      PROVIDER_STYLES[provider],
    )}
  >
    {provider}
  </span>
)
