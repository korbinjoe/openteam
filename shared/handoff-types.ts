export interface HandoffRequest {
  from: string
  to: string
  chatId: string
  reason?: string
  task: string
  context: HandoffContext
}

export interface HandoffContext {
  originalUserMessage?: string
  workDoneSoFar?: string
  relevantFiles?: string[]
  keyFindings?: string[]
  conversationSummary?: string
}

export interface HandoffResult {
  status: 'ok' | 'error'
  targetSessionId?: string
  reason?: string
}
