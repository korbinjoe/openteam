import { useCallback, useMemo, useState } from 'react'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAllChats } from '../../hooks/useAllChats'
import { useAgents } from '../../hooks/useAgents'
import { useTaskPinArchive } from '../../hooks/useTaskPinArchive'
import { useExternalCwds, type UnmatchedExternalDir } from '../../hooks/useExternalCwds'
import { useWorkspaceExternalSessions } from '../../hooks/useWorkspaceExternalSessions'
import { useExternalCwdSessions, type ExternalSession } from '../../hooks/useExternalCwdSessions'
import { Clock, Check, Pin, ChevronDown, ChevronRight, FolderGit, Folder } from './icons'
import type { Chat } from './types'
import {
  loadMap, saveMap, ageLabel, isCompletedStatus,
  TaskRow, PinnedRow, CompletedRow,
} from './TaskSessionRows'
import { ExternalSessionRow } from './ExternalSessionRow'

const COMPLETED_EXPANDED_KEY = 'openteam:v2-completed-expanded'
const WORKSPACE_EXPANDED_KEY = 'openteam:v2-workspace-expanded'

const TaskSessionList = () => {
  const { workspaceId, activeChatId, openAddAgent } = useWorkspace()
  const { chats, workspaces, loading } = useAllChats()
  const { unmatchedDirs } = useExternalCwds()
  const { agentNames } = useAgents()

  const visibleChats = useMemo(
    () => (workspaceId ? chats.filter((c) => c.workspaceId === workspaceId) : chats),
    [chats, workspaceId],
  )

  const { pinnedIds, archivedIds, pinnedAt, isArchived, togglePin, toggleArchive } = useTaskPinArchive(workspaceId ?? '__all__')
  const [completedExpanded, setCompletedExpanded] = useState<boolean>(
    () => loadMap(COMPLETED_EXPANDED_KEY)[workspaceId ?? '__all__'] ?? false,
  )
  const [wsExpanded, setWsExpanded] = useState<Record<string, boolean>>(
    () => loadMap(WORKSPACE_EXPANDED_KEY),
  )
  const [extDirExpanded, setExtDirExpanded] = useState<Record<string, boolean>>({})

  const toggleCompleted = useCallback(() => {
    setCompletedExpanded((prev) => {
      const next = !prev
      const map = loadMap(COMPLETED_EXPANDED_KEY)
      map[workspaceId ?? '__all__'] = next
      saveMap(COMPLETED_EXPANDED_KEY, map)
      return next
    })
  }, [workspaceId])

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

  if (
    loading
    && visibleChats.length === 0
    && workspaces.length === 0
    && unmatchedDirs.length === 0
  ) {
    return <div className="px-3 py-3 text-[10px] text-text-muted">Loading…</div>
  }

  // ── Cross-workspace mode ────────────────────────────────────────────────
  // Render every workspace as a folder; each one carries its own unified
  // native+external session feed via WorkspaceGroup → useWorkspaceExternalSessions.
  if (!workspaceId) {
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

    return (
      <div className="flex flex-col gap-1 pb-2">
        {workspaces.map((ws) => {
          const wsChats = chats.filter((c) => c.workspaceId === ws.id && !archivedIds.has(c.id))
          const expanded = wsExpanded[ws.id] ?? true
          return (
            <WorkspaceGroup
              key={ws.id}
              wsId={ws.id}
              name={ws.name}
              chats={wsChats}
              expanded={expanded}
              activeChatId={activeChatId}
              agentNames={agentNames}
              onToggle={() => toggleWorkspace(ws.id)}
              onPin={togglePin}
              onArchive={toggleArchive}
              onAddAgent={openAddAgent}
            />
          )
        })}

        {visibleUnmatched.length > 0 && (
          <UnmatchedDirsSection
            dirs={visibleUnmatched}
            expandedMap={extDirExpanded}
            onToggle={toggleExtDir}
          />
        )}
      </div>
    )
  }

  // ── Single-workspace mode ──────────────────────────────────────────────
  const pinned = visibleChats
    .filter((c) => pinnedIds.has(c.id))
    .sort((a, b) => (pinnedAt[b.id] ?? 0) - (pinnedAt[a.id] ?? 0))

  const visibleNonPinned = visibleChats.filter((c) => !pinnedIds.has(c.id) && !archivedIds.has(c.id))
  const active = visibleNonPinned.filter((c) => !isCompletedStatus(c))
  const completedAuto = visibleNonPinned.filter(isCompletedStatus)
  const archived = visibleChats.filter((c) => archivedIds.has(c.id))
  const completed = [...completedAuto, ...archived]

  return (
    <div className="flex flex-col gap-3 pb-2">
      {pinned.length > 0 && (
        <Section icon={<Pin size={11} />} label="Pinned" count={pinned.length}>
          {pinned.map((chat) => (
            <PinnedRow
              key={chat.id}
              chat={chat}
              age={ageLabel(pinnedAt[chat.id])}
              isSelected={activeChatId === chat.id}
              agentNames={agentNames}
              onUnpin={() => togglePin(chat.id)}
              onArchive={() => toggleArchive(chat.id)}
            />
          ))}
        </Section>
      )}

      <Section icon={<Clock size={11} />} label="Active Tasks" count={active.length}>
        <WorkspaceCwdGroups
          wsId={workspaceId}
          chats={active}
          activeChatId={activeChatId}
          agentNames={agentNames}
          onPin={togglePin}
          onArchive={toggleArchive}
          onAddAgent={openAddAgent}
        />
      </Section>

      {completed.length > 0 && (
        <CollapsibleSection
          icon={<Check size={11} />}
          label="Completed"
          count={completed.length}
          expanded={completedExpanded}
          onToggle={toggleCompleted}
        >
          {completed.slice(0, 8).map((chat) => (
            <CompletedRow
              key={chat.id}
              chat={chat}
              isSelected={activeChatId === chat.id}
              archived={isArchived(chat.id)}
              agentNames={agentNames}
              onPin={() => togglePin(chat.id)}
              onUnarchive={isArchived(chat.id) ? () => toggleArchive(chat.id) : undefined}
            />
          ))}
        </CollapsibleSection>
      )}
    </div>
  )
}

