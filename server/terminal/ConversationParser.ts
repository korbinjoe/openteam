/**
 * ConversationParser - JSONL
 *
 * Claude Code CLI  ~/.claude/projects/<project>/<uuid>.jsonl
 *  JSON  typemessageuuidtimestamp
 *
 *  JSONL
 *
 * - (turn)  user text →  agent  turn
 * -  turn  stats turn
 * - toolUse  toolResult  toolId/toolUseId
 * -  API call  apiCallId
 * - ID + →  ID
 * - ParserState
 */

import { readFileSync, existsSync } from 'fs'
import { createLogger } from '../lib/logger'

const log = createLogger('ConversationParser')

export interface ParsedToolUse {
  toolName: string
  toolId: string
  input: string
  status: 'completed'
}

export interface ParsedToolResult {
  toolUseId: string
  content: string
  isError?: boolean
}

export interface ParsedStats {
  costUsd?: number
  durationMs?: number
  inputTokens?: number
  outputTokens?: number
  cacheReadInputTokens?: number
  cacheCreationInputTokens?: number
  numTurns?: number
}

export interface ParsedMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  timestamp: number
  type: 'text' | 'toolUse' | 'toolResult' | 'thinking' | 'stats'
  toolUse?: ParsedToolUse
  toolResult?: ParsedToolResult
  stats?: ParsedStats
  thinkingSummary?: string
  model?: string
  jsonlUuid?: string
  turnIndex?: number
  apiCallId?: string
  images?: Array<{ data: string; mediaType: string }>
  /** stop_reason === 'end_turn' stats  */
  isTurnEnd?: boolean
}

export interface ParserState {
  turnIndex: number
  turnUsage: Map<number, { input: number; output: number; cacheRead: number; cacheCreation: number }>
  turnModel: Map<number, string>
  turnFirstTs: Map<number, number>
  turnLastTs: Map<number, number>
  turnLastUuid: Map<number, string>
  turnEnded: Set<number>
  messages: ParsedMessage[]
  linesProcessed: number
}

export function createParserState(): ParserState {
  return {
    turnIndex: -1,
    turnUsage: new Map(),
    turnModel: new Map(),
    turnFirstTs: new Map(),
    turnLastTs: new Map(),
    turnLastUuid: new Map(),
    turnEnded: new Set(),
    messages: [],
    linesProcessed: 0,
  }
}

const stableId = (lineIndex: number, blockIndex: number) =>
  `msg-${lineIndex}-${blockIndex}`

/**
 *  state
 * @param lines  startLine
 * @param startLine
 * @param state
 */
