import { useState, useMemo } from 'react'
import { cn } from '@/lib/utils'
import type { DevEvent } from '@/hooks/useDevPanel'

interface DevEventsTabProps {
  events: DevEvent[]
  onClear: () => void
}

export const DevEventsTab = ({ events, onClear }: DevEventsTabProps) => {
  const [paused, setPaused] = useState(false)
  const [filterType, setFilterType] = useState<string | null>(null)
  const [filterAgent, setFilterAgent] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const eventTypes = useMemo(() => {
    const types = new Set<string>()
    events.forEach((e) => types.add(e.type))
    return Array.from(types).sort()
  }, [events])

  const agentIds = useMemo(() => {
    const ids = new Set<string>()
    events.forEach((e) => { if (e.agentId) ids.add(e.agentId) })
    return Array.from(ids).sort()
  }, [events])

  const displayEvents = useMemo(() => {
    return events.filter((e) => {
      if (filterType && e.type !== filterType) return false
      if (filterAgent && e.agentId !== filterAgent) return false
      if (search) {
        const haystack = `${e.type} ${e.agentId ?? ''} ${JSON.stringify(e.data ?? {})}`.toLowerCase()
        if (!haystack.includes(search.toLowerCase())) return false
      }
      return true
    })
  }, [events, filterType, filterAgent, search])

  const formatTime = (ts: number) => {
    const d = new Date(ts)
    return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
      + '.' + String(d.getMilliseconds()).padStart(3, '0')
  }

  const typeColor = (type: string) => {
    if (type.includes('error') || type.includes('fail')) return 'text-red-400'
    if (type.includes('permission')) return 'text-yellow-400'
    if (type.includes('complete') || type.includes('done')) return 'text-green-400'
    return 'text-zinc-300'
  }

  return (
    <div className="flex flex-col h-full">
      {/* Controls */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0 flex-wrap">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[11px] text-zinc-200 w-28 focus:outline-none focus:border-zinc-500"
        />
        <select
          value={filterType ?? ''}
          onChange={(e) => setFilterType(e.target.value || null)}
          className="bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-300"
        >
          <option value="">All types</option>
          {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
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
        <div className="flex items-center gap-1 ml-auto">
          <button
            onClick={() => setPaused(!paused)}
            className={cn('px-1.5 py-0.5 rounded text-[10px]',
              paused ? 'bg-yellow-900/50 text-yellow-300' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200')}
          >
            {paused ? '▶ Resume' : '⏸ Pause'}
          </button>
          <button
            onClick={onClear}
            className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800 text-zinc-400 hover:text-zinc-200"
          >
            Clear
          </button>
          <span className="text-[10px] text-zinc-600">{displayEvents.length} events</span>
        </div>
      </div>

      {/* Event Stream */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {displayEvents.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs text-zinc-600">No events</div>
        ) : (
          (paused ? displayEvents : displayEvents).slice(0, 300).map((ev, idx) => (
            <div key={`${ev.timestamp}-${idx}`}>
              <div
                className="flex items-center gap-2 px-3 py-1 hover:bg-zinc-800/30 cursor-pointer text-[11px] border-b border-zinc-900"
                onClick={() => setExpandedIdx(expandedIdx === idx ? null : idx)}
                onKeyDown={(e) => { if (e.key === 'Enter') setExpandedIdx(expandedIdx === idx ? null : idx) }}
                role="button"
                tabIndex={0}
              >
                <span className="text-zinc-600 font-mono shrink-0 w-[72px]">{formatTime(ev.timestamp)}</span>
                <span className={cn('font-mono shrink-0', typeColor(ev.type))}>{ev.type}</span>
                {ev.agentId && <span className="text-zinc-500 font-mono text-[10px] shrink-0">[{ev.agentId}]</span>}
                {ev.data && (
                  <span className="text-zinc-600 truncate flex-1 font-mono">
                    {JSON.stringify(ev.data).slice(0, 60)}
                  </span>
                )}
              </div>
              {expandedIdx === idx && ev.data && (
                <pre className="px-6 py-2 text-[10px] text-zinc-400 bg-zinc-900/50 overflow-x-auto border-b border-zinc-800">
                  {JSON.stringify(ev.data, null, 2)}
                </pre>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
