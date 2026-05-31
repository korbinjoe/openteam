import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAgents } from '@/hooks/useAgents'
import AgentAvatar from '@/components/ui/agent-avatar'
import type { DagNode } from '@/lib/whiteboardLayout'
import { TYPE_VISUAL } from './TypeChip'

export interface SpanNodeData {
  node: DagNode
  isHighlighted: boolean
  isDimmed: boolean
  isSelected: boolean
  onHover: (node: DagNode, rect: DOMRect) => void
  onLeave: () => void
  onClick: (node: DagNode) => void
  [key: string]: unknown
}

const HANDLE_STYLE: React.CSSProperties = {
  opacity: 0,
  pointerEvents: 'none',
  width: 1,
  height: 1,
  border: 0,
  background: 'transparent',
}

const formatRelative = (ts: number): string => {
  const sec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  return `${Math.floor(hr / 24)}d`
}

const TYPE_ACCENT: Record<string, string> = {
  goal: 'rgb(var(--accent-brand))',
  decision: 'rgb(16 185 129)',
  artifact: 'rgb(139 92 246)',
  progress: 'rgb(var(--text-muted))',
  open_question: 'rgb(245 158 11)',
  constraint: 'rgb(244 63 94)',
  handoff: 'rgb(14 165 233)',
}

const SpanNodeInner = ({ data }: NodeProps) => {
  const { t } = useTranslation('chat')
  const { node, isHighlighted, isDimmed, isSelected, onHover, onLeave, onClick } = data as SpanNodeData
  const visual = TYPE_VISUAL[node.type]
  const Icon = visual.icon
  const { agentNames } = useAgents()
  const displayName = agentNames[node.agent] ?? node.agent

  const accentColor = TYPE_ACCENT[node.type] ?? 'rgb(var(--border))'

  const handleMouseEnter = (ev: React.MouseEvent<HTMLDivElement>) => {
    onHover(node, ev.currentTarget.getBoundingClientRect())
  }

  const relTime = useMemo(() => formatRelative(node.timestamp), [node.timestamp])

  const fileCount = node.entry.refs?.files?.length ?? 0
  const refCount = node.entry.refs?.entries?.length ?? 0
  const tags = node.entry.tags ?? []

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${t(visual.labelKey)}: ${node.entry.summary}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={onLeave}
      onClick={() => onClick(node)}
      onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onClick(node) } }}
      className={cn(
        'group relative cursor-pointer',
        'rounded-lg bg-bg-elevated border border-border-subtle',
        'transition-all duration-150 ease-out',
        'hover:shadow-md hover:border-border hover:-translate-y-px',
        isSelected && 'ring-1.5 ring-[rgb(var(--accent-brand))] border-[rgb(var(--accent-brand))] shadow-md',
        isHighlighted && !isSelected && 'border-border shadow-sm',
        isDimmed && 'opacity-20 hover:opacity-40',
      )}
      style={{ width: node.width, minHeight: node.height }}
    >
      {/* Handles */}
      <Handle type="target" position={Position.Left}  id="left-in"  style={{ ...HANDLE_STYLE, left: 0 }} />
      <Handle type="source" position={Position.Right} id="right-out" style={{ ...HANDLE_STYLE, right: 0 }} />

      <div
        className="absolute left-0 top-2 bottom-2 w-[2.5px] rounded-full"
        style={{ background: accentColor }}
      />

      <div className="pl-3.5 pr-2.5 py-2 flex flex-col gap-1.5">
        <div className="flex items-center gap-1.5">
          <span
            className="inline-flex items-center gap-1 px-1.5 py-px rounded text-[10px] font-semibold tracking-wide"
            style={{
              color: accentColor,
              background: `color-mix(in srgb, ${accentColor} 10%, transparent)`,
            }}
          >
            <Icon size={11} strokeWidth={2.5} aria-hidden="true" />
            {t(visual.labelKey)}
          </span>
          <span className="text-[9.5px] text-text-faint font-mono">#{node.entry.seq}</span>
          <span className="ml-auto text-[10px] text-text-muted font-mono shrink-0">
            {relTime}
          </span>
          {node.isLive && (
            <span className="relative flex h-2 w-2 shrink-0">
              <span className="absolute inset-0 rounded-full bg-[rgb(var(--accent-running))] motion-safe:animate-ping opacity-60" />
              <span className="relative rounded-full h-2 w-2 bg-[rgb(var(--accent-running))]" />
            </span>
          )}
        </div>

        {/* Summary */}
        <div className="text-[12px] text-text-primary leading-snug line-clamp-3 break-words">
          {node.entry.summary}
        </div>

        <div className="flex items-center gap-1.5 min-w-0">
          <AgentAvatar name={displayName} agentId={node.agent} size="xs" />
          <span className="text-[10.5px] text-text-muted truncate">{displayName}</span>
          {node.causedBySeq != null && node.causedByType && (
            <span className="text-[9px] text-text-faint ml-0.5">
              ← {TYPE_VISUAL[node.causedByType]?.labelKey ? t(TYPE_VISUAL[node.causedByType].labelKey) : node.causedByType} #{node.causedBySeq}
            </span>
          )}

          {(fileCount > 0 || refCount > 0 || tags.length > 0) && (
            <div className="ml-auto flex items-center gap-2 shrink-0">
              {fileCount > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-text-faint">
                  <FileText size={10} />
                  {fileCount}
                </span>
              )}
              {refCount > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-text-faint">
                  <Link2 size={10} />
                  {refCount}
                </span>
              )}
              {tags.length > 0 && (
                <span className="text-[9.5px] text-text-faint truncate max-w-[80px]">
                  #{tags[0]}
                </span>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export const SpanNode = memo(SpanNodeInner)
