/**
 * ChatInstance —  Chat  UI
 *
 *  ChatPage  chatId / workspaceId  props useParams
 *  ChatTabContainer  display:none
 */

import { useState, useRef, useEffect, useCallback, useMemo, lazy, Suspense } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { AgentActivity } from '../../types/chat'
import { groupMessages } from './messages/MessageGroup'
import ChatHeader from './ChatHeader'
import ChatBody from './ChatBody'
import MessageToolbar from './messages/MessageToolbar'
import InputArea, { type InputAreaHandle } from './input/InputArea'
import QueuedMessagesBar from './input/QueuedMessagesBar'
import AgentSwitcherModal from './modals/AgentSwitcherModal'
import GitStatusBar from './indicators/GitStatusBar'
import WorktreePanel from '../worktree/WorktreePanel'
import GlobalHeartbeatBar from './indicators/GlobalHeartbeatBar'
import PermissionModal from './modals/PermissionModal'
import PlanCard from './messages/PlanCard'
import useMultiRepoGitStatus from '../../hooks/useMultiRepoGitStatus'
import { useChatScroll } from '../../hooks/useChatScroll'
import { useExpertActivities } from '../../hooks/useExpertActivities'
import { useAgents } from '../../hooks/useAgents'
import { useChatWebSocket } from '../../hooks/useChatWebSocket'
import { useChatActions } from '../../hooks/useChatActions'
import { useChatTabs } from '../../contexts/ChatTabContext'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import DirPickerDialog from '../home/DirPickerDialog'
import { useDirPicker } from '../../hooks/useDirPicker'
import { API_BASE, authFetch } from '@/config/api'
import { getModelsForProvider } from '@/lib/models'

