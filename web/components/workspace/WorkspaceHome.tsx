import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Zap, Wrench, Eye, LayoutGrid, ClipboardCheck, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useWorkspaceChats } from '../../hooks/useWorkspaceChats'
import { useAgents } from '../../hooks/useAgents'
import AgentAvatar from '../ui/agent-avatar'
import type { Chat } from './types'

const TEMPLATES = [
  { icon: Zap, title: 'Ship a feature', desc: 'Code, tests, and PR in one shot' },
  { icon: Wrench, title: 'Fix a bug', desc: 'Trace, diagnose, patch' },
  { icon: Eye, title: 'Review code', desc: 'Deep review with suggestions' },
  { icon: LayoutGrid, title: 'Design UI', desc: 'From sketch to production code' },
  { icon: ClipboardCheck, title: 'Write tests', desc: 'Coverage targets, auto-generated' },
  { icon: Package, title: 'Refactor', desc: 'Restructure without regressions' },
] as const

const FEED_PREVIEW_COUNT = 3

const getGreeting = (): string => {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

const relativeTime = (dateStr: string | undefined): string => {
  if (!dateStr) return ''
  const diff = Date.now() - new Date(dateStr).getTime()
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  return `${Math.floor(diff / 86_400_000)}d ago`
}

const WorkspaceHome = () => {
  const { workspaceId, openNewMission } = useWorkspace()
  const { running, awaitingReview, done } = useWorkspaceChats(workspaceId)
  const { availableAgents, resolveAgentName } = useAgents()
  const navigate = useNavigate()

  const failedChats = done.filter((c) => (c as Chat & { missionStatus?: string }).missionStatus === 'error')
  const completedChats = done.filter((c) => (c as Chat & { missionStatus?: string }).missionStatus !== 'error')
  const hasActivity = running.length > 0 || awaitingReview.length > 0 || done.length > 0

  const goToMission = (chatId: string) => {
    if (workspaceId) navigate(`/workspace/${workspaceId}/mission/${chatId}`)
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-[760px] mx-auto px-16 py-10">
        {/* Header */}
        <div className="mb-9">
          {!hasActivity && <div className="text-[13px] font-medium text-text-muted mb-1">{getGreeting()}</div>}
          {hasActivity ? (
            <div className="flex items-center gap-5">
              <h2 className="text-[20px] font-extrabold text-text-emphasis tracking-[-0.3px] mr-auto">
                Welcome back
              </h2>
              <div className="flex items-center gap-5">
                {running.length > 0 && <StatBadge color="bg-accent-brand" count={running.length} label="running" />}
                {awaitingReview.length > 0 && <StatBadge color="bg-accent-yellow" count={awaitingReview.length} label="to review" />}
                {failedChats.length > 0 && <StatBadge color="bg-accent-red" count={failedChats.length} label="failed" />}
                {completedChats.length > 0 && <StatBadge color="bg-accent-green/50" count={completedChats.length} label="done" />}
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-[26px] font-extrabold text-text-emphasis tracking-tight leading-[1.2] mb-2">
                What should your team work on?
              </h1>
              <p className="text-[13px] text-text-muted leading-relaxed max-w-[400px] mb-5">
                Describe a task, assign agents, walk away.
                They'll ship code, open PRs, and ping you when it's done.
              </p>
              <button
                onClick={() => openNewMission()}
                className="inline-flex items-center gap-2 px-4 py-2 bg-accent-brand rounded-md text-[12px] font-bold text-white hover:bg-accent-brand-light transition-colors"
              >
                New Mission
                <kbd className="text-[9px] font-semibold px-1.5 py-0.5 bg-white/15 rounded">⌘N</kbd>
              </button>
            </>
          )}
        </div>

        {/* Activity feed */}
        {hasActivity && (
          <div className="mb-9">
            {awaitingReview.length > 0 && (
              <FeedSection label="Needs your review" count={awaitingReview.length}>
                {awaitingReview.slice(0, FEED_PREVIEW_COUNT).map((chat) => (
                  <FeedItem
                    key={chat.id}
                    chat={chat}
                    resolveAgentName={resolveAgentName}
                    actionLabel="Review"
                    onClick={() => goToMission(chat.id)}
                  />
                ))}
                {awaitingReview.length > FEED_PREVIEW_COUNT && (
                  <ShowMoreHint count={awaitingReview.length - FEED_PREVIEW_COUNT} />
                )}
              </FeedSection>
            )}

            {failedChats.length > 0 && (
              <FeedSection label="Failed" count={failedChats.length}>
                {failedChats.slice(0, FEED_PREVIEW_COUNT).map((chat) => (
                  <FeedItem
                    key={chat.id}
                    chat={chat}
                    resolveAgentName={resolveAgentName}
                    isError
                    actionLabel="Investigate"
                    onClick={() => goToMission(chat.id)}
                  />
                ))}
              </FeedSection>
            )}

            {running.length > 0 && (
              <FeedSection label="Running now">
                {running.map((chat) => (
                  <RunningItem
                    key={chat.id}
                    chat={chat}
                    onClick={() => goToMission(chat.id)}
                  />
                ))}
              </FeedSection>
            )}

            {completedChats.length > 0 && (
              <CompletedSection
                chats={completedChats}
                resolveAgentName={resolveAgentName}
                onNavigate={goToMission}
              />
            )}

            <button
              onClick={() => openNewMission()}
              className="w-full mt-3 py-2.5 px-3.5 border border-dashed border-border-subtle rounded-md text-[11px] font-semibold text-text-muted hover:border-accent-brand hover:text-text-secondary transition-colors flex items-center gap-2"
            >
              + Dispatch another mission
              <kbd className="text-[9px] px-1 py-px bg-bg-hover border border-border-subtle rounded">⌘N</kbd>
            </button>
          </div>
        )}

        {/* Team strip */}
        {availableAgents.length > 0 && (
          <div className="mb-9">
            <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.6px] mb-2.5 flex items-center gap-2">
              Your team
              <span className="text-[10px] font-semibold text-accent-green normal-case tracking-normal">
                {availableAgents.length} online
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {availableAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center gap-[6px] pl-1.5 pr-2.5 py-1 bg-bg-secondary border border-border-subtle rounded-full text-[10px] font-semibold text-text-secondary hover:border-border hover:bg-bg-hover transition-colors"
                >
                  <AgentAvatar name={agent.name} agentId={agent.id} size="xs" />
                  <span>{agent.name.split(' ')[0]}</span>
                  <span className="w-1 h-1 rounded-full bg-accent-green opacity-80" />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Templates — only for empty state */}
        {!hasActivity && (
          <div className="mb-9">
            <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.6px] mb-2.5">
              Start with a template
            </div>
            <div className="grid grid-cols-2 gap-x-4">
              {TEMPLATES.map(({ icon: Icon, title, desc }) => (
                <button
                  key={title}
                  onClick={() => openNewMission()}
                  className="flex items-center gap-2 py-2 border-b border-border-subtle hover:bg-bg-secondary rounded pr-2 transition-colors text-left"
                >
                  <div className="w-6 h-6 rounded bg-bg-hover flex items-center justify-center shrink-0">
                    <Icon size={12} className="text-text-secondary" strokeWidth={1.8} />
                  </div>
                  <div className="flex flex-col">
                    <span className="text-[11px] font-bold text-text-primary">{title}</span>
                    <span className="text-[9px] text-text-muted">{desc}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Shortcuts */}
        <div className="flex gap-4">
          <ShortcutHint keys={['⌘', 'N']} label="New mission" />
          <ShortcutHint keys={['⌘', 'K']} label="Commands" />
          <ShortcutHint keys={['/']} label="Search" />
        </div>
      </div>
    </div>
  )
}

const CompletedSection = ({
  chats,
  resolveAgentName,
  onNavigate,
}: {
  chats: Chat[]
  resolveAgentName: (id: string) => string
  onNavigate: (chatId: string) => void
}) => {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? chats : chats.slice(0, FEED_PREVIEW_COUNT)
  const hasMore = chats.length > FEED_PREVIEW_COUNT

  return (
    <FeedSection label="Recently completed" count={chats.length}>
      {visible.map((chat) => (
        <FeedItem
          key={chat.id}
          chat={chat}
          resolveAgentName={resolveAgentName}
          actionLabel="View"
          onClick={() => onNavigate(chat.id)}
        />
      ))}
      {hasMore && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full text-center py-1.5 text-[10px] font-semibold text-text-muted hover:text-accent-brand-light transition-colors"
        >
          {expanded ? 'Show less' : `Show ${chats.length - FEED_PREVIEW_COUNT} more`}
        </button>
      )}
    </FeedSection>
  )
}

const FeedSection = ({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) => (
  <div className="mb-9 last:mb-0">
    <div className="text-[10px] font-bold text-text-muted uppercase tracking-[0.6px] mb-2.5 flex items-center gap-[7px]">
      {label}
      {count != null && (
        <span className="text-[9px] font-bold px-1.5 py-px rounded-full bg-accent-brand/10 text-accent-brand-light">
          {count}
        </span>
      )}
    </div>
    {children}
  </div>
)

const StatBadge = ({ color, count, label }: { color: string; count: number; label: string }) => (
  <div className="flex items-center gap-[5px] text-[11px] text-text-secondary font-semibold">
    <span className={cn('w-1.5 h-1.5 rounded-full', color)} />
    <span className="font-extrabold text-text-primary">{count}</span>
    {label}
  </div>
)

const ShowMoreHint = ({ count }: { count: number }) => (
  <div className="text-center py-1 text-[10px] text-text-muted">
    +{count} more
  </div>
)

const FeedItem = ({
  chat,
  resolveAgentName,
  isError,
  actionLabel,
  onClick,
}: {
  chat: Chat
  resolveAgentName: (id: string) => string
  isError?: boolean
  actionLabel: string
  onClick: () => void
}) => {
  const dotColor = isError ? 'bg-accent-red' : 'bg-accent-green/50'
  const agentName = resolveAgentName(chat.primaryAgentId)
  const summary = chat.members?.find((m) => m.agentId === chat.primaryAgentId)?.lastMessage

  return (
    <button
      onClick={onClick}
      className="w-full grid grid-cols-[8px_1fr_auto] gap-3.5 items-start py-3.5 border-b border-border-subtle last:border-b-0 rounded-md hover:bg-bg-secondary transition-colors text-left px-2 -mx-2"
    >
      <span className={cn('w-2 h-2 rounded-full mt-[5px]', dotColor)} />
      <div className="flex flex-col gap-1 min-w-0">
        <span className="text-[13px] font-bold text-text-primary truncate">{chat.title}</span>
        {summary && (
          <span className="text-[11px] text-text-secondary leading-[1.5] line-clamp-2">{summary}</span>
        )}
        <div className="flex items-center gap-2.5 mt-1 text-[10px] text-text-muted">
          <div className="flex items-center gap-1">
            <AgentAvatar name={agentName} agentId={chat.primaryAgentId} size="xs" />
            <span>{agentName}</span>
          </div>
        </div>
      </div>
      <div className="flex flex-col items-end gap-1.5 pt-0.5 shrink-0">
        <span className="text-[10px] text-text-muted whitespace-nowrap">
          {relativeTime(chat.lastMessageAt)}
        </span>
        <span className={cn(
          'text-[10px] font-bold px-2.5 py-[3px] rounded',
          isError
            ? 'bg-accent-red/[0.08] text-red-300 hover:bg-accent-red/[0.15]'
            : 'bg-accent-brand/10 text-accent-brand-light hover:bg-accent-brand/20',
        )}>
          {actionLabel}
        </span>
      </div>
    </button>
  )
}

const RunningItem = ({
  chat,
  onClick,
}: {
  chat: Chat
  onClick: () => void
}) => {
  const currentStep = chat.members?.find((m) => m.status === 'running')?.lastMessage

  return (
    <button
      onClick={onClick}
      className="w-full grid grid-cols-[6px_1fr_auto] gap-3 items-center py-3 border-b border-border-subtle last:border-b-0 text-left hover:bg-bg-secondary rounded-md transition-colors px-2 -mx-2"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-accent-brand animate-[pulse_2s_ease-in-out_infinite]" />
      <div className="flex flex-col gap-[3px] min-w-0">
        <span className="text-[12px] font-bold text-text-primary truncate">{chat.title}</span>
        {currentStep && (
          <span className="text-[10px] text-text-muted truncate">{currentStep}</span>
        )}
      </div>
      <div className="flex flex-col items-end shrink-0">
        <span className="text-[10px] text-text-muted tabular-nums whitespace-nowrap">
          {relativeTime(chat.lastMessageAt)}
        </span>
        <div className="mt-[3px] w-20 h-0.5 bg-bg-hover rounded-sm overflow-hidden">
          <div className="h-full bg-accent-brand rounded-sm w-3/5" />
        </div>
      </div>
    </button>
  )
}

const ShortcutHint = ({ keys, label }: { keys: string[]; label: string }) => (
  <div className="flex items-center gap-[4px] text-[10px] text-text-muted">
    {keys.map((k) => (
      <kbd key={k} className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-[3px] text-[8px] font-bold bg-bg-hover border border-border-subtle rounded text-text-secondary">
        {k}
      </kbd>
    ))}
    <span className="ml-0.5">{label}</span>
  </div>
)

export default WorkspaceHome
