/**
 * useTaskPinArchive — Persist user-controlled task organization (pin / archive)
 * for the v2 sidebar. Storage is workspace-scoped via localStorage so each
 * workspace keeps its own pinned and archived sets.
 *
 * Auto-archive: chats become eligible for archive when terminal. `merged` is
 * immediate; `idle` / `stopped` only after they've been quiet for
 * AUTO_ARCHIVE_DAYS. Users can unarchive any auto-archived chat — the override
 * is recorded so the rule won't immediately re-archive it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Chat } from '../components/workspace/types'

const STORAGE_PREFIX = 'openteam:v2:taskOrg:'
const AUTO_ARCHIVE_DAYS = 2
const AUTO_ARCHIVE_MS = AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000
// Re-evaluate auto-archive periodically so chats cross the threshold without
// requiring a page refresh. Exact cadence isn't important.
const RECHECK_INTERVAL_MS = 30 * 60 * 1000

interface TaskOrgState {
  pinned: string[]
  archived: string[]
  pinnedAt: Record<string, number>
  unarchivedManually: string[]
}

const emptyState = (): TaskOrgState => ({
  pinned: [],
  archived: [],
  pinnedAt: {},
  unarchivedManually: [],
})

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
      unarchivedManually: Array.isArray(parsed.unarchivedManually) ? parsed.unarchivedManually : [],
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

const chatMtime = (c: Chat): number => {
  if (c.lastMessageAt) {
    const t = new Date(c.lastMessageAt).getTime()
    if (!Number.isNaN(t)) return t
  }
  if (c.createdAt) {
    const t = new Date(c.createdAt).getTime()
    if (!Number.isNaN(t)) return t
  }
  return 0
}

const computeAutoArchived = (chats: Chat[], now: number): Set<string> => {
  const out = new Set<string>()
  for (const c of chats) {
    if (c.status === 'merged') {
      out.add(c.id)
      continue
    }
    if (c.status !== 'idle' && c.status !== 'stopped') continue
    const last = chatMtime(c)
    if (last === 0) continue
    if (now - last > AUTO_ARCHIVE_MS) out.add(c.id)
  }
  return out
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

export const useTaskPinArchive = (
  workspaceId: string | null | undefined,
  chats: Chat[] = [],
): TaskPinArchiveApi => {
  const [state, setState] = useState<TaskOrgState>(() => readState(workspaceId))

  useEffect(() => {
    setState(readState(workspaceId))
  }, [workspaceId])

  const [recheckTick, setRecheckTick] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const id = window.setInterval(() => setRecheckTick((t) => t + 1), RECHECK_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])

  const autoArchived = useMemo(
    () => computeAutoArchived(chats, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick deliberately re-triggers Date.now()
    [chats, recheckTick],
  )

  const archivedIds = useMemo(() => {
    const out = new Set<string>(state.archived)
    const unarchived = new Set(state.unarchivedManually)
    const pinned = new Set(state.pinned)
    for (const id of autoArchived) {
      if (unarchived.has(id)) continue
      if (pinned.has(id)) continue
      out.add(id)
    }
    return out
  }, [state.archived, state.unarchivedManually, state.pinned, autoArchived])

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
          ...prev,
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
      const currentlyArchived = archivedIds.has(chatId)
      const isAuto = autoArchived.has(chatId)
      persist((prev) => {
        if (currentlyArchived) {
          // Unarchive: drop manual entry; if it was auto-archived, remember the
          // override so the auto rule won't immediately put it back.
          const nextArchived = prev.archived.filter((id) => id !== chatId)
          const nextUnarchived = isAuto && !prev.unarchivedManually.includes(chatId)
            ? [chatId, ...prev.unarchivedManually]
            : prev.unarchivedManually
          return { ...prev, archived: nextArchived, unarchivedManually: nextUnarchived }
        }
        // Archive: record manual archive, drop any override marker, and unpin.
        const { [chatId]: _omit, ...restPinnedAt } = prev.pinnedAt
        return {
          pinned: prev.pinned.filter((id) => id !== chatId),
          archived: [chatId, ...prev.archived],
          pinnedAt: restPinnedAt,
          unarchivedManually: prev.unarchivedManually.filter((id) => id !== chatId),
        }
      })
    },
    [persist, archivedIds, autoArchived],
  )

  return {
    pinnedIds: new Set(state.pinned),
    archivedIds,
    pinnedAt: state.pinnedAt,
    isPinned: (chatId) => state.pinned.includes(chatId),
    isArchived: (chatId) => archivedIds.has(chatId),
    togglePin,
    toggleArchive,
  }
}
