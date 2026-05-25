import { useCallback, useEffect, useMemo, useState } from 'react'

// Sidebar pagination: every group shows this many items first; "Load more"
// grows the visible slice in the same step. When the slice catches up to the
// already-fetched items and the server still has more, the click also triggers
// a network fetch before growing the slice.
const INITIAL_VISIBLE = 10
const PAGE_STEP = 10
import { API_BASE, authFetch } from '@/config/api'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAllChats } from '../../hooks/useAllChats'
import { useAgents } from '../../hooks/useAgents'
import { useMissionPinArchive } from '../../hooks/useMissionPinArchive'
import { useExternalCwds, type UnmatchedExternalDir } from '../../hooks/useExternalCwds'
import { useWorkspaceExternalSessions } from '../../hooks/useWorkspaceExternalSessions'
import { useExternalCwdSessions, type ExternalSession } from '../../hooks/useExternalCwdSessions'
import { ChevronDown, ChevronRight, Plus, Archive, Pin } from './icons'
import type { Chat } from './types'
import { MissionRow, CompletedRow } from './MissionSessionRows'
import { ExternalSessionRow } from './ExternalSessionRow'

interface MissionSessionListProps {
  query?: string
}

const MissionSessionList = ({ query = '' }: MissionSessionListProps) => {
  const { workspaceId, activeChatId, openAddAgent, openNewMission } = useWorkspace()
  const { chats, workspaces, loading } = useAllChats()
  const { unmatchedDirs } = useExternalCwds()
  const { agentNames } = useAgents()

  const q = query.trim().toLowerCase()
  const isSearching = q.length > 0

  const { pinnedIds, pinnedAt, archivedIds, togglePin, toggleArchive, archiveAll } = useMissionPinArchive(chats)

  // Global pinned chats — extracted from all workspaces, rendered at the top.
  const wsNameById = useMemo(() => {
    const m: Record<string, string> = {}
    for (const ws of workspaces) m[ws.id] = ws.name
    return m
  }, [workspaces])

  const globalPinnedChats = useMemo(
    () => chats
      .filter((c) => pinnedIds.has(c.id))
      .sort((a, b) => (pinnedAt[b.id] ?? 0) - (pinnedAt[a.id] ?? 0)),
    [chats, pinnedIds, pinnedAt],
  )

  // Session-local expansion only. Default-collapsed so the sidebar opens as a
  // scannable index rather than a wall of nested rows; the active workspace
  // (the one holding the current chat) auto-opens to preserve context.
  const [wsExpanded, setWsExpanded] = useState<Record<string, boolean>>({})
  const [extDirExpanded, setExtDirExpanded] = useState<Record<string, boolean>>({})

  const activeWorkspaceId = useMemo(() => {
    if (!activeChatId) return null
    return chats.find((c) => c.id === activeChatId)?.workspaceId ?? null
  }, [activeChatId, chats])

  const defaultExpanded = useCallback(
    (wsId: string) => wsId === activeWorkspaceId,
    [activeWorkspaceId],
  )

  const toggleWorkspace = useCallback((wsId: string) => {
    setWsExpanded((prev) => ({ ...prev, [wsId]: !(prev[wsId] ?? defaultExpanded(wsId)) }))
  }, [defaultExpanded])

  // Selecting a mission collapses every other workspace: drop manual overrides
  // so only the active workspace stays open via defaultExpanded. Users can
  // still re-expand others to browse — the reset only fires when the selection
  // changes, not on every render.
  useEffect(() => {
    setWsExpanded({})
  }, [activeChatId])

  const toggleExtDir = useCallback((cwd: string) => {
    setExtDirExpanded((prev) => ({ ...prev, [cwd]: !prev[cwd] }))
  }, [])

  if (loading && workspaces.length === 0 && unmatchedDirs.length === 0) {
    return <div className="px-3 py-3 text-[10px] text-text-muted">Loading…</div>
  }

  // Always render every workspace + every unmatched local dir, regardless of
  // whether the URL has a workspace selected. The selected workspace just
  // drives which chat is highlighted and (optionally later) auto-scroll. This
  // keeps the user's full local jsonl inventory visible in one place.
  const visibleUnmatched = unmatchedDirs.filter(
    (d) => d.sessionCount > 0 || d.adoptedCount > 0,
  )

  if (workspaces.length === 0 && visibleUnmatched.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <div className="text-[11px] text-text-secondary mb-1">No missions yet</div>
        <div className="text-[10px] text-text-muted leading-relaxed">Create one with ⌘N or the New Mission button.</div>
      </div>
    )
  }

  // While searching: hide workspaces with no name match and no chat-title match.
  // External sessions are also filterable but only against what's already loaded —
  // we don't trigger fetches based on the query.
  const renderedWorkspaces = workspaces
    .map((ws) => {
      const wsChats = chats.filter((c) => c.workspaceId === ws.id)
      if (!isSearching) return { ws, wsChats, wsNameMatches: false }
      const wsNameMatches = ws.name.toLowerCase().includes(q)
      const anyChatMatches = wsChats.some((c) => c.title.toLowerCase().includes(q))
      if (!wsNameMatches && !anyChatMatches) return null
      return { ws, wsChats, wsNameMatches }
    })
    .filter((x): x is { ws: typeof workspaces[number]; wsChats: Chat[]; wsNameMatches: boolean } => x !== null)

  // Pinned chats filtered by search query
  const visiblePinned = isSearching
    ? globalPinnedChats.filter((c) => c.title.toLowerCase().includes(q))
    : globalPinnedChats

  const hasMatches = !isSearching || renderedWorkspaces.length > 0 || visiblePinned.length > 0

  return (
    <div className="flex flex-col gap-1 pb-2">
      {visiblePinned.length > 0 && (
        <PinnedSection
          chats={visiblePinned}
          activeChatId={activeChatId}
          agentNames={agentNames}
          wsNameById={wsNameById}
          onPin={togglePin}
          onArchive={toggleArchive}
          onAddAgent={openAddAgent}
        />
      )}
      {renderedWorkspaces.map(({ ws, wsChats, wsNameMatches }) => {
        const expanded = isSearching ? true : (wsExpanded[ws.id] ?? defaultExpanded(ws.id))
        return (
          <WorkspaceGroup
            key={ws.id}
            wsId={ws.id}
            name={ws.name}
            chats={wsChats}
            pinnedIds={pinnedIds}
            pinnedAt={pinnedAt}
            archivedIds={archivedIds}
            hidePinnedSection
            expanded={expanded}
            isCurrent={ws.id === workspaceId}
            activeChatId={activeChatId}
            agentNames={agentNames}
            query={q}
            wsNameMatches={wsNameMatches}
            onToggle={() => toggleWorkspace(ws.id)}
            onPin={togglePin}
            onArchive={toggleArchive}
            onArchiveAll={archiveAll}
            onAddAgent={openAddAgent}
            onNewTask={openNewMission}
          />
        )
      })}

      {!isSearching && visibleUnmatched.length > 0 && (
        <UnmatchedDirsSection
          dirs={visibleUnmatched}
          expandedMap={extDirExpanded}
          onToggle={toggleExtDir}
          onPin={togglePin}
          onArchive={toggleArchive}
          onAddAgent={openAddAgent}
        />
      )}

      {isSearching && !hasMatches && (
        <div className="px-3 py-6 text-center">
          <div className="text-[11px] text-text-secondary mb-1">No matching missions</div>
          <div className="text-[10px] text-text-muted">Try a different keyword.</div>
        </div>
      )}
    </div>
  )
}

