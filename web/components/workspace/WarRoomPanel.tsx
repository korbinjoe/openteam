import { useMemo } from 'react'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useWhiteboard } from '../../hooks/useWhiteboard'
import { cn } from '../../lib/utils'
import type { WhiteboardEntry, WhiteboardEntryType } from '@shared/whiteboard-types'

const TYPE_LABEL: Record<WhiteboardEntryType, string> = {
  goal: 'GOAL',
  decision: 'DECISION',
  open_question: 'OPEN QUESTION',
  constraint: 'CONSTRAINT',
  handoff: 'HANDOFF',
  artifact: 'ARTIFACT',
  progress: 'PROGRESS',
}

// Left color stripe per type — drives the only chrome on each card so the
// summary text gets the visual weight, not the metadata badge.
const TYPE_STRIPE: Record<WhiteboardEntryType, string> = {
  open_question: 'bg-accent-yellow',
  constraint:    'bg-accent-red',
  decision:      'bg-accent-brand',
  goal:          'bg-accent-brand-light',
  handoff:       'bg-accent-green',
  artifact:      'bg-text-muted',
  progress:      'bg-text-muted',
}

const TYPE_TEXT: Record<WhiteboardEntryType, string> = {
  open_question: 'text-accent-yellow',
  constraint:    'text-accent-red',
  decision:      'text-accent-brand-light',
  goal:          'text-accent-brand-light',
  handoff:       'text-accent-green',
  artifact:      'text-text-secondary',
  progress:      'text-text-muted',
}

/** Live counts for IDE-strip badge. */
export const useWarRoomCounts = () => {
  const { activeChatId } = useWorkspace()
  const { goal, active } = useWhiteboard(activeChatId ?? undefined)
  const entries: WhiteboardEntry[] = useMemo(() => (goal ? [goal, ...active] : active), [goal, active])
  const open = entries.filter((e) => e.type === 'open_question' || e.type === 'constraint').length
  return { open, total: entries.length }
}

const relativeAgo = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h`
  return `${Math.floor(diff / 86_400_000)}d`
}

// Priority order: blockers first (need user action), then commitments (decisions/goals),
// then observational entries (handoffs, artifacts, progress).
const SECTIONS: Array<{ key: string; title: string; types: WhiteboardEntryType[]; emptyHint?: string }> = [
  { key: 'blockers',    title: 'Open Questions & Constraints', types: ['open_question', 'constraint'] },
  { key: 'commitments', title: 'Goals & Decisions',            types: ['goal', 'decision'] },
  { key: 'activity',    title: 'Activity',                     types: ['handoff', 'artifact', 'progress'] },
]

const WarRoomContent = () => {
  const { activeChatId } = useWorkspace()
  const { goal, active, loading, error, archive } = useWhiteboard(activeChatId ?? undefined)

  const entries: WhiteboardEntry[] = useMemo(() => (goal ? [goal, ...active] : active), [goal, active])
  const blockerCount = entries.filter((e) => e.type === 'open_question' || e.type === 'constraint').length

  if (!activeChatId) {
    return (
      <div className="flex items-center justify-center h-full px-4 py-6 text-center">
        <div>
          <div className="text-[11px] font-medium text-text-secondary mb-1">No active task</div>
          <div className="text-[10px] text-text-muted leading-relaxed">War-room appears once a task is selected.</div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <Header total={entries.length} blockerCount={blockerCount} />

      <div className="flex-1 overflow-y-auto px-3 py-2.5 space-y-4">
        {loading && entries.length === 0 ? (
          <div className="text-[10px] text-text-muted px-1 py-3">Loading whiteboard…</div>
        ) : error ? (
          <div className="text-[10px] text-accent-red px-1 py-3">{error}</div>
        ) : entries.length === 0 ? (
          <EmptyState />
        ) : (
          SECTIONS.map((section) => {
            const items = entries.filter((e) => section.types.includes(e.type))
            if (items.length === 0) return null
            return (
              <Section key={section.key} title={section.title} count={items.length}>
                {items.map((e) => (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    onArchive={() => archive(e.id, 'workspace:user').catch(() => {})}
                  />
                ))}
              </Section>
            )
          })
        )}
      </div>
    </div>
  )
}

const Header = ({ total, blockerCount }: { total: number; blockerCount: number }) => (
  <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle flex-shrink-0">
    <span className="text-[10px] font-semibold tracking-wide text-text-secondary uppercase">War Room</span>
    <span className="font-mono text-[10px] text-text-muted tabular-nums">{total}</span>
    {blockerCount > 0 && (
      <span className="ml-auto inline-flex items-center gap-1 px-1.5 py-px rounded-[3px] bg-accent-yellow/10 text-accent-yellow text-[10px] font-semibold tabular-nums">
        <span className="w-1.5 h-1.5 rounded-full bg-accent-yellow" />
        {blockerCount} blocked
      </span>
    )}
  </div>
)

const Section = ({ title, count, children }: { title: string; count: number; children: React.ReactNode }) => (
  <section>
    <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
      <span className="text-[10px] font-semibold tracking-wider text-text-muted uppercase">{title}</span>
      <span className="font-mono text-[10px] text-text-muted/70 tabular-nums">{count}</span>
    </div>
    <div className="space-y-1">{children}</div>
  </section>
)

const EntryRow = ({ entry, onArchive }: { entry: WhiteboardEntry; onArchive: () => void }) => {
  const isOpenQuestion = entry.type === 'open_question'
  const isConstraint = entry.type === 'constraint'
  const needsAttention = isOpenQuestion || isConstraint

  return (
    <div className={cn(
      'group relative flex gap-2 pl-2 pr-2 py-2 rounded-[5px] border border-border-subtle bg-bg-primary hover:border-border transition-colors',
      needsAttention && (isOpenQuestion ? 'bg-accent-yellow/[0.025]' : 'bg-accent-red/[0.025]'),
    )}>
      <span className={cn('w-[2px] rounded-full flex-shrink-0', TYPE_STRIPE[entry.type])} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn('text-[10px] font-semibold tracking-wide', TYPE_TEXT[entry.type])}>
            {TYPE_LABEL[entry.type]}
          </span>
          <span className="text-[10px] text-text-muted">·</span>
          <span className="text-[10px] text-text-secondary truncate">{entry.by}</span>
          <span className="text-[10px] text-text-muted">·</span>
          <span className="font-mono text-[10px] text-text-muted tabular-nums">{relativeAgo(entry.timestamp)}</span>
          {isOpenQuestion && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onArchive() }}
              className="ml-auto px-1.5 py-[1px] rounded text-[10px] text-text-muted opacity-0 group-hover:opacity-100 hover:bg-bg-hover hover:text-text-secondary transition-all"
            >
              Resolve
            </button>
          )}
        </div>
        <div className="text-[11px] leading-snug text-text-primary mt-0.5 line-clamp-3">{entry.summary}</div>
      </div>
    </div>
  )
}

const EmptyState = () => (
  <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
    <div className="text-[11px] font-medium text-text-secondary mb-1">No entries yet</div>
    <div className="text-[10px] text-text-muted leading-relaxed max-w-[240px]">
      Decisions, open questions, and handoffs from agents will appear here as they work.
    </div>
  </div>
)

export default WarRoomContent
