/**
 * ExternalCwdSessions — lazy paginated list of un-adopted local CLI
 * sessions under one cwd. Mounted only when its parent group is expanded.
 *
 * Pagination via mtime keyset cursor; "Load more" fetches the next 20.
 */

import { useCallback, useState } from 'react'
import { useExternalCwdSessions } from '@/hooks/useExternalCwdSessions'
import { ExternalSessionRow } from './ExternalSessionRow'

interface ExternalCwdSessionsProps {
  cwd: string
  enabled: boolean
}

export const ExternalCwdSessions = ({ cwd, enabled }: ExternalCwdSessionsProps) => {
  const { sessions, hasMore, loading, error, loadMore, reload } = useExternalCwdSessions(cwd, enabled)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set())

  const handleAdopted = useCallback((adoptedSessionId: string) => {
    // Optimistic removal — the dir aggregate decrements on the server, sidebar
    // will refetch via openteam:chat-created event.
    setHiddenIds((prev) => {
      if (prev.has(adoptedSessionId)) return prev
      const next = new Set(prev)
      next.add(adoptedSessionId)
      return next
    })
  }, [])

  if (!enabled) return null

  const visible = sessions.filter((s) => !hiddenIds.has(s.id))

  if (loading && visible.length === 0) {
    return <div className="pl-3 py-1 text-[10px] text-text-muted italic">Loading…</div>
  }

  if (error && visible.length === 0) {
    return (
      <div className="pl-3 py-1 flex items-center gap-2">
        <span className="text-[10px] text-accent-red">Failed: {error}</span>
        <button
          onClick={() => void reload()}
          className="text-[10px] text-text-muted hover:text-text-primary underline"
        >
          retry
        </button>
      </div>
    )
  }

  if (visible.length === 0) {
    return <div className="pl-3 py-1 text-[10px] text-text-muted italic">No local sessions</div>
  }

  return (
    <div className="flex flex-col gap-0.5">
      {visible.map((s) => (
        <ExternalSessionRow
          key={s.id}
          session={s}
          onAdopted={() => handleAdopted(s.id)}
        />
      ))}
      {hasMore && (
        <button
          onClick={() => void loadMore()}
          disabled={loading}
          className="ml-3 mt-0.5 text-[10px] text-text-muted hover:text-text-primary underline self-start disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </div>
  )
}
