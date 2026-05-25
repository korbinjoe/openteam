import { useState, useMemo, useEffect, memo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Loader2,
  Wrench, CheckCircle2, ChevronDown, ChevronRight,
  AlertCircle, Clock, FileText, RotateCcw,
} from 'lucide-react'
import type { Message, AgentActivity } from '../../../types/chat'
import type { AgentPersonality } from '../../../types/agentConfig'
import { formatTokens } from '@/utils/format'

const formatElapsed = (ms: number): string => {
  if (ms < 1000) return '<1s'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const rs = s % 60
  return rs > 0 ? `${m}m ${rs}s` : `${m}m`
}

/**  ID  claude-sonnet-4-5-20250514 → Sonnet 4.5 */
const formatModelName = (model: string): string => {
  // claude-opus-4-6 → Opus 4.6, claude-sonnet-4-5-20250514 → Sonnet 4.5
  const m = model.match(/claude-(\w+)-(\d+)-(\d+)/)
  if (m) {
    const family = m[1].charAt(0).toUpperCase() + m[1].slice(1)
    return `${family} ${m[2]}.${m[3]}`
  }
  // claude-3-5-sonnet-20241022 → Sonnet 3.5
  const m2 = model.match(/claude-(\d+)-(\d+)-(\w+)/)
  if (m2) {
    const family = m2[3].charAt(0).toUpperCase() + m2[3].slice(1)
    return `${family} ${m2[1]}.${m2[2]}`
  }
  return model.replace(/-\d{8}$/, '')
}
import AgentAvatar from '@/components/ui/agent-avatar'
import TurnChangeSummary, { extractFileChanges } from './TurnChangeSummary'
import TimelineView from '../indicators/TimelineView'
import type { MessageGroup } from './groupMessages'

const INTERACTIVE_TOOL_NAMES = new Set(['AskUserQuestion', 'ExitPlanMode', 'EnterPlanMode'])

