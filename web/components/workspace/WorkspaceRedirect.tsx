import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { API_BASE, authFetch } from '@/config/api'
import type { WorkspaceInfo } from '@/components/home/types'

const LAST_KEY = 'openteam:last-workspace'

/** Resolves `/` → last-visited workspace, else first workspace, else `/workspaces`
 *  (so the user can create one). */
const WorkspaceRedirect = () => {
  const [target, setTarget] = useState<string | null>(null)

  useEffect(() => {
    const last = localStorage.getItem(LAST_KEY)
    if (last) {
      setTarget(`/workspace/${last}`)
      return
    }
    let cancelled = false
    authFetch(`${API_BASE}/api/workspaces`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list: WorkspaceInfo[]) => {
        if (cancelled) return
        if (list.length === 0) {
          setTarget('/workspaces')
          return
        }
        setTarget(`/workspace/${list[0].id}`)
      })
      .catch(() => { if (!cancelled) setTarget('/workspaces') })
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

export const persistLastWorkspace = (workspaceId: string): void => {
  try { localStorage.setItem(LAST_KEY, workspaceId) } catch { /* storage unavailable */ }
}

export default WorkspaceRedirect
