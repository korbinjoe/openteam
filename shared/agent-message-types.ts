/**
 * Agent  —
 *
 *  docs/agent-communication-protocol.md  Layer 2 Layer 3
 *  server/  web/
 */

// ── Message ID Generate ──

export const generateMessageId = (): string => {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 6)
  return `${ts}-${rand}`
}

export const generateTaskId = (): string => {
  const ts = Date.now()
  const rand = Math.random().toString(36).slice(2, 6)
  return `task-${ts}-${rand}`
}

export const wrapTaskEnvelope = (agentId: string, task: string): TaskEnvelope => ({
  taskId: generateTaskId(),
  agentId,
  description: task,
  priority: 'p1',
})

export interface AgentMessageBase {
  id: string
  timestamp: string
  /**  IDinstanceId fullstack-engineer#2 */
  from: string
  to: string
  chatId: string
  taskId?: string
  replyTo?: string
  /**
   *  instanceId
   * ['lead', 'fullstack-engineer#1', 'code-reviewer']
   */
  dispatchChain?: string[]
  protocolVersion: '1.0'
}

/**
 * Discriminated union —  type  payload
 *  type
 */
export type AgentMessage =
  | AgentMessageBase & { type: 'task:assign'; payload: TaskEnvelope }
  /** @deprecated Mailbox-era type — no longer written. Use SSE events + team-status instead. */
  | AgentMessageBase & { type: 'task:accepted'; payload: { taskId: string } }
  /** @deprecated Mailbox-era type — no longer written. Use team-status for progress queries. */
  | AgentMessageBase & { type: 'task:progress'; payload: ProgressReport }
  /** @deprecated Mailbox-era type — no longer written. Use team-status for progress queries. */
  | AgentMessageBase & { type: 'task:milestone'; payload: { taskId: string; milestone: string; percent: number } }
  | AgentMessageBase & { type: 'task:blocked'; payload: { taskId: string; reason: string } }
  | AgentMessageBase & { type: 'task:input_required'; payload: { taskId: string; question: string } }
  /** @deprecated Mailbox-era type — no longer written. */
  | AgentMessageBase & { type: 'task:idle'; payload: { taskId: string; summary: string } }
  /** @deprecated Mailbox-era type — no longer written. */
  | AgentMessageBase & { type: 'task:rejected'; payload: { taskId: string; reason: string } }
  | AgentMessageBase & { type: 'task:completed'; payload: TaskResult }
  | AgentMessageBase & { type: 'task:failed'; payload: TaskResult }
  /** @deprecated Mailbox-era type — no longer written. Use Handoff API instead. */
  | AgentMessageBase & { type: 'task:delegated'; payload: { taskId: string; subTaskId: string; executor: string } }
  /** @deprecated Mailbox-era type — no longer written. */
  | AgentMessageBase & { type: 'query'; payload: { question: string; timeoutMs?: number } }
  /** @deprecated Mailbox-era type — no longer written. */
  | AgentMessageBase & { type: 'response'; payload: { answer: string } }
  | AgentMessageBase & { type: 'handoff'; payload: HandoffPayload }
  | AgentMessageBase & { type: 'artifact'; payload: { path: string; description: string } }

export type AgentMessageType = AgentMessage['type']

// ── 3.1 TaskEnvelope ──

export interface TaskEnvelope {
  taskId: string
  parentTaskId?: string
  agentId: string
  instanceSuffix?: string
  description: string
  inputs?: TaskInputs
  expectedOutputs?: TaskExpectedOutputs
  priority?: 'p0' | 'p1' | 'p2'
  estimatedMinutes?: number
}

export interface TaskInputs {
  files?: string[]
  context?: string
  dependencies?: Array<{
    taskId: string
    artifactPath: string
  }>
}

export interface TaskExpectedOutputs {
  type: 'code' | 'document' | 'review' | 'design' | 'image'
  path?: string
  acceptanceCriteria?: string[]
}

// ── 3.2 ProgressReport ──

export interface ProgressReport {
  taskId: string
  percent: number
  phase: string
  justCompleted?: string
  status: 'working' | 'blocked' | 'input_required' | 'completed' | 'failed' | 'rejected'
  newBlocker?: string
  newArtifact?: { path: string; description: string }
  delegatedUpdate?: {
    taskId: string
    executor: string
    status: string
    percent?: number
  }
}

// ── 3.3 TaskResult ──

