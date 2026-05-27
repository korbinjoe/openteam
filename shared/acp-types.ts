/**
 * ACP (Agent Client Protocol)  —
 *
 *  JSON-RPC 2.0  OpenTeam  AI Agent
 * v5:  agentclientprotocol.com  spec2026-04
 *   - P0-1tool_call_update / plan / modeId / AvailableCommand[]
 *   - P0-2agentCapabilities promptCapabilities / mcpCapabilities / sessionCapabilities
 *   - P0-3mcpServers  + McpServer
 *   - P1-1ContentBlock  5 text/image/audio/resource/resource_link
 *   - P1-2ToolCallContent  diff/terminal
 *
 * https://agentclientprotocol.com/
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: JsonRpcError
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: Record<string, unknown>
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification

export interface ACPClientCapabilities {
  fs?: {
    readTextFile?: boolean
    writeTextFile?: boolean
  }
  terminal?: boolean
  _meta?: Record<string, unknown>
}

export interface ACPPromptCapabilities {
  image?: boolean
  audio?: boolean
  embeddedContext?: boolean
  _meta?: Record<string, unknown>
}

export interface ACPMcpCapabilities {
  http?: boolean
  sse?: boolean
  _meta?: Record<string, unknown>
}

export interface ACPSessionCapabilities {
  list?: boolean
  _meta?: Record<string, unknown>
}

export interface ACPAgentCapabilities {
  loadSession?: boolean
  promptCapabilities?: ACPPromptCapabilities
  mcpCapabilities?: ACPMcpCapabilities
  sessionCapabilities?: ACPSessionCapabilities
  _meta?: Record<string, unknown>
}

export interface ACPClientInfo {
  name: string
  title?: string
  version: string
}

export interface ACPAgentInfo {
  name: string
  title?: string
  version: string
}

export interface ACPAuthMethod {
  id: string
  name: string
  description?: string
  _meta?: Record<string, unknown>
}

/** initialize */
export interface InitializeParams {
  protocolVersion: number
  clientCapabilities: ACPClientCapabilities
  clientInfo: ACPClientInfo
}

export interface InitializeResult {
  protocolVersion: number
  agentCapabilities: ACPAgentCapabilities
  agentInfo: ACPAgentInfo
  authMethods?: ACPAuthMethod[]
}

/** McpServer —  spec  stdio/http/sse  transport */
export type McpServer =
  | {
      name: string
      transport?: 'stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
    }
  | {
      name: string
      transport: 'http' | 'sse'
      url: string
      headers?: Array<{ name: string; value: string }>
    }

/** session/new — mcpServers  spec  */
export interface SessionNewParams {
  cwd: string
  mcpServers?: McpServer[]
  _meta?: Record<string, unknown>
}

export interface SessionNewResult {
  sessionId: string
  _meta?: Record<string, unknown>
}

/** session/load */
export interface SessionLoadParams {
  sessionId: string
  cwd?: string
  mcpServers?: McpServer[]
  _meta?: Record<string, unknown>
}

/** session/load  null —  session/update replay */
export type SessionLoadResult = null

/** session/prompt — prompt  spec content */
export interface SessionPromptParams {
  sessionId: string
  prompt: ACPContentBlock[]
  _meta?: Record<string, unknown>
}

export type StopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled'

export interface SessionPromptResult {
  stopReason: StopReason
  usage?: ACPUsage
  _meta?: Record<string, unknown>
}

/** session/cancel (notification) */
export interface SessionCancelParams {
  sessionId: string
  _meta?: Record<string, unknown>
}

/** session/set_mode */
export interface SessionSetModeParams {
  sessionId: string
  modeId: string
  _meta?: Record<string, unknown>
}

export interface ACPAnnotations {
  audience?: Array<'user' | 'assistant'>
  priority?: number
  _meta?: Record<string, unknown>
}

export interface ACPEmbeddedResource {
  uri: string
  mimeType?: string
  text?: string
  blob?: string
  _meta?: Record<string, unknown>
}

export interface ACPTextContent {
  type: 'text'
  text: string
  annotations?: ACPAnnotations
  _meta?: Record<string, unknown>
}

/** mimeType  spec mediaType */
export interface ACPImageContent {
  type: 'image'
  data: string
  mimeType: string
  uri?: string
  annotations?: ACPAnnotations
  _meta?: Record<string, unknown>
}

export interface ACPAudioContent {
  type: 'audio'
  data: string
  mimeType: string
  annotations?: ACPAnnotations
  _meta?: Record<string, unknown>
}

export interface ACPResourceContent {
  type: 'resource'
  resource: ACPEmbeddedResource
  annotations?: ACPAnnotations
  _meta?: Record<string, unknown>
}

export interface ACPResourceLinkContent {
  type: 'resource_link'
  uri: string
  name: string
  mimeType?: string
  description?: string
  size?: number
  title?: string
  annotations?: ACPAnnotations
  _meta?: Record<string, unknown>
}

export type ACPContentBlock =
  | ACPTextContent
  | ACPImageContent
  | ACPAudioContent
  | ACPResourceContent
  | ACPResourceLinkContent

// ── ACP Message ──

export interface ACPMessage {
  role: 'user' | 'agent' | 'system'
  content: ACPContentBlock[]
}

