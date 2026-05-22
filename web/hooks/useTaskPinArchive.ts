/**
 * useTaskPinArchive — Persist user-controlled task organization (pin / archive)
 * for the v2 sidebar. Storage is workspace-scoped via localStorage so each
 * workspace keeps its own pinned and archived sets.
 */

import { useCallback, useEffect, useState } from 'react'

const STORAGE_PREFIX = 'openteam:v2:taskOrg:'

interface TaskOrgState {
  pinned: string[]
  archived: string[]
  pinnedAt: Record<string, number>
}

const emptyState = (): TaskOrgState => ({ pinned: [], archived: [], pinnedAt: {} })

const readState = (workspaceId: string | null | undefined): TaskOrgState => {
  if (!workspaceId || typeof window === 'undefined') return emptyState()
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + workspaceId)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw)
    return {
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : [],
      archived: Array.isArray(parsed.archived) ? parsed.archived : [],
      pinnedAt: parsed.pinnedAt && typeof parsed.pinnedAt === 'object' ? parsed.pinnedAt : {},
    }
  } catch {
    return emptyState()
  }
}

const writeState = (workspaceId: string, state: TaskOrgState) => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_PREFIX + workspaceId, JSON.stringify(state))
  } catch {
    // localStorage may be full or disabled — silently ignore
  }
}

export interface TaskPinArchiveApi {
  pinnedIds: Set<string>
  archivedIds: Set<string>
  pinnedAt: Record<string, number>
  isPinned: (chatId: string) => boolean
  isArchived: (chatId: string) => boolean
  togglePin: (chatId: string) => void
  toggleArchive: (chatId: string) => void
}

export const useTaskPinArchive = (workspaceId: string | null | undefined): TaskPinArchiveApi => {
  const [state, setState] = useState<TaskOrgState>(() => readState(workspaceId))

  useEffect(() => {
    setState(readState(workspaceId))
  }, [workspaceId])

  const persist = useCallback(
    (updater: (prev: TaskOrgState) => TaskOrgState) => {
      setState((prev) => {
        const next = updater(prev)
        if (workspaceId) writeState(workspaceId, next)
        return next
      })
    },
    [workspaceId],
  )

  const togglePin = useCallback(
    (chatId: string) => {
      persist((prev) => {
        const isPinned = prev.pinned.includes(chatId)
        if (isPinned) {
          const { [chatId]: _omit, ...rest } = prev.pinnedAt
          return { ...prev, pinned: prev.pinned.filter((id) => id !== chatId), pinnedAt: rest }
        }
        return {
          pinned: [chatId, ...prev.pinned],
          archived: prev.archived.filter((id) => id !== chatId),
          pinnedAt: { ...prev.pinnedAt, [chatId]: Date.now() },
        }
      })
    },
    [persist],
  )

  const toggleArchive = useCallback(
    (chatId: string) => {
      persist((prev) => {
        const isArchived = prev.archived.includes(chatId)
        if (isArchived) {
          return { ...prev, archived: prev.archived.filter((id) => id !== chatId) }
        }
        const { [chatId]: _omit, ...restPinnedAt } = prev.pinnedAt
        return {
          pinned: prev.pinned.filter((id) => id !== chatId),
          archived: [chatId, ...prev.archived],
          pinnedAt: restPinnedAt,
        }
      })
    },
    [persist],
  )

  return {
    pinnedIds: new Set(state.pinned),
    archivedIds: new Set(state.archived),
    pinnedAt: state.pinnedAt,
    isPinned: (chatId) => state.pinned.includes(chatId),
    isArchived: (chatId) => state.archived.includes(chatId),
    togglePin,
    toggleArchive,
  }
}
