/**
 * WebSocket
 *
 *  WebSocketClient.ts
 *  TypeScript
 */

import type { AgentActivity, Message } from '@/types/chat'

export interface WsReceiveEventMap {
  'reconnected': void
  'disconnected': void
  'connected': void
  'reconnect_failed': void

  'protocol:hello': import('@shared/ws/envelope').ProtocolHello
  'protocol:version-mismatch': import('@shared/ws/envelope').ProtocolVersionMismatch

  // PTY

  'error': { message?: string }

  'expert:structured-message': {
    agentId: string
    sessionId: string
    chatId: string
    type?: 'full' | 'delta'
    messages: Message[]
    replacedStatsId?: string | null
  }

  // Expert Agent
  'expert:activity': { agentId: string; chatId: string; activity: AgentActivity }
  'expert:started': { agentId: string; chatId: string; agentName: string; sessionId: string; agentIcon: string; status: 'running' | 'completed'; exitCode?: number }
  'expert:exit': { agentId: string; chatId: string; exitCode?: number }
  'expert:stopped': { agentId: string; chatId: string; exitCode?: number }
  'expert:data': { agentId: string; chatId: string; sessionId?: string; seq?: number; snapshot?: boolean; data: string; ptySize?: { cols: number; rows: number } }
  'expert:partial-text': { agentId: string; chatId: string; sessionId?: string; blockIndex: number; text: string }
  'expert:resume-failed': { agentId: string; chatId: string; agentName: string; reason: string; sessionId?: string; message?: string }
  'expert:list': { chatId?: string; experts: Array<{ agentId: string; sessionId: string; agentName: string; agentIcon: string; status: 'running' | 'completed'; exitCode?: number; completedAt?: string }> }
  'expert:list-updated': { chatId?: string; experts: Array<{ agentId: string; sessionId: string; agentName: string; agentIcon: string; status: 'running' | 'completed'; exitCode?: number; completedAt?: string }> }
  'expert:already-running': { agentId: string; agentName: string; sessionId: string }
  'expert:start-failed': { agentId: string; chatId: string; exitCode?: number; message?: string }
  'expert:slash-commands': { agentId: string; chatId: string; commands: string[] }

