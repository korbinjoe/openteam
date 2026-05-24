import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { TimelineEntry } from '@/hooks/useDevPanel'
import { fmtTime } from './helpers'

const sourceColor = (source: TimelineEntry['source']) => {
  switch (source) {
    case 'ws': return 'bg-blue-500/20 text-blue-400'
    case 'matrix': return 'bg-purple-500/20 text-purple-400'
    case 'oss': return 'bg-emerald-500/20 text-emerald-400'
    case 'internal': return 'bg-zinc-500/20 text-zinc-400'
  }
}

const directionIcon = (dir: TimelineEntry['direction']) => {
  switch (dir) {
    case 'out': return { icon: '↑', color: 'text-blue-400' }
    case 'in': return { icon: '↓', color: 'text-green-400' }
    case 'internal': return { icon: '•', color: 'text-zinc-500' }
  }
}

const typeColor = (type: string) => {
  if (type.startsWith('task.dispatch')) return 'text-blue-400'
  if (type.startsWith('task.result')) return 'text-green-400'
  if (type.startsWith('task.stream')) return 'text-cyan-400'
  if (type.startsWith('task.progress')) return 'text-yellow-400'
  if (type.startsWith('sync.')) return 'text-purple-400'
  if (type.startsWith('agent.')) return 'text-zinc-500'
  if (type.startsWith('syncChat') || type.startsWith('syncJsonl') || type.startsWith('syncWorkspace')) return 'text-emerald-400'
  return 'text-zinc-400'
}

const TimelineRow = ({ entry }: { entry: TimelineEntry }) => {
  const [expanded, setExpanded] = useState(false)
  const dir = directionIcon(entry.direction)
  const hasDetail = !!entry.detail && Object.keys(entry.detail).length > 0

  return (
    <div className="group">
      <button
        onClick={() => hasDetail && setExpanded(!expanded)}
        className={cn('w-full flex items-center gap-1.5 text-[10px] py-1 hover:bg-zinc-800/30 rounded px-2', hasDetail && 'cursor-pointer')}
      >
        <span className="text-zinc-600 font-mono shrink-0 w-[58px]">{fmtTime(entry.timestamp)}</span>
        <span className={cn('shrink-0 w-[10px] font-bold', dir.color)}>{dir.icon}</span>
        <span className={cn('shrink-0 text-[9px] px-1.5 py-0.5 rounded', sourceColor(entry.source))}>
          {entry.source}
        </span>
        <span className={cn('font-medium shrink-0', typeColor(entry.type))}>{entry.type}</span>
        <span className="text-zinc-500 truncate ml-1">{entry.summary}</span>
        {entry.missionId && (
          <span className="text-zinc-700 font-mono shrink-0 ml-auto">{entry.missionId.slice(0, 8)}</span>
        )}
        {hasDetail && (
          <span className="text-zinc-600 shrink-0 ml-1">{expanded ? '▼' : '▶'}</span>
        )}
      </button>
      {expanded && hasDetail && (
        <pre className="text-[9px] font-mono text-zinc-400 bg-zinc-950/50 px-2 py-1 mx-2 mb-1 rounded overflow-x-auto max-h-[200px] overflow-y-auto whitespace-pre-wrap break-all">
          {JSON.stringify(entry.detail, null, 2)}
        </pre>
      )}
    </div>
  )
}

const detectTimeGaps = (entries: TimelineEntry[], thresholdMs = 5000): Map<number, number> => {
  const gaps = new Map<number, number>()
  for (let i = 0; i < entries.length - 1; i++) {
    const gap = entries[i].timestamp - entries[i + 1].timestamp
    if (gap > thresholdMs) gaps.set(i, gap)
  }
  return gaps
}

const formatGap = (ms: number) => {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
}

export const DevProtocolTimeline = ({ entries }: { entries: TimelineEntry[] }) => {
  const { t } = useTranslation('chat')
  const [sourceFilter, setSourceFilter] = useState<string>('')
  const [typeFilter, setTypeFilter] = useState('')

  const filtered = entries.filter((e) => {
    if (sourceFilter && e.source !== sourceFilter) return false
    if (typeFilter && !e.type.includes(typeFilter) && !e.summary.includes(typeFilter)) return false
    return true
  })

  const gaps = detectTimeGaps(filtered)
  const sources = Array.from(new Set(entries.map((e) => e.source)))

  return (
    <div className="py-2">
      <div className="px-3 mb-2 flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setSourceFilter('')}
            className={cn(
              'text-[10px] px-1.5 py-0.5 rounded',
              !sourceFilter ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300',
            )}
          >
            All
          </button>
          {sources.map((s) => (
            <button
              key={s}
              onClick={() => setSourceFilter(sourceFilter === s ? '' : s)}
              className={cn(
                'text-[10px] px-1.5 py-0.5 rounded',
                sourceFilter === s ? sourceColor(s as TimelineEntry['source']) : 'text-zinc-500 hover:text-zinc-300',
              )}
            >
              {s}
            </button>
          ))}
        </div>
        <input
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          placeholder="Filter type/summary..."
          className="flex-1 min-w-[120px] bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-300 placeholder:text-zinc-600 outline-none focus:border-zinc-500"
        />
        <span className="text-[10px] text-zinc-600">{t('dev.total', { count: filtered.length })}</span>
      </div>

      <div className="max-h-[calc(100vh-280px)] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="text-xs text-zinc-600 italic py-8 text-center">{t('dev.noMessages')}</div>
        ) : (
          filtered.map((entry, i) => (
            <div key={`${entry.timestamp}-${i}`}>
              <TimelineRow entry={entry} />
              {gaps.has(i) && (
                <div className="flex items-center gap-2 px-3 py-1">
                  <div className="flex-1 border-t border-dashed border-zinc-800" />
                  <span className="text-[9px] text-zinc-600 font-mono shrink-0">
                    gap: {formatGap(gaps.get(i)!)}
                  </span>
                  <div className="flex-1 border-t border-dashed border-zinc-800" />
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
