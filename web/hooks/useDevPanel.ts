/**
 * useDevPanel —
 *
 *  dev:* WS  server  DevInspector
 *  snapshot  event log
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { getWebSocketClient } from '@/services/WebSocketClient'

export interface DevSessionSnapshot {
  sessionId: string
  agentId: string | undefined
  agentName: string
  cliSessionId: string | undefined
  /** 'active' = , 'historical' =  DB  */
  status: 'active' | 'historical'
  origin?: 'local'
  connectedWs: boolean
  connectionId: string | null
  disconnectedAt: number | null
  createdAt: number
  killReason: string | undefined
  streamJson?: {
    alive: boolean
    pid: number | null
    spawnedAt: number | null
    provider: string
    cliSessionId: string | null
    messageCount: number
    turnIndex: number
    model: string | null
  }
  jsonl: {
    filePath: string
    fileExists: boolean
    fileSizeBytes: number
  } | null
  activity: {
    phase: string
    updatedAt: number
    currentTool: string | null
    turnIndex: number
    toolCount: number
    toolCompleted: number
    modelUsage: Record<string, { input: number; output: number; cost: number }>
  }
  acp?: {
    adapterState: string
    provider: string
    capabilities: { supportsSessionLoad: boolean; supportsImages: boolean; supportsThinking: boolean; modes: string[] }
    promptInFlight: boolean
    promptStartedAt: number | null
    lastPromptDurationMs: number | null
    updateCount: number
    lastUpdateType: string | null
    lastUpdateAt: number | null
    recentUpdates: Array<{ ts: number; type: string; summary: string; dir: 'out' | 'in'; data?: unknown }>
  }
}

export type DevPanelMode = 'local'

export interface DevSnapshot {
  chatId: string
  timestamp: number
  mode: DevPanelMode
  chat: {
    status: string | null
    missionStatus: string | null
    expertSessions: Record<string, unknown> | null
  } | null
  sessions: DevSessionSnapshot[]
  totalSessions: number
}

export interface DevEvent {
  chatId: string
  timestamp: number
  type: string
  agentId?: string
  sessionId?: string
  data?: Record<string, unknown>
}

export interface DevJsonlMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: number
  type: 'text' | 'toolUse' | 'toolResult' | 'thinking' | 'stats'
  toolUse?: { toolName: string; toolId: string; input: string; status: string }
  toolResult?: { toolUseId: string; content: string; isError?: boolean }
  stats?: { costUsd?: number; inputTokens?: number; outputTokens?: number }
  thinkingSummary?: string
  model?: string
  turnIndex?: number
}

export interface DevJsonlContent {
  chatId: string
  sessionId: string
  filePath: string | null
  fileExists: boolean
  messages: DevJsonlMessage[]
  lineCount: number
}

export interface DevRawJsonlContent {
  sessionId: string
  filePath: string | null
  fileExists: boolean
  content: string
  sizeBytes: number
}

// ── Pipeline Type ────────────────────────────────────────────────────────

export type PipelineStageStatus = 'pending' | 'active' | 'done' | 'error' | 'skipped'

export interface PipelineStageState {
  id: string
  label: string
  status: PipelineStageStatus
  startedAt: number | null
  endedAt: number | null
  durationMs: number | null
  detail: Record<string, unknown>
}

export type PipelineZoneId = 'local' | 'network' | 'backflow'

export interface PipelineZone {
  id: PipelineZoneId
  label: string
  stages: PipelineStageState[]
}

export interface PipelineSnapshot {
  chatId: string
  mode: DevPanelMode
  missionId: string | null
  zones: PipelineZone[]
  totalElapsedMs: number | null
  health: 'green' | 'yellow' | 'red'
}

// ── Timeline Type ────────────────────────────────────────────────────────

export interface TimelineEntry {
  timestamp: number
  source: 'ws' | 'matrix' | 'oss' | 'internal'
  direction: 'in' | 'out' | 'internal'
  type: string
  missionId: string | null
  agentId: string | null
  summary: string
  detail?: Record<string, unknown>
}

// ── Workflow Type ────────────────────────────────────────────────────────

export type WorkflowStatus = 'created' | 'running' | 'completed' | 'stopped' | 'suspended'
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'suspended'

