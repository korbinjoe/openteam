/**
 * useWorkspaceMeta — Lightweight workspace name/id fetch for header surfaces.
 * Separate from useWorkspaceDetail (which carries full editing/dialog state).
 */

import { useEffect, useState } from 'react'
import { API_BASE, authFetch } from '@/config/api'

export interface WorkspaceMeta {
  id: string
  name: string
  repositories: Array<{ path: string; name: string }>
}

export const useWorkspaceMeta = (workspaceId: string | null | undefined) => {
  const [meta, setMeta] = useState<WorkspaceMeta | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!workspaceId) {
      setMeta(null)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    authFetch(`${API_BASE}/api/workspaces/${workspaceId}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: WorkspaceMeta | null) => {
        if (controller.signal.aborted) return
        setMeta(data)
      })
      .catch(() => { if (!controller.signal.aborted) setMeta(null) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })

    return () => controller.abort()
  }, [workspaceId])

  return { meta, loading }
}
