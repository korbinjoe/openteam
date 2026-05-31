/**
 * ExpertProgressView — Collapsible progress view for expert agent work.
 * Groups consecutive wait_for_expert tool calls into a single timeline block.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronRight, Clock } from 'lucide-react'
import type { ExpertProgressGroup, TimelineEntry } from './timelineHelpers'

const isWaitEntry = (entry: TimelineEntry): boolean =>
  entry.type === 'tool' && !!entry.toolName && (
    entry.toolName.includes('wait_for_expert')
  )

const ExpertProgressBlock = ({ group }: { group: ExpertProgressGroup }) => {
  const { t } = useTranslation('chat')
  const [expanded, setExpanded] = useState(false)
  const Chevron = expanded ? ChevronDown : ChevronRight

  const waitCount = group.entries.filter(isWaitEntry).length
  const displayName = group.agentId || 'Expert'

  const statusLines = group.latestStatus.split('\n').filter((l) => l.trim())
  const phaseInfo = statusLines.find((l) => l.includes('Phase:'))?.replace(/^\s*Phase:\s*/, '') || ''
  const progressInfo = statusLines.find((l) => l.includes('Tool Progress:'))?.replace(/^\s*Tool Progress:\s*/, '') || ''
  const tokenInfo = statusLines.find((l) => l.includes('Token:'))?.replace(/^\s*Token:\s*/, '') || ''
  const elapsedInfo = statusLines.find((l) => l.includes('Run:'))?.replace(/^\s*Run:\s*/, '') || ''

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setExpanded((p) => !p)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded((p) => !p) } }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '3px 4px',
          borderRadius: 4,
          cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        <Chevron size={9} style={{ color: 'rgb(var(--text-muted))', flexShrink: 0, opacity: 0.5 }} />
        {group.completed ? (
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'rgb(var(--accent-green))', flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
            <span style={{ color: '#fff', fontSize: 7, fontWeight: 700 }}>&#10003;</span>
          </span>
        ) : (
          <Clock size={10} style={{ color: 'rgb(var(--accent-purple))', animation: 'spin 2s linear infinite', flexShrink: 0 }} />
        )}
        <span style={{ fontSize: 11, fontWeight: 500, color: 'rgb(var(--text-secondary))', flexShrink: 0 }}>
          {group.completed ? t('expertProgress.completed', { name: displayName }) : t('expertProgress.waiting', { name: displayName })}
        </span>
        {phaseInfo && !group.completed && (
          <span style={{
            fontSize: 10, color: 'rgb(var(--text-muted))', opacity: 0.8,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0,
          }}>
            {phaseInfo}
          </span>
        )}
        {progressInfo && (
          <span style={{ fontSize: 10, color: 'rgb(var(--text-muted))', fontFamily: 'monospace', flexShrink: 0 }}>
            {progressInfo}
          </span>
        )}
        {tokenInfo && (
          <span style={{ fontSize: 10, color: 'rgb(var(--text-muted))', fontFamily: 'monospace', opacity: 0.6, flexShrink: 0 }}>
            {tokenInfo}
          </span>
        )}
        {elapsedInfo && (
          <span style={{ fontSize: 10, color: 'rgb(var(--text-muted))', fontFamily: 'monospace', opacity: 0.6, flexShrink: 0 }}>
            {elapsedInfo}
          </span>
        )}
        <span style={{
          fontSize: 10, padding: '0 4px', borderRadius: 3,
          background: 'rgb(var(--bg-hover-muted) / var(--bg-hover-muted-alpha))',
          color: 'rgb(var(--text-muted))', fontFamily: 'monospace', fontWeight: 500, flexShrink: 0,
        }}>
          x{waitCount}
        </span>
      </div>

      {expanded && group.logLines.length > 0 && (
        <div style={{
          margin: '2px 0 4px 28px',
          padding: '6px 8px',
          borderRadius: 4,
          background: 'rgb(var(--bg-elevated))',
          border: '1px solid rgb(var(--border-subtle))',
          fontSize: 10,
          fontFamily: "'SF Mono', monospace",
          color: 'rgb(var(--text-secondary))',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          maxHeight: 300,
          overflowY: 'auto',
          lineHeight: 1.5,
        }}>
          {group.logLines.join('\n')}
        </div>
      )}

      {expanded && group.logLines.length === 0 && group.latestStatus && (
        <div style={{
          margin: '2px 0 4px 28px',
          padding: '4px 8px',
          fontSize: 10,
          color: 'rgb(var(--text-muted))',
          fontStyle: 'italic',
        }}>
          {group.latestStatus}
        </div>
      )}
    </div>
  )
}

export default ExpertProgressBlock
