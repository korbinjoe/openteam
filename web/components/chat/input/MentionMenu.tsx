/**
 * MentionMenu — @Files  + Agents
 *  Claude Code / Cursor  @ Agent mention
 */

import { useEffect, useRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Folder } from 'lucide-react'
import { cn } from '@/lib/utils'
import AgentAvatar from '@/components/ui/agent-avatar'
import type { AgentSummary } from '@/types/agentConfig'
import type { AgentActivity, AgentPhase } from '@/types/chat'
import type { FileSearchResult } from '@/hooks/useFileSearch'

export type MentionItem =
  | { kind: 'file'; file: FileSearchResult }
  | { kind: 'agent'; agent: AgentSummary }

interface MentionMenuProps {
  /**  InputArea  files + agents  */
  items: MentionItem[]
  activities: Record<string, AgentActivity>
  selectedIndex: number
  onSelect: (item: MentionItem) => void
  loading?: boolean
  showFilesSection?: boolean
  query?: string
}

const PHASE_COLOR: Record<AgentPhase | 'idle', string> = {
  idle: 'rgb(var(--text-muted))',
  initializing: 'rgb(var(--text-muted))',
  thinking: 'rgb(var(--accent-running))',
  tool_running: 'rgb(var(--accent-running))',
  responding: 'rgb(var(--accent-running))',
  waiting_input: 'rgb(var(--text-muted))',
  waiting_confirmation: 'rgb(var(--accent-yellow, --accent-brand))',
  completed: 'rgb(var(--accent-green))',
  error: 'rgb(var(--accent-red))',
}

const MentionMenu = ({
  items,
  activities,
  selectedIndex,
  onSelect,
  loading = false,
  showFilesSection = true,
  query = '',
}: MentionMenuProps) => {
  const { t } = useTranslation('chat')
  const listRef = useRef<HTMLDivElement>(null)

  const { firstAgentIndex, hasFiles, hasAgents } = useMemo(() => {
    const idx = items.findIndex((it) => it.kind === 'agent')
    return {
      firstAgentIndex: idx,
      hasFiles: items.some((it) => it.kind === 'file'),
      hasAgents: idx !== -1,
    }
  }, [items])

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-mention-idx="${selectedIndex}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const empty = items.length === 0 && !loading
  const isSearching = !!query && loading

  if (empty && !isSearching) return null

  const getPhase = (agent: AgentSummary): AgentPhase | 'idle' => {
    return activities[agent.id ?? agent.name]?.phase ?? 'idle'
  }

  return (
    <div
      ref={listRef}
      className="absolute bottom-full left-0 right-0 mb-1 bg-bg-elevated border border-border rounded-md shadow-lg max-h-[280px] overflow-y-auto z-50"
    >
      {showFilesSection && hasFiles && (
        <div className="px-3 py-1.5 text-xs font-semibold tracking-wide text-text-secondary border-b border-border-subtle uppercase">
          {t('mention.filesSection', 'Files')}
        </div>
      )}

      {items.map((item, i) => {
        const isSelected = i === selectedIndex
        const showAgentHeader = hasAgents && i === firstAgentIndex && hasFiles
        return (
          <div key={`${item.kind}-${item.kind === 'file' ? item.file.path : item.agent.name}`}>
            {showAgentHeader && (
              <div className="px-3 py-1.5 text-xs font-semibold tracking-wide text-text-secondary border-y border-border-subtle uppercase">
                {t('mention.agentsSection', 'Agents')}
              </div>
            )}
            <div
              data-mention-idx={i}
              onMouseDown={(e) => { e.preventDefault(); onSelect(item) }}
              className={cn(
                'flex items-center gap-2.5 px-3 py-[7px] cursor-pointer transition-colors',
                isSelected ? 'bg-accent-brand/[0.08]' : 'bg-transparent',
              )}
            >
              {item.kind === 'file' ? (
                <>
                  {item.file.type === 'directory' ? (
                    <Folder size={13} className="shrink-0 text-text-secondary" />
                  ) : (
                    <FileText size={13} className="shrink-0 text-text-secondary" />
                  )}
                  <span className={cn(
                    'text-xs font-medium truncate shrink-0 max-w-[40%]',
                    isSelected ? 'text-accent-brand' : 'text-text-primary',
                  )}>
                    {item.file.name}
                  </span>
                  <span className="text-[11px] text-text-muted truncate ml-auto text-right" title={item.file.path}>
                    {item.file.path}
                  </span>
                </>
              ) : (
                <>
                  <AgentAvatar name={item.agent.name} agentId={item.agent.id} size="xs" />
                  <span className={cn(
                    'text-xs font-medium truncate',
                    isSelected ? 'text-accent-brand' : 'text-text-primary',
                  )}>
                    {item.agent.name}
                  </span>
                  <span className="ml-auto flex items-center gap-1 shrink-0">
                    <span
                      className="inline-block w-1.5 h-1.5 rounded-full"
                      style={{ background: PHASE_COLOR[getPhase(item.agent)] || PHASE_COLOR.idle }}
                    />
                    <span className="text-xs text-text-secondary">
                      {t(`activity.phase.${getPhase(item.agent)}`, { defaultValue: getPhase(item.agent) })}
                    </span>
                  </span>
                </>
              )}
            </div>
          </div>
        )
      })}

      {isSearching && (
        <div className="px-3 py-2 text-xs text-text-muted">
          {t('mention.searching', 'Searching...')}
        </div>
      )}
      {empty && !isSearching && (
        <div className="px-3 py-2 text-xs text-text-muted">
          {t('mention.noMatches', 'No matches')}
        </div>
      )}
    </div>
  )
}

export { MentionMenu }
export default MentionMenu