const AgentTurnCard = ({ group, activity, agentName, agentNames, agentPersonalities, defaultExpanded = false, onAnswerQuestion, targetAgentId }: { group: MessageGroup; activity?: AgentActivity | null; agentName?: string; agentNames?: Record<string, string>; agentPersonalities?: Record<string, AgentPersonality>; defaultExpanded?: boolean; onAnswerQuestion?: (agentId: string, answer: string) => void; targetAgentId?: string | null }) => {
  const { t } = useTranslation('chat')
  const getToolLabel = (name: string) => t(`tools.${name}`, { defaultValue: name })

  const { isCompletedPhase, hasUnresolvedToolUse } = useMemo(() => {
    const hasStats = group.agentMessages.some((m) => m.type === 'stats') && !group.isStreaming
    const resultIds = new Set(
      group.agentMessages
        .filter((m) => m.type === 'toolResult' && m.toolResult)
        .map((m) => m.toolResult!.toolUseId),
    )
    const hasUnresolved = group.agentMessages.some(
      (m) => m.type === 'toolUse' && m.toolUse && !resultIds.has(m.toolUse.toolId),
    )
    let completed = false
    if (activity && activity.phase !== 'initializing') {
      if (activity.phase === 'completed' || activity.phase === 'waiting_input') {
        completed = true
      } else if (hasStats && !hasUnresolved) {
        completed = true
      }
    } else {
      completed = hasStats
    }
    return { isCompletedPhase: completed, hasUnresolvedToolUse: hasUnresolved }
  }, [activity, group.agentMessages, group.isStreaming])

  const hasPendingQuestion = useMemo(() => {
    const toolResultIds = new Set(
      group.agentMessages
        .filter((m) => m.type === 'toolResult' && m.toolResult)
        .map((m) => m.toolResult!.toolUseId),
    )
    return group.agentMessages.some(
      (m) => m.type === 'toolUse' && m.toolUse
        && INTERACTIVE_TOOL_NAMES.has(m.toolUse.toolName)
        && !toolResultIds.has(m.toolUse.toolId),
    )
  }, [group.agentMessages])

  const [userToggled, setUserToggled] = useState(false)
  const [expanded, setExpanded] = useState(defaultExpanded || !isCompletedPhase)
  const [expandedByQuestion, setExpandedByQuestion] = useState(false)

  useEffect(() => {
    if (hasPendingQuestion) {
      setExpanded(true)
      setExpandedByQuestion(true)
    } else if (expandedByQuestion) {
      setExpandedByQuestion(false)
      if (isCompletedPhase && !defaultExpanded) {
        setExpanded(false)
      }
    } else if (isCompletedPhase && !defaultExpanded && !userToggled) {
      setExpanded(false)
    }
  }, [isCompletedPhase, hasPendingQuestion, defaultExpanded, userToggled, expandedByQuestion])

  const resolvedAgentName = useMemo(() => {
    const firstAgentMsg = group.agentMessages.find((m) => m.agentId)
    if (firstAgentMsg?.agentId) {
      const personality = agentPersonalities?.[firstAgentMsg.agentId]
      if (personality?.nickname) return personality.nickname
      return agentNames?.[firstAgentMsg.agentId] || firstAgentMsg.agentId
    }
    const mentionId = group.userMessage?.mentions?.[0]?.id
    if (mentionId) {
      const personality = agentPersonalities?.[mentionId]
      if (personality?.nickname) return personality.nickname
      return agentNames?.[mentionId] || mentionId
    }
    return agentName || 'Agent'
  }, [group.agentMessages, group.userMessage?.mentions, agentName, agentNames, agentPersonalities])

  const useActivity = !!activity && activity.phase !== 'initializing'

  const statsMessage = useMemo(() => {
    for (const msg of group.agentMessages) {
      if (msg.type === 'stats' && msg.stats) return msg
    }
    return null
  }, [group.agentMessages])

  const turnModel = useMemo(() => {
    if (activity?.modelUsage?.length) {
      return activity.modelUsage.map((u) => formatModelName(u.model)).join(' + ')
    }
    for (const msg of group.agentMessages) {
      if (msg.model) return formatModelName(msg.model)
    }
    return null
  }, [activity?.modelUsage, group.agentMessages])

  const isStaleActivity = useActivity &&
    !['completed', 'waiting_input', 'waiting_confirmation', 'error'].includes(activity!.phase) &&
    !!statsMessage && !group.isStreaming && !hasUnresolvedToolUse

  const phase = (useActivity && !isStaleActivity) ? activity!.phase : (
    statsMessage ? 'waiting_input' :
    group.agentMessages.length === 0 ? 'initializing' :
    group.isStreaming ? 'thinking' : 'waiting_input'
  )

  const toolCount = useActivity ? activity.toolCount : 0
  const toolCompleted = useActivity ? activity.toolCompleted : 0
  const currentTool = useActivity ? activity.currentTool : undefined
  const isError = phase === 'error'
  const isCompleted = phase === 'completed' || phase === 'waiting_input'
  const tokens = useActivity
    ? activity.tokens
    : (statsMessage?.stats ? { input: statsMessage.stats.inputTokens ?? 0, output: statsMessage.stats.outputTokens ?? 0, cacheRead: statsMessage.stats.cacheReadInputTokens ?? 0, cacheCreation: statsMessage.stats.cacheCreationInputTokens ?? 0 } : undefined)

  const hasDetails = group.agentMessages.some((m) =>
    m.type === 'text' || m.type === 'toolUse' || m.type === 'toolResult' || m.type === 'thinking' || m.type === 'stats'
  )

  const startTs = useMemo(() => group.agentMessages[0]?.timestamp ?? 0, [group.agentMessages])
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    if (isCompleted && statsMessage?.stats?.durationMs) {
      setElapsed(statsMessage.stats.durationMs)
      return
    }
    if (!startTs || isCompleted) return
    const tick = () => setElapsed(Date.now() - startTs)
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [startTs, isCompleted, statsMessage])

  const summaryData = useMemo(() => {
    let finalText = ''
    for (let i = group.agentMessages.length - 1; i >= 0; i--) {
      const msg = group.agentMessages[i]
      if (msg.type === 'text' && msg.content) {
        finalText = msg.content.split('\n').filter((l) => l.trim()).slice(0, 2).join(' ').slice(0, 120)
        if (msg.content.length > 120) finalText += '...'
        break
      }
    }
    const fileChanges = extractFileChanges(group.agentMessages)
    const errorMessages = group.agentMessages.filter((m) =>
      (m.type === 'toolResult' && m.toolResult?.isError) || m.type === 'error'
    )
    const hasError = errorMessages.length > 0
    const errorCount = errorMessages.length
    const firstErrorLine = errorMessages[0]?.toolResult?.content?.split('\n')[0]?.slice(0, 80) || errorMessages[0]?.content?.split('\n')[0]?.slice(0, 80) || ''
    return { finalText, fileChanges, hasError, errorCount, firstErrorLine }
  }, [group.agentMessages])

  // Tool errors during a successful turn are recovered retries (e.g. file-not-found → retry with correct path).
  // Render as success with an amber retry chip — only `phase === 'error'` is a real task failure.
  const hasRecoveredErrors = isCompleted && !isError && summaryData.hasError

  if (phase === 'initializing' && group.agentMessages.length === 0) return null

  const statusText = (() => {
    switch (phase) {
      case 'error': return t('message.executionError')
      case 'completed': return t('message.completed')
      case 'waiting_input': return t('message.completed')
      case 'waiting_confirmation': return t('message.waitingConfirmation', )
      case 'tool_running': return currentTool ? getToolLabel(currentTool) + '...' : t('message.toolRunning')
      case 'responding': return t('message.responding')
      case 'thinking': return t('message.thinking')
      case 'initializing': return t('message.initializing', )
      default: return t('message.processing')
    }
  })()

  const Chevron = expanded ? ChevronDown : ChevronRight

  const handleToggle = () => {
    if (hasDetails) {
      setUserToggled(true)
      setExpanded((prev) => !prev)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.key === 'Enter' || e.key === ' ') && hasDetails) {
      e.preventDefault()
      setUserToggled(true)
      setExpanded((prev) => !prev)
    }
  }

  return (
    <div className="group" style={{ animation: 'fadeIn 0.2s ease', marginTop: 2 }}>
      <div
        role={hasDetails ? 'button' : undefined}
        tabIndex={hasDetails ? 0 : undefined}
        aria-label={hasDetails ? t('message.expandDetail', { name: resolvedAgentName }) : undefined}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 16px',
          cursor: hasDetails ? 'pointer' : 'default',
          borderLeft: `2px solid ${isError ? 'rgb(var(--accent-red))' : isCompleted ? 'rgb(var(--accent-green))' : 'rgb(var(--accent-purple))'}`,
          marginLeft: 16,
          transition: 'background 0.1s',
          overflow: 'hidden',
          minWidth: 0,
        }}
        onMouseEnter={(e) => { if (hasDetails) e.currentTarget.style.background = 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))' }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
      >
        {hasDetails && (
          <Chevron size={12} style={{ color: 'rgb(var(--text-muted))', flexShrink: 0, opacity: 0.6 }} />
        )}

        {isError ? (
          <AlertCircle size={13} style={{ color: 'rgb(var(--accent-red))', flexShrink: 0 }} />
        ) : isCompleted ? (
          <CheckCircle2 size={13} style={{ color: 'rgb(var(--accent-green))', flexShrink: 0 }} />
        ) : (
          <Loader2 size={13} style={{ color: 'rgb(var(--accent-purple))', animation: 'spin 1s linear infinite', flexShrink: 0 }} />
        )}

        <span style={{
          fontSize: 12,
          fontWeight: 600,
          color: 'rgb(var(--text-emphasis))',
          flexShrink: 0,
        }}>
          {resolvedAgentName}
        </span>

        {turnModel && (
          <span style={{
            fontSize: 10,
            padding: '0 5px',
            borderRadius: 3,
            background: 'rgb(var(--bg-hover-muted) / var(--bg-hover-muted-alpha))',
            color: 'rgb(var(--text-muted))',
            fontFamily: 'monospace',
            flexShrink: 0,
          }}>
            {turnModel}
          </span>
        )}

        {(!isCompleted || isError) && (
          <span style={{
            fontSize: 11,
            color: isError ? 'rgb(var(--accent-red))' : 'rgb(var(--text-secondary))',
            fontWeight: isError ? 500 : 400,
            flexShrink: 0,
          }}>
            {isError
              ? (summaryData.errorCount > 1 ? `${summaryData.errorCount} errors` : t('message.executionError'))
              : statusText}
          </span>
        )}

        {hasRecoveredErrors && (
          <span
            title={summaryData.firstErrorLine
              ? `Tool errors recovered during this turn:\n${summaryData.firstErrorLine}`
              : 'Tool errors recovered during this turn'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10,
              padding: '0 5px',
              borderRadius: 3,
              background: 'rgb(var(--accent-orange) / 0.12)',
              color: 'rgb(var(--accent-orange))',
              fontFamily: 'monospace',
              flexShrink: 0,
            }}
          >
            <RotateCcw size={9} style={{ opacity: 0.85 }} />
            {summaryData.errorCount} {summaryData.errorCount > 1 ? 'retries' : 'retry'}
          </span>
        )}

        {toolCount > 0 && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontSize: 10,
            color: 'rgb(var(--text-muted))',
            fontFamily: 'monospace',
            flexShrink: 1,
            overflow: 'hidden',
          }}>
            <Wrench size={10} style={{ opacity: 0.6, flexShrink: 0 }} />
            <span style={{ whiteSpace: 'nowrap' }}>{isCompleted ? toolCount : `${toolCompleted}/${toolCount}`}</span>
          </span>
        )}

        {/* tokens + elapsed in header only while running — completed-state moves to hover footer */}
        {elapsed > 0 && !isCompleted && (
          <span style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            fontSize: 11,
            color: 'rgb(var(--accent-purple))',
            fontFamily: 'monospace',
            fontWeight: 600,
            flexShrink: 1,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}>
            <Clock size={10} style={{ opacity: 0.8, flexShrink: 0 }} />
            {formatElapsed(elapsed)}
          </span>
        )}
      </div>

      {!expanded && hasPendingQuestion && (
        <div
          style={{ padding: '6px 16px 6px 36px', cursor: 'pointer' }}
          onClick={() => setExpanded(true)}
        >
          <span style={{ fontSize: 11, color: 'rgb(var(--accent-brand))', fontWeight: 500 }}>
            {t('message.waitingConfirmation', )} — {t('message.clickToExpand', )}
          </span>
        </div>
      )}

      {!expanded && isCompleted && !hasPendingQuestion && (summaryData.finalText || summaryData.fileChanges.length > 0 || (isError && summaryData.firstErrorLine)) && (
        <div
          style={{ padding: '2px 16px 6px 36px', cursor: 'pointer' }}
          onClick={handleToggle}
        >
          {isError && summaryData.firstErrorLine && (
            <div style={{
              fontSize: 11,
              color: 'rgb(var(--accent-red))',
              opacity: 0.75,
              fontFamily: "'SF Mono', 'Fira Code', monospace",
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              marginBottom: 3,
            }}>
              {summaryData.firstErrorLine}
            </div>
          )}
          {summaryData.fileChanges.length > 0 && (
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              marginBottom: summaryData.finalText ? 6 : 0,
            }}>
              {summaryData.fileChanges.slice(0, 6).map((change) => {
                const isCreated = change.operation === 'created'
                return (
                  <span
                    key={change.path}
                    title={change.path}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 11,
                      color: 'rgb(var(--text-secondary))',
                      fontFamily: "'SF Mono', 'Fira Code', monospace",
                      padding: '1px 6px 1px 5px',
                      borderRadius: 4,
                      background: 'rgb(var(--bg-hover-subtle) / var(--bg-hover-subtle-alpha))',
                      border: '1px solid rgb(var(--border-subtle))',
                    }}
                  >
                    <FileText size={10} style={{ opacity: 0.55, flexShrink: 0 }} />
                    {change.fileName}
                    <span style={{
                      fontSize: 9,
                      fontWeight: 600,
                      letterSpacing: 0.3,
                      color: isCreated ? 'rgb(var(--accent-green))' : 'rgb(var(--accent-brand-light))',
                      opacity: 0.8,
                    }}>
                      {isCreated ? 'A' : 'M'}
                    </span>
                  </span>
                )
              })}
              {summaryData.fileChanges.length > 6 && (
                <span style={{
                  fontSize: 10,
                  color: 'rgb(var(--text-muted))',
                  alignSelf: 'center',
                }}>
                  +{summaryData.fileChanges.length - 6} more
                </span>
              )}
            </div>
          )}
          {summaryData.finalText && (
            <div style={{
              fontSize: 12,
              color: 'rgb(var(--text-secondary))',
              lineHeight: 1.5,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
            }}>
              {summaryData.finalText}
            </div>
          )}
          {(elapsed > 0 || toolCount > 0 || (tokens && tokens.output > 0) || turnModel) && (
            <div
              className="opacity-0 group-hover:opacity-50 transition-opacity duration-150"
              style={{
                display: 'flex', alignItems: 'center', gap: 10, marginTop: 6,
                fontSize: 10, color: 'rgb(var(--text-muted))', fontFamily: "'SF Mono', 'Fira Code', monospace",
              }}
            >
              {turnModel && <span>{turnModel}</span>}
              {elapsed > 0 && <span>{formatElapsed(elapsed)}</span>}
              {toolCount > 0 && <span>{toolCount} tools</span>}
              {tokens && tokens.output > 0 && (
                <span
                  title={`input: ${tokens.input.toLocaleString()} / output: ${tokens.output.toLocaleString()}${tokens.cacheRead ? ` / cache read: ${tokens.cacheRead.toLocaleString()}` : ''}${tokens.cacheCreation ? ` / cache creation: ${tokens.cacheCreation.toLocaleString()}` : ''}`}
                >
                  {formatTokens(tokens.output)} out
                </span>
              )}
              {activity?.cost != null && activity.cost > 0 && <span>${activity.cost.toFixed(4)}</span>}
            </div>
          )}
        </div>
      )}

      {expanded && hasDetails && (
        <ExpandedDetails messages={group.agentMessages} fallbackAgentName={agentName} agentNames={agentNames} onAnswerQuestion={onAnswerQuestion} fallbackAgentId={targetAgentId} isCompleted={isCompleted} />
      )}

      {expanded && isCompleted && (
        <TurnChangeSummary fileChanges={summaryData.fileChanges} />
      )}
    </div>
  )
}

