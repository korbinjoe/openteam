/**
 * CompletionCeremony -
 *  Agent
 */

import { useTranslation } from 'react-i18next'
import { CheckCircle2, Wrench, FileText, FilePlus, FileEdit, Clipboard, GitPullRequest } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import AgentAvatar from '@/components/ui/agent-avatar'
import type { AgentActivity } from '@/types/chat'
import type { AgentPersonality } from '@/types/agentConfig'
import { formatTokens } from '@/utils/format'

interface AgentContribution {
  agentId: string
  displayName: string
  personality?: AgentPersonality
  activity: AgentActivity
  summary: string
}

const buildContributionSummary = (
  personality: AgentPersonality | undefined,
  activity: AgentActivity,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string => {
  const tools = activity.toolCompleted || 0
  const isDetailed = personality?.verbosity === 'detailed'

  if (!personality) {
    if (tools === 0) return t('completion.missionDone')
    return t('completion.toolCallsDone', { count: tools })
  }

  const { tone, persona } = personality

  if (tools === 0) {
    return isDetailed ? t('completion.reviewOk') : t('completion.done')
  }

  if (persona?.includes('fullstack') || persona?.includes('engineer')) {
    return isDetailed
      ? t('completion.engineerDetailed', { count: tools })
      : t('completion.engineerBrief', { count: tools })
  }
  if (persona?.includes('Review') || persona?.includes('security')) {
    return isDetailed
      ? t('completion.reviewDetailed', { count: tools })
      : t('completion.reviewBrief', { count: tools })
  }
  if (persona?.includes('design') || persona?.includes('UI')) {
    return isDetailed
      ? t('completion.designDetailed', { count: tools })
      : t('completion.designBrief', { count: tools })
  }

  return tone === 'casual'
    ? t('completion.casualDefault', { count: tools })
    : t('completion.formalDefault', { count: tools })
}

interface FileChange {
  path: string
  operation: 'create' | 'edit' | 'delete' | 'read'
}

interface CompletionCeremonyProps {
  expertActivities: Record<string, AgentActivity>
  agentNames?: Record<string, string>
  agentPersonalities?: Record<string, AgentPersonality>
  /** @deprecated  */
  onClose?: () => void
  className?: string
}

const CompletionCeremony = ({
  expertActivities,
  agentNames,
  agentPersonalities,
  className,
}: CompletionCeremonyProps) => {
  const { t } = useTranslation('chat')

  const contributions: AgentContribution[] = []

  for (const [agentId, activity] of Object.entries(expertActivities)) {
    const personality = agentPersonalities?.[agentId]
    const displayName = personality?.nickname || agentNames?.[agentId] || agentId
    contributions.push({
      agentId,
      displayName,
      personality,
      activity,
      summary: buildContributionSummary(personality, activity, t),
    })
  }

  const totalTools = contributions.reduce((sum, c) => sum + c.activity.toolCompleted, 0)
  const totalInputTokens = contributions.reduce((sum, c) => sum + (c.activity.tokens?.input || 0), 0)
  const totalOutputTokens = contributions.reduce((sum, c) => sum + (c.activity.tokens?.output || 0), 0)
  const totalCacheRead = contributions.reduce((sum, c) => sum + (c.activity.tokens?.cacheRead || 0), 0)
  const totalCacheCreation = contributions.reduce((sum, c) => sum + (c.activity.tokens?.cacheCreation || 0), 0)
  const totalCost = contributions.reduce((sum, c) => sum + (c.activity.cost || 0), 0)

  const fileChanges: FileChange[] = []
  const seenPaths = new Set<string>()
  for (const [, activity] of Object.entries(expertActivities)) {
    if (activity.fileOp && !seenPaths.has(activity.fileOp.path)) {
      seenPaths.add(activity.fileOp.path)
      fileChanges.push({ path: activity.fileOp.path, operation: activity.fileOp.operation as FileChange['operation'] })
    }
  }

  const handleCopySummary = () => {
    const lines = [
      t('completion.title'),
      ...contributions.map((c) => `${c.displayName}: ${c.summary}`),
      fileChanges.length > 0 ? `\nFiles: ${fileChanges.map((f) => f.path.split('/').pop()).join(', ')}` : '',
      `\nTools: ${totalTools} | Cost: $${totalCost.toFixed(4)}`,
    ]
    navigator.clipboard.writeText(lines.filter(Boolean).join('\n'))
    toast.success(t('completion.copied', { defaultValue: 'Summary copied' }))
  }

  const FILE_OP_ICON: Record<string, typeof FileText> = {
    create: FilePlus,
    edit: FileEdit,
    delete: FileText,
    read: FileText,
  }

  return (
    <div className={cn(
      'mx-4 mb-3 rounded-lg border border-accent-green/15 overflow-hidden',
      'bg-bg-primary shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300',
      className,
    )}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle/40 bg-accent-green/[0.03]">
        <CheckCircle2 size={14} className="text-accent-green" />
        <span className="text-xs font-semibold text-text-emphasis">
          {t('completion.title')}
        </span>
      </div>

      {/* Agent contributions */}
      <div className="px-3 py-1.5 space-y-0.5">
        {contributions.map((c) => (
          <div key={c.agentId} className="flex items-center gap-2 py-1">
            <AgentAvatar name={c.displayName} agentId={c.agentId} size="xs" animationState="completed" />
            <span className="text-xs font-medium text-text-primary truncate max-w-[80px]">
              {c.displayName}
            </span>
            <span className="text-xs text-text-secondary truncate">
              {c.summary}
            </span>
            <span className="flex-1" />
            {c.activity.toolCompleted > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-text-muted font-mono shrink-0">
                <Wrench size={9} className="opacity-50" />
                {c.activity.toolCompleted}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* File changes */}
      {fileChanges.length > 0 && (
        <div className="px-3 py-2 border-t border-border-subtle/40">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-text-muted mb-1.5">
            {t('completion.changes', { defaultValue: 'Changes' })}
          </div>
          <div className="flex flex-col gap-0.5">
            {fileChanges.map((f) => {
              const Icon = FILE_OP_ICON[f.operation] || FileText
              const isNew = f.operation === 'create'
              return (
                <div key={f.path} className="flex items-center gap-2 py-0.5 text-xs font-mono">
                  <Icon size={11} className={isNew ? 'text-accent-green' : 'text-accent-yellow'} />
                  <span className="text-text-primary truncate">{f.path.split('/').slice(-2).join('/')}</span>
                  <span className={cn('text-[10px] ml-auto shrink-0', isNew ? 'text-accent-green' : 'text-accent-yellow')}>
                    {f.operation}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="flex items-center gap-4 px-4 py-2 border-t border-border-subtle/40 text-xs text-text-secondary font-mono">
        {totalTools > 0 && (
          <span className="inline-flex items-center gap-1">
            <Wrench size={9} className="opacity-50" />
            {totalTools} {t('completion.toolCalls')}
          </span>
        )}
        {(totalInputTokens > 0 || totalOutputTokens > 0) && (
          <span className="inline-flex items-center gap-1">
            {formatTokens(totalInputTokens)} in / {formatTokens(totalOutputTokens)} out
            {totalCacheRead > 0 && (
              <span className="opacity-60">/ {formatTokens(totalCacheRead)} cache↓</span>
            )}
            {totalCacheCreation > 0 && (
              <span className="opacity-60">/ {formatTokens(totalCacheCreation)} cache↑</span>
            )}
          </span>
        )}
        {totalCost > 0 && (
          <span>${totalCost.toFixed(4)}</span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-2 px-3 py-2 border-t border-border-subtle/40">
        {fileChanges.length > 0 && (
          <button
            type="button"
            onClick={handleCopySummary}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-brand text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer border-none"
          >
            <CheckCircle2 size={11} />
            {t('completion.reviewChanges', { defaultValue: 'Review Changes' })}
          </button>
        )}
        <button
          type="button"
          onClick={handleCopySummary}
          className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-border text-xs text-text-secondary hover:text-text-primary hover:bg-bg-hover-muted transition-colors cursor-pointer bg-transparent"
        >
          <Clipboard size={11} />
          {t('completion.copySummary', { defaultValue: 'Copy Summary' })}
        </button>
        <span className="flex-1" />
        {fileChanges.length > 0 && (
          <button
            type="button"
            onClick={handleCopySummary}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md border border-border text-xs text-text-muted hover:text-text-secondary hover:bg-bg-hover-muted transition-colors cursor-pointer bg-transparent"
          >
            {t('completion.createPR', { defaultValue: 'Create PR' })}
            <GitPullRequest size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

export default CompletionCeremony
