import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import { API_BASE, authFetch } from '@/config/api'
import type { WorkspaceInfo } from '@/components/home/types'

const LAST_KEY = 'openteam:workspace-v2:last-workspace'

/** Resolves `/v2` → last-visited workspace, else first workspace, else `/workspaces`
 *  (so the user can create one). Avoids the previous `/v2/workspace/default` path
 *  which always 404'd on workspaces. */
const V2WorkspaceRedirect = () => {
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    const last = localStorage.getItem(LAST_KEY)
    if (last) {
      setTarget(`/v2/workspace/${last}`)
      return
    }
    let cancelled = false
    authFetch(`${API_BASE}/api/workspaces`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: WorkspaceInfo[]) => {
        if (cancelled) return
        if (list.length === 0) {
          setTarget('/v2/workspaces')
          return
        }
        setTarget(`/v2/workspace/${list[0].id}`)
      })
      .catch(() => { if (!cancelled) setTarget('/v2/workspaces') })
    return () => { cancelled = true }
  }, [])

  if (!target) {
    return (
      <div className="h-screen flex items-center justify-center text-text-muted text-sm bg-bg-primary">
        Loading workspace…
      </div>
    )
  }

  return <Navigate to={target} replace />
}

export const persistLastV2Workspace = (workspaceId: string): void => {
  try { localStorage.setItem(LAST_KEY, workspaceId) } catch { /* storage unavailable */ }
}

/** Back-compat: redirect legacy /v2/workspace/:workspaceId/chat/:taskId to /task/:taskId */
export const V2ChatToTaskRedirect = () => {
  const { workspaceId, taskId } = useParams<{ workspaceId: string; taskId: string }>()
  if (!workspaceId || !taskId) return <Navigate to="/v2" replace />
  return <Navigate to={`/v2/workspace/${workspaceId}/task/${taskId}`} replace />
}

export default V2WorkspaceRedirect
