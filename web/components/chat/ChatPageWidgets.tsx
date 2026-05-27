/**
 * ChatPage
 * BreadcrumbLink / TopBtn / EmptyState / ThinkingIndicator
 */

import { useTranslation } from 'react-i18next'
import AgentAvatar from '@/components/ui/agent-avatar'
import type { AgentActivity } from '@/types/chat'

export const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export const BreadcrumbLink = ({ label, children, onClick }: {
  label?: string; children?: React.ReactNode; onClick: () => void
}) => (
  <button
    onClick={onClick}
    tabIndex={0}
    aria-label={label || 'Navigate'}
    className="bg-transparent border-none cursor-pointer text-text-secondary hover:text-text-emphasis transition-colors p-0 flex items-center text-xs leading-none"
  >
    {children || label}
  </button>
)

export const TopBtn = ({ children, onClick, title, disabled }: {
  children: React.ReactNode; onClick: () => void; title: string; disabled?: boolean
}) => (
  <button
    onClick={onClick} title={title} disabled={disabled}
    style={{
      background: 'transparent', border: 'none', borderRadius: 'var(--radius-sm)',
      color: 'rgb(var(--text-muted))', cursor: disabled ? 'not-allowed' : 'pointer',
      padding: 5, display: 'flex', alignItems: 'center',
      opacity: disabled ? 0.4 : 1, transition: 'all 0.1s',
      ...noDrag,
    }}
    onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.background = 'rgb(var(--bg-hover-muted) / var(--bg-hover-muted-alpha))'; e.currentTarget.style.color = 'rgb(var(--text-primary))' } }}
    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgb(var(--text-muted))' }}
  >
    {children}
  </button>
)

export const EmptyState = ({ connected, hasSession, reconnecting = false }: { connected: boolean; hasSession: boolean; reconnecting?: boolean }) => {
  const { t } = useTranslation(['chat', 'common'])
  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 20,
      color: 'rgb(var(--text-muted))', userSelect: 'none', padding: 40,
    }}>
      {connected && hasSession ? (
        <>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 352 352" width={64} height={64}>
            <rect width="352" height="352" rx="56" fill="#5a8fca" />
            <rect x="75" y="92" width="202" height="48" rx="24" fill="white" />
            <rect x="150" y="92" width="52" height="192" rx="26" fill="white" />
          </svg>
          <div style={{
            fontSize: 22, fontWeight: 800, letterSpacing: '0.04em',
            color: 'rgb(var(--text-emphasis))',
          }}>
            OpenTeam
          </div>
          <div style={{
            fontSize: 13, color: 'rgb(var(--text-muted))',
            textAlign: 'center', lineHeight: 1.8, maxWidth: 320,
          }}>
            {t('chat:emptyStateHint')}
          </div>
          <div style={{
            fontSize: 11, color: 'rgb(var(--text-muted))',
            textAlign: 'center', lineHeight: 1.6, opacity: 0.7,
          }}>
            {t('chat:emptyStateMentionHint')}
          </div>
        </>
      ) : (
        <>
          <div style={{
            width: 40, height: 40, borderRadius: '50%',
            border: '3px solid rgb(var(--border-color))', borderTopColor: 'rgb(var(--accent-brand))',
            animation: 'spin 0.8s linear infinite',
          }} />
          <span style={{ fontSize: 13, color: 'rgb(var(--text-secondary))' }}>
            {!connected ? (reconnecting ? t('common:status.reconnecting') : t('common:status.connecting')) : t('common:status.initializing')}
          </span>
        </>
      )}
    </div>
  )
}

const FILE_OP_VERB_KEYS: Record<string, string> = { create: 'fileOp.create', edit: 'fileOp.edit', delete: 'fileOp.delete', read: 'fileOp.read' }
const PHASE_LABEL_KEYS: Record<string, string> = { initializing: 'phase.initializing', thinking: 'phase.thinking', responding: 'phase.responding', tool_running: 'phase.tool_running' }

const getActivityLabel = (activity: AgentActivity | null | undefined, t: (key: string, opts?: Record<string, unknown>) => string): string | null => {
  if (!activity) return null
  if (activity.phase === 'tool_running') {
    if (activity.fileOp) {
      const verb = FILE_OP_VERB_KEYS[activity.fileOp.operation] ? t(FILE_OP_VERB_KEYS[activity.fileOp.operation]) : activity.fileOp.operation
      const fileName = activity.fileOp.path.split('/').pop() || activity.fileOp.path
      return `${verb} ${fileName}`
    }
    if (activity.currentTool) return `${t('fileOp.executing')} ${activity.currentTool}`
  }
  return PHASE_LABEL_KEYS[activity.phase] ? t(PHASE_LABEL_KEYS[activity.phase]) : null
}

export const ThinkingIndicator = ({ agentName, agentId, activity }: { agentName?: string; agentId?: string; activity?: AgentActivity | null }) => {
  const { t } = useTranslation('chat')
  const label = getActivityLabel(activity, t)

  return (
    <div style={{ padding: '8px 16px', display: 'flex', gap: 10, alignItems: 'center' }}>
      <AgentAvatar name={agentName || 'Agent'} agentId={agentId} size="sm" active />
      <span style={{ fontSize: 12, fontWeight: 600, color: 'rgb(var(--text-emphasis))' }}>
        {agentName || 'Agent'}
      </span>
      {label ? (
        <span style={{ fontSize: 11, color: 'rgb(var(--text-secondary))', transition: 'opacity 0.2s' }}>
          {label}
        </span>
      ) : (
        <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              width: 4, height: 4, borderRadius: '50%', background: 'rgb(var(--text-muted))',
              animation: `pulse-dot 1.4s ease-in-out ${i * 0.16}s infinite`,
            }} />
          ))}
        </span>
      )}
      {label && (
        <span style={{ display: 'inline-flex', gap: 2, alignItems: 'center', marginLeft: -4 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{
              width: 3, height: 3, borderRadius: '50%', background: 'rgb(var(--text-muted))',
              animation: `pulse-dot 1.4s ease-in-out ${i * 0.16}s infinite`,
            }} />
          ))}
        </span>
      )}
    </div>
  )
}
