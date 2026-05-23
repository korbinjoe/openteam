import { useCallback, useMemo, useState } from 'react'

// Sidebar pagination: every group shows this many items first; "Load more"
// grows the visible slice in the same step. When the slice catches up to the
// already-fetched items and the server still has more, the click also triggers
// a network fetch before growing the slice.
const INITIAL_VISIBLE = 10
const PAGE_STEP = 10
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAllChats } from '../../hooks/useAllChats'
import { useAgents } from '../../hooks/useAgents'
import { useTaskPinArchive } from '../../hooks/useTaskPinArchive'
import { useExternalCwds, type UnmatchedExternalDir } from '../../hooks/useExternalCwds'
import { useWorkspaceExternalSessions } from '../../hooks/useWorkspaceExternalSessions'
import { useExternalCwdSessions, type ExternalSession } from '../../hooks/useExternalCwdSessions'
import { ChevronDown, ChevronRight, FolderGit, Folder } from './icons'
import type { Chat } from './types'
import { loadMap, saveMap, TaskRow, CompletedRow } from './TaskSessionRows'
import { ExternalSessionRow } from './ExternalSessionRow'

const WORKSPACE_EXPANDED_KEY = 'openteam:v2-workspace-expanded'

interface TaskSessionListProps {
  query?: string
}

const TaskSessionList = ({ query = '' }: TaskSessionListProps) => {
  const { workspaceId, activeChatId, openAddAgent } = useWorkspace()
  const { chats, workspaces, loading } = useAllChats()
  const { unmatchedDirs } = useExternalCwds()
  const { agentNames } = useAgents()

  const q = query.trim().toLowerCase()
  const isSearching = q.length > 0

  const { pinnedIds, pinnedAt, archivedIds, togglePin, toggleArchive } = useTaskPinArchive(workspaceId ?? '__all__')
  const [wsExpanded, setWsExpanded] = useState<Record<string, boolean>>(
    () => loadMap(WORKSPACE_EXPANDED_KEY),
  )
  const [extDirExpanded, setExtDirExpanded] = useState<Record<string, boolean>>({})

  const toggleWorkspace = useCallback((wsId: string) => {
    setWsExpanded((prev) => {
      const next = { ...prev, [wsId]: !(prev[wsId] ?? true) }
      saveMap(WORKSPACE_EXPANDED_KEY, next)
      return next
    })
  }, [])

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
        <div className="text-[11px] text-text-secondary mb-1">No tasks yet</div>
        <div className="text-[10px] text-text-muted leading-relaxed">Create one with ⌘N or the New Task button.</div>
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

  const hasMatches = !isSearching || renderedWorkspaces.length > 0

  return (
    <div className="flex flex-col gap-1 pb-2">
      {renderedWorkspaces.map(({ ws, wsChats, wsNameMatches }) => {
        const expanded = isSearching ? true : (wsExpanded[ws.id] ?? true)
        return (
          <WorkspaceGroup
            key={ws.id}
            wsId={ws.id}
            name={ws.name}
            chats={wsChats}
            pinnedIds={pinnedIds}
            pinnedAt={pinnedAt}
            archivedIds={archivedIds}
            expanded={expanded}
            isCurrent={ws.id === workspaceId}
            activeChatId={activeChatId}
            agentNames={agentNames}
            query={q}
            wsNameMatches={wsNameMatches}
            onToggle={() => toggleWorkspace(ws.id)}
            onPin={togglePin}
            onArchive={toggleArchive}
            onAddAgent={openAddAgent}
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
          <div className="text-[11px] text-text-secondary mb-1">No matching tasks</div>
          <div className="text-[10px] text-text-muted">Try a different keyword.</div>
        </div>
      )}
    </div>
  )
}

// ── Workspace group ────────────────────────────────────────────────────────
// Unifies native chats + external sessions for ONE workspace into a single
// time-ordered list, with "Load more" pulling the next page of external rows.
// External fetch fires only when the group is expanded. `isCurrent` flags the
// workspace the URL currently points at so its header gets a subtle marker.
const WorkspaceGroup = ({
  wsId, name, chats, pinnedIds, pinnedAt, archivedIds,
  expanded, isCurrent, activeChatId, agentNames,
  query, wsNameMatches,
  onToggle, onPin, onArchive, onAddAgent,
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
  onToggle: () => void
  onPin: (chatId: string) => void
  onArchive: (chatId: string) => void
  onAddAgent: (chatId: string) => void
}) => {
  const { sessions, hasMore, loading, loadMore, hide } = useWorkspaceExternalSessions(wsId, expanded)
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
      <button
        onClick={onToggle}
        className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover/50 rounded-sm transition-colors"
        aria-expanded={expanded}
      >
        <span className="text-text-muted -ml-px">
          {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        </span>
        <FolderGit size={11} className={isCurrent ? 'text-text-primary' : 'text-text-muted'} />
        <span className={`text-[11px] font-semibold truncate ${isCurrent ? 'text-text-primary' : 'text-text-secondary'}`}>{name}</span>
        {runningCount > 0 && (
          <span className="w-[6px] h-[6px] rounded-full bg-accent-brand animate-pulse flex-shrink-0" />
        )}
        <span className="ml-auto font-mono text-[10px] text-text-muted tabular-nums">{totalCount}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-0.5">
          {pinnedChats.length > 0 && (
            <div className="flex flex-col gap-0.5 pb-1 mb-0.5 border-b border-border/30">
              {pinnedChats.map((c) => (
                <TaskRow
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
              {isSearching ? 'No matching tasks' : 'No sessions'}
            </div>
          ) : visibleItems.map((it) => (
            it.kind === 'chat' ? (
              <TaskRow
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
            <div className="mt-1 pt-1 border-t border-border/30">
              <button
                onClick={() => setArchivedOpen((v) => !v)}
                disabled={isSearching}
                className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover/50 rounded-sm transition-colors text-text-muted disabled:cursor-default"
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
        <Folder size={11} className="text-text-muted" />
        <span className="text-[11px] font-semibold text-text-secondary truncate">{basename(cwd)}</span>
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

export default TaskSessionList