export interface DevWorkflowTask {
  taskId: string
  agentId: string
  description: string
  status: TaskStatus
  dependsOn: string[]
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  retryCount: number
  failureReason: string | null
}

export interface DevWorkflowPayload {
  chatId: string
  workflowId: string | null
  status: WorkflowStatus | null
  tasks: DevWorkflowTask[]
  totalElapsedMs: number | null
}

// ── Whiteboard Type ─────────────────────────────────────────────────────

export interface WhiteboardEntry {
  id: string
  chatId: string
  seq: number
  type: 'goal' | 'decision' | 'artifact' | 'progress' | 'open_question' | 'constraint' | 'handoff'
  by: string
  summary: string
  refs?: { files?: string[]; entries?: string[]; mailbox?: string; artifacts?: string[] }
  tags?: string[]
  status: 'active' | 'archived' | 'superseded'
  timestamp: string
}

export interface DevWhiteboardPayload {
  chatId: string
  goal: WhiteboardEntry | null
  active: WhiteboardEntry[]
  totalActive: number
  totalArchived: number
}

interface DevJsonlMessagesEvent {
  chatId: string
  sessionId: string
  agentId?: string
  type: 'full' | 'delta'
  messages: DevJsonlMessage[]
  replacedStatsId: string | null
}

const MAX_EVENTS = 500
const SHOW_ALL_PROTOCOL_KEY = 'devpanel.showAllProtocol'

