/**
 * WhiteboardChat  —
 *
 *  Agent  chat  Agent
 *  ContextBriefing  Agent
 *  Agent
 *
 *  - JSONL  mailbox / SessionFileWatcher
 *  -  entry  summary  ≤120
 *  -  SQLite DB  +  goal
 */

export type WhiteboardEntryType =
  | 'goal'
  | 'decision'
  | 'artifact'
  | 'progress'
  | 'open_question'
  | 'constraint'
  | 'handoff'

export type WhiteboardEntryStatus = 'active' | 'archived' | 'superseded'

export interface WhiteboardEntryRefs {
  files?: string[]
  entries?: string[]
  mailbox?: string
  artifacts?: string[]
}

export interface WhiteboardEntry {
  id: string
  chatId: string
  /**
   * chat  1  WhiteboardManager
   *  entries.jsonl cursor  diff
   */
  seq: number
  type: WhiteboardEntryType
  by: string
  summary: string
  refs?: WhiteboardEntryRefs
  tags?: string[]
  status: WhiteboardEntryStatus
  supersededBy?: string
  timestamp: string
}

/** id / chatId / seq / timestamp / status  Manager  */
export type WhiteboardEntryInput = Omit<WhiteboardEntry, 'id' | 'chatId' | 'seq' | 'timestamp' | 'status' | 'supersededBy'> & {
  status?: WhiteboardEntryStatus
}

export interface WhiteboardQueryOptions {
  sinceTs?: string
  types?: WhiteboardEntryType[]
  byAgent?: string
  tags?: string[]
  status?: WhiteboardEntryStatus
  limit?: number
}

/** Snapshot UI  ContextBriefing  */
export interface WhiteboardSnapshot {
  chatId: string
  goal: WhiteboardEntry | null
  active: WhiteboardEntry[]
  archivedCount: number
  updatedAt: string
}

export const WHITEBOARD_SUMMARY_MAX = 120

export const WHITEBOARD_ERROR = {
  SUMMARY_TOO_LONG: 'whiteboard.summary_too_long',
  SUMMARY_EMPTY: 'whiteboard.summary_empty',
  MISSING_BY: 'whiteboard.missing_by',
  GOAL_ALREADY_EXISTS: 'whiteboard.goal_already_exists',
  ENTRY_NOT_FOUND: 'whiteboard.entry_not_found',
} as const

export type WhiteboardErrorCode = typeof WHITEBOARD_ERROR[keyof typeof WHITEBOARD_ERROR]

export const normalizeAgentId = (by: string): string =>
  by.endsWith(':auto') ? by.slice(0, -':auto'.length) : by
