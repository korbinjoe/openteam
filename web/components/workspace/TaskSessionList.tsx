import { useCallback, useMemo, useState } from 'react'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAllChats } from '../../hooks/useAllChats'
import { useAgents } from '../../hooks/useAgents'
import { useTaskPinArchive } from '../../hooks/useTaskPinArchive'
import { useExternalCwds, type UnmatchedExternalDir } from '../../hooks/useExternalCwds'
import { useWorkspaceExternalSessions } from '../../hooks/useWorkspaceExternalSessions'
import { useExternalCwdSessions, type ExternalSession } from '../../hooks/useExternalCwdSessions'
import { ChevronDown, ChevronRight, FolderGit, Folder } from './icons'
import type { Chat } from './types'
import { loadMap, saveMap, TaskRow } from './TaskSessionRows'
import { ExternalSessionRow } from './ExternalSessionRow'

const WORKSPACE_EXPANDED_KEY = 'openteam:v2-workspace-expanded'

const TaskSessionList = () => {
  const { workspaceId, activeChatId, openAddAgent } = useWorkspace()
  const { chats, workspaces, loading } = useAllChats()
  const { unmatchedDirs } = useExternalCwds()
  const { agentNames } = useAgents()

  const { archivedIds, togglePin, toggleArchive } = useTaskPinArchive(workspaceId ?? '__all__')
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
            isCurrent={ws.id === workspaceId}
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

// ── Workspace group ────────────────────────────────────────────────────────
// Unifies native chats + external sessions for ONE workspace into a single
// time-ordered list, with "Load more" pulling the next page of external rows.
// External fetch fires only when the group is expanded. `isCurrent` flags the
// workspace the URL currently points at so its header gets a subtle marker.
const WorkspaceGroup = ({
  wsId, name, chats, expanded, isCurrent, activeChatId, agentNames,
  onToggle, onPin, onArchive, onAddAgent,
}: {
  wsId: string
  name: string
  chats: Chat[]
  expanded: boolean
  isCurrent: boolean
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
  const items = useMemo(() => buildMergedItems(chats, sessions), [chats, sessions])

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
        <span className={`text-[11px] font-semibold tracking-wide uppercase truncate ${isCurrent ? 'text-text-primary' : 'text-text-muted'}`}>{name}</span>
        {runningCount > 0 && (
          <span className="w-[6px] h-[6px] rounded-full bg-accent-brand animate-pulse flex-shrink-0" />
        )}
        <span className="ml-auto font-mono text-[10px] text-text-muted tabular-nums">{totalCount}</span>
      </button>
      {expanded && (
        <div className="flex flex-col gap-0.5">
          {items.length === 0 ? (
            <div className="px-3 py-1 text-[10px] text-text-muted italic">No sessions</div>
          ) : items.map((it) => (
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
