/**
 * useExternalCwds — surfaces external (auto-discovered) local CLI sessions
 * in the sidebar.
 *
 * Calls GET /api/sidebar/groups once and stays live via two WS events:
 *   - external-dirs:ready    — initial enumeration finished, refetch once
 *   - external-dirs:changed  — fs watcher tripped, refetch
 *
 * Returns:
 *   - externalDirsByWs:  workspaceId → { cwd, providers, sessionCount } list
 *                        (only cwds that fall under the workspace's repos)
 *   - unmatchedDirs:     orphan cwds with no matching workspace
 *
 * The hook is intentionally a thin wrapper around the snapshot endpoint —
 * native chats still come from useAllChats. We layer external data ON TOP
 * rather than replacing the existing chat fetch so the change stays small.
 */

import { useCallback, useEffect, useState } from 'react'
import { API_BASE, authFetch } from '@/config/api'
import { getWebSocketClient } from '@/services/WebSocketClient'

export type CliProviderKind = 'claude' | 'codex'

export interface ExternalDirInfo {
  cwd: string
  providers: CliProviderKind[]
  sessionCount: number
  latestMtimeMs: number
}

export interface UnmatchedExternalDir extends ExternalDirInfo {
  adoptedCount: number
}

interface GroupsResponse {
  workspaces: Array<{
    id: string
    name: string
    externalDirs: ExternalDirInfo[]
  }>
  unmatchedDirs: UnmatchedExternalDir[]
}

export interface UseExternalCwdsResult {
  externalDirsByWs: Record<string, ExternalDirInfo[]>
  unmatchedDirs: UnmatchedExternalDir[]
  loading: boolean
  refresh: () => Promise<void>
}

const emptyResult: GroupsResponse = { workspaces: [], unmatchedDirs: [] }

export const useExternalCwds = (): UseExternalCwdsResult => {
  const [data, setData] = useState<GroupsResponse>(emptyResult)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch(`${API_BASE}/api/sidebar/groups`)
      if (!res.ok) return
      const body = (await res.json()) as GroupsResponse
      setData(body)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const wsClient = getWebSocketClient()
    wsClient.connect().catch(() => {})

    const handler = () => { void refresh() }
    wsClient.on('external-dirs:ready', handler)
    wsClient.on('external-dirs:changed', handler)

    return () => {
      wsClient.off('external-dirs:ready', handler)
      wsClient.off('external-dirs:changed', handler)
    }
  }, [refresh])

  const externalDirsByWs: Record<string, ExternalDirInfo[]> = {}
  for (const ws of data.workspaces) {
    if (ws.externalDirs.length > 0) externalDirsByWs[ws.id] = ws.externalDirs
  }

  return {
    externalDirsByWs,
    unmatchedDirs: data.unmatchedDirs,
    loading,
    refresh,
  }
}
