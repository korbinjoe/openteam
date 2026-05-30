import { useCallback, useMemo, useState } from 'react'

const STORAGE_KEY = 'openteam:v2:hiddenWorkspaces'

const readHidden = (): string[] => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const writeHidden = (ids: string[]) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
  } catch {
    // localStorage may be full or disabled
  }
}

export interface WorkspaceVisibilityApi {
  hiddenIds: Set<string>
  isHidden: (wsId: string) => boolean
  toggleHide: (wsId: string) => void
}

export const useWorkspaceVisibility = (): WorkspaceVisibilityApi => {
  const [hidden, setHidden] = useState<string[]>(() => readHidden())

  const hiddenIds = useMemo(() => new Set(hidden), [hidden])

  const isHidden = useCallback((wsId: string) => hiddenIds.has(wsId), [hiddenIds])

  const toggleHide = useCallback((wsId: string) => {
    setHidden((prev) => {
      const next = prev.includes(wsId)
        ? prev.filter((id) => id !== wsId)
        : [...prev, wsId]
      writeHidden(next)
      return next
    })
  }, [])

  return { hiddenIds, isHidden, toggleHide }
}