const AGENT_BORDER_COLORS = [
  'rgb(var(--accent-brand))',
  'rgb(var(--accent-green))',
  'rgb(var(--accent-purple))',
  'rgb(var(--accent-yellow, 234 179 8))',
  'rgb(var(--accent-red))',
]

const getAgentColor = (name: string): string => {
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
  }
  return AGENT_BORDER_COLORS[Math.abs(hash) % AGENT_BORDER_COLORS.length]
}

interface AgentSegment {
  agentId: string | undefined
  messages: Message[]
}

const segmentByAgent = (messages: Message[]): AgentSegment[] => {
  const segments: AgentSegment[] = []
  for (const msg of messages) {
    const lastSeg = segments[segments.length - 1]
    if (lastSeg && lastSeg.agentId === msg.agentId) {
      lastSeg.messages.push(msg)
    } else {
      segments.push({ agentId: msg.agentId, messages: [msg] })
    }
  }
  return segments
}

const ExpandedDetails = ({ messages, fallbackAgentName, agentNames, onAnswerQuestion, fallbackAgentId, isCompleted, showAll }: {
  messages: Message[]
  fallbackAgentName?: string
  agentNames?: Record<string, string>
  onAnswerQuestion?: (agentId: string, answer: string) => void
  isCompleted?: boolean
  showAll?: boolean
  fallbackAgentId?: string | null
}) => {
  const hasMultipleAgents = new Set(messages.map((m) => m.agentId ?? '__default__')).size > 1

  const resolvedAgentId = messages.find((m) => m.agentId)?.agentId || fallbackAgentId || undefined

  if (!hasMultipleAgents) {
    const boundHandler = onAnswerQuestion
      ? (answer: string) => {
          const agentId = resolvedAgentId || messages.find((m) => m.agentId)?.agentId || fallbackAgentId || ''
          if (agentId) onAnswerQuestion(agentId, answer)
        }
      : undefined
    return (
      <div style={{
        margin: '0 16px 8px',
        padding: '4px 0',
        borderLeft: '2px solid rgb(var(--border-subtle))',
        paddingLeft: 12,
      }}>
        <TimelineView messages={messages} onAnswerQuestion={boundHandler} isCompleted={isCompleted} showAll={showAll} />
      </div>
    )
  }

  const segments = segmentByAgent(messages)

  return (
    <div style={{ margin: '0 16px 8px' }}>
      {segments.map((seg, i) => {
        const name = (seg.agentId && agentNames?.[seg.agentId]) || seg.agentId || fallbackAgentName || 'Agent'
        const color = seg.agentId ? getAgentColor(seg.agentId) : 'rgb(var(--border-subtle))'
        const effectiveSegAgentId = seg.agentId || fallbackAgentId || undefined
        const segHandler = onAnswerQuestion
          ? (answer: string) => {
              const agentId = effectiveSegAgentId || seg.messages.find((m) => m.agentId)?.agentId || ''
              if (agentId) onAnswerQuestion(agentId, answer)
            }
          : undefined

        return (
          <div key={`${seg.agentId ?? 'lead'}-${i}`} style={{
            padding: '6px 0 6px 16px',
            borderLeft: `2px solid ${color}`,
            marginBottom: 4,
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 4,
            }}>
              <AgentAvatar name={name} agentId={name} size="xs" />
              <span style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'rgb(var(--text-emphasis))',
              }}>
                {name}
              </span>
              {seg.agentId && (
                <span style={{
                  fontSize: 9,
                  padding: '0 4px',
                  borderRadius: 3,
                  background: 'rgb(var(--bg-hover-muted) / var(--bg-hover-muted-alpha))',
                  color: 'rgb(var(--text-muted))',
                }}>
                  Expert
                </span>
              )}
            </div>
            <TimelineView messages={seg.messages} onAnswerQuestion={segHandler} isCompleted={isCompleted} showAll={showAll} />
          </div>
        )
      })}
    </div>
  )
}