// ── Global pinned section ──────────────────────────────────────────────────
const PinnedSection = ({ chats, activeChatId, agentNames, wsNameById, onPin, onArchive, onAddAgent }: {
  chats: Chat[]
  activeChatId: string | null
  agentNames: Record<string, string>
  wsNameById: Record<string, string>
  onPin: (chatId: string) => void
  onArchive: (chatId: string) => void
  onAddAgent: (chatId: string) => void
}) => (
  <div className="pb-1 mb-1 border-b border-border/40">
    <div className="flex items-center gap-1.5 px-2 py-1">
      <Pin size={10} className="text-text-muted" />
      <span className="text-[11px] font-medium text-text-secondary uppercase tracking-wide">Pinned</span>
    </div>
    <div className="flex flex-col gap-0.5 ml-2">
      {chats.map((c) => (
        <MissionRow
          key={`pin:${c.id}`}
          chat={c}
          isSelected={activeChatId === c.id}
          agentNames={agentNames}
          onPin={() => onPin(c.id)}
          onArchive={() => onArchive(c.id)}
          onAddAgent={() => onAddAgent(c.id)}
          isPinned
          badge={wsNameById[c.workspaceId]}
        />
      ))}
    </div>
  </div>
)

// ── Workspace group ────────────────────────────────────────────────────────
// Unifies native chats + external sessions for ONE workspace into a single
// time-ordered list, with "Load more" pulling the next page of external rows.
// External fetch fires only when the group is expanded. `isCurrent` flags the
// workspace the URL currently points at so its header gets a subtle marker.
const WorkspaceGroup = ({
  wsId, name, chats, pinnedIds, pinnedAt, archivedIds,
  expanded, isCurrent, activeChatId, agentNames,
  query, wsNameMatches, hidePinnedSection = false,
  onToggle, onPin, onArchive, onArchiveAll, onAddAgent, onNewTask,
}: {
  wsId: string
  name: string
  chats: Chat[]
  pinnedIds: Set<string>
  pinnedAt: Record<string, number>
  archivedIds: Set<string>
  expanded: boolean
  isCurrent: boolean
  activeChatId: string | null
  agentNames: Record<string, string>
  query: string
  wsNameMatches: boolean
  hidePinnedSection?: boolean
  onToggle: () => void
  onPin: (chatId: string) => void
  onArchive: (chatId: string) => void
  onArchiveAll: (chatIds: string[]) => void
  onAddAgent: (chatId: string) => void
  onNewTask: (workspaceId: string) => void
}) => {
  const { sessions, hasMore, loading, loadMore, hide } = useWorkspaceExternalSessions(wsId, expanded)
  const [archivingAll, setArchivingAll] = useState(false)
  const isSearching = query.length > 0
  // Workspace name match keeps every chat under it; otherwise filter by title.
  const chatMatches = useCallback((c: Chat): boolean => {
    if (!isSearching || wsNameMatches) return true
    return c.title.toLowerCase().includes(query)
  }, [isSearching, wsNameMatches, query])
  const sessionMatches = useCallback((s: ExternalSession): boolean => {
    if (!isSearching || wsNameMatches) return true
    const msg = s.firstUserMessage?.toLowerCase() ?? ''
    return msg.includes(query) || s.sessionId.toLowerCase().startsWith(query)
  }, [isSearching, wsNameMatches, query])
  // Partition workspace chats into pinned / archived / active. External sessions
  // are always "active" — pin/archive only applies to native chats.
  const pinnedChats = useMemo(
    () => chats
      .filter((c) => pinnedIds.has(c.id) && chatMatches(c))
      .sort((a, b) => (pinnedAt[b.id] ?? 0) - (pinnedAt[a.id] ?? 0)),
    [chats, pinnedIds, pinnedAt, chatMatches],
  )
  const archivedChats = useMemo(
    () => chats
      .filter((c) => archivedIds.has(c.id) && chatMatches(c))
      .sort((a, b) => chatMtime(b) - chatMtime(a)),
    [chats, archivedIds, chatMatches],
  )
  const activeChats = useMemo(
    () => chats.filter((c) => !pinnedIds.has(c.id) && !archivedIds.has(c.id) && chatMatches(c)),
    [chats, pinnedIds, archivedIds, chatMatches],
  )
  const filteredSessions = useMemo(
    () => sessions.filter(sessionMatches),
    [sessions, sessionMatches],
  )
  const runningCount = activeChats.filter((c) => c.status === 'running').length
  const totalCount = isSearching
    ? activeChats.length + pinnedChats.length + archivedChats.length + filteredSessions.length
    : chats.length + sessions.length
  const items = useMemo(() => buildMergedItems(activeChats, filteredSessions), [activeChats, filteredSessions])
  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_VISIBLE)
  // While searching, show all matched items at once — no Load more truncation
  // and no extra fetches (we only filter what's already in memory).
  const visibleItems = useMemo(
    () => isSearching ? items : items.slice(0, visibleCount),
    [items, visibleCount, isSearching],
  )
  const canLoadMore = !isSearching && (visibleCount < items.length || hasMore)
  const [archivedOpen, setArchivedOpen] = useState<boolean>(false)
  const showArchived = isSearching ? archivedChats.length > 0 : archivedOpen

  // Pull every unadopted external session for this workspace, paging the
  // server until the cursor runs out. Sidebar lazy-loads only the first page,
  // so archive-all must explicitly drain the rest before adopting — otherwise
  // unloaded sessions stay live and reappear on next expand.
  const fetchAllUnadopted = useCallback(async (): Promise<ExternalSession[]> => {
    const all: ExternalSession[] = []
    let cursor: number | null = null
    for (;;) {
      const params = new URLSearchParams()
      params.set('limit', '100')
      if (cursor !== null) params.set('cursor', String(cursor))
      const url = `${API_BASE}/api/workspaces/${encodeURIComponent(wsId)}/external-sessions?${params}`
      const res = await authFetch(url)
      if (!res.ok) break
      const body = (await res.json()) as { sessions: ExternalSession[]; nextCursor: number | null; hasMore: boolean }
      all.push(...body.sessions)
      if (!body.hasMore || body.nextCursor === null) break
      cursor = body.nextCursor
    }
    return all
  }, [wsId])

  // Adopt sessions in parallel, returning their newly assigned chat IDs.
  // Adoption is idempotent server-side; failures are skipped so a single bad
  // session does not block the batch.
  const adoptAllSessions = useCallback(async (toAdopt: ExternalSession[]): Promise<string[]> => {
    const results = await Promise.all(toAdopt.map(async (s) => {
      try {
        const res = await authFetch(
          `${API_BASE}/api/external-sessions/${encodeURIComponent(s.id)}/adopt`,
          { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
        )
        if (!res.ok) return null
        const { chatId } = (await res.json()) as { chatId: string }
        hide(s.id)
        return chatId
      } catch {
        return null
      }
    }))
    return results.filter((id): id is string => id !== null)
  }, [hide])

  const handleArchiveAllClick = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (archivingAll) return
    const nativeIds = [...activeChats, ...pinnedChats].map((c) => c.id)
    setArchivingAll(true)
    try {
      const allSessions = await fetchAllUnadopted()
      const adoptedIds = allSessions.length > 0 ? await adoptAllSessions(allSessions) : []
      if (adoptedIds.length > 0) {
        window.dispatchEvent(new Event('openteam:chat-created'))
      }
      onArchiveAll([...nativeIds, ...adoptedIds])
    } finally {
      setArchivingAll(false)
    }
  }, [archivingAll, activeChats, pinnedChats, fetchAllUnadopted, adoptAllSessions, onArchiveAll])

  // Two-stage Load more: first consume already-fetched items, then fetch the
  // next external page once the local slice is exhausted. Keeps the click
  // cheap for the common case where the user just wants the next 10 rows.
  const handleLoadMore = useCallback(async () => {
    if (visibleCount < items.length) {
      setVisibleCount((v) => v + PAGE_STEP)
      return
    }
    if (hasMore) {
      await loadMore()
      setVisibleCount((v) => v + PAGE_STEP)
    }
  }, [visibleCount, items.length, hasMore, loadMore])

  return (
    <div>
      <div className={`group flex items-center gap-1 pr-1 rounded-sm transition-colors ${isCurrent ? 'bg-bg-hover/40' : 'hover:bg-bg-hover/50'}`}>
        <button
          onClick={onToggle}
          className="flex-1 min-w-0 flex items-center gap-1.5 px-2 py-1"
          aria-expanded={expanded}
        >
          <span className="text-text-muted -ml-px">
            {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
          </span>
          <span className="text-[11px] font-medium truncate text-text-secondary">{name}</span>
          {runningCount > 0 && (
            <span className="w-[6px] h-[6px] rounded-full bg-accent-brand animate-pulse flex-shrink-0" />
          )}
          <span className="ml-auto font-mono text-[10px] text-text-muted tabular-nums">{totalCount}</span>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); onNewTask(wsId) }}
          title={`New mission in ${name} (⌘N)`}
          aria-label={`New mission in ${name}`}
          className="w-[18px] h-[18px] rounded flex items-center justify-center text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-hover hover:text-text-primary transition-opacity flex-shrink-0"
        >
          <Plus size={11} />
        </button>
        {activeChats.length + pinnedChats.length + sessions.length > 0 && (
          <button
            onClick={(e) => { void handleArchiveAllClick(e) }}
            disabled={archivingAll}
            title={`Archive all missions in `}
            aria-label={`Archive all missions in `}
            className="w-[18px] h-[18px] rounded flex items-center justify-center text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-hover hover:text-text-primary transition-opacity flex-shrink-0 disabled:opacity-50 disabled:cursor-progress"
          >
            <Archive size={11} />
          </button>
        )}
      </div>
      {expanded && (
        <div className="flex flex-col gap-0.5 ml-2">
          {!hidePinnedSection && pinnedChats.length > 0 && (
            <div className="flex flex-col gap-0.5 pb-1 mb-0.5 border-b border-border/30">
              {pinnedChats.map((c) => (
                <MissionRow
                  key={`p:${c.id}`}
                  chat={c}
                  isSelected={activeChatId === c.id}
                  agentNames={agentNames}
                  onPin={() => onPin(c.id)}
                  onArchive={() => onArchive(c.id)}
                  onAddAgent={() => onAddAgent(c.id)}
                  isPinned
                />
              ))}
            </div>
          )}
          {items.length === 0 && pinnedChats.length === 0 && archivedChats.length === 0 ? (
            <div className="px-3 py-1 text-[10px] text-text-muted italic">
              {isSearching ? 'No matching missions' : 'No sessions'}
            </div>
          ) : visibleItems.map((it) => (
            it.kind === 'chat' ? (
              <MissionRow
                key={`c:${it.chat.id}`}
                chat={it.chat}
                isSelected={activeChatId === it.chat.id}
                agentNames={agentNames}
                onPin={() => onPin(it.chat.id)}
                onArchive={() => onArchive(it.chat.id)}
                onAddAgent={() => onAddAgent(it.chat.id)}
              />
            ) : (
              <ExternalSessionRow
                key={`e:${it.session.id}`}
                session={it.session}
                onAdopted={() => hide(it.session.id)}
                onPin={onPin}
                onArchive={onArchive}
                onAddAgent={onAddAgent}
              />
            )
          ))}
          {canLoadMore && (
            <button
              onClick={() => void handleLoadMore()}
              disabled={loading}
              className="ml-3 mt-0.5 text-[10px] text-text-muted hover:text-text-primary underline self-start disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
          {archivedChats.length > 0 && (
            <div className="mt-1 pt-1 ml-3 border-t border-border/30">
              <button
                onClick={() => setArchivedOpen((v) => !v)}
                disabled={isSearching}
                className="w-full flex items-center gap-1.5 px-1.5 py-0.5 hover:bg-bg-hover/50 rounded-sm transition-colors text-text-muted disabled:cursor-default"
                aria-expanded={showArchived}
              >
                <span className="-ml-px">
                  {showArchived ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                </span>
                <span className="text-[10px] uppercase tracking-wide">Archived</span>
                <span className="ml-auto font-mono text-[10px] tabular-nums">{archivedChats.length}</span>
              </button>
              {showArchived && (
                <div className="flex flex-col gap-0.5">
                  {archivedChats.map((c) => (
                    <CompletedRow
                      key={`a:${c.id}`}
                      chat={c}
                      isSelected={activeChatId === c.id}
                      archived
                      agentNames={agentNames}
                      onPin={() => onPin(c.id)}
                      onUnarchive={() => onArchive(c.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────

type MergedItem =
  | { kind: 'chat'; mtime: number; chat: Chat }
  | { kind: 'session'; mtime: number; session: ExternalSession }

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

const buildMergedItems = (chats: Chat[], sessions: ExternalSession[]): MergedItem[] => {
  const out: MergedItem[] = [
    ...chats.map<MergedItem>((c) => ({ kind: 'chat', mtime: chatMtime(c), chat: c })),
    ...sessions.map<MergedItem>((s) => ({ kind: 'session', mtime: s.mtimeMs, session: s })),
  ]
  out.sort((a, b) => b.mtime - a.mtime)
  return out
}

const basename = (p: string): string => {
  const trimmed = p.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i === -1 ? trimmed : trimmed.slice(i + 1)
}

// Unmatched-cwd group: a peer to WorkspaceGroup for cwds that don't fall under
// any workspace's repositories. Same row shape inside, but the rows are
// guaranteed external (no native chats exist without a workspace).
const UnmatchedDirsSection = ({ dirs, expandedMap, onToggle, onPin, onArchive, onAddAgent }: {
  dirs: UnmatchedExternalDir[]
  expandedMap: Record<string, boolean>
  onToggle: (cwd: string) => void
  onPin: (chatId: string) => void
  onArchive: (chatId: string) => void
  onAddAgent: (chatId: string) => void
}) => (
  <div className="mt-2 border-t border-border/40 pt-2">
    {dirs.map((d) => (
      <ExternalCwdGroup
        key={d.cwd}
        cwd={d.cwd}
        count={d.sessionCount}
        expanded={expandedMap[d.cwd] ?? false}
        onToggle={() => onToggle(d.cwd)}
        onPin={onPin}
        onArchive={onArchive}
        onAddAgent={onAddAgent}
      />
    ))}
  </div>
)

const ExternalCwdGroup = ({ cwd, count, expanded, onToggle, onPin, onArchive, onAddAgent }: {
  cwd: string
  count: number
  expanded: boolean
  onToggle: () => void
  onPin: (chatId: string) => void
  onArchive: (chatId: string) => void
  onAddAgent: (chatId: string) => void
}) => {
  const { sessions, hasMore, loading, loadMore, error } = useExternalCwdSessions(cwd, expanded)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set())
  const visible = sessions.filter((s) => !hiddenIds.has(s.id))
  const [visibleCount, setVisibleCount] = useState<number>(INITIAL_VISIBLE)
  const sliced = visible.slice(0, visibleCount)
  const canLoadMore = visibleCount < visible.length || hasMore

  const handleLoadMore = useCallback(async () => {
    if (visibleCount < visible.length) {
      setVisibleCount((v) => v + PAGE_STEP)
      return
    }
    if (hasMore) {
      await loadMore()
      setVisibleCount((v) => v + PAGE_STEP)
    }
  }, [visibleCount, visible.length, hasMore, loadMore])

  return (
    <div>
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover/50 rounded-sm transition-colors"
        aria-expanded={expanded}
        title={cwd}
      >
        <span className="text-text-muted -ml-px">
          {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        </span>
        <span className="text-[11px] font-medium text-text-secondary truncate">{basename(cwd)}</span>
        <span className="ml-auto font-mono text-[10px] text-text-muted tabular-nums">{count}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-0.5">
          {loading && visible.length === 0 && (
            <div className="px-3 py-1 text-[10px] text-text-muted italic">Loading…</div>
          )}
          {error && visible.length === 0 && (
            <div className="px-3 py-1 text-[10px] text-accent-red">Failed: {error}</div>
          )}
          {sliced.map((s) => (
            <ExternalSessionRow
              key={s.id}
              session={s}
              onAdopted={() => setHiddenIds((prev) => {
                if (prev.has(s.id)) return prev
                const next = new Set(prev)
                next.add(s.id)
                return next
              })}
              onPin={onPin}
              onArchive={onArchive}
              onAddAgent={onAddAgent}
            />
          ))}
          {canLoadMore && (
            <button
              onClick={() => void handleLoadMore()}
              disabled={loading}
              className="ml-3 mt-0.5 text-[10px] text-text-muted hover:text-text-primary underline self-start disabled:opacity-50"
            >
              {loading ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default MissionSessionList
