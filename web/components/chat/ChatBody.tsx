import { useMemo, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import type { Message, AgentActivity } from '../../types/chat'
import type { AgentPersonality } from '../../types/agentConfig'
import type { MessageGroup } from './messages/groupMessages'
import { UserMessage, AgentTurnCard } from './messages/MessageGroup'
import NewMessagesBadge from './indicators/NewMessagesBadge'
import { EmptyState, ThinkingIndicator } from './ChatPageWidgets'
import CompletionCeremony from './ceremonies/CompletionCeremony'

const MESSAGES_AREA_STYLE: React.CSSProperties = { flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden' }
const VIRTUOSO_STYLE: React.CSSProperties = { height: '100%' }

export interface ChatBodyProps {
  messages: Message[]
  groups: MessageGroup[]
  /** Stable key for the current view (locked agent id, filter agent id, or
   *  '__all__'). Drives Virtuoso remount + scroll reset on filter change. */
  viewKey: string | null
  currentMergedActivity: AgentActivity | null | undefined
  groupActivities: Record<string, AgentActivity>
  expertActivities: Record<string, AgentActivity>
  agentNames: Record<string, string>
  agentPersonalities: Record<string, AgentPersonality>
  thinking: boolean
  currentAgentName: string
  connected: boolean
  currentSessionId: string | null
  reconnecting: boolean
  showReconnected: boolean
  newMessageCount: number
  virtuosoRef: React.RefObject<VirtuosoHandle | null>
  onAtBottomChange: (atBottom: boolean) => void
  followOutput: () => 'auto' | false
  handleScrollToBottom: () => void
  handleAnswerQuestion: (agentId: string, answer: string) => void
  targetAgentId?: string | null
}

const ChatBody = ({
  messages, groups, viewKey, currentMergedActivity, groupActivities,
  expertActivities, agentNames, agentPersonalities,
  thinking, currentAgentName, connected, currentSessionId,
  reconnecting, showReconnected, newMessageCount,
  virtuosoRef, onAtBottomChange, followOutput,
  handleScrollToBottom, handleAnswerQuestion, targetAgentId,
}: ChatBodyProps) => {
  const { t } = useTranslation('chat')
  const totalGroups = groups.length

  const renderItem = useCallback((index: number, group: MessageGroup) => {
    const isLast = index === totalGroups - 1
    const displayActivity = isLast ? currentMergedActivity ?? groupActivities[group.id] : groupActivities[group.id]
    return (
      <div>
        {group.userMessage ? <UserMessage message={group.userMessage} /> : (
          <div style={{ padding: '8px 16px 2px', fontSize: 11, color: 'rgb(var(--text-muted))' }}>Agent Task Progress</div>
        )}
        <AgentTurnCard
          group={group}
          activity={displayActivity}
          agentName={currentAgentName}
          agentNames={agentNames}
          agentPersonalities={agentPersonalities}
          defaultExpanded={isLast}
          onAnswerQuestion={handleAnswerQuestion}
          targetAgentId={targetAgentId}
        />
      </div>
    )
  }, [totalGroups, currentMergedActivity, groupActivities, currentAgentName, agentNames, agentPersonalities, handleAnswerQuestion, targetAgentId])

  const computeKey = useCallback((_: number, group: MessageGroup) => group.id, [])

  const Header = useCallback(() => <div style={{ height: 8 }} />, [])

  const Footer = useCallback(() => (
    <div style={{ paddingBottom: 8 }}>
      {thinking && <ThinkingIndicator agentName={currentAgentName} activity={currentMergedActivity} />}
      {currentMergedActivity?.phase === 'completed' && Object.keys(expertActivities).length > 0 && (
        <CompletionCeremony expertActivities={expertActivities} agentNames={agentNames} agentPersonalities={agentPersonalities} />
      )}
    </div>
  ), [thinking, currentAgentName, currentMergedActivity, expertActivities, agentNames, agentPersonalities])

  const components = useMemo(() => ({ Header, Footer }), [Header, Footer])

  return (
    <div style={MESSAGES_AREA_STYLE}>
      {(reconnecting || showReconnected) && messages.length > 0 && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, zIndex: 15,
          padding: '4px 12px',
          background: reconnecting ? 'rgb(var(--accent-yellow, 234 179 8) / 0.12)' : 'rgb(var(--accent-green) / 0.1)',
          borderBottom: `1px solid ${reconnecting ? 'rgb(var(--accent-yellow, 234 179 8) / 0.3)' : 'rgb(var(--accent-green) / 0.3)'}`,
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 11, fontWeight: 500,
          color: reconnecting ? 'rgb(var(--accent-yellow, 234 179 8))' : 'rgb(var(--accent-green))',
          transition: 'all 0.3s ease',
          animation: showReconnected && !reconnecting ? 'fadeIn 0.3s ease' : undefined,
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
            background: reconnecting ? 'rgb(var(--accent-yellow, 234 179 8))' : 'rgb(var(--accent-green))',
            animation: reconnecting ? 'pulse 1.5s ease-in-out infinite' : undefined,
          }} />
          {reconnecting ? t('reconnection.reconnecting') : t('reconnection.reconnected')}
        </div>
      )}
      <NewMessagesBadge count={newMessageCount} onClick={handleScrollToBottom} />
      {messages.length === 0 ? (
        <EmptyState connected={connected} hasSession={!!currentSessionId} reconnecting={reconnecting} />
      ) : (
        <Virtuoso
          key={viewKey ?? '__all__'}
          ref={virtuosoRef}
          style={VIRTUOSO_STYLE}
          data={groups}
          computeItemKey={computeKey}
          itemContent={renderItem}
          followOutput={followOutput}
          atBottomStateChange={onAtBottomChange}
          atBottomThreshold={50}
          defaultItemHeight={60}
          initialTopMostItemIndex={{ index: 'LAST', align: 'end' }}
          increaseViewportBy={{ top: 600, bottom: 600 }}
          components={components}
        />
      )}
    </div>
  )
}

export default ChatBody
