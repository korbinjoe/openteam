import { useCallback, useMemo, useState } from 'react'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAllChats } from '../../hooks/useAllChats'
import { useAgents } from '../../hooks/useAgents'
import { useTaskPinArchive } from '../../hooks/useTaskPinArchive'
import { useExternalCwds, type ExternalDirInfo, type UnmatchedExternalDir } from '../../hooks/useExternalCwds'
import { Clock, Check, Pin, ChevronDown, ChevronRight, FolderGit, Folder, Terminal } from './icons'
import {
  loadMap, saveMap, ageLabel, isCompletedStatus,
  TaskRow, PinnedRow, CompletedRow,
} from './TaskSessionRows'
import { ExternalCwdSessions } from './ExternalCwdSessions'

const COMPLETED_EXPANDED_KEY = 'openteam:v2-completed-expanded'
const WORKSPACE_EXPANDED_KEY = 'openteam:v2-workspace-expanded'

const TaskSessionList = () => {
  const { workspaceId, activeChatId, openAddAgent } = useWorkspace()
  const { chats, workspaces, loading } = useAllChats()
  const { externalDirsByWs, unmatchedDirs } = useExternalCwds()
  const { agentNames } = useAgents()

  // Scope to current workspace; if no workspace selected, render workspace folders.
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
  // External-cwd group expand state is session-only per design — start collapsed,
  // do not persist across reloads (these are not "owned" by the user).
  const [extDirExpanded, setExtDirExpanded] = useState<Record<string, boolean>>({})
  // "Local Sessions" sub-section inside a workspace group, session-only.
  const [wsLocalExpanded, setWsLocalExpanded] = useState<Record<string, boolean>>({})

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

  const toggleWsLocal = useCallback((wsId: string) => {
    setWsLocalExpanded((prev) => ({ ...prev, [wsId]: !prev[wsId] }))
  }, [])

  if (
    loading
    && visibleChats.length === 0
    && workspaces.length === 0
    && unmatchedDirs.length === 0
  ) {
    return <div className="px-3 py-3 text-[10px] text-text-muted">Loading…</div>
  }

  // Cross-workspace mode: render a workspace folder tree so the sidebar
  // surfaces "which workspace each task belongs to" instead of a flat list.
  if (!workspaceId) {
    const groups = workspaces
      .map((ws) => ({
        ws,
        items: chats.filter((c) => c.workspaceId === ws.id && !archivedIds.has(c.id)),
        externalDirs: externalDirsByWs[ws.id] ?? [],
      }))
      .filter((g) => g.items.length > 0 || g.externalDirs.length > 0)

    const visibleUnmatched = unmatchedDirs.filter(
      (d) => d.sessionCount > 0 || d.adoptedCount > 0,
    )

    if (groups.length === 0 && visibleUnmatched.length === 0) {
      return (
        <div className="px-3 py-6 text-center">
          <div className="text-[11px] text-text-secondary mb-1">No tasks yet</div>
          <div className="text-[10px] text-text-muted leading-relaxed">Create one with ⌘N or the New Task button.</div>
        </div>
      )
    }

    return (
      <div className="flex flex-col gap-1 pb-2">
        {groups.map(({ ws, items, externalDirs }) => {
          const expanded = wsExpanded[ws.id] ?? true
          const runningCount = items.filter((c) => c.status === 'running').length
          const localCount = externalDirs.reduce((sum, d) => sum + d.sessionCount, 0)
          const localExpanded = wsLocalExpanded[ws.id] ?? false
          return (
            <div key={ws.id}>
              <button
                onClick={() => toggleWorkspace(ws.id)}
                className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover/50 rounded-sm transition-colors"
                aria-expanded={expanded}
              >
                <span className="text-text-muted -ml-px">
                  {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
                </span>
                <FolderGit size={11} className="text-text-muted" />
                <span className="text-[11px] font-semibold tracking-wide uppercase text-text-muted truncate">{ws.name}</span>
                {runningCount > 0 && (
                  <span className="w-[6px] h-[6px] rounded-full bg-accent-brand animate-pulse flex-shrink-0" />
                )}
                <span className="ml-auto font-mono text-[10px] text-text-muted tabular-nums">{items.length}</span>
              </button>
              {expanded && (
                <div className="flex flex-col gap-0.5">
                  {items.map((chat) => (
                    <TaskRow
                      key={chat.id}
                      chat={chat}
                      isSelected={activeChatId === chat.id}
                      agentNames={agentNames}
                      onPin={() => togglePin(chat.id)}
                      onArchive={() => toggleArchive(chat.id)}
                      onAddAgent={() => openAddAgent(chat.id)}
                    />
                  ))}
                  {externalDirs.length > 0 && localCount > 0 && (
                    <LocalSessionsSection
                      label="Local Sessions"
                      count={localCount}
                      expanded={localExpanded}
                      onToggle={() => toggleWsLocal(ws.id)}
                      dirs={externalDirs}
                    />
                  )}
                </div>
              )}
            </div>
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

  const pinned = visibleChats
    .filter((c) => pinnedIds.has(c.id))
    .sort((a, b) => (pinnedAt[b.id] ?? 0) - (pinnedAt[a.id] ?? 0))

  const visibleNonPinned = visibleChats.filter((c) => !pinnedIds.has(c.id) && !archivedIds.has(c.id))
  const active = visibleNonPinned.filter((c) => !isCompletedStatus(c))
  const completedAuto = visibleNonPinned.filter(isCompletedStatus)
  const archived = visibleChats.filter((c) => archivedIds.has(c.id))
  const completed = [...completedAuto, ...archived]

  const wsExternalDirs = externalDirsByWs[workspaceId] ?? []
  const wsLocalCount = wsExternalDirs.reduce((sum, d) => sum + d.sessionCount, 0)
  const wsLocalIsExpanded = wsLocalExpanded[workspaceId] ?? false

  if (visibleChats.length === 0 && wsExternalDirs.length === 0) {
    return (
      <div className="px-3 py-6 text-center">
        <div className="text-[11px] text-text-secondary mb-1">No tasks yet</div>
        <div className="text-[10px] text-text-muted leading-relaxed">Create one with ⌘N or the New Task button.</div>
      </div>
    )
  }

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
        {active.length === 0 ? (
          <div className="px-3 py-1 text-[10px] text-text-muted italic">No active tasks</div>
        ) : (
          active.map((chat) => (
            <TaskRow
              key={chat.id}
              chat={chat}
              isSelected={activeChatId === chat.id}
              agentNames={agentNames}
              onPin={() => togglePin(chat.id)}
              onArchive={() => toggleArchive(chat.id)}
              onAddAgent={() => openAddAgent(chat.id)}
            />
          ))
        )}
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

      {wsExternalDirs.length > 0 && wsLocalCount > 0 && (
        <LocalSessionsSection
          label="Local Sessions"
          count={wsLocalCount}
          expanded={wsLocalIsExpanded}
          onToggle={() => toggleWsLocal(workspaceId)}
          dirs={wsExternalDirs}
        />
      )}
    </div>
  )
}

const Section = ({ icon, label, count, children }: {
  icon: React.ReactNode
  label: string
  count: number
  children: React.ReactNode
}) => (
  <div>
    <div className="flex items-center gap-1.5 px-2 pb-1">
      <span className="text-text-muted">{icon}</span>
      <span className="text-[11px] font-semibold tracking-wide uppercase text-text-muted">{label}</span>
      <span className="ml-auto font-mono text-[10px] text-text-muted tabular-nums">{count}</span>
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

// "Local Sessions" inside a workspace group — folds N external dirs that
// fall under the workspace's repositories. Each dir expands independently
// (its own jsonl pagination fires only on expand).
const LocalSessionsSection = ({ label, count, expanded, onToggle, dirs }: {
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  dirs: ExternalDirInfo[]
}) => (
  <CollapsibleSection
    icon={<Terminal size={11} />}
    label={label}
    count={count}
    expanded={expanded}
    onToggle={onToggle}
  >
    {dirs.map((d) => (
      <ExternalDirRow key={d.cwd} dir={d} />
    ))}
  </CollapsibleSection>
)

// Cwd row inside a "Local Sessions" rollup. Click expands to show jsonl rows.
const ExternalDirRow = ({ dir }: { dir: ExternalDirInfo }) => {
  const [expanded, setExpanded] = useState(false)
  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        title={dir.cwd}
        className="w-full flex items-center gap-1.5 pl-3 pr-2 py-1 hover:bg-bg-hover rounded-md transition-colors"
        aria-expanded={expanded}
      >
        <span className="text-text-muted -ml-px">
          {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        </span>
        <Folder size={11} className="text-text-muted" />
        <span className="text-[11px] text-text-secondary flex-1 truncate">{basename(dir.cwd)}</span>
        <span className="font-mono text-[10px] text-text-muted tabular-nums">{dir.sessionCount}</span>
      </button>
      {expanded && (
        <div className="pl-3">
          <ExternalCwdSessions cwd={dir.cwd} enabled={expanded} />
        </div>
      )}
    </div>
  )
}

// Top-level rollup for cwds not matched to any workspace. Rendered after
// the workspace tree in cross-workspace view only.
const UnmatchedDirsSection = ({ dirs, expandedMap, onToggle }: {
  dirs: UnmatchedExternalDir[]
  expandedMap: Record<string, boolean>
  onToggle: (cwd: string) => void
}) => (
  <div className="mt-2 border-t border-border/40 pt-2">
    <div className="flex items-center gap-1.5 px-2 pb-1">
      <Terminal size={11} className="text-text-muted" />
      <span className="text-[11px] font-semibold tracking-wide uppercase text-text-muted">External CWDs</span>
      <span className="ml-auto font-mono text-[10px] text-text-muted tabular-nums">{dirs.length}</span>
    </div>
    <div className="flex flex-col gap-0.5">
      {dirs.map((d) => {
        const expanded = expandedMap[d.cwd] ?? false
        return (
          <div key={d.cwd}>
            <button
              onClick={() => onToggle(d.cwd)}
              title={d.cwd}
              className="w-full flex items-center gap-1.5 px-2 py-1 hover:bg-bg-hover rounded-md transition-colors"
              aria-expanded={expanded}
            >
              <span className="text-text-muted -ml-px">
                {expanded ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
              </span>
              <Folder size={11} className="text-text-muted" />
              <span className="text-[11px] text-text-secondary flex-1 truncate">{basename(d.cwd)}</span>
              <span className="font-mono text-[10px] text-text-muted tabular-nums">{d.sessionCount}</span>
            </button>
            {expanded && (
              <div className="pl-3">
                <ExternalCwdSessions cwd={d.cwd} enabled={expanded} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  </div>
)

export default TaskSessionList