  'expert:plan-update': {
    agentId: string
    chatId: string
    sessionId: string
    plan: { entries: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed'; priority?: 'low' | 'medium' | 'high' }> }
  }
  'expert:mode-change': { agentId: string; chatId: string; sessionId: string; currentModeId: string }
  'expert:commands-update': { agentId: string; chatId: string; sessionId: string; availableCommands: string[] }
  'expert:session-info': { agentId: string; chatId: string; sessionId: string; title?: string; updatedAt?: string }
  'expert:permission-request': {
    agentId: string
    chatId: string
    sessionId: string
    requestId: string
    toolCall: { toolCallId: string; title: string }
    options: Array<{ optionId: string; name: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' }>
  }
  // Chat
  'chat:title-updated': { chatId: string; title: string }
  'chat:meta-updated': { chatId: string; archivedAt: number | null; pinnedAt: number | null }
  'chat:status-changed': { chatId: string; status: string; missionStatus?: string | null }
  'chat:activity': {
    chatId: string
    phase: string
    currentTool?: string
    toolCount: number
    toolCompleted: number
    cost?: number
    logLine?: string
    expertActivities?: Array<{ agentId: string; agentName: string; phase: string; currentTool?: string; toolCount: number; toolCompleted: number; cost?: number }>
    /** Server's actual key for per-agent activity. Prefer over `expertActivities`
     *  (which is a legacy alias the server never populates). */
    agentActivities?: Array<{ agentId: string; agentName: string; phase: string; currentTool?: string; toolCount: number; toolCompleted: number; cost?: number }>
    latestMessage?: { role: 'user' | 'agent' | 'assistant'; text: string; at: number }
  }
  'chat:permission-request': {
    agentId: string
    chatId: string
    sessionId: string
    requestId: string
    toolCall: { toolCallId: string; title: string; rawInput?: unknown }
    options: Array<{ optionId: string; name: string; kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always' }>
  }
  /** sidebar  Tab  PermissionModal  */
  'chat:permission-resolved': { chatId: string; requestId: string }

  // Whiteboard（chat War room）
  'whiteboard:entry-added': {
    chatId: string
    entry: import('../../shared/whiteboard-types').WhiteboardEntry
    supersededId?: string
  }
  'whiteboard:entry-archived': { chatId: string; entryId: string; archivedCount: number }

  // Notification
  'notification:init': { unreadCount: number }
  'notification:new': { id: string; title: string; body: string; read: boolean; createdAt: string; [key: string]: unknown }
  'notification:read': { id: string }
  'notification:read-all': void

  'session:file-operation': {
    sessionId: string
    chatId: string
    agentId?: string
    operations: Array<{
      timestamp: number
      agentId: string
      tool: string
      filePath: string
      operation: 'create' | 'edit' | 'delete' | 'read'
    }>
  }

  'semantic-log': {
    chatId: string
    entry: {
      id: string
      timestamp: number
      agentId: string
      agentName: string
      personality?: { nickname: string; emoji: string; animal: string; tone: string; verbosity: string; persona: string }
      type: 'status' | 'milestone' | 'question' | 'completion' | 'error'
      message: string
      rawEvent?: string
    }
  }

  // Sensei CapabilitiesUpgrade
  'sensei:progress': { agentId: string; text: string; logType?: 'stage' | 'content' | 'verbose' }
  'sensei:complete': { agentId: string; original: string; optimized: string }
  'sensei:error': { agentId: string; error: string }

  // Cron
  'cron:job-started': { jobId: string; [key: string]: unknown }
  'cron:job-finished': { jobId: string; [key: string]: unknown }

  // Dev Panel
  'dev:snapshot': { chatId: string; timestamp: number; chat: unknown; sessions: unknown[]; totalSessions: number }
  'dev:event': { chatId: string; timestamp: number; type: string; agentId?: string; sessionId?: string; data?: Record<string, unknown> }
  'dev:action-result': { chatId: string; action: string; success: boolean; message?: string }

  // System
  'system:env-check': { npmAvailable: boolean; envCheckStatus?: string }
  'system:preflight': {
    timestamp: number
    overall: 'pass' | 'warn' | 'fail'
    items: Array<{
      id: string
      label: string
      status: 'pass' | 'warn' | 'fail'
      current?: string
      required?: string
      hint?: string
      fixCommand?: string
      fixUrl?: string
    }>
  }

  'shell:created': { shellId: string; cwd: string }
  'shell:output': { shellId: string; data: string }
  'shell:exit': { shellId: string; exitCode: number }

  'git:changes': import('../../shared/ws/git').GitChangesEventPayload
  'git:tree-changed': { chatId: string; path: string }

  // External session scanner (~/.claude, ~/.codex jsonl adoption)
  'external-dirs:ready': { scannedFiles: number; cachedHits: number; durationMs: number; dirCount: number }
  'external-dirs:changed': { providers: Array<'claude' | 'codex'>; dirCount: number; durationMs: number }

  '*': { type: string; payload: unknown }
}

export interface WsSendEventMap {
  'chat:set-context': { chatId: string | undefined }
  'chat:resume-experts': { chatId: string | undefined }
  'expert:direct-input': { chatId: string; agentId: string; message: string; images?: Array<{ data: string; mediaType: string }>; autoStart?: boolean; cwd?: string; cols?: number; rows?: number }
  'expert:input': { chatId: string; agentId: string; data: string }
  'expert:stop': { chatId: string; agentId: string }
  'expert:resize': { chatId: string; agentId: string; cols: number; rows: number }
  'expert:list': { chatId: string | undefined }
  'expert:clear-completed': { chatId: string | undefined }
  'sensei:upgrade': { agentId: string; markdown: string }
  'sensei:cancel': { agentId: string }
  'sensei:generate': { agentId: string; description: string }
  'telemetry:track': { category: string; event: string; properties?: Record<string, unknown> }
  'dev:subscribe': { chatId: string }
  'dev:unsubscribe': { chatId: string }
  'dev:snapshot': { chatId: string }
  'dev:action': { chatId: string; action: string; params?: Record<string, unknown> }
  'shell:create': { cwd: string; cols?: number; rows?: number }
  'shell:input': { shellId: string; data: string }
  'shell:resize': { shellId: string; cols: number; rows: number }
  'shell:destroy': { shellId: string }
  'expert:permission-response': {
    agentId: string
    chatId: string
    sessionId: string
    requestId: string
    outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' }
  }
  /** sidebar  chatId + text chat  waiting_input  agent */
  'expert:user-input': { chatId: string; text: string }
  'git:subscribe': { chatId: string; path: string }
  'git:unsubscribe': { chatId: string; path: string }
}
