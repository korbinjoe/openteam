import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { DevEvent, TimelineEntry } from '@/hooks/useDevPanel'

interface DevProtocolTabProps {
  events: DevEvent[]
  timeline: TimelineEntry[]
}

type ProtocolEntry = {
  id: string
  timestamp: number
  direction: 'in' | 'out' | 'internal'
  source: string
  type: string
  category: 'acp' | 'agent-msg' | 'ws-control' | 'lifecycle'
  summary: string
  detail?: Record<string, unknown>
}

const CATEGORY_COLORS: Record<string, string> = {
  'acp': 'bg-purple-900/50 text-purple-300',
  'agent-msg': 'bg-blue-900/50 text-blue-300',
  'ws-control': 'bg-zinc-800 text-zinc-300',
  'lifecycle': 'bg-green-900/50 text-green-300',
}

const DIRECTION_ICON: Record<string, string> = {
  'in': '←',
  'out': '→',
  'internal': '↔',
}

const categorizeEvent = (type: string): ProtocolEntry['category'] => {
  if (type.startsWith('acp:') || type.includes('session_update')) return 'acp'
  if (type.startsWith('task:') || type === 'handoff') return 'agent-msg'
  if (type.startsWith('pty:') || type.startsWith('jsonl:')) return 'lifecycle'
  return 'ws-control'
}

const categorizeTimeline = (source: string): ProtocolEntry['category'] => {
  if (source === 'matrix') return 'agent-msg'
  if (source === 'ws') return 'ws-control'
  return 'acp'
}

export const DevProtocolTab = ({ events, timeline }: DevProtocolTabProps) => {
  const [filterCategory, setFilterCategory] = useState<string | null>(null)
  const [filterAgent, setFilterAgent] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const entries = useMemo((): ProtocolEntry[] => {
    const combined: ProtocolEntry[] = []

    for (const ev of events) {
      combined.push({
        id: `ev-${ev.timestamp}-${ev.type}`,
        timestamp: ev.timestamp,
        direction: ev.type.startsWith('pty:') || ev.type.startsWith('jsonl:') ? 'internal' : 'in',
        source: ev.agentId ?? 'system',
        type: ev.type,
        category: categorizeEvent(ev.type),
        summary: ev.data ? JSON.stringify(ev.data).slice(0, 80) : ev.type,
        detail: ev.data,
      })
    }

    for (const entry of timeline) {
      combined.push({
        id: `tl-${entry.timestamp}-${entry.type}`,
        timestamp: entry.timestamp,
        direction: entry.direction,
        source: entry.agentId ?? entry.source,
        type: entry.type,
        category: categorizeTimeline(entry.source),
        summary: entry.summary,
        detail: entry.detail,
      })
    }

    combined.sort((a, b) => b.timestamp - a.timestamp)
    return combined
  }, [events, timeline])

  const agentIds = useMemo(() => {
    const ids = new Set<string>()
    entries.forEach((e) => { if (e.source !== 'system') ids.add(e.source) })
    return Array.from(ids).sort()
  }, [entries])

  const filtered = useMemo(() => {
    return entries.filter((e) => {
      if (filterCategory && e.category !== filterCategory) return false
      if (filterAgent && e.source !== filterAgent) return false
      if (search && !e.type.includes(search) && !e.summary.toLowerCase().includes(search.toLowerCase())) return false
      return true
    })
  }, [entries, filterCategory, filterAgent, search])

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(d.getMilliseconds()).padStart(3, '0')
  }

  return (
    <div className="flex flex-col h-full">
      {/* Filter Bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0 flex-wrap">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[11px] text-zinc-200 w-32 focus:outline-none focus:border-zinc-500"
        />
        {(['acp', 'agent-msg', 'ws-control', 'lifecycle'] as const).map((cat) => (
          <button
            key={cat}
            onClick={() => setFilterCategory(filterCategory === cat ? null : cat)}
            className={cn(
              'px-1.5 py-0.5 rounded text-[10px] font-mono',
              filterCategory === cat ? CATEGORY_COLORS[cat] : 'bg-zinc-800/50 text-zinc-500 hover:text-zinc-300',
            )}
          >
            {cat}
          </button>
        ))}
        {agentIds.length > 0 && (
          <select
            value={filterAgent ?? ''}
            onChange={(e) => setFilterAgent(e.target.value || null)}
            className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-300"
          >
            <option value="">All agents</option>
            {agentIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        )}
        <span className="text-[10px] text-zinc-600 ml-auto">{filtered.length} entries</span>
      </div>

      {/* Protocol Entries */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs text-zinc-600">No protocol entries</div>
        ) : (
          filtered.slice(0, 200).map((entry) => (
            <div key={entry.id}>
              <div
                className="flex items-center gap-2 px-3 py-1 hover:bg-zinc-800/30 cursor-pointer text-[11px] border-b border-zinc-900"
                onClick={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') setExpandedId(expandedId === entry.id ? null : entry.id) }}
                role="button"
                tabIndex={0}
              >
                <span className="text-zinc-600 font-mono shrink-0 w-[72px]">{formatTime(entry.timestamp)}</span>
                <span className={cn('shrink-0 w-4 text-center',
                  entry.direction === 'in' ? 'text-green-500' :
                  entry.direction === 'out' ? 'text-blue-500' : 'text-zinc-500',
                )}>
                  {DIRECTION_ICON[entry.direction]}
                </span>
                <span className={cn('px-1 rounded text-[10px] font-mono shrink-0', CATEGORY_COLORS[entry.category])}>
                  {entry.type}
                </span>
                <span className="text-zinc-500 truncate flex-1">{entry.summary}</span>
                <span className="text-zinc-700 font-mono text-[10px] shrink-0">{entry.source}</span>
              </div>
              {expandedId === entry.id && entry.detail && (
                <pre className="px-6 py-2 text-[10px] text-zinc-400 bg-zinc-900/50 overflow-x-auto border-b border-zinc-800">
                  {JSON.stringify(entry.detail, null, 2)}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