type AgentTurnCardProps = Parameters<typeof AgentTurnCard>[0]

const arePropsEqual = (prev: AgentTurnCardProps, next: AgentTurnCardProps): boolean => {
  if (prev.group.id !== next.group.id) return false
  if (prev.group.agentMessages.length !== next.group.agentMessages.length) return false
  if (prev.group.isStreaming !== next.group.isStreaming) return false
  const pLast = prev.group.agentMessages.at(-1)
  const nLast = next.group.agentMessages.at(-1)
  if (pLast?.id !== nLast?.id || pLast?.content !== nLast?.content) return false
  if (prev.activity?.phase !== next.activity?.phase) return false
  if (prev.activity?.toolCount !== next.activity?.toolCount) return false
  if (prev.activity?.toolCompleted !== next.activity?.toolCompleted) return false
  if (prev.activity?.currentTool !== next.activity?.currentTool) return false
  if (prev.activity?.cost !== next.activity?.cost) return false
  if (prev.activity?.tokens?.input !== next.activity?.tokens?.input) return false
  if (prev.activity?.tokens?.output !== next.activity?.tokens?.output) return false
  if (prev.defaultExpanded !== next.defaultExpanded) return false
  if (prev.agentNames !== next.agentNames) return false
  if (prev.agentPersonalities !== next.agentPersonalities) return false
  if (prev.onAnswerQuestion !== next.onAnswerQuestion) return false
  if (prev.targetAgentId !== next.targetAgentId) return false
  return true
}

export default memo(AgentTurnCard, arePropsEqual)
