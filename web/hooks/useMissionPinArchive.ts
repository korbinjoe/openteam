/**
 * useMissionPinArchive — Persist user-controlled mission organization (pin / archive)
 * for the v2 sidebar.
 *
 * Source of truth for pin / archive is the chat row on the server
 * (chats.pinned_at, chats.archived_at). State follows the chat across
 * workspaces, browsers, and devices, and propagates via the chat:meta-updated
 * WS event. localStorage is used only for:
 *   - `unarchivedManually`: client-side override so the auto-archive rule
 *     (status === 'merged' || stale idle) doesn't keep flipping a chat back.
 *   - a one-shot migration that pushes legacy pinned / archived ids to the
 *     server the first time the new code runs.
 *
 * Auto-archive: chats become eligible for archive when terminal. `merged` is
 * immediate; `idle` / `stopped` only after they've been quiet for
 * AUTO_ARCHIVE_DAYS. Pinned chats are never auto-archived.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, authFetch } from '@/config/api'
import type { Chat } from '../components/workspace/types'

const LOCAL_STORAGE_KEY = 'openteam:v2:missionOrg:global'
const LEGACY_STORAGE_PREFIX = 'openteam:v2:missionOrg:'
const MIGRATION_FLAG_KEY = 'openteam:v2:missionOrg:serverMigrated'
const AUTO_ARCHIVE_DAYS = 2
const AUTO_ARCHIVE_MS = AUTO_ARCHIVE_DAYS * 24 * 60 * 60 * 1000
// Re-evaluate auto-archive periodically so chats cross the threshold without
// requiring a page refresh. Exact cadence isn't important.
const RECHECK_INTERVAL_MS = 30 * 60 * 1000

interface LocalState {
  unarchivedManually: string[]
  // Legacy fields retained only for one-shot migration to the server.
  pinned?: string[]
  archived?: string[]
  pinnedAt?: Record<string, number>
}

const emptyState = (): LocalState => ({ unarchivedManually: [] })

const parseState = (raw: string | null): LocalState => {
  if (!raw) return emptyState()
  try {
    const parsed = JSON.parse(raw)
    return {
      unarchivedManually: Array.isArray(parsed.unarchivedManually) ? parsed.unarchivedManually : [],
      pinned: Array.isArray(parsed.pinned) ? parsed.pinned : undefined,
      archived: Array.isArray(parsed.archived) ? parsed.archived : undefined,
      pinnedAt: parsed.pinnedAt && typeof parsed.pinnedAt === 'object' ? parsed.pinnedAt : undefined,
    }
  } catch {
    return emptyState()
  }
}

// Union every legacy per-workspace key into the global key so we have one
// authoritative blob to migrate to the server.
const consolidateLegacyKeys = (): LocalState => {
  if (typeof window === 'undefined') return emptyState()
  const ls = window.localStorage
  const base = parseState(ls.getItem(LOCAL_STORAGE_KEY))
  const pinnedSet = new Set<string>(base.pinned ?? [])
  const archivedSet = new Set<string>(base.archived ?? [])
  const unarchivedSet = new Set<string>(base.unarchivedManually)
  const pinnedAt: Record<string, number> = { ...(base.pinnedAt ?? {}) }
  const legacyKeys: string[] = []
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i)
    if (!key || !key.startsWith(LEGACY_STORAGE_PREFIX)) continue
    if (key === LOCAL_STORAGE_KEY) continue
    if (key === MIGRATION_FLAG_KEY) continue
    legacyKeys.push(key)
  }
  for (const key of legacyKeys) {
    const legacy = parseState(ls.getItem(key))
    for (const id of legacy.pinned ?? []) pinnedSet.add(id)
    for (const id of legacy.archived ?? []) archivedSet.add(id)
    for (const id of legacy.unarchivedManually) unarchivedSet.add(id)
    for (const [id, ts] of Object.entries(legacy.pinnedAt ?? {})) {
      if (typeof ts === 'number' && (pinnedAt[id] ?? 0) < ts) pinnedAt[id] = ts
    }
  }
  const next: LocalState = {
    unarchivedManually: Array.from(unarchivedSet),
    pinned: pinnedSet.size > 0 ? Array.from(pinnedSet) : undefined,
    archived: archivedSet.size > 0 ? Array.from(archivedSet) : undefined,
    pinnedAt: Object.keys(pinnedAt).length > 0 ? pinnedAt : undefined,
  }
  try {
    ls.setItem(LOCAL_STORAGE_KEY, JSON.stringify(next))
    for (const key of legacyKeys) ls.removeItem(key)
  } catch {
    // localStorage may be full or disabled — silently ignore
  }
  return next
}

const readState = (): LocalState => {
  if (typeof window === 'undefined') return emptyState()
  return consolidateLegacyKeys()
}

const writeState = (state: LocalState) => {
  if (typeof window === 'undefined') return
  try {
    // Only persist the override list; legacy fields are dropped once migrated.
    window.localStorage.setItem(
      LOCAL_STORAGE_KEY,
      JSON.stringify({ unarchivedManually: state.unarchivedManually }),
    )
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

const putChat = async (chatId: string, body: Record<string, unknown>): Promise<void> => {
  try {
    await authFetch(`${API_BASE}/api/chats/${chatId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // Best-effort — the WS broadcast (or next refresh) will reconcile.
  }
}

export interface MissionPinArchiveApi {
  pinnedIds: Set<string>
  archivedIds: Set<string>
  pinnedAt: Record<string, number>
  isPinned: (chatId: string) => boolean
  isArchived: (chatId: string) => boolean
  togglePin: (chatId: string) => void
  toggleArchive: (chatId: string) => void
  archiveAll: (chatIds: string[]) => void
}

export const useMissionPinArchive = (
  chats: Chat[] = [],
): MissionPinArchiveApi => {
  const [state, setState] = useState<LocalState>(() => readState())

  // Optimistic overrides keyed by chatId. `null` means "explicitly cleared",
  // `undefined` means "no override". Cleared on every chats update so the
  // server-side truth wins as soon as it arrives.
  const [optPinnedAt, setOptPinnedAt] = useState<Record<string, number | null>>({})
  const [optArchivedAt, setOptArchivedAt] = useState<Record<string, number | null>>({})

  const [recheckTick, setRecheckTick] = useState(0)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const id = window.setInterval(() => setRecheckTick((t) => t + 1), RECHECK_INTERVAL_MS)
    return () => window.clearInterval(id)
  }, [])

  // Reconcile optimistic overrides against the latest chats: drop any entry
  // that the server now confirms (either matches our intent or supersedes it).
  useEffect(() => {
    if (Object.keys(optPinnedAt).length === 0 && Object.keys(optArchivedAt).length === 0) return
    const byId = new Map(chats.map((c) => [c.id, c]))
    setOptPinnedAt((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of Object.keys(prev)) {
        const chat = byId.get(id)
        if (!chat) continue
        const want = prev[id]
        const actual = chat.pinnedAt ?? null
        if ((want === null && actual === null) || (want !== null && actual !== null)) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
    setOptArchivedAt((prev) => {
      let changed = false
      const next = { ...prev }
      for (const id of Object.keys(prev)) {
        const chat = byId.get(id)
        if (!chat) continue
        const want = prev[id]
        const actual = chat.archivedAt ?? null
        if ((want === null && actual === null) || (want !== null && actual !== null)) {
          delete next[id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [chats, optPinnedAt, optArchivedAt])

  // One-shot migration: push any legacy pinned/archived ids that the server
  // hasn't recorded yet (chat.pinnedAt / chat.archivedAt are null) up via PUT.
  const migrationStartedRef = useRef(false)
  useEffect(() => {
    if (migrationStartedRef.current) return
    if (typeof window === 'undefined') return
    if (window.localStorage.getItem(MIGRATION_FLAG_KEY) === '1') return
    if (chats.length === 0) return
    const legacyPinned = state.pinned ?? []
    const legacyArchived = state.archived ?? []
    const legacyPinnedAt = state.pinnedAt ?? {}
    if (legacyPinned.length === 0 && legacyArchived.length === 0) {
      try { window.localStorage.setItem(MIGRATION_FLAG_KEY, '1') } catch {}
      // Drop legacy keys from the persisted blob.
      writeState(state)
      return
    }
    migrationStartedRef.current = true
    const byId = new Map(chats.map((c) => [c.id, c]))
    const now = Date.now()
    const pushes: Array<Promise<void>> = []
    for (const id of legacyPinned) {
      const chat = byId.get(id)
      if (!chat || chat.pinnedAt) continue
      pushes.push(putChat(id, { pinnedAt: legacyPinnedAt[id] ?? now }))
    }
    for (const id of legacyArchived) {
      const chat = byId.get(id)
      if (!chat || chat.archivedAt) continue
      pushes.push(putChat(id, { archivedAt: now }))
    }
    void Promise.allSettled(pushes).then(() => {
      try { window.localStorage.setItem(MIGRATION_FLAG_KEY, '1') } catch {}
      writeState(state)
    })
  }, [chats, state])

  const pinnedIds = useMemo(() => {
    const out = new Set<string>()
    for (const c of chats) {
      const override = optPinnedAt[c.id]
      if (override === null) continue
      if (override !== undefined || c.pinnedAt) out.add(c.id)
    }
    return out
  }, [chats, optPinnedAt])

  const serverPinnedAt = useMemo(() => {
    const out: Record<string, number> = {}
    for (const c of chats) {
      const override = optPinnedAt[c.id]
      if (override === null) continue
      if (override !== undefined) out[c.id] = override
      else if (c.pinnedAt) out[c.id] = c.pinnedAt
    }
    return out
  }, [chats, optPinnedAt])

  const autoArchived = useMemo(
    () => computeAutoArchived(chats, Date.now()),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick deliberately re-triggers Date.now()
    [chats, recheckTick],
  )

  const archivedIds = useMemo(() => {
    const out = new Set<string>()
    const unarchived = new Set(state.unarchivedManually)
    for (const c of chats) {
      if (pinnedIds.has(c.id)) continue
      const override = optArchivedAt[c.id]
      if (override === null) continue
      if (override !== undefined) { out.add(c.id); continue }
      if (c.archivedAt) { out.add(c.id); continue }
      if (autoArchived.has(c.id) && !unarchived.has(c.id)) out.add(c.id)
    }
    return out
  }, [chats, optArchivedAt, pinnedIds, autoArchived, state.unarchivedManually])

  const persistOverride = useCallback((updater: (prev: LocalState) => LocalState) => {
    setState((prev) => {
      const next = updater(prev)
      writeState(next)
      return next
    })
  }, [])

  const togglePin = useCallback(
    (chatId: string) => {
      const isPinned = pinnedIds.has(chatId)
      if (isPinned) {
        setOptPinnedAt((prev) => ({ ...prev, [chatId]: null }))
        void putChat(chatId, { pinnedAt: null })
      } else {
        const ts = Date.now()
        setOptPinnedAt((prev) => ({ ...prev, [chatId]: ts }))
        // Pinning also clears any archive — the user has indicated they want
        // this chat visible. Mirror the change locally and on the server.
        if (archivedIds.has(chatId)) {
          setOptArchivedAt((prev) => ({ ...prev, [chatId]: null }))
          void putChat(chatId, { pinnedAt: ts, archivedAt: null })
        } else {
          void putChat(chatId, { pinnedAt: ts })
        }
      }
    },
    [pinnedIds, archivedIds],
  )

  const toggleArchive = useCallback(
    (chatId: string) => {
      const currentlyArchived = archivedIds.has(chatId)
      if (currentlyArchived) {
        // Unarchive: clear server flag AND record a client-side override so
        // the auto-archive rule won't flip the chat back when its status
        // later qualifies (e.g. idle/stale).
        setOptArchivedAt((prev) => ({ ...prev, [chatId]: null }))
        void putChat(chatId, { archivedAt: null })
        persistOverride((prev) => prev.unarchivedManually.includes(chatId)
          ? prev
          : { ...prev, unarchivedManually: [chatId, ...prev.unarchivedManually] })
      } else {
        const ts = Date.now()
        setOptArchivedAt((prev) => ({ ...prev, [chatId]: ts }))
        if (pinnedIds.has(chatId)) {
          setOptPinnedAt((prev) => ({ ...prev, [chatId]: null }))
          void putChat(chatId, { archivedAt: ts, pinnedAt: null })
        } else {
          void putChat(chatId, { archivedAt: ts })
        }
        persistOverride((prev) => ({
          ...prev,
          unarchivedManually: prev.unarchivedManually.filter((id) => id !== chatId),
        }))
      }
    },
    [archivedIds, pinnedIds, persistOverride],
  )

  const archiveAll = useCallback(
    (chatIds: string[]) => {
      if (chatIds.length === 0) return
      const ts = Date.now()
      const toArchive = chatIds.filter((id) => !archivedIds.has(id))
      if (toArchive.length === 0) return
      setOptArchivedAt((prev) => {
        const next = { ...prev }
        for (const id of toArchive) next[id] = ts
        return next
      })
      setOptPinnedAt((prev) => {
        const next = { ...prev }
        for (const id of toArchive) if (pinnedIds.has(id)) next[id] = null
        return next
      })
      for (const id of toArchive) {
        const body: Record<string, unknown> = { archivedAt: ts }
        if (pinnedIds.has(id)) body.pinnedAt = null
        void putChat(id, body)
      }
      persistOverride((prev) => ({
        ...prev,
        unarchivedManually: prev.unarchivedManually.filter((id) => !toArchive.includes(id)),
      }))
    },
    [archivedIds, pinnedIds, persistOverride],
  )

  return {
    pinnedIds,
    archivedIds,
    pinnedAt: serverPinnedAt,
    isPinned: (chatId) => pinnedIds.has(chatId),
    isArchived: (chatId) => archivedIds.has(chatId),
    togglePin,
    toggleArchive,
    archiveAll,
  }
}
