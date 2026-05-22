import { useRef, useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useWorkspaceChats } from '../../hooks/useWorkspaceChats'
import { useAgents } from '../../hooks/useAgents'
import { Search } from './icons'
import { buildTaskUrl } from './urls'
import { buildTaskOpenUrl } from './TaskSessionRows'
import type { Chat, ChatMember } from '../workspace/types'

interface PaletteEntry {
  type: 'task' | 'member' | 'action'
  id: string
  /** Members carry their parent task id so visual grouping survives filtering. */
  parentTaskId?: string
  label: string
  group?: string
  status?: string
  time?: string
  shortcut?: string
  run: () => void
}

const fuzzyMatch = (query: string, text: string): boolean => {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

const formatTimeAgo = (iso: string | undefined): string => {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

const chatStatusLabel = (chat: Chat): { status: string; time: string } => {
  const taskStatus = (chat as Chat & { taskStatus?: string }).taskStatus
  let status = chat.status
  if (taskStatus === 'error') status = 'error' as Chat['status']
  else if (taskStatus === 'waiting_input' || taskStatus === 'waiting_confirm') status = 'waiting' as Chat['status']
  return { status: String(status), time: formatTimeAgo(chat.lastMessageAt) }
}

const memberStatusToString = (s: ChatMember['status']): string => {
  if (s === 'idle' || s === 'done') return s
  return s
}

const CommandPalette = () => {
  const {
    workspaceId,
    commandPaletteOpen, closeCommandPalette,
    openNewTask, togglePanel, toggleTerminal, cycleLayoutMode, toggleIde,
  } = useWorkspace()
  const { chats } = useWorkspaceChats(workspaceId)
  const { agentNames } = useAgents()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('')
      setSelectedIndex(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [commandPaletteOpen])

  // Build entries flat-mapped: each task becomes [task header, ...members].
  // Visual grouping is reconstructed at render time via `parentTaskId`.
  const entries: PaletteEntry[] = useMemo(() => {
    const out: PaletteEntry[] = []
    for (const c of chats) {
      const { status, time } = chatStatusLabel(c)
      out.push({
        type: 'task',
        id: `task:${c.id}`,
        parentTaskId: c.id,
        label: c.title,
        group: 'overview',
        status,
        time,
        run: () => { if (workspaceId) navigate(buildTaskOpenUrl(c)) },
      })
      const members = c.members ?? []
      for (const m of members) {
        out.push({
          type: 'member',
          id: `member:${c.id}:${m.agentId}`,
          parentTaskId: c.id,
          label: agentNames[m.agentId] ?? m.agentId,
          group: m.role === 'lead' ? 'lead' : 'worker',
          status: memberStatusToString(m.status),
          time: formatTimeAgo(m.lastMessageAt),
          run: () => { if (workspaceId) navigate(buildTaskUrl(workspaceId, c.id, m.agentId)) },
        })
      }
    }
    const actionEntries: PaletteEntry[] = [
      { type: 'action', id: 'new-task',        label: 'New Task',         shortcut: '⌘N', run: openNewTask },
      { type: 'action', id: 'toggle-panel',    label: 'Toggle Sidebar',   shortcut: '⌘B', run: togglePanel },
      { type: 'action', id: 'toggle-terminal', label: 'Toggle Terminal',  shortcut: '⌘`', run: toggleTerminal },
      { type: 'action', id: 'toggle-ide',      label: 'Toggle IDE Panel', shortcut: '⌘J', run: toggleIde },
      { type: 'action', id: 'cycle-layout',    label: 'Cycle Layout',     shortcut: '⌘\\', run: cycleLayoutMode },
    ]
    return [...out, ...actionEntries]
  }, [chats, agentNames, workspaceId, navigate, openNewTask, togglePanel, toggleTerminal, toggleIde, cycleLayoutMode])

  // Filter: a task title match surfaces the task header + all its members; a
  // member name match surfaces the parent header + that member only (so the
  // user sees which task it belongs to).
  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return entries
    const taskMatch = new Set<string>()
    const memberMatch = new Set<string>()
    for (const e of entries) {
      if (e.type === 'task' && fuzzyMatch(q, e.label)) {
        taskMatch.add(e.parentTaskId!)
      } else if (e.type === 'member' && fuzzyMatch(q, e.label)) {
        memberMatch.add(e.id)
      }
    }
    const matchedTaskIds = new Set<string>([
      ...taskMatch,
      ...Array.from(memberMatch).map((id) => id.split(':')[1]),
    ])
    return entries.filter((e) => {
      if (e.type === 'action') return fuzzyMatch(q, e.label)
      if (e.type === 'task') return matchedTaskIds.has(e.parentTaskId!)
      // member row
      const taskId = e.parentTaskId!
      // Include all members of a task whose title matched; otherwise only the matched member.
      return taskMatch.has(taskId) || memberMatch.has(e.id)
    })
  }, [entries, query])

  const executeEntry = (entry: PaletteEntry) => {
    entry.run()
    closeCommandPalette()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      closeCommandPalette()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[selectedIndex]) executeEntry(filtered[selectedIndex])
    }
  }

  if (!commandPaletteOpen) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeCommandPalette()
  }

  const taskAndMemberEntries = filtered.filter((e) => e.type === 'task' || e.type === 'member')
  const actionEntries = filtered.filter((e) => e.type === 'action')

  let flatIndex = 0

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-[20vh] z-[100]"
      onClick={handleBackdropClick}
    >
      <div className="w-[520px] border border-border rounded-xl bg-bg-secondary shadow-2xl overflow-hidden">
        <div className="px-4 py-3.5 border-b border-border flex items-center gap-2.5">
          <Search size={16} className="text-accent-brand" />
          <input
            ref={inputRef}
            className="flex-1 bg-transparent border-none outline-none text-sm text-text-primary font-sans placeholder:text-text-muted"
            placeholder="Search tasks, actions, navigation..."
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIndex(0) }}
            onKeyDown={handleKeyDown}
          />
          <kbd className="px-1.5 py-0.5 rounded border border-border bg-white/[0.04] font-mono text-[11px] text-text-muted">
            esc
          </kbd>
        </div>

        <div className="p-2 max-h-[300px] overflow-y-auto">
          {taskAndMemberEntries.length > 0 && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted px-2.5 py-2 pt-2">
                Tasks
              </div>
              {taskAndMemberEntries.map((entry) => {
                const idx = flatIndex++
                if (entry.type === 'task') {
                  return (
                    <PaletteItem
                      key={entry.id}
                      label={entry.label}
                      sub={entry.group}
                      status={entry.status!}
                      time={entry.time!}
                      selected={idx === selectedIndex}
                      onClick={() => executeEntry(entry)}
                    />
                  )
                }
                return (
                  <MemberPaletteItem
                    key={entry.id}
                    label={entry.label}
                    role={entry.group ?? 'worker'}
                    status={entry.status!}
                    time={entry.time!}
                    selected={idx === selectedIndex}
                    onClick={() => executeEntry(entry)}
                  />
                )
              })}
            </>
          )}

          {actionEntries.length > 0 && (
            <>
              <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted px-2.5 py-2 pt-3">
                Actions
              </div>
              {actionEntries.map((entry) => {
                const idx = flatIndex++
                return (
                  <ActionItem
                    key={entry.id}
                    label={entry.label}
                    shortcut={entry.shortcut || ''}
                    selected={idx === selectedIndex}
                    onClick={() => executeEntry(entry)}
                  />
                )
              })}
            </>
          )}

          {filtered.length === 0 && (
            <div className="px-2.5 py-6 text-center text-xs text-text-muted">No results</div>
          )}
        </div>
      </div>
    </div>
  )
}