const ROOT_STYLE: React.CSSProperties = { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }
const MAIN_CONTENT_STYLE: React.CSSProperties = { flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }
const LOADING_STYLE: React.CSSProperties = { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgb(var(--text-muted))' }
const DIVIDER_BAR_STYLE: React.CSSProperties = { width: 4, flexShrink: 0, position: 'relative', zIndex: 20 }
const RightPanel = lazy(() => import('../ide/RightPanel'))

/**
 * Claude Code  slash commands  — CLI  fallback
 * CLI  system.init  slash_commands
 * CLI  commands.filter(c => c.userInvocable !== false).map(c => c.name)
 */
const DEFAULT_SLASH_COMMANDS = [
  'add-dir', 'agents', 'btw', 'branch', 'chrome', 'clear', 'color',
  'compact', 'config', 'context', 'copy', 'cost', 'desktop', 'diff',
  'doctor', 'effort', 'exit', 'export', 'extra-usage', 'fast',
  'feedback', 'help', 'hooks', 'ide', 'init', 'insights',
  'install-github-app', 'install-slack-app', 'keybindings', 'login',
  'logout', 'mcp', 'memory', 'mobile', 'model', 'passes',
  'permissions', 'plan', 'plugin', 'powerup', 'pr-comments',
  'privacy-settings', 'release-notes', 'reload-plugins',
  'remote-control', 'remote-env', 'rename', 'resume', 'review',
  'rewind', 'sandbox', 'schedule', 'security-review', 'skills',
  'stats', 'status', 'statusline', 'stickers', 'tasks',
  'terminal-setup', 'theme', 'upgrade', 'usage', 'vim', 'voice',
]
export interface ChatInstanceProps {
  chatId: string
  workspaceId: string
  isActive: boolean
  isNewChat?: boolean
  initAgentId?: string | null
  initialMessage?: string | null
  /** When true, hide the chat <-> RightPanel divider and the embedded RightPanel.
   *  Used by V2 workspace where IDEPanel lives at the layout level, so the chat
   *  pane shouldn't host a second one. */
  hideRightPanel?: boolean
  /** When provided, render RightPanel into this DOM node via React Portal instead of
   *  inline. Lets V2 IDEPanel host the real IDE in its own column without
   *  re-instantiating the chat-bound data hooks. */
  rightPanelMountNode?: HTMLElement | null
  /** Override the workspace-scoped selectedAgentId for this instance. Used by Quad
   *  mode where multiple ChatInstance tiles share one chat but each locks to a
   *  different agent. `undefined` = inherit from useWorkspace(); `null` = explicit
   *  no-lock; a string locks the conversation to that agent. */
  agentScopeOverride?: string | null
}

const ChatInstance = ({ chatId, workspaceId, isActive, isNewChat = false, initAgentId = null, initialMessage = null, hideRightPanel = false, rightPanelMountNode = null, agentScopeOverride }: ChatInstanceProps) => {
  const msgSeqRef = useRef(0)
  const uid = useCallback((prefix: string) => `${prefix}-${Date.now()}-${++msgSeqRef.current}`, [])

  const { t } = useTranslation(['chat', 'common'])
  const navigate = useNavigate()
  const { updateTabTitle, updateTabStatus } = useChatTabs()
  // URL-derived single-agent lock: when /workspace/:ws/mission/:mission?agent=:id is
  // active, the workspace pins the conversation to one agent. All cross-agent
  // affordances (mention menu, agent switcher, etc.) must be hidden inside this
  // view — talking to a different agent there means leaving the 1:1 surface.
  // agentScopeOverride takes precedence — Quad tiles use it so each tile pins
  // to its own agent independent of the URL.
  const { selectedAgentId: workspaceSelectedAgentId } = useWorkspace()
  const lockedAgentId = agentScopeOverride !== undefined ? agentScopeOverride : workspaceSelectedAgentId
  // ── Hooks ──
  const {
    availableAgents, setAvailableAgents,
    selectedAgentId, targetAgentId, setTargetAgentId,
    handleSetSelectedAgentId, currentAgentName,
    agentNames, agentPersonalities,
  } = useAgents()

  const lockedAgent = useMemo(() => {
    if (!lockedAgentId) return null
    return availableAgents.find((a) => a.id === lockedAgentId || a.name === lockedAgentId) ?? null
  }, [lockedAgentId, availableAgents])
  const singleAgentMode = !!lockedAgent
  const inputAgents = useMemo(
    () => (singleAgentMode && lockedAgent ? [lockedAgent] : availableAgents),
    [singleAgentMode, lockedAgent, availableAgents],
  )

  // Keep the input's target locked to the URL agent in single-agent mode so
  // the agent chip / send path stay coherent if state momentarily drifts.
  useEffect(() => {
    if (!singleAgentMode || !lockedAgent) return
    const lockedKey = lockedAgent.id ?? lockedAgent.name
    if (targetAgentId !== lockedKey) setTargetAgentId(lockedKey)
  }, [singleAgentMode, lockedAgent, targetAgentId, setTargetAgentId])

  // V2: an agent route (?agent=X) is a 1:1 conversation. The chat body must
  // show only that agent's groups, otherwise switching agents inside a mission
  // reveals the same merged stream and the 1:1 promise breaks.
  const lockedAgentKey = lockedAgent?.id ?? lockedAgent?.name ?? null

  const {
    expertActivities, setExpertActivities,
    currentMergedActivity,
  } = useExpertActivities()

  // In singleAgentMode (Quad tile / ?agent=X route), every chat-level "merged"
  // activity must collapse to just the locked agent's slot — otherwise a sibling
  // agent's tool run lights up this view's input/heartbeat/IDE indicators and
  // the conversation appears to bleed across agents.
  const activeMergedActivity = singleAgentMode && lockedAgentKey
    ? expertActivities[lockedAgentKey] ?? null
    : currentMergedActivity

  const [groupActivities, setGroupActivities] = useState<Record<string, AgentActivity>>({})
  const [input, setInput] = useState('')
  const [terminalWidth, setTerminalWidth] = useState(58)
  const [chatCollapsed, setChatCollapsed] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const [filterAgentId, setFilterAgentId] = useState<string | null>(null)

  const inputAreaRef = useRef<InputAreaHandle>(null)
  const [agentSwitcherOpen, setAgentSwitcherOpen] = useState(false)

  const onInitError = useCallback(() => navigate('/'), [navigate])

  const {
    wsClient, connected, currentSessionId,
    workspaceName,
    chatTitle, setChatTitle, currentWorkingDirectory, cwdReady,
    setLoading, thinking,
    allWorktreeSessions, wsRepositories,
    agentSlashCommands,
    chatModel, setChatModel,
    agentPlans, agentModes, agentAvailableCommands, agentSessionInfo,
    permissionRequests, dismissPermissionRequest,
    agentMessages, mergedMessages,
    addAgentMessage, addSystemMessage,
  } = useChatWebSocket({
    workspaceId, chatId, isNewChat, initAgentId, initialMessage,
    uid, t,
    setExpertActivities,
    selectedAgentId, availableAgents, handleSetSelectedAgentId, setAvailableAgents,
    isActive,
    onInitError,
  })

  // Single-agent surfaces (Quad tile, ?agent=X route) and the toolbar agent
  // filter read their slot directly so cross-agent traffic is excluded at the
  // source; the aggregate Mission view falls back to the merged, timestamp-sorted
  // stream. ChatBody no longer needs a post-hoc filter pass.
  const visibleMessages = useMemo(() => {
    if (singleAgentMode && lockedAgentKey) return agentMessages[lockedAgentKey] ?? []
    if (filterAgentId) return agentMessages[filterAgentId] ?? []
    return mergedMessages
  }, [singleAgentMode, lockedAgentKey, filterAgentId, agentMessages, mergedMessages])

  const dirPickerHistory = useMemo(() => currentWorkingDirectory ? [currentWorkingDirectory] : [], [currentWorkingDirectory])
  const dirPicker = useDirPicker(dirPickerHistory)

  const currentSlashCommands = useMemo(() => {
    if (!targetAgentId) return DEFAULT_SLASH_COMMANDS
    // Both sources contribute: `available_commands_update` (ACP, CLI built-ins)
    // and `slash-commands` (stream-json init + OpenTeam-scanned plugin commands).
    // Take the union so plugin commands aren't masked by either feed.
    const available = agentAvailableCommands[targetAgentId]
    const slash = agentSlashCommands[targetAgentId]
    if (!available && !slash) return DEFAULT_SLASH_COMMANDS
    return Array.from(new Set([...(available ?? []), ...(slash ?? [])])).sort()
  }, [targetAgentId, agentSlashCommands, agentAvailableCommands])

  const currentMode = targetAgentId ? agentModes[targetAgentId] : undefined
  const currentPlan = targetAgentId ? agentPlans[targetAgentId] : undefined
  const currentSessionInfo = targetAgentId ? agentSessionInfo[targetAgentId] : undefined
  const activePermissionRequest = permissionRequests[0] ?? null

  const wasConnectedRef = useRef(false)
  if (connected) wasConnectedRef.current = true
  const reconnecting = !connected && wasConnectedRef.current

  const [showReconnected, setShowReconnected] = useState(false)
  const prevReconnectingRef = useRef(false)
  useEffect(() => {
    if (prevReconnectingRef.current && connected) {
      setShowReconnected(true)
      const timer = setTimeout(() => setShowReconnected(false), 2000)
      return () => clearTimeout(timer)
    }
    prevReconnectingRef.current = reconnecting
  }, [connected, reconnecting])

  useEffect(() => {
    if (chatTitle) updateTabTitle(chatId, chatTitle)
  }, [chatTitle, chatId, updateTabTitle])

  useEffect(() => {
    if (currentSessionInfo?.title && !chatTitle) {
      setChatTitle(currentSessionInfo.title)
    }
  }, [currentSessionInfo?.title, chatTitle, setChatTitle])

  const {
    virtuosoRef, onAtBottomChange, followOutput,
    newMessageCount, handleScrollToBottom,
  } = useChatScroll(visibleMessages)

  const { statusMap: multiGitStatus, aggregate: gitAggregate, optimisticUpdate: multiOptimisticUpdate } = useMultiRepoGitStatus({
    worktreeSessions: allWorktreeSessions,
    agentActivity: activeMergedActivity,
    repositories: wsRepositories,
    chatId,
  })
  const primaryGitStatus = (wsRepositories.length > 0
    ? multiGitStatus.get(wsRepositories[0].path)
    : multiGitStatus.values().next().value) ?? null

  useEffect(() => {
    updateTabStatus(chatId, { changedFiles: gitAggregate.totalChangedFiles })
  }, [chatId, gitAggregate.totalChangedFiles, updateTabStatus])

  const [changesTabRequest, setChangesTabRequest] = useState(0)
  const handleViewChanges = useCallback(() => {
    setChangesTabRequest((n) => n + 1)
  }, [])

  const groups = useMemo(() => groupMessages(visibleMessages), [visibleMessages])
  const activeAgentIds = useMemo(
    () => [...new Set(mergedMessages.filter((m) => m.role === 'agent' && m.agentId).map((m) => m.agentId!))],
    [mergedMessages],
  )
  const lastUserGroupId = useMemo(() => {
    for (let i = visibleMessages.length - 1; i >= 0; i--) {
      if (visibleMessages[i].role === 'user') return `group-${visibleMessages[i].id}`
    }
    const firstAgent = visibleMessages.find((m) => m.role !== 'user')
    return firstAgent ? `group-orphan-${firstAgent.id}` : null
  }, [visibleMessages])

  const setGroupActivity = useCallback((groupId: string, activity: AgentActivity) => {
    setGroupActivities((prev) => {
      const existing = prev[groupId]
      if (
        existing &&
        existing.phase === activity.phase &&
        existing.background === activity.background &&
        existing.currentTool === activity.currentTool &&
        existing.toolCount === activity.toolCount &&
        existing.toolCompleted === activity.toolCompleted &&
        existing.hasText === activity.hasText &&
        existing.cost === activity.cost &&
        existing.tokens?.output === activity.tokens?.output
      ) {
        return prev
      }
      return { ...prev, [groupId]: activity }
    })
  }, [])

  // AutoSend initialMessage. Route to the agent slot that will actually receive
  // this turn (locked agent > init agent > current selection); otherwise fall
  // back to the chat-level system slot so the message never gets lost.
  const initialMessageAddedRef = useRef(false)
  useEffect(() => {
    if (!initialMessage || initialMessageAddedRef.current) return
    if (!connected || !cwdReady) return
    initialMessageAddedRef.current = true
    const initialAgentId = lockedAgentId || initAgentId || selectedAgentId
    const userMsg = { id: uid('usr'), role: 'user' as const, content: initialMessage, timestamp: Date.now(), type: 'text' as const }
    if (initialAgentId) {
      addAgentMessage(initialAgentId, userMsg)
    } else {
      addSystemMessage(userMsg)
    }
  }, [initialMessage, connected, cwdReady, lockedAgentId, initAgentId, selectedAgentId, addAgentMessage, addSystemMessage, uid])

  // snapshot activity → groupActivity
  const prevLastGroupIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (lastUserGroupId && prevLastGroupIdRef.current && lastUserGroupId !== prevLastGroupIdRef.current) {
      const prevId = prevLastGroupIdRef.current
      setGroupActivities((prev) => {
        const prevActivity = prev[prevId]
        if (prevActivity && !['completed', 'waiting_input', 'error'].includes(prevActivity.phase)) {
          return { ...prev, [prevId]: { ...prevActivity, phase: 'completed' } }
        }
        return prev
      })
    }
    prevLastGroupIdRef.current = lastUserGroupId
  }, [lastUserGroupId])

  useEffect(() => {
    if (!activeMergedActivity) return
    if (lastUserGroupId) setGroupActivity(lastUserGroupId, activeMergedActivity)
  }, [activeMergedActivity, lastUserGroupId, setGroupActivity])

  useEffect(() => {
    if (!isActive) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('devpanel:toggle'))
        return
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && (e.key === 'k' || e.key === 'K')) {
        if (singleAgentMode) return
        e.preventDefault()
        setAgentSwitcherOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isActive, singleAgentMode])

  const handleAddDirPick = useCallback((path: string) => {
    dirPicker.setDirModalOpen(false)
    setInput('')
    const message = `/add-dir ${path}`
    const targetAgent = availableAgents.find((a) => a.name === targetAgentId || a.id === targetAgentId)
    const agentId = targetAgent?.id || targetAgentId || availableAgents[0]?.id
    if (!agentId) return
    addAgentMessage(agentId, { id: uid('usr'), role: 'user', content: message, timestamp: Date.now(), type: 'text' })
    handleScrollToBottom()
    wsClient.send('expert:direct-input', {
      chatId, agentId, message, autoStart: true,
      cwd: currentWorkingDirectory,
      repositories: wsRepositories.map((r) => ({ path: r.path })),
      cols: 80, rows: 24,
    })
  }, [availableAgents, targetAgentId, chatId, currentWorkingDirectory, wsRepositories, wsClient, dirPicker, addAgentMessage, uid, handleScrollToBottom])

  const {
    queuedMessages,
    handleSend, handleAnswerQuestion, handleInterrupt,
    removeQueuedMessage, clearQueue,
  } = useChatActions({
    chatId, wsClient, currentSessionId, currentWorkingDirectory, wsRepositories,
    availableAgents, targetAgentId, expertActivities,
    currentMergedActivity: activeMergedActivity,
    lockedAgentId: singleAgentMode ? lockedAgentKey : null,
    messages: mergedMessages, input, setInput, addAgentMessage, uid, handleScrollToBottom,
    setExpertActivities, setTargetAgentId, setLoading, chatTitle, setChatTitle,
    openDirPicker: dirPicker.openDirPicker,
  })

  const handleResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    const container = e.currentTarget.parentElement?.parentElement
    if (!container) return
    const containerWidth = container.getBoundingClientRect().width
    const startX = e.clientX
    const startWidth = terminalWidth
    const onMove = (ev: MouseEvent) => {
      const deltaPercent = ((ev.clientX - startX) / containerWidth) * 100
      setTerminalWidth(Math.max(25, Math.min(80, startWidth - deltaPercent)))
    }
    setIsResizing(true)
    const onUp = () => { setIsResizing(false); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleModelChange = useCallback((newModel: string) => {
    setChatModel(newModel)
    if (chatId) {
      authFetch(`${API_BASE}/api/chats/${chatId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: newModel }),
      }).catch((err: unknown) => console.warn('model update failed', err))
    }
  }, [chatId, setChatModel])

  const handleFilterAgentChange = useCallback((agentId: string | null) => {
    setFilterAgentId(agentId)
    if (!agentId) return
    setTargetAgentId(agentId)
  }, [])

  const currentAgent = availableAgents.find((a) => a.name === targetAgentId || a.id === targetAgentId)
  const availableModels = useMemo(
    () => getModelsForProvider(currentAgent?.provider),
    [currentAgent?.provider],
  )

  const canSend = connected && !!currentSessionId && cwdReady

  // When portal mode is active, chat owns the full pane just like hideRightPanel.
  const rightPanelExternal = hideRightPanel || rightPanelMountNode !== null
  const chatPanelStyle = useMemo<React.CSSProperties>(() => ({
    width: rightPanelExternal ? '100%' : (chatCollapsed ? 0 : `${100 - terminalWidth}%`),
    display: 'flex', flexDirection: 'column', minWidth: 0, overflow: 'hidden',
    transition: isResizing ? 'none' : 'width 0.2s ease',
  }), [chatCollapsed, terminalWidth, isResizing, rightPanelExternal])
  const terminalPanelStyle = useMemo<React.CSSProperties>(() => ({
    width: chatCollapsed ? '100%' : `${terminalWidth}%`,
    height: '100%', minWidth: 0, overflow: 'hidden',
    transition: isResizing ? 'none' : 'width 0.2s ease',
  }), [chatCollapsed, terminalWidth, isResizing])

  return (
    <div style={ROOT_STYLE}>
      {/* Main content */}
      <div style={MAIN_CONTENT_STYLE}>
        <div style={chatPanelStyle}>
          <ChatHeader
              workspaceName={workspaceName} workspaceId={workspaceId} chatId={chatId}
              chatTitle={chatTitle} setChatTitle={setChatTitle}
              connected={connected} currentMode={currentMode}
          />
          {!cwdReady ? (
            <div style={LOADING_STYLE}>Loading workspace...</div>
          ) : (<>
          {allWorktreeSessions.length > 0 && <WorktreePanel sessions={allWorktreeSessions} repositories={wsRepositories} />}
          {mergedMessages.length > 0 && !singleAgentMode && (
            <MessageToolbar filterAgentId={filterAgentId} onFilterAgentChange={handleFilterAgentChange} agentNames={agentNames} agentPersonalities={agentPersonalities} expertActivities={expertActivities} activeAgentIds={activeAgentIds} />
          )}
          <ChatBody
            messages={visibleMessages} groups={groups} viewKey={singleAgentMode ? lockedAgentKey : (filterAgentId ?? '__all__')}
            currentMergedActivity={activeMergedActivity} groupActivities={groupActivities}
            expertActivities={expertActivities} agentNames={agentNames} agentPersonalities={agentPersonalities}
            thinking={thinking} currentAgentName={currentAgentName}
            connected={connected} currentSessionId={currentSessionId}
            reconnecting={reconnecting} showReconnected={showReconnected}
            newMessageCount={newMessageCount}
            virtuosoRef={virtuosoRef}
            onAtBottomChange={onAtBottomChange}
            followOutput={followOutput}
            handleScrollToBottom={handleScrollToBottom}
            handleAnswerQuestion={handleAnswerQuestion}
            targetAgentId={targetAgentId}
          />
          {currentPlan && currentPlan.entries.length > 0 && (
            <PlanCard entries={currentPlan.entries} />
          )}
          <GlobalHeartbeatBar expertActivities={expertActivities} agentNames={agentNames} agentPersonalities={agentPersonalities}
            onInterrupt={handleInterrupt}
            onAgentClick={(agentId) => { setTargetAgentId(agentId); inputAreaRef.current?.focus() }} />
          {primaryGitStatus && (
            <GitStatusBar gitStatus={primaryGitStatus} aggregate={multiGitStatus.size > 1 ? gitAggregate : undefined} onViewChanges={handleViewChanges} repositories={wsRepositories} multiGitStatus={multiGitStatus} />
          )}
          <QueuedMessagesBar queue={queuedMessages} onRemove={removeQueuedMessage} onClear={clearQueue} />
          <InputArea ref={inputAreaRef} value={input} onChange={setInput} onSend={handleSend}
            onInterrupt={handleInterrupt}
            disabled={!canSend} activity={activeMergedActivity} slashCommands={currentSlashCommands}
            model={chatModel} onModelChange={handleModelChange} availableModels={availableModels}
            agents={inputAgents} expertActivities={expertActivities} targetAgentId={targetAgentId}
            onTargetChange={(agent) => setTargetAgentId(agent.id ?? agent.name)}
            cwd={currentWorkingDirectory}
            queueSize={queuedMessages.length}
            onOpenAgentSwitcher={singleAgentMode ? undefined : () => setAgentSwitcherOpen(true)}
            singleAgentMode={singleAgentMode}
            lockedAgentName={lockedAgent?.name}
            isActive={isActive} />
          </>)}
        </div>

        {rightPanelMountNode && createPortal(
          <Suspense fallback={<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgb(var(--text-muted))', fontSize: 12 }}>Loading...</div>}>
            <RightPanel
              chatId={chatId}
              gitStatus={primaryGitStatus}
              multiGitStatus={multiGitStatus}
              onMultiOptimisticUpdate={multiOptimisticUpdate}
              agentActive={!!activeMergedActivity && !['completed', 'waiting_input', 'error', 'initializing'].includes(activeMergedActivity.phase)}
              connected={connected}
              workingDirectory={currentWorkingDirectory}
              repositories={wsRepositories}
              worktreePath={allWorktreeSessions[0]?.worktreePath}
              changesTabRequest={changesTabRequest}
            />
          </Suspense>,
          rightPanelMountNode,
        )}

        {!hideRightPanel && !rightPanelMountNode && (
          <>
            <div style={DIVIDER_BAR_STYLE}>
              <div
                onMouseDown={chatCollapsed ? undefined : handleResizeMouseDown}
                style={{ width: '100%', height: '100%', background: 'rgb(var(--border-color))', cursor: chatCollapsed ? 'default' : 'col-resize', transition: 'background 0.15s' }}
                onMouseEnter={(e) => { if (!chatCollapsed) e.currentTarget.style.background = 'rgb(var(--accent-brand))' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgb(var(--border-color))' }}
              />
              <button
                onClick={() => setChatCollapsed((v) => !v)}
                tabIndex={0}
                aria-label={chatCollapsed ? t('chat:expandPanel') : t('chat:collapsePanel')}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-5 h-8 rounded-full border border-border-subtle bg-bg-primary text-text-secondary cursor-pointer transition-colors duration-150 hover:bg-bg-secondary hover:text-text-primary"
              >
                {chatCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
            </div>

            <div style={terminalPanelStyle}>
              <Suspense fallback={<div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'rgb(var(--text-muted))', fontSize: 12 }}>Loading...</div>}>
                <RightPanel
                  chatId={chatId}
                  gitStatus={primaryGitStatus}
                  multiGitStatus={multiGitStatus}
                  onMultiOptimisticUpdate={multiOptimisticUpdate}
                  agentActive={!!activeMergedActivity && !['completed', 'waiting_input', 'error', 'initializing'].includes(activeMergedActivity.phase)}
                  connected={connected}
                  workingDirectory={currentWorkingDirectory}
                  repositories={wsRepositories}
                  worktreePath={allWorktreeSessions[0]?.worktreePath}
                  changesTabRequest={changesTabRequest}
                />
              </Suspense>
            </div>
          </>
        )}
      </div>

      {isActive && !singleAgentMode && (
        <AgentSwitcherModal
          open={agentSwitcherOpen}
          agents={availableAgents}
          activities={expertActivities}
          currentAgentId={targetAgentId}
          onSelect={(agent) => setTargetAgentId(agent.id ?? agent.name)}
          onClose={() => {
            setAgentSwitcherOpen(false)
            inputAreaRef.current?.focus()
          }}
        />
      )}

      <DirPickerDialog
        open={dirPicker.dirModalOpen}
        onOpenChange={dirPicker.setDirModalOpen}
        browsePath={dirPicker.browsePath}
        homeDir={dirPicker.homeDir}
        dirs={dirPicker.dirs}
        loadingDirs={dirPicker.loadingDirs}
        dirSearch={dirPicker.dirSearch}
        onDirSearchChange={dirPicker.setDirSearch}
        searchResults={dirPicker.searchResults}
        searchLoading={dirPicker.searchLoading}
        newFolderMode={dirPicker.newFolderMode}
        onNewFolderModeChange={dirPicker.setNewFolderMode}
        newFolderName={dirPicker.newFolderName}
        onNewFolderNameChange={dirPicker.setNewFolderName}
        newFolderError={dirPicker.newFolderError}
        onNewFolderErrorChange={dirPicker.setNewFolderError}
        pickingForCreateWs={false}
        onLoadDirs={dirPicker.loadDirs}
        onPickAndLaunch={handleAddDirPick}
        onCreateFolder={() => dirPicker.handleCreateFolder(handleAddDirPick)}
      />

      {isActive && (
        <PermissionModal
          request={activePermissionRequest}
          onResolved={dismissPermissionRequest}
        />
      )}
    </div>
  )
}

export default ChatInstance
