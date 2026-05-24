/**
 * ExternalSessionRow — single-row representation of an un-adopted local CLI
 * jsonl session (Claude or Codex). Shape-mirrors `MissionRow` so the sidebar can
 * mix native and external sessions in one mtime-sorted list without visual
 * dissonance. Click anywhere on the row triggers POST /adopt + navigates
 * straight into the resulting chat.
 *
 * Hover actions (Pin / Archive / Add Agent) silently adopt the session first
 * to obtain a chatId, then apply the action — no navigation. This makes
 * external sessions first-class citizens in the sidebar without requiring the
 * user to enter the chat just to manage it.
 *
 * Adoption is idempotent server-side; `adopting` blocks the double-fire that
 * happens on rapid clicks.
 */

import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { API_BASE, authFetch } from '@/config/api'
import type { ExternalSession } from '@/hooks/useExternalCwdSessions'
import { cn } from '../../lib/utils'
import { ChevronRight, Pin, Archive, Plus } from './icons'
import { buildMissionUrl } from './urls'
import { ageLabel, RowEndSlotWithLabel } from './MissionSessionRows'

interface ExternalSessionRowProps {
  session: ExternalSession
  onAdopted?: (sessionId: string) => void
  onPin?: (chatId: string) => void
  onArchive?: (chatId: string) => void
  onAddAgent?: (chatId: string) => void
}

export const ExternalSessionRow = ({
  session,
  onAdopted,
  onPin,
  onArchive,
  onAddAgent,
}: ExternalSessionRowProps) => {
  const navigate = useNavigate()
  const [adopting, setAdopting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const label = session.firstUserMessage?.trim()
    || `${session.sessionId.slice(0, 8)}…`

  // Core adopt request. Returns the new chatId (or null on failure) without
  // navigating — callers decide whether to jump in or stay put.
  const adoptOnly = useCallback(async (): Promise<string | null> => {
    if (adopting) return null
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
        return null
      }
      const { chatId } = (await res.json()) as { chatId: string }
      onAdopted?.(session.id)
      window.dispatchEvent(new Event('openteam:chat-created'))
      return chatId
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      return null
    } finally {
      setAdopting(false)
    }
  }, [adopting, session.id, onAdopted])

  // Row click: adopt + navigate into the resulting chat.
  const handleAdoptAndOpen = useCallback(async () => {
    const chatId = await adoptOnly()
    if (!chatId) return
    try {
      const chatRes = await authFetch(`${API_BASE}/api/chats/${chatId}`)
      if (chatRes.ok) {
        const chat = (await chatRes.json()) as { workspaceId: string; primaryAgentId: string }
        navigate(buildMissionUrl(chat.workspaceId, chatId, chat.primaryAgentId))
        return
      }
    } catch {
      // fall through
    }
    navigate('/')
  }, [adoptOnly, navigate])

  // Hover-action click: adopt silently, then apply the requested action.
  // Stays on the current view so the user can keep triaging the sidebar.
  // ActionButtons already calls stopPropagation before invoking onClick.
  const runWithAdopt = (action?: (chatId: string) => void) => async () => {
    if (!action) return
    const chatId = await adoptOnly()
    if (chatId) action(chatId)
  }

  return (
    <div
      onClick={handleAdoptAndOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void handleAdoptAndOpen() } }}
      title={`${session.cwd}\n${label}`}
      className={cn(
        'group relative flex items-center gap-[7px] pl-1.5 pr-2 py-1.5 rounded-md cursor-pointer transition-colors',
        'hover:bg-bg-hover',
        adopting && 'opacity-60 cursor-progress',
      )}
    >
      {/* Chevron slot kept for visual alignment with MissionRow even though
          external rows have no children to expand. */}
      <span className="w-4 h-4 flex items-center justify-center text-text-muted -mr-0.5 flex-shrink-0">
        <ChevronRight size={9} />
      </span>
      <span className="w-[7px] h-[7px] rounded-full bg-text-muted flex-shrink-0" />
      <span className="text-xs text-text-primary flex-1 truncate">{label}</span>
      {error && (
        <span className="text-[10px] text-accent-red" title={error}>!</span>
      )}
      <RowEndSlotWithLabel
        label={ageLabel(session.mtimeMs)}
        actions={[
          { title: 'Add agent', onClick: () => { void runWithAdopt(onAddAgent)() }, children: <Plus size={11} /> },
          { title: 'Pin mission', onClick: () => { void runWithAdopt(onPin)() }, children: <Pin size={11} /> },
          { title: 'Archive mission', onClick: () => { void runWithAdopt(onArchive)() }, children: <Archive size={11} /> },
        ]}
      />
    </div>
  )
}
