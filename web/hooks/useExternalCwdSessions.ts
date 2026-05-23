/**
 * useExternalCwdSessions(cwd) — lazy paginated session loader for one cwd.
 *
 * Fires the first /api/external-cwds/:cwd/sessions request only when
 * `enabled` is true (the directory group is expanded in the sidebar). On
 * loadMore, advances the mtime keyset cursor. Resets when cwd or enabled
 * changes.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE, authFetch } from '@/config/api'
import type { CliProviderKind } from './useExternalCwds'

export interface ExternalSession {
  id: string
  provider: CliProviderKind
  sessionId: string
  cwd: string
  firstUserMessage: string | null
  mtimeMs: number
  sizeBytes: number
}

interface PageResponse {
  sessions: ExternalSession[]
  nextCursor: number | null
  hasMore: boolean
}

export interface UseExternalCwdSessionsResult {
  sessions: ExternalSession[]
  hasMore: boolean
  loading: boolean
  error: string | null
  loadMore: () => Promise<void>
  reload: () => Promise<void>
}

export const useExternalCwdSessions = (
  cwd: string | null,
  enabled: boolean,
): UseExternalCwdSessionsResult => {
  const [sessions, setSessions] = useState<ExternalSession[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef<boolean>(false)

  const fetchPage = useCallback(async (resetCursor: boolean): Promise<void> => {
    if (!cwd || !enabled) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (!resetCursor && cursor !== null) params.set('cursor', String(cursor))
      params.set('limit', '20')
      const url = `${API_BASE}/api/external-cwds/${encodeURIComponent(cwd)}/sessions?${params}`
      const res = await authFetch(url)
      if (!res.ok) {
        setError(`HTTP ${res.status}`)
        return
      }
      const body = (await res.json()) as PageResponse
      setSessions((prev) => (resetCursor ? body.sessions : [...prev, ...body.sessions]))
      setCursor(body.nextCursor)
      setHasMore(body.hasMore)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      inFlightRef.current = false
      setLoading(false)
    }
  }, [cwd, enabled, cursor])

  // Initial / re-enable load: reset everything and fetch page 1.
  useEffect(() => {
    if (!enabled || !cwd) {
      setSessions([])
      setCursor(null)
      setHasMore(true)
      return
    }
    void (async () => {
      setSessions([])
      setCursor(null)
      setHasMore(true)
      // fetchPage reads cursor from closure; we just reset it above. Use a
      // fresh local fetch that ignores cursor.
      inFlightRef.current = true
      setLoading(true)
      try {
        const url = `${API_BASE}/api/external-cwds/${encodeURIComponent(cwd)}/sessions?limit=20`
        const res = await authFetch(url)
        if (!res.ok) { setError(`HTTP ${res.status}`); return }
        const body = (await res.json()) as PageResponse
        setSessions(body.sessions)
        setCursor(body.nextCursor)
        setHasMore(body.hasMore)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        inFlightRef.current = false
        setLoading(false)
      }
    })()
  }, [cwd, enabled])

  const loadMore = useCallback(async () => {
    if (!hasMore) return
    await fetchPage(false)
  }, [fetchPage, hasMore])

  const reload = useCallback(async () => {
    await fetchPage(true)
  }, [fetchPage])

  return { sessions, hasMore, loading, error, loadMore, reload }
}