const PaletteItem = ({ label, sub, status, time, selected, onClick }: {
  label: string; sub?: string; status: string; time: string; selected: boolean; onClick: () => void
}) => {
  const dotColor =
    status === 'error' ? 'bg-accent-red' :
    status === 'waiting' ? 'bg-accent-yellow' :
    status === 'running' ? 'bg-accent-brand' :
    'bg-text-muted'
  return (
    <div
      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${selected ? 'bg-accent-brand/10' : 'hover:bg-bg-hover'}`}
      onClick={onClick}
    >
      <span className={`w-[7px] h-[7px] rounded-full ${dotColor}`} />
      <span className="text-xs text-text-primary flex-1 truncate">{label}</span>
      {sub && <span className="font-mono text-[11px] text-text-muted">{sub}</span>}
      <span className="font-mono text-[11px] text-text-muted">{time}</span>
    </div>
  )
}

const MemberPaletteItem = ({ label, role, status, time, selected, onClick }: {
  label: string; role: string; status: string; time: string; selected: boolean; onClick: () => void
}) => {
  const dotColor =
    status === 'error' ? 'bg-accent-red' :
    status === 'waiting' ? 'bg-accent-yellow' :
    status === 'running' ? 'bg-accent-brand' :
    status === 'done' ? 'bg-accent-green' :
    'bg-text-muted'
  return (
    <div
      className={`flex items-center gap-2.5 pl-7 pr-2.5 py-1.5 rounded-md cursor-pointer transition-colors ${selected ? 'bg-accent-brand/10' : 'hover:bg-bg-hover'}`}
      onClick={onClick}
    >
      <span className="text-[11px] text-text-muted -ml-1 mr-0">↳</span>
      <span className={`w-[6px] h-[6px] rounded-full ${dotColor}`} />
      <span className="text-[12px] text-text-secondary flex-1 truncate">{label}</span>
      {role === 'lead' && (
        <span className="font-mono text-[10px] font-bold uppercase tracking-wide px-1 py-px rounded-sm bg-accent-purple/[0.12] text-accent-purple">
          LEAD
        </span>
      )}
      <span className="font-mono text-[11px] text-text-muted">{time}</span>
    </div>
  )
}

const ActionItem = ({ label, shortcut, selected, onClick }: { label: string; shortcut: string; selected: boolean; onClick: () => void }) => (
  <div
    className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer transition-colors ${selected ? 'bg-accent-brand/10' : 'hover:bg-bg-hover'}`}
    onClick={onClick}
  >
    <span className="text-xs text-text-primary flex-1">{label}</span>
    <span className="font-mono text-[11px] text-text-muted">{shortcut}</span>
  </div>
)

export default CommandPalette
