/**
 * useWorkspaceExternalSessions(workspaceId) — paginated unified feed of every
 * external Claude/Codex jsonl that falls under the workspace's repositories,
 * already merged + sorted by file mtime DESC on the server.
 *
 * Sidebar uses this to interleave external rows with native chats inside one
 * workspace group, so the user sees "all sessions for this project" in one
 * time-ordered list — regardless of where the bytes live on disk.
 *
 * Refetches when external-dirs:ready / external-dirs:changed fires, so newly
 * created jsonl files surface without a manual reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE, authFetch } from '@/config/api'
import { getWebSocketClient } from '@/services/WebSocketClient'
import type { ExternalSession } from './useExternalCwdSessions'

interface PageResponse {
  sessions: ExternalSession[]
  nextCursor: number | null
  hasMore: boolean
}

// Sidebar slices items to 10 by default and grows in +10 steps. Fetching 30
// per request gives ~2 local pages of headroom before hitting the network.
const PAGE_SIZE = 30

export interface UseWorkspaceExternalSessionsResult {
  sessions: ExternalSession[]
  hasMore: boolean
  loading: boolean
  error: string | null
  loadMore: () => Promise<void>
  reload: () => Promise<void>
  hide: (sessionId: string) => void
}

export const useWorkspaceExternalSessions = (
  workspaceId: string | null,
  enabled: boolean,
): UseWorkspaceExternalSessionsResult => {
  const [sessions, setSessions] = useState<ExternalSession[]>([])
  const [cursor, setCursor] = useState<number | null>(null)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef<boolean>(false)

  const fetchPage = useCallback(async (resetCursor: boolean): Promise<void> => {
    if (!workspaceId || !enabled) return
    if (inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (!resetCursor && cursor !== null) params.set('cursor', String(cursor))
      params.set('limit', String(PAGE_SIZE))
      const url = `${API_BASE}/api/workspaces/${encodeURIComponent(workspaceId)}/external-sessions?${params}`
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
  }, [workspaceId, enabled, cursor])

  // Initial / re-enable load: reset and fetch page 1 with a fresh local fetch
  // that ignores the stale cursor in closure.
  useEffect(() => {
    if (!enabled || !workspaceId) {
      setSessions([])
      setCursor(null)
      setHasMore(true)
      return
    }
    void (async () => {
      setSessions([])
      setCursor(null)
      setHasMore(true)
      inFlightRef.current = true
      setLoading(true)
      try {
        const url = `${API_BASE}/api/workspaces/${encodeURIComponent(workspaceId)}/external-sessions?limit=${PAGE_SIZE}`
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
  }, [workspaceId, enabled])

  // Stay live: external scanner fires these when jsonl files appear/disappear.
  useEffect(() => {
    if (!enabled || !workspaceId) return
    const wsClient = getWebSocketClient()
    const handler = () => { void fetchPage(true) }
    wsClient.on('external-dirs:ready', handler)
    wsClient.on('external-dirs:changed', handler)
    return () => {
      wsClient.off('external-dirs:ready', handler)
      wsClient.off('external-dirs:changed', handler)
    }
  }, [enabled, workspaceId, fetchPage])

  const loadMore = useCallback(async () => {
    if (!hasMore) return
    await fetchPage(false)
  }, [fetchPage, hasMore])

  const reload = useCallback(async () => {
    await fetchPage(true)
  }, [fetchPage])

  // Optimistic drop after a row is adopted — server-side state will catch up
  // via openteam:chat-created → useExternalCwds refresh, but the dropped row
  // should disappear immediately.
  const hide = useCallback((sessionId: string) => {
    setSessions((prev) => prev.filter((s) => s.id !== sessionId))
  }, [])

  return { sessions, hasMore, loading, error, loadMore, reload, hide }
}