export interface TaskResult {
  taskId: string
  parentTaskId?: string
  executor: string
  status: 'completed' | 'partial' | 'failed'
  summary: string
  artifacts: Array<{
    path: string
    type: 'created' | 'modified' | 'deleted'
    description: string
  }>
  modifiedFiles: Array<{
    path: string
    changeType: 'create' | 'edit' | 'delete'
    linesAdded: number
    linesRemoved: number
  }>
  impactAnalysis?: {
    affectedModules: string[]
    riskAreas: string[]
    testCoverage: string
  }
  delegatedResults?: Array<{
    taskId: string
    executor: string
    status: 'completed' | 'partial' | 'failed'
    summary: string
  }>
  followUp?: string[]
  failureReason?: string
}

// ── 3.4 HandoffPayload ──

export interface HandoffPayload {
  description: string
  artifacts: Array<{
    path: string
    description: string
  }>
  context: string
  caveats?: string[]
  sourceTaskId?: string
}

export const mailboxFileName = (from: string, to: string): string =>
  `${from}→${to}.jsonl`

export const createAgentMessage = <T extends AgentMessage['type']>(
  type: T,
  fields: {
    from: string
    to: string
    chatId: string
    taskId?: string
    replyTo?: string
    dispatchChain?: string[]
    payload: Extract<AgentMessage, { type: T }>['payload']
  },
): Extract<AgentMessage, { type: T }> => {
  return {
    id: generateMessageId(),
    timestamp: new Date().toISOString(),
    protocolVersion: '1.0' as const,
    type,
    ...fields,
  } as unknown as Extract<AgentMessage, { type: T }>
}

export const parseMailboxFileName = (fileName: string): { from: string, to: string } | null => {
  const base = fileName.replace(/\.jsonl$/, '')
  const sepIdx = base.indexOf('→')
  if (sepIdx < 0) return null
  return { from: base.slice(0, sepIdx), to: base.slice(sepIdx + '→'.length) }
}

const encodeLogfmtValue = (v: unknown): string => {
  if (v === undefined || v === null) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (s === '') return '""'
  if (/[\s"=]/.test(s)) return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  return s
}

const isEmptyValue = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || v === 0 ||
  (Array.isArray(v) && v.length === 0)

/**
 *  AgentMessage  logfmt
 *  from/to/chatId/timestamp/protocolVersion
 * payload payload.taskId
 */
export const serializeLogfmt = (msg: AgentMessage): string => {
  const parts: string[] = [`id=${msg.id}`, `type=${msg.type}`]
  if (msg.taskId) parts.push(`taskId=${encodeLogfmtValue(msg.taskId)}`)
  if (msg.replyTo) parts.push(`replyTo=${msg.replyTo}`)
  if (msg.dispatchChain?.length) parts.push(`dc=${encodeLogfmtValue(msg.dispatchChain.join(','))}`)

  const payload = (msg as AgentMessage & { payload: Record<string, unknown> }).payload
  if (payload) {
    for (const [k, v] of Object.entries(payload)) {
      if (k === 'taskId') continue
      if (isEmptyValue(v)) continue
      if (typeof v === 'object' && v !== null) {
        parts.push(`${k}=${encodeLogfmtValue(JSON.stringify(v))}`)
      } else {
        parts.push(`${k}=${encodeLogfmtValue(v)}`)
      }
    }
  }
  return parts.join(' ')
}

const decodeLogfmtValue = (raw: string): string => {
  if (raw.startsWith('"') && raw.endsWith('"')) {
    return raw.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  }
  return raw
}

const parseLogfmt = (line: string): Record<string, string> => {
  const result: Record<string, string> = {}
  const re = /(\w+)=((?:"(?:[^"\\]|\\.)*")|(?:\S+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    result[m[1]] = decodeLogfmtValue(m[2])
  }
  return result
}

/**
 *  AgentMessage
 * {  JSON logfmt
 */
export const deserializeMailboxLine = (
  line: string, from: string, to: string, chatId: string,
): AgentMessage | null => {
  const trimmed = line.trim()
  if (!trimmed) return null

  if (trimmed.startsWith('{')) {
    try { return JSON.parse(trimmed) as AgentMessage } catch { return null }
  }

  try {
    const kv = parseLogfmt(trimmed)
    if (!kv.id || !kv.type) return null

    const timestamp = new Date(parseInt(kv.id.split('-')[0], 10)).toISOString()
    const { id, type, taskId, replyTo, dc, ...payloadFields } = kv

    if (taskId) payloadFields.taskId = taskId

    for (const [k, v] of Object.entries(payloadFields)) {
      if (v.startsWith('[') || v.startsWith('{')) {
        try { (payloadFields as Record<string, unknown>)[k] = JSON.parse(v) } catch { /* keep string */ }
      }
    }

    return {
      id, timestamp, protocolVersion: '1.0',
      type: type as AgentMessage['type'],
      from, to, chatId, taskId, replyTo,
      dispatchChain: dc ? dc.split(',') : undefined,
      payload: payloadFields,
    } as unknown as AgentMessage
  } catch { return null }
}