// ── Workspace group (cross-workspace mode) ──────────────────────────────────
// Unifies native chats + external sessions for ONE workspace into a single
// time-ordered list, with "Load more" pulling the next page of external rows.
// External fetch fires only when the group is expanded.
const WorkspaceGroup = ({
  wsId, name, chats, expanded, activeChatId, agentNames,
  onToggle, onPin, onArchive, onAddAgent,
}: {
  wsId: string
  name: string
  chats: Chat[]
  expanded: boolean
  activeChatId: string | null
  agentNames: Record<string, string>
  onToggle: () => void
  onPin: (chatId: string) => void
  onArchive: (chatId: string) => void
  onAddAgent: (chatId: string) => void
}) => {
  const runningCount = chats.filter((c) => c.status === 'running').length
  const { sessions, hasMore, loading, loadMore, hide } = useWorkspaceExternalSessions(wsId, expanded)
  const totalCount = chats.length + sessions.length

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
        <FolderGit size={11} className="text-text-muted" />
        <span className="text-[11px] font-semibold tracking-wide uppercase text-text-muted truncate">{name}</span>
        {runningCount > 0 && (
          <span className="w-[6px] h-[6px] rounded-full bg-accent-brand animate-pulse flex-shrink-0" />
        )}
        <span className="ml-auto font-mono text-[10px] text-text-muted tabular-nums">{totalCount}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-0.5">
          <UnifiedSessionList
            wsId={wsId}
            chats={chats}
            externalSessions={sessions}
            externalHasMore={hasMore}
            externalLoading={loading}
            onLoadMore={loadMore}
            onAdoptedSession={hide}
            activeChatId={activeChatId}
            agentNames={agentNames}
            onPin={onPin}
            onArchive={onArchive}
            onAddAgent={onAddAgent}
          />
        </div>
      )}
    </div>
  )
}