export type ToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled'
export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'other'

/** ToolCallContent content / diff / terminal */
export type ACPToolCallContent =
  | { type: 'content'; content: ACPContentBlock }
  | { type: 'diff'; path: string; oldText: string | null; newText: string }
  | { type: 'terminal'; terminalId: string }

export interface ACPToolCallLocation {
  path: string
  line?: number
}

export interface ACPToolCall {
  toolCallId: string
  title: string
  kind?: ToolKind
  status: ToolCallStatus
  content?: ACPToolCallContent[]
  locations?: ACPToolCallLocation[]
  rawInput?: unknown
  rawOutput?: unknown
  _meta?: Record<string, unknown>
}

/** ToolCallUpdate —  ToolResult toolCallId  */
export interface ACPToolCallUpdate {
  toolCallId: string
  title?: string
  kind?: ToolKind
  status?: ToolCallStatus
  content?: ACPToolCallContent[]
  locations?: ACPToolCallLocation[]
  rawInput?: unknown
  rawOutput?: unknown
  _meta?: Record<string, unknown>
}

export interface ACPPlanEntry {
  content: string
  priority?: 'high' | 'medium' | 'low'
  status: 'pending' | 'in_progress' | 'completed'
  _meta?: Record<string, unknown>
}

export interface ACPPlan {
  entries: ACPPlanEntry[]
}

export interface ACPAvailableCommand {
  name: string
  description: string
  input?: { hint: string }
  _meta?: Record<string, unknown>
}

export interface ACPConfigOption {
  category: string
  optionId: string
  name: string
  description?: string
  selected?: boolean
  _meta?: Record<string, unknown>
}

// ── ACP Usage ──

export interface ACPUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheCreationTokens?: number
  costUsd?: number
}

export type ACPSessionUpdateType =
  | { sessionUpdate: 'user_message_chunk'; content: ACPContentBlock }
  | { sessionUpdate: 'agent_message_chunk'; content: ACPContentBlock }
  | { sessionUpdate: 'agent_thought_chunk'; content: ACPContentBlock }
  | { sessionUpdate: 'tool_call'; toolCall: ACPToolCall }
  | { sessionUpdate: 'tool_call_update'; toolCallUpdate: ACPToolCallUpdate }
  | { sessionUpdate: 'plan'; entries: ACPPlanEntry[] }
  | { sessionUpdate: 'available_commands_update'; availableCommands: ACPAvailableCommand[] }
  | { sessionUpdate: 'current_mode_update'; modeId: string }
  | { sessionUpdate: 'config_option_update'; configOptions: ACPConfigOption[] }
  | { sessionUpdate: 'session_info_update'; title?: string; updatedAt?: string }

export interface OpenTeamParsedMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: number
  type: 'text' | 'toolUse' | 'toolResult' | 'thinking' | 'stats'
  toolUse?: { toolName: string; toolId: string; input: string; status: string }
  toolResult?: { toolUseId: string; content: string; isError?: boolean }
  stats?: { costUsd?: number; inputTokens?: number; outputTokens?: number; cacheReadInputTokens?: number; cacheCreationInputTokens?: number; numTurns?: number }
  thinkingSummary?: string
  model?: string
  jsonlUuid?: string
  turnIndex?: number
  apiCallId?: string
  images?: Array<{ data: string; mediaType: string }>
  isTurnEnd?: boolean
}

export type OpenTeamSessionUpdateType =
  | { sessionUpdate: '_openteam/activity'; activity: Record<string, unknown> }
  | { sessionUpdate: '_openteam/cli_init'; slashCommands: string[]; model?: string }
  | { sessionUpdate: '_openteam/thinking'; text: string; thinkingSummary?: string }
  | { sessionUpdate: '_openteam/messages_batch'; messages: OpenTeamParsedMessage[]; replacedStatsId: string | null; batchType?: 'full' | 'delta' }

export type SessionUpdateType = ACPSessionUpdateType | OpenTeamSessionUpdateType

export interface ACPSessionUpdateParams {
  sessionId: string
  update: SessionUpdateType
  _meta?: Record<string, unknown>
}

export interface ACPPermissionOption {
  optionId: string
  name: string
  kind: 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always'
}

export interface ACPRequestPermissionParams {
  sessionId: string
  toolCall: { toolCallId: string; title: string; rawInput?: unknown }
  options: ACPPermissionOption[]
  _meta?: Record<string, unknown>
}

export interface ACPRequestPermissionResult {
  outcome: { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' }
  _meta?: Record<string, unknown>
}

export const isJsonRpcRequest = (msg: JsonRpcMessage): msg is JsonRpcRequest =>
  'id' in msg && 'method' in msg

export const isJsonRpcNotification = (msg: JsonRpcMessage): msg is JsonRpcNotification =>
  !('id' in msg) && 'method' in msg

export const isJsonRpcResponse = (msg: JsonRpcMessage): msg is JsonRpcResponse =>
  'id' in msg && !('method' in msg)

export const jsonRpcSuccess = (id: number | string, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
})

export const jsonRpcError = (id: number | string, code: number, message: string, data?: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, data },
})

export const RPC_ERROR = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  SESSION_NOT_FOUND: -32001,
  AGENT_NOT_READY: -32002,
} as const