export function parseNewLines(
  lines: string[],
  startLine: number,
  state: ParserState,
): { newMessages: ParsedMessage[]; replacedStatsId: string | null } {
  const rawMessages: ParsedMessage[] = []

  let { turnIndex } = state

  for (let i = startLine; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue

    let entry: any
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }

    const entryType = entry.type as string

    if (entryType === 'last-prompt' && turnIndex >= 0) {
      state.turnEnded.add(turnIndex)
      state.turnLastTs.set(turnIndex, entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now())
      continue
    }

    if (!entryType || !['user', 'assistant'].includes(entryType)) continue

    const ts = entry.timestamp ? new Date(entry.timestamp).getTime() : Date.now()
    const uuid = entry.uuid as string | undefined
    let blockIndex = 0

    if (entryType === 'user') {
      const content = entry.message?.content
      if (!content) continue

      if (typeof content === 'string') {
        turnIndex++
        rawMessages.push({
          id: stableId(i, blockIndex++),
          role: 'user',
          content,
          timestamp: ts,
          type: 'text',
          jsonlUuid: uuid,
          turnIndex,
        })
      } else if (Array.isArray(content)) {
        const imageBlocks: Array<{ data: string; mediaType: string }> = []
        for (const block of content) {
          if (block.type === 'image' && block.source?.data) {
            imageBlocks.push({ data: block.source.data, mediaType: block.source.media_type || 'image/png' })
          }
        }

        for (const block of content) {
          if (block.type === 'text' && block.text) {
            turnIndex++
            rawMessages.push({
              id: stableId(i, blockIndex++),
              role: 'user',
              content: block.text,
              timestamp: ts,
              type: 'text',
              jsonlUuid: uuid,
              turnIndex,
              images: imageBlocks.length > 0 ? imageBlocks : undefined,
            })
          } else if (block.type === 'tool_result') {
            const resultContent = typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text || '').join('\n')
                : JSON.stringify(block.content)

            rawMessages.push({
              id: stableId(i, blockIndex++),
              role: 'agent',
              content: '',
              timestamp: ts,
              type: 'toolResult',
              toolResult: {
                toolUseId: block.tool_use_id || '',
                content: resultContent.length > 2000
                  ? resultContent.slice(0, 2000) + '…'
                  : resultContent,
                isError: block.is_error === true,
              },
              jsonlUuid: uuid,
              turnIndex: Math.max(turnIndex, 0),
            })
          }
        }
      }
      continue
    }

    if (entryType === 'assistant') {
      const msg = entry.message
      if (!msg) continue

      const blocks = Array.isArray(msg.content)
        ? msg.content
        : typeof msg.content === 'string' && msg.content
          ? [{ type: 'text', text: msg.content }]
          : []
      const model = msg.model as string | undefined
      const apiCallId = msg.id as string | undefined
      const currentTurn = Math.max(turnIndex, 0)

      if (msg.usage) {
        const u = msg.usage
        const existing = state.turnUsage.get(currentTurn)
        if (existing) {
          existing.input = Math.max(existing.input, u.input_tokens || 0)
          existing.output += (u.output_tokens || 0)
          existing.cacheRead = Math.max(existing.cacheRead, u.cache_read_input_tokens || 0)
          existing.cacheCreation = Math.max(existing.cacheCreation, u.cache_creation_input_tokens || 0)
        } else {
          state.turnUsage.set(currentTurn, {
            input: u.input_tokens || 0,
            output: u.output_tokens || 0,
            cacheRead: u.cache_read_input_tokens || 0,
            cacheCreation: u.cache_creation_input_tokens || 0,
          })
        }
      }

      if (model) state.turnModel.set(currentTurn, model)
      if (!state.turnFirstTs.has(currentTurn)) state.turnFirstTs.set(currentTurn, ts)
      state.turnLastTs.set(currentTurn, ts)
      if (uuid) state.turnLastUuid.set(currentTurn, uuid)

      if (msg.stop_reason === 'end_turn' || msg.stop_reason === 'stop') {
        state.turnEnded.add(currentTurn)
      }

      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          rawMessages.push({
            id: stableId(i, blockIndex++),
            role: 'agent',
            content: block.text,
            timestamp: ts,
            type: 'text',
            model,
            jsonlUuid: uuid,
            turnIndex: currentTurn,
            apiCallId,
          })
        } else if (block.type === 'tool_use') {
          const inputStr = typeof block.input === 'string'
            ? block.input
            : JSON.stringify(block.input)

          rawMessages.push({
            id: stableId(i, blockIndex++),
            role: 'agent',
            content: '',
            timestamp: ts,
            type: 'toolUse',
            toolUse: {
              toolName: block.name || 'unknown',
              toolId: block.id || stableId(i, blockIndex),
              input: inputStr,
              status: 'completed',
            },
            model,
            jsonlUuid: uuid,
            turnIndex: currentTurn,
            apiCallId,
          })
        } else if (block.type === 'thinking' && block.thinking) {
          const thinking = block.thinking as string
          rawMessages.push({
            id: stableId(i, blockIndex++),
            role: 'agent',
            content: '',
            timestamp: ts,
            type: 'thinking',
            thinkingSummary: thinking.length > 200
              ? thinking.slice(0, 200) + '…'
              : thinking,
            model,
            jsonlUuid: uuid,
            turnIndex: currentTurn,
            apiCallId,
          })
        }
      }
    }
  }

  state.turnIndex = turnIndex
  state.linesProcessed = lines.length

  const reordered: ParsedMessage[] = []
  const toolResultMap = new Map<string, ParsedMessage>()
  const usedToolResults = new Set<string>()

  for (const msg of rawMessages) {
    if (msg.type === 'toolResult' && msg.toolResult) {
      toolResultMap.set(msg.toolResult.toolUseId, msg)
    }
  }

  for (const msg of rawMessages) {
    if (msg.type === 'toolResult') continue

    reordered.push(msg)

    if (msg.type === 'toolUse' && msg.toolUse) {
      const tr = toolResultMap.get(msg.toolUse.toolId)
      if (tr) {
        reordered.push(tr)
        usedToolResults.add(msg.toolUse.toolId)
      }
    }
  }

  for (const msg of rawMessages) {
    if (msg.type === 'toolResult' && msg.toolResult && !usedToolResults.has(msg.toolResult.toolUseId)) {
      reordered.push(msg)
    }
  }

  let replacedStatsId: string | null = null
  if (state.messages.length > 0 && reordered.length > 0) {
    const lastPrev = state.messages[state.messages.length - 1]
    if (lastPrev.type === 'stats') {
      const firstNewTurn = reordered[0].turnIndex ?? 0
      if (lastPrev.turnIndex === firstNewTurn) {
        state.messages.pop()
        replacedStatsId = lastPrev.id
      }
    }
  }

  const newMessages: ParsedMessage[] = []
  for (let i = 0; i < reordered.length; i++) {
    const msg = reordered[i]
    const nextMsg = reordered[i + 1]
    newMessages.push(msg)

    const currentTurn = msg.turnIndex ?? 0
    const isLastInTurn = !nextMsg || (nextMsg.turnIndex ?? 0) !== currentTurn

    if (isLastInTurn && (state.turnUsage.has(currentTurn) || state.turnEnded.has(currentTurn))) {
      const usage = state.turnUsage.get(currentTurn)
      const firstTs = state.turnFirstTs.get(currentTurn)
      const lastTs = state.turnLastTs.get(currentTurn) || msg.timestamp
      const durationMs = firstTs && lastTs > firstTs ? lastTs - firstTs : undefined
      newMessages.push({
        id: `stats-${currentTurn}`,
        role: 'agent',
        content: '',
        timestamp: lastTs,
        type: 'stats',
        stats: usage ? {
          durationMs,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cacheReadInputTokens: usage.cacheRead,
          cacheCreationInputTokens: usage.cacheCreation,
        } : undefined,
        model: state.turnModel.get(currentTurn),
        jsonlUuid: state.turnLastUuid.get(currentTurn),
        turnIndex: currentTurn,
        isTurnEnd: state.turnEnded.has(currentTurn),
      })
    }
  }

  return { newMessages, replacedStatsId }
}

interface ParseResult {
  messages: ParsedMessage[]
  linesProcessed: number
}

export function parseConversationLines(lines: string[], startLine = 0): ParseResult {
  const state = createParserState()
  const { newMessages } = parseNewLines(lines, startLine, state)
  state.messages.push(...newMessages)
  return { messages: state.messages, linesProcessed: lines.length }
}

export function parseConversationFile(filePath: string): ParsedMessage[] {
  if (!existsSync(filePath)) return []

  try {
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split('\n')
    return parseConversationLines(lines).messages
  } catch (err) {
    log.error('Failed to parse file', { filePath, error: err instanceof Error ? err.message : String(err) })
    return []
  }
}