// ── Single-workspace cwd grouping ───────────────────────────────────────────
// Inside one workspace, a power user often has several cwds: the main repo,
// adopted external dirs (e.g. /tmp/scratch sessions), worktrees branched off
// the repo. WorkspaceCwdGroups buckets chats + external sessions by their cwd
// so the sidebar inside a workspace mirrors the cross-workspace grouping one
// level deeper. When there's only one cwd we skip the group layer to avoid
// the "lone folder" antipattern.
const WorkspaceCwdGroups = ({
  wsId, chats, activeChatId, agentNames, onPin, onArchive, onAddAgent,
}: {
  wsId: string
  chats: Chat[]
  activeChatId: string | null
  agentNames: Record<string, string>
  onPin: (chatId: string) => void
  onArchive: (chatId: string) => void
  onAddAgent: (chatId: string) => void
}) => {
  const { sessions, hasMore, loading, loadMore, hide } = useWorkspaceExternalSessions(wsId, true)
  const [cwdExpanded, setCwdExpanded] = useState<Record<string, boolean>>({})

  const buckets = useMemo(() => groupByCwd(chats, sessions), [chats, sessions])

  if (buckets.length === 0) {
    return <div className="px-3 py-1 text-[10px] text-text-muted italic">No sessions</div>
  }

  // Single-cwd workspace: skip the extra folder layer and render flat. Keeps
  // small/single-repo workspaces looking exactly like before this change.
  if (buckets.length === 1) {
    return (
      <UnifiedSessionList
        wsId={wsId}
        chats={chats}
        externalSessions={sessions}
        externalHasMore={hasMore}
        externalLoading={loading}
        onLoadMore={loadMore}
        onAdoptedSession={hide}
        activeChatId={activeChatId}
        agentNames={agentNames}
        onPin={onPin}
        onArchive={onArchive}
        onAddAgent={onAddAgent}
      />
    )
  }

  const toggle = (cwd: string) =>
    setCwdExpanded((prev) => ({ ...prev, [cwd]: !(prev[cwd] ?? true) }))

  return (
    <div className="flex flex-col gap-1">
      {buckets.map((b, idx) => {
        const expanded = cwdExpanded[b.cwd] ?? true
        // "Load more" is workspace-wide pagination — only render it under the
        // newest bucket to avoid ambiguity about which group will grow.
        const isPrimary = idx === 0
        return (
          <div key={b.cwd}>
            <button
              onClick={() => toggle(b.cwd)}
              className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover/50 rounded-sm transition-colors"
              aria-expanded={expanded}
              title={b.cwd}
            >
              <span className="text-text-muted -ml-px">
                {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              </span>
              <Folder size={11} className="text-text-muted" />
              <span className="text-[11px] font-semibold tracking-wide uppercase text-text-muted truncate">{basename(b.cwd)}</span>
              <span className="ml-auto font-mono text-[10px] text-text-muted tabular-nums">{b.items.length}</span>
            </button>
            {expanded && (
              <div className="flex flex-col gap-0.5">
                {b.items.map((it) => (
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
                    />
                  )
                ))}
                {isPrimary && hasMore && (
                  <button
                    onClick={() => void loadMore()}
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
      })}
    </div>
  )
}

// Interleaves native chats and external sessions by mtime DESC. Used in both
// the workspace group (cross-ws mode) and the Active Tasks section
// (single-ws mode). External rows are lazy: when externalSessions isn't
// supplied, we just render the native chats.
const UnifiedSessionList = ({
  wsId,
  chats,
  externalSessions,
  externalHasMore,
  externalLoading,
  onLoadMore,
  onAdoptedSession,
  activeChatId,
  agentNames,
  onPin,
  onArchive,
  onAddAgent,
}: {
  wsId: string
  chats: Chat[]
  externalSessions?: ExternalSession[]
  externalHasMore?: boolean
  externalLoading?: boolean
  onLoadMore?: () => Promise<void>
  onAdoptedSession?: (sessionId: string) => void
  activeChatId: string | null
  agentNames: Record<string, string>
  onPin: (chatId: string) => void
  onArchive: (chatId: string) => void
  onAddAgent: (chatId: string) => void
}) => {
  // Single-workspace caller doesn't pass externalSessions — fetch them here so
  // active tasks and external sessions interleave in that view too.
  const single = useWorkspaceExternalSessions(
    externalSessions === undefined ? wsId : null,
    externalSessions === undefined,
  )
  const sessions = externalSessions ?? single.sessions
  const hasMore = externalHasMore ?? single.hasMore
  const loading = externalLoading ?? single.loading
  const loadMore = onLoadMore ?? single.loadMore
  const adopted = onAdoptedSession ?? single.hide

  const items = useMemo(() => buildMergedItems(chats, sessions), [chats, sessions])

  if (items.length === 0) {
    return <div className="px-3 py-1 text-[10px] text-text-muted italic">No sessions</div>
  }

  return (
    <>
      {items.map((it) => (
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
            onAdopted={() => adopted(it.session.id)}
          />
        )
      ))}
      {hasMore && (
        <button
          onClick={() => void loadMore()}
          disabled={loading}
          className="ml-3 mt-0.5 text-[10px] text-text-muted hover:text-text-primary underline self-start disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Load more'}
        </button>
      )}
    </>
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

// Per-cwd grouping for single-workspace view. Native chats inherit cwd from
// the first worktree session (the chat's primary working directory) or fall
// back to externalCwd for adopted chats. Chats with no resolvable cwd land in
// a synthetic "(workspace)" bucket so they remain visible.
const WORKSPACE_BUCKET = '(workspace)'

const chatCwd = (c: Chat): string => {
  if (c.externalCwd) return c.externalCwd
  const wt = c.worktreeSessions?.[0]?.worktreePath
  return wt ?? WORKSPACE_BUCKET
}

interface CwdBucket {
  cwd: string
  latestMtime: number
  items: MergedItem[]
}

const groupByCwd = (chats: Chat[], sessions: ExternalSession[]): CwdBucket[] => {
  const map = new Map<string, CwdBucket>()
  const push = (cwd: string, item: MergedItem) => {
    const existing = map.get(cwd)
    if (existing) {
      existing.items.push(item)
      if (item.mtime > existing.latestMtime) existing.latestMtime = item.mtime
    } else {
      map.set(cwd, { cwd, latestMtime: item.mtime, items: [item] })
    }
  }
  for (const c of chats) push(chatCwd(c), { kind: 'chat', mtime: chatMtime(c), chat: c })
  for (const s of sessions) push(s.cwd, { kind: 'session', mtime: s.mtimeMs, session: s })
  for (const b of map.values()) b.items.sort((a, b) => b.mtime - a.mtime)
  return [...map.values()].sort((a, b) => b.latestMtime - a.latestMtime)
}

const Section = ({ icon, label, count, children }: {
  icon: React.ReactNode
  label: string
  count?: number
  children: React.ReactNode
}) => (
  <div>
    <div className="flex items-center gap-1.5 px-2 pb-1">
      <span className="text-text-muted">{icon}</span>
      <span className="text-[11px] font-semibold tracking-wide uppercase text-text-muted">{label}</span>
      {typeof count === 'number' && (
        <span className="ml-auto font-mono text-[10px] text-text-muted tabular-nums">{count}</span>
      )}
    </div>
    <div className="flex flex-col gap-0.5">{children}</div>
  </div>
)

const CollapsibleSection = ({ icon, label, count, expanded, onToggle, children }: {
  icon: React.ReactNode
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) => (
  <div>
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1.5 px-2 pb-1 hover:bg-bg-hover/50 rounded-sm transition-colors"
      aria-expanded={expanded}
    >
      <span className="text-text-muted -ml-px">
        {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
      </span>
      <span className="text-text-muted">{icon}</span>
      <span className="text-[11px] font-semibold tracking-wide uppercase text-text-muted">{label}</span>
      <span className="ml-auto font-mono text-[10px] text-text-muted tabular-nums">{count}</span>
    </button>
    {expanded && <div className="flex flex-col gap-0.5">{children}</div>}
  </div>
)

const basename = (p: string): string => {
  const trimmed = p.replace(/\/+$/, '')
  const i = trimmed.lastIndexOf('/')
  return i === -1 ? trimmed : trimmed.slice(i + 1)
}

// Unmatched-cwd group: a peer to WorkspaceGroup for cwds that don't fall under
// any workspace's repositories. Same row shape inside, but the rows are
// guaranteed external (no native chats exist without a workspace).
const UnmatchedDirsSection = ({ dirs, expandedMap, onToggle }: {
  dirs: UnmatchedExternalDir[]
  expandedMap: Record<string, boolean>
  onToggle: (cwd: string) => void
}) => (
  <div className="mt-2 border-t border-border/40 pt-2">
    {dirs.map((d) => (
      <ExternalCwdGroup
        key={d.cwd}
        cwd={d.cwd}
        count={d.sessionCount}
        expanded={expandedMap[d.cwd] ?? false}
        onToggle={() => onToggle(d.cwd)}
      />
    ))}
  </div>
)

const ExternalCwdGroup = ({ cwd, count, expanded, onToggle }: {
  cwd: string
  count: number
  expanded: boolean
  onToggle: () => void
}) => {
  const { sessions, hasMore, loading, loadMore, error } = useExternalCwdSessions(cwd, expanded)
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set())
  const visible = sessions.filter((s) => !hiddenIds.has(s.id))

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
        <span className="text-[11px] font-semibold tracking-wide uppercase text-text-muted truncate">{basename(cwd)}</span>
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
          {visible.map((s) => (
            <ExternalSessionRow
              key={s.id}
              session={s}
              onAdopted={() => setHiddenIds((prev) => {
                if (prev.has(s.id)) return prev
                const next = new Set(prev)
                next.add(s.id)
                return next
              })}
            />
          ))}
          {hasMore && (
            <button
              onClick={() => void loadMore()}
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
