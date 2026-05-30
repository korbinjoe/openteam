import { useState, useEffect, useRef, useCallback } from 'react'
import { toast } from 'sonner'
import { getWebSocketClient, sendTelemetry } from '../services/WebSocketClient'
import type { Message, AgentActivity, WorktreeSession } from '../types/chat'
import type { AgentSummary } from '../types/agentConfig'
import { API_BASE, authFetch } from '@/config/api'
import { DEFAULT_AGENT } from '@/lib/models'
import { createExpertEventHandlers, type ExpertEventHandlers } from './useExpertEvents'
import { usePermissionEvents } from './usePermissionEvents'
import { useAgentMessages, SYSTEM_MESSAGE_AGENT } from './useAgentMessages'

interface UseChatWebSocketOptions {
  workspaceId?: string
  chatId?: string
  isNewChat: boolean
  initAgentId: string | null
  initialMessage?: string | null
  uid: (prefix: string) => string
  t: (key: string, opts?: Record<string, unknown>) => string
  setExpertActivities: React.Dispatch<React.SetStateAction<Record<string, AgentActivity>>>
  selectedAgentId: string | null
  availableAgents: AgentSummary[]
  handleSetSelectedAgentId: (id: string | null) => void
  setAvailableAgents: React.Dispatch<React.SetStateAction<AgentSummary[]>>
  /** Tab  Tab —  Tab  chat:set-context */
  isActive?: boolean
  onInitError?: () => void
}

/**
 * ChatPage  WebSocket Workspace
 *
 * Owns the per-agent message store. Callers (ChatInstance, useChatActions)
 * read `agentMessages` and append via `addAgentMessage(agentId, msg)`. Each
 * agent slot corresponds 1:1 to one CLI JSONL session, so no cross-agent
 * merge/split happens at this layer.
 */