export const useDevPanel = (chatId: string, isOpen: boolean) => {
  const [snapshot, setSnapshot] = useState<DevSnapshot | null>(null)
  const [events, setEvents] = useState<DevEvent[]>([])
  const [jsonlStreams, setJsonlStreams] = useState<Record<string, DevJsonlMessage[]>>({})
  const [rawJsonlCache, setRawJsonlCache] = useState<Record<string, DevRawJsonlContent>>({})
  const [pipeline, setPipeline] = useState<PipelineSnapshot | null>(null)
  const [timeline, setTimeline] = useState<TimelineEntry[]>([])
  const [workflow, setWorkflow] = useState<DevWorkflowPayload | null>(null)
  const [whiteboard, setWhiteboard] = useState<DevWhiteboardPayload | null>(null)
  const [showAllProtocol, setShowAllProtocolState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SHOW_ALL_PROTOCOL_KEY) === '1'
    } catch {
      return false
    }
  })
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const setShowAllProtocol = useCallback((value: boolean) => {
    setShowAllProtocolState(value)
    try {
      if (value) localStorage.setItem(SHOW_ALL_PROTOCOL_KEY, '1')
      else localStorage.removeItem(SHOW_ALL_PROTOCOL_KEY)
    } catch {
      // ignore
    }
  }, [])

  const wsClient = getWebSocketClient()

  const refreshSnapshot = useCallback(() => {
    wsClient.send('dev:snapshot', { chatId })
  }, [wsClient, chatId])

  const executeAction = useCallback((action: string, params?: Record<string, unknown>) => {
    wsClient.send('dev:action', { chatId, action, params })
  }, [wsClient, chatId])

  const clearEvents = useCallback(() => {
    setEvents([])
  }, [])

  const requestRawJsonl = useCallback((sessionId: string) => {
    wsClient.send('dev:raw-jsonl', { chatId, sessionId })
  }, [wsClient, chatId])

  useEffect(() => {
    if (!isOpen) return

    wsClient.send('dev:subscribe', { chatId })
    wsClient.send('dev:snapshot', { chatId })
    wsClient.send('dev:pipeline', { chatId })
    wsClient.send('dev:timeline', { chatId })
    wsClient.send('dev:workflow', { chatId })
    wsClient.send('dev:whiteboard', { chatId })

    const handleSnapshot = (data: unknown) => {
      const d = data as DevSnapshot
      if (d.chatId === chatId) setSnapshot(d)
    }

    const handleEvent = (data: unknown) => {
      const d = data as DevEvent
      if (d.chatId === chatId) {
        setEvents((prev) => {
          const next = [d, ...prev]
          return next.length > MAX_EVENTS ? next.slice(0, MAX_EVENTS) : next
        })
      }
    }

    const handleJsonlMessages = (data: unknown) => {
      const d = data as DevJsonlMessagesEvent
      if (d.chatId !== chatId) return

      setJsonlStreams((prev) => {
        if (d.type === 'full') {
          return { ...prev, [d.sessionId]: d.messages }
        }
        const existing = prev[d.sessionId] ?? []
        let updated = existing
        if (d.replacedStatsId) {
          updated = updated.filter((m) => m.id !== d.replacedStatsId)
        }
        return { ...prev, [d.sessionId]: [...updated, ...d.messages] }
      })
    }

    const handleRawJsonlContent = (data: unknown) => {
      const d = data as { chatId: string; sessionId: string; filePath: string | null; fileExists: boolean; content: string; sizeBytes: number }
      if (d.chatId !== chatId) return
      setRawJsonlCache((prev) => ({
        ...prev,
        [d.sessionId]: {
          sessionId: d.sessionId,
          filePath: d.filePath,
          fileExists: d.fileExists,
          content: d.content,
          sizeBytes: d.sizeBytes,
        },
      }))
    }

    const handleChatStatusChanged = (data: unknown) => {
      const d = data as { chatId: string; status: string; missionStatus?: string | null }
      if (d.chatId !== chatId) return
      setSnapshot((prev) => {
        if (!prev) return prev
        const prevChat = prev.chat ?? { status: null, missionStatus: null, expertSessions: null }
        return {
          ...prev,
          chat: {
            ...prevChat,
            status: d.status,
            missionStatus: d.missionStatus ?? prevChat.missionStatus ?? null,
          },
        }
      })
    }

    const handlePipeline = (data: unknown) => {
      const d = data as PipelineSnapshot
      if (d.chatId === chatId) setPipeline(d)
    }

    const handleTimeline = (data: unknown) => {
      const d = data as { chatId: string; entries: TimelineEntry[] }
      if (d.chatId === chatId) setTimeline(d.entries)
    }

    const handleWorkflow = (data: unknown) => {
      const d = data as DevWorkflowPayload
      if (d.chatId === chatId) setWorkflow(d)
    }

    const handleWhiteboard = (data: unknown) => {
      const d = data as DevWhiteboardPayload
      if (d.chatId === chatId) setWhiteboard(d)
    }

    wsClient.on('dev:snapshot', handleSnapshot)
    wsClient.on('dev:event', handleEvent)
    wsClient.on('dev:jsonl-messages', handleJsonlMessages)
    wsClient.on('dev:raw-jsonl-content', handleRawJsonlContent)
    wsClient.on('chat:status-changed', handleChatStatusChanged)
    wsClient.on('dev:pipeline', handlePipeline)
    wsClient.on('dev:timeline', handleTimeline)
    wsClient.on('dev:workflow', handleWorkflow)
    wsClient.on('dev:whiteboard', handleWhiteboard)

    refreshTimerRef.current = setInterval(() => {
      wsClient.send('dev:snapshot', { chatId })
      wsClient.send('dev:pipeline', { chatId })
      wsClient.send('dev:timeline', { chatId })
      wsClient.send('dev:workflow', { chatId })
      wsClient.send('dev:whiteboard', { chatId })
    }, 5000)

    return () => {
      wsClient.send('dev:unsubscribe', { chatId })
      wsClient.off('dev:snapshot', handleSnapshot)
      wsClient.off('dev:event', handleEvent)
      wsClient.off('dev:jsonl-messages', handleJsonlMessages)
      wsClient.off('dev:raw-jsonl-content', handleRawJsonlContent)
      wsClient.off('chat:status-changed', handleChatStatusChanged)
      wsClient.off('dev:pipeline', handlePipeline)
      wsClient.off('dev:timeline', handleTimeline)
      wsClient.off('dev:workflow', handleWorkflow)
      wsClient.off('dev:whiteboard', handleWhiteboard)
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [chatId, isOpen, wsClient])

  const refreshTimeline = useCallback((missionId?: string) => {
    wsClient.send('dev:timeline', { chatId, missionId })
  }, [wsClient, chatId])

  return {
    snapshot,
    events,
    jsonlStreams,
    rawJsonlCache,
    pipeline,
    timeline,
    workflow,
    whiteboard,
    refreshSnapshot,
    executeAction,
    clearEvents,
    requestRawJsonl,
    refreshTimeline,
    showAllProtocol,
    setShowAllProtocol,
  }
}
