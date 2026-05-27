import type { ExpertPermissionRequestPayload } from './permission'

export interface ChatStatusChangedPayload {
  chatId: string
  status: string
}

export interface AgentActivitySnapshot {
  agentId: string
  agentName: string
  phase: string
  currentTool?: string
  toolCount: number
  toolCompleted: number
  cost?: number
}

export interface ChatLatestMessage {
  role: 'user' | 'agent' | 'assistant'
  text: string
  at: number
}

export interface ChatActivityPayload {
  chatId: string
  phase: string
  currentTool?: string
  toolCount: number
  toolCompleted: number
  cost?: number
  logLine?: string
  exitReason?: 'user_stop' | 'timeout' | 'model_switch'
  agentActivities?: AgentActivitySnapshot[]
  latestMessage?: ChatLatestMessage
}

export type ChatPermissionRequestPayload = ExpertPermissionRequestPayload

export interface ChatPermissionResolvedPayload {
  chatId: string
  requestId: string
}

export interface ExpertUserInputPayload {
  chatId: string
  text: string
}