export const useChatWebSocket = (opts: UseChatWebSocketOptions) => {
  const {
    workspaceId, chatId, isNewChat, initAgentId,
    uid, t,
    setExpertActivities,
    selectedAgentId, availableAgents, handleSetSelectedAgentId, setAvailableAgents,
    isActive = true, onInitError,
  } = opts
  const wsClient = getWebSocketClient()
  const isActiveRef = useRef(isActive)
  isActiveRef.current = isActive

  const initialAgentSetRef = useRef(false)
  const selectedAgentIdRef = useRef(selectedAgentId)
  selectedAgentIdRef.current = selectedAgentId

  const agentMessagesStore = useAgentMessages()
  const { agentMessages, agentMessagesRef, setAgentMessages, mergedMessages } = agentMessagesStore

  const [connected, setConnected] = useState(false)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [workspaceName, setWorkspaceName] = useState('')
  const [chatTitle, setChatTitle] = useState('')
  const [currentWorkingDirectory, setCurrentWorkingDirectory] = useState('')
  const [cwdReady, setCwdReady] = useState(false)
  const [loading, setLoading] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [allWorktreeSessions, setAllWorktreeSessions] = useState<WorktreeSession[]>([])
  const [wsRepositories, setWsRepositories] = useState<Array<{ id: string; path: string; name: string }>>([])
  const [chatTokenSnapshot, setChatTokenSnapshot] = useState<{ totalCost?: number; totalTokens?: { input: number; output: number; cacheRead?: number; cacheCreation?: number } } | null>(null)
  const [agentSlashCommands, setAgentSlashCommands] = useState<Record<string, string[]>>({})
  const [chatModel, setChatModel] = useState<string | null>(null)

  const [agentPlans, setAgentPlans] = useState<Record<string, { entries: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; priority?: 'low' | 'medium' | 'high' }> }>>({})
  const [agentModes, setAgentModes] = useState<Record<string, string>>({})
  const [agentAvailableCommands, setAgentAvailableCommands] = useState<Record<string, string[]>>({})
  const [agentSessionInfo, setAgentSessionInfo] = useState<Record<string, { title?: string; updatedAt?: string }>>({})

  const currentSessionIdRef = useRef(currentSessionId)
  currentSessionIdRef.current = currentSessionId
  const chatIdRef = useRef(chatId)
  chatIdRef.current = chatId
  const autoInitFiredRef = useRef(false)
  const selectedAgentIdRefForSystem = useRef(selectedAgentId)
  selectedAgentIdRefForSystem.current = selectedAgentId

  const isCurrentChatEvent = (payload?: { chatId?: string }) => {
    const result = !!(payload?.chatId && chatIdRef.current && payload.chatId === chatIdRef.current)
    return result
  }

  /** Route chat-level system messages (errors, banners) to a fallback agent slot
   *  so they remain visible regardless of which agent the user is currently on. */
  const addSystemMessage = useCallback((msg: Message) => {
    const fallback = msg.agentId || selectedAgentIdRefForSystem.current || SYSTEM_MESSAGE_AGENT
    const targetMsg: Message = msg.agentId ? msg : { ...msg, agentId: fallback }
    setAgentMessages((prev) => {
      const list = prev[fallback] ?? []
      return { ...prev, [fallback]: [...list, targetMsg] }
    })
  }, [setAgentMessages])

  /** Append a message to a specific agent slot. Public API for callers. */
  const addAgentMessage = useCallback((agentId: string, msg: Message) => {
    const targetMsg: Message = msg.agentId ? msg : { ...msg, agentId }
    setAgentMessages((prev) => {
      const list = prev[agentId] ?? []
      return { ...prev, [agentId]: [...list, targetMsg] }
    })
  }, [setAgentMessages])

  const { permissionRequests, handleExpertPermissionRequest, handleChatPermissionResolved, dismissPermissionRequest } = usePermissionEvents(chatIdRef)

  const expertHandlersRef = useRef<ExpertEventHandlers | null>(null)
  if (!expertHandlersRef.current) {
    expertHandlersRef.current = createExpertEventHandlers({
      isCurrentChatEvent, addSystemMessage, uid, t,
      setExpertActivities, setAgentMessages, setLoading, setThinking,
      setAgentSlashCommands, setAgentPlans, setAgentModes,
      setAgentAvailableCommands, setAgentSessionInfo,
    })
  }
  const expertHandlers = expertHandlersRef.current

  const sendContextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const wsHandlersRef = useRef({
    handleError: (data: { message?: string; chatId?: string } | undefined) => {
      if (!isActiveRef.current) return
      if (data?.chatId && !isCurrentChatEvent(data)) return
      addSystemMessage({ id: uid('err'), role: 'agent', content: `Error: ${data?.message ?? 'unknown'}`, timestamp: Date.now(), type: 'error' })
      setLoading(false); setThinking(false)
    },
    ...expertHandlers,
    handleExpertPermissionRequest,
    handleChatPermissionResolved,
    sendChatContext: () => {
      const currentChatId = chatIdRef.current
      if (!currentChatId || !wsClient.isConnected()) return
      if (!isActiveRef.current) return
      if (sendContextTimerRef.current) clearTimeout(sendContextTimerRef.current)
      sendContextTimerRef.current = setTimeout(() => {
        sendContextTimerRef.current = null
        const cid = chatIdRef.current
        if (!cid || !wsClient.isConnected() || !isActiveRef.current) return
        wsClient.send('chat:set-context', { chatId: cid })
        wsClient.send('chat:resume-experts', { chatId: cid })
      }, 300)
    },
  })

  wsHandlersRef.current.handleError = (data) => {
    if (!isActiveRef.current) return
    if (data?.chatId && !isCurrentChatEvent(data)) return
    addSystemMessage({ id: uid('err'), role: 'agent', content: `Error: ${data?.message ?? 'unknown'}`, timestamp: Date.now(), type: 'error' })
    setLoading(false); setThinking(false)
  }
  wsHandlersRef.current.sendChatContext = () => {
    const currentChatId = chatIdRef.current
    if (!currentChatId || !wsClient.isConnected()) return
    if (!isActiveRef.current) return
    if (sendContextTimerRef.current) clearTimeout(sendContextTimerRef.current)
    sendContextTimerRef.current = setTimeout(() => {
      sendContextTimerRef.current = null
      const cid = chatIdRef.current
      if (!cid || !wsClient.isConnected() || !isActiveRef.current) return
      wsClient.send('chat:set-context', { chatId: cid })
      wsClient.send('chat:resume-experts', { chatId: cid })
    }, 300)
  }

  // ── Workspace Initialize ──
  useEffect(() => {
    if (!workspaceId) return
    let cancelled = false

    const init = async () => {
      try {
        const fetches: [Promise<Response>, Promise<Response | null>] = [
          authFetch(`${API_BASE}/api/workspaces/${workspaceId}`),
          chatId ? authFetch(`${API_BASE}/api/chats/${chatId}`) : Promise.resolve(null),
        ]
        const [wsRes, chatRes] = await Promise.all(fetches)
        if (!wsRes.ok) throw new Error('Workspace not found')
        const ws = await wsRes.json()
        if (cancelled) return

        setWorkspaceName(ws.name || workspaceId || '')

        if (ws.repositories?.length > 0) {
          const paths = ws.repositories.map((r: { path: string }) => r.path)
          setCurrentWorkingDirectory(paths[0])
          setWsRepositories(ws.repositories)
        }

        const agents: AgentSummary[] = await authFetch(`${API_BASE}/api/agents`)
          .then((r) => r.ok ? r.json() : [])
        if (cancelled) return
        if (agents.length > 0) setAvailableAgents(agents)

        const chat = chatRes?.ok ? await chatRes.json() : null

        // Priority：chat.lastAgentId > workspace.primaryAgentId > config.defaultAgent > first
        if (!initialAgentSetRef.current && agents.length > 0 && !selectedAgentIdRef.current) {
          initialAgentSetRef.current = true
          const lastAgent = chat?.lastAgentId
            ? agents.find((a) => a.id === chat.lastAgentId)
            : null
          const primary = ws.agentTeam?.primaryAgentId
            ? agents.find((a) => a.id === ws.agentTeam.primaryAgentId)
            : null
          const fallback = agents.find((a) => a.id === DEFAULT_AGENT) ?? agents[0]
          const target = lastAgent ?? primary ?? fallback
          if (target) handleSetSelectedAgentId(target.id)
        } else if (!initialAgentSetRef.current) {
          initialAgentSetRef.current = true
        }

        if (chat) {
          if (chat.title) setChatTitle(chat.title)
          if (chat.model) setChatModel(chat.model)
          setAllWorktreeSessions(chat.worktreeSessions ?? [])
          if (chat.totalTokens || chat.totalCost != null) {
            setChatTokenSnapshot({ totalCost: chat.totalCost, totalTokens: chat.totalTokens })
          }
        }
      } catch (err) {
        console.error('[useChatWebSocket] Workspace init failed:', err)
        sendTelemetry('system', 'web.workspace_init_failed', { error: err instanceof Error ? err.message : String(err) })
        toast.error(t('chat:workspaceLoadFailed'))
        onInitError?.()
        return
      }

      setCwdReady(true)
    }

    init()
    return () => { cancelled = true }
  }, [workspaceId, chatId, handleSetSelectedAgentId, setAvailableAgents, onInitError])

  useEffect(() => {
    let cancelled = false
    const h = wsHandlersRef.current

    const onStructuredMessage = (p: unknown) => wsHandlersRef.current.onExpertStructuredMessage(p as Parameters<typeof h.onExpertStructuredMessage>[0])
    const onError = (p: unknown) => wsHandlersRef.current.handleError(p as { message?: string; chatId?: string } | undefined)
    const onExpertError = (p: unknown) => wsHandlersRef.current.handleExpertError(p as Parameters<typeof h.handleExpertError>[0])
    const onExpertActivity = (p: unknown) => wsHandlersRef.current.handleExpertActivity(p as Parameters<typeof h.handleExpertActivity>[0])
    const onExpertExit = (p: unknown) => wsHandlersRef.current.handleExpertExit(p as Parameters<typeof h.handleExpertExit>[0])
    const onExpertStarted = (p: unknown) => wsHandlersRef.current.handleExpertStarted(p as Parameters<typeof h.handleExpertStarted>[0])
    const onExpertResumeFailed = (p: unknown) => wsHandlersRef.current.handleExpertResumeFailed(p as Parameters<typeof h.handleExpertResumeFailed>[0])
    const onVersionBlocked = (p: unknown) => wsHandlersRef.current.handleVersionBlocked(p as Parameters<typeof h.handleVersionBlocked>[0])
    const onExpertSlashCommands = (p: unknown) => wsHandlersRef.current.handleExpertSlashCommands(p as Parameters<typeof h.handleExpertSlashCommands>[0])
    const onExpertPartialText = (p: unknown) => wsHandlersRef.current.handleExpertPartialText(p as Parameters<typeof h.handleExpertPartialText>[0])
    const onExpertPlanUpdate = (p: unknown) => wsHandlersRef.current.handleExpertPlanUpdate(p as Parameters<typeof h.handleExpertPlanUpdate>[0])
    const onExpertModeChange = (p: unknown) => wsHandlersRef.current.handleExpertModeChange(p as Parameters<typeof h.handleExpertModeChange>[0])
    const onExpertCommandsUpdate = (p: unknown) => wsHandlersRef.current.handleExpertCommandsUpdate(p as Parameters<typeof h.handleExpertCommandsUpdate>[0])
    const onExpertSessionInfo = (p: unknown) => wsHandlersRef.current.handleExpertSessionInfo(p as Parameters<typeof h.handleExpertSessionInfo>[0])
    const onExpertPermissionRequest = (p: unknown) => wsHandlersRef.current.handleExpertPermissionRequest(p as Parameters<typeof h.handleExpertPermissionRequest>[0])
    const onChatPermissionResolved = (p: unknown) => wsHandlersRef.current.handleChatPermissionResolved(p as Parameters<typeof h.handleChatPermissionResolved>[0])
    const onChatTitleUpdated = (p: unknown) => {
      const payload = p as { chatId: string; title: string }
      if (!isCurrentChatEvent(payload)) return
      if (payload.title) setChatTitle(payload.title)
    }

    wsClient.on('expert:structured-message', onStructuredMessage)
    wsClient.on('error', onError)
    wsClient.on('expert:error', onExpertError)
    wsClient.on('expert:activity', onExpertActivity)
    wsClient.on('expert:exit', onExpertExit)
    wsClient.on('expert:stopped', onExpertExit)
    wsClient.on('expert:started', onExpertStarted)
    wsClient.on('expert:resume-failed', onExpertResumeFailed)
    wsClient.on('expert:version-blocked', onVersionBlocked)
    wsClient.on('expert:slash-commands', onExpertSlashCommands)
    wsClient.on('expert:partial-text', onExpertPartialText)
    wsClient.on('expert:plan-update', onExpertPlanUpdate)
    wsClient.on('expert:mode-change', onExpertModeChange)
    wsClient.on('expert:commands-update', onExpertCommandsUpdate)
    wsClient.on('expert:session-info', onExpertSessionInfo)
    wsClient.on('expert:permission-request', onExpertPermissionRequest)
    wsClient.on('chat:permission-resolved', onChatPermissionResolved)
    wsClient.on('chat:title-updated', onChatTitleUpdated)

    const handleReconnected = () => {
      setConnected(true)
      wsHandlersRef.current.sendChatContext()
    }
    wsClient.on('reconnected', handleReconnected)

    const handleDisconnected = () => setConnected(false)
    wsClient.on('disconnected', handleDisconnected)

    const handleReconnectFailed = () => {
      setConnected(false)
      wsClient.connect().catch(() => { })
    }
    wsClient.on('reconnect_failed', handleReconnectFailed)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && wsClient.isConnected()) {
        wsHandlersRef.current.sendChatContext()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    const connect = async () => {
      if (!wsClient.isConnected()) {
        await wsClient.connect()
      }
      if (cancelled) return
      setConnected(true)
      wsHandlersRef.current.sendChatContext()

      if (!currentSessionIdRef.current) {
        const localSid = `local-${Date.now()}`
        setCurrentSessionId(localSid)
      }
    }

    connect().catch(() => { if (!cancelled) setConnected(false) })

    return () => {
      cancelled = true
      expertHandlers.cleanupDeltaTimer()
      if (sendContextTimerRef.current) { clearTimeout(sendContextTimerRef.current); sendContextTimerRef.current = null }
      wsClient.off('expert:structured-message', onStructuredMessage)
      wsClient.off('error', onError)
      wsClient.off('expert:error', onExpertError)
      wsClient.off('expert:activity', onExpertActivity)
      wsClient.off('expert:exit', onExpertExit)
      wsClient.off('expert:stopped', onExpertExit)
      wsClient.off('expert:started', onExpertStarted)
      wsClient.off('expert:resume-failed', onExpertResumeFailed)
      wsClient.off('expert:version-blocked', onVersionBlocked)
      wsClient.off('expert:slash-commands', onExpertSlashCommands)
      wsClient.off('expert:partial-text', onExpertPartialText)
      wsClient.off('expert:plan-update', onExpertPlanUpdate)
      wsClient.off('expert:mode-change', onExpertModeChange)
      wsClient.off('expert:commands-update', onExpertCommandsUpdate)
      wsClient.off('expert:session-info', onExpertSessionInfo)
      wsClient.off('expert:permission-request', onExpertPermissionRequest)
      wsClient.off('chat:permission-resolved', onChatPermissionResolved)
      wsClient.off('chat:title-updated', onChatTitleUpdated)
      wsClient.off('reconnected', handleReconnected)
      wsClient.off('disconnected', handleDisconnected)
      wsClient.off('reconnect_failed', handleReconnectFailed)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [wsClient])

  const prevIsActiveRef = useRef(isActive)
  useEffect(() => {
    if (isActive && !prevIsActiveRef.current && chatId && wsClient.isConnected()) {
      wsHandlersRef.current.sendChatContext()
    }
    prevIsActiveRef.current = isActive
  }, [isActive, chatId, wsClient])

  const prevContextChatIdRef = useRef<string | undefined>(chatId)
  useEffect(() => {
    if (chatId === prevContextChatIdRef.current) return
    prevContextChatIdRef.current = chatId
    if (!chatId || !wsClient.isConnected()) return
    wsHandlersRef.current.sendChatContext()
  }, [chatId, wsClient])

  useEffect(() => {
    if (!isNewChat) return
    if (autoInitFiredRef.current) return
    const rawAgentId = initAgentId || selectedAgentId
    if (!connected || !cwdReady || !rawAgentId || !chatId || availableAgents.length === 0) return
    if (!opts.initialMessage) return

    const agent = availableAgents.find((a) => a.name === rawAgentId || a.id === rawAgentId)
    const agentId = agent?.id || rawAgentId
    if (!agentId) return

    autoInitFiredRef.current = true
    if (agentId !== selectedAgentId) {
      handleSetSelectedAgentId(agentId)
    }
    setExpertActivities((prev) => ({
      ...prev,
      [agentId]: { phase: 'initializing', background: false, toolCount: 0, toolCompleted: 0, hasText: false, updatedAt: Date.now() },
    }))
    wsClient.send('expert:direct-input', {
      chatId,
      agentId,
      message: opts.initialMessage || '',
      autoStart: true,
      cwd: currentWorkingDirectory,
      repositories: wsRepositories.map((r) => ({ path: r.path })),
      cols: 80,
      rows: 24,
    })
  }, [isNewChat, connected, cwdReady, selectedAgentId, initAgentId, chatId, currentWorkingDirectory, wsRepositories, wsClient, handleSetSelectedAgentId, availableAgents, opts.initialMessage])

  return {
    wsClient,
    connected,
    currentSessionId, setCurrentSessionId,
    workspaceName,
    chatTitle, setChatTitle,
    currentWorkingDirectory,
    cwdReady,
    loading, setLoading,
    thinking, setThinking,
    allWorktreeSessions,
    wsRepositories,
    chatTokenSnapshot,
    agentSlashCommands,
    chatModel, setChatModel,
    agentPlans,
    agentModes,
    agentAvailableCommands,
    agentSessionInfo,
    permissionRequests,
    dismissPermissionRequest,
    // Per-agent message store
    agentMessages,
    agentMessagesRef,
    mergedMessages,
    addAgentMessage,
    addSystemMessage,
    setAgentMessages,
  }
}
