/**
 * timelineHelpers — Timeline dispatch tool grouping (legacy expert-dispatcher + handoff)
 */

import type { Message } from '@/types/chat'

export interface TimelineEntry {
  id: string
  type: 'tool' | 'thinking' | 'text' | 'error' | 'stats' | 'image'
  timestamp: number
  toolName?: string
  toolSummary?: string
  toolInput?: string
  toolResultContent?: string
  toolResultIsError?: boolean
  /** tool  toolResult AskUserQuestion  */
  hasToolResult?: boolean
  thinkingText?: string
  textContent?: string
  stats?: Message['stats']
  imagePaths?: string[]
}

export interface ToolGroup {
  type: 'tool-group'
  toolName: string
  entries: TimelineEntry[]
}

export interface ExpertProgressGroup {
  type: 'expert-progress'
  agentId: string
  entries: TimelineEntry[]
  logLines: string[]
  latestStatus: string
  completed: boolean
}

export type RenderItem = TimelineEntry | ToolGroup | ExpertProgressGroup

export const isExpertDispatcherTool = (toolName: string): boolean =>
  toolName.startsWith('mcp__expert-dispatcher__') || toolName.startsWith('mcp__expert_dispatcher__') || toolName.startsWith('mcp__handoff__')

export const getExpertAction = (toolName: string): string | null => {
  if (!isExpertDispatcherTool(toolName)) return null
  return toolName.split('__').pop() || null
}

export const isWaitForExpert = (entry: TimelineEntry): boolean =>
  entry.type === 'tool' && !!entry.toolName && getExpertAction(entry.toolName) === 'wait_for_expert'

const EXPERT_ACTION_LABEL_KEYS: Record<string, string> = {
  wait_for_expert: 'tools.waitExpert',
  start_expert: 'tools.startExpert',
  stop_expert: 'tools.stopExpert',
  send_to_expert: 'tools.sendMessage',
  list_experts: 'tools.listExperts',
  stop_all_experts: 'tools.stopAll',
  check_inbox: 'tools.checkInbox',
}

export const getReadableToolLabel = (toolName: string, t: (key: string, opts?: Record<string, unknown>) => string): string => {
  const expertAction = getExpertAction(toolName)
  if (expertAction) return EXPERT_ACTION_LABEL_KEYS[expertAction] ? t(EXPERT_ACTION_LABEL_KEYS[expertAction]) : expertAction.replace(/_/g, ' ')
  return t(`tools.${toolName}`, { defaultValue: toolName })
}

/* ── wait_for_expert ResultParse ─────────────────────────────── */

export const parseWaitResult = (resultContent: string | undefined): { logLines: string[]; status: string; completed: boolean } => {
  if (!resultContent) return { logLines: [], status: '', completed: false }

  const logLines: string[] = []
  let status = ''
  const completed = resultContent.includes('Completed')

  const statusMatch = resultContent.match(/📊 Live Status\n([\s\S]*?)(?:\n\n|$)/)
  if (statusMatch) {
    status = statusMatch[1].trim()
  }

  const logMatch = resultContent.match(/--- Expert .+ Work Log[\s\S]*?---\n([\s\S]*?)\n--- Log End ---/)
  if (logMatch) {
    logMatch[1].split('\n').forEach((line) => {
      const trimmed = line.trim()
      if (trimmed) logLines.push(trimmed)
    })
  }

  const progressMatch = resultContent.match(/--- Structured Progress ---\n([\s\S]*?)\n--- Progress End ---/)
  if (progressMatch) {
    progressMatch[1].split('\n').forEach((line) => {
      const trimmed = line.trim()
      if (trimmed) logLines.push(trimmed)
    })
  }

  return { logLines, status, completed }
}

const STANDALONE_TOOLS = new Set(['AskUserQuestion', 'TodoWrite'])

export const groupConsecutiveTools = (entries: TimelineEntry[]): RenderItem[] => {
  let lastTodoWriteIdx = -1
  for (let k = entries.length - 1; k >= 0; k--) {
    if (entries[k].type === 'tool' && entries[k].toolName === 'TodoWrite') {
      lastTodoWriteIdx = k
      break
    }
  }

  const result: RenderItem[] = []
  let i = 0

  while (i < entries.length) {
    const entry = entries[i]

    if (isWaitForExpert(entry)) {
      let agentId = ''
      try { agentId = JSON.parse(entry.toolInput || '{}').agentId || '' } catch { /* ignore */ }

      const groupEntries: TimelineEntry[] = [entry]
      const allLogLines: string[] = []
      let latestStatus = ''
      let completed = false
      let j = i + 1

      const { logLines, status, completed: c } = parseWaitResult(entry.toolResultContent)
      allLogLines.push(...logLines)
      if (status) latestStatus = status
      if (c) completed = true

      while (j < entries.length) {
        const next = entries[j]
        if (isWaitForExpert(next)) {
          groupEntries.push(next)
          const parsed = parseWaitResult(next.toolResultContent)
          allLogLines.push(...parsed.logLines)
          if (parsed.status) latestStatus = parsed.status
          if (parsed.completed) completed = true
          j++
        } else if (next.type === 'text' && !completed) {
          groupEntries.push(next)
          j++
        } else {
          break
        }
      }

      const waitCount = groupEntries.filter(isWaitForExpert).length
      if (waitCount >= 2) {
        result.push({
          type: 'expert-progress',
          agentId,
          entries: groupEntries,
          logLines: allLogLines,
          latestStatus,
          completed,
        })
        i = j
        continue
      }
    }

    if (entry.type === 'tool' && entry.toolName && !STANDALONE_TOOLS.has(entry.toolName)) {
      let j = i + 1
      while (j < entries.length && entries[j].type === 'tool' && entries[j].toolName === entry.toolName) {
        j++
      }
      if (j - i >= 3) {
        result.push({ type: 'tool-group', toolName: entry.toolName, entries: entries.slice(i, j) })
        i = j
        continue
      }
    }

    if (entry.type === 'tool' && entry.toolName === 'TodoWrite' && i !== lastTodoWriteIdx) {
      i++
      continue
    }

    result.push(entry)
    i++
  }

  return result
}
