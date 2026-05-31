/**
 * WhiteboardManager - Chat
 *
 *  chat  entries.jsonl +  snapshot.json
 *  Agent →  appendFileSync + O_APPEND
 *
 *   ~/.openteam/whiteboard/{chatId}/
 *     ├── entries.jsonl   #  entry
 *     └── snapshot.json   # active debounce
 *
 *  mailbox
 *   mailbox =  push {from}→{to}.jsonl
 *   whiteboard = chat  pull  + snapshot
 */

import {
  existsSync,
  mkdirSync,
  appendFileSync,
  readFileSync,
  writeFileSync,
  statSync,
  openSync,
  readSync,
  closeSync,
} from 'fs'
import { join } from 'path'
import { rm } from 'fs/promises'
import { nanoid } from 'nanoid'
import { WHITEBOARD_ROOT } from '../config/paths'
import {
  type WhiteboardEntry,
  type WhiteboardEntryInput,
  type WhiteboardQueryOptions,
  type WhiteboardSnapshot,
  type WhiteboardErrorCode,
  WHITEBOARD_SUMMARY_MAX,
  WHITEBOARD_ERROR,
  normalizeAgentId,
} from '../../shared/whiteboard-types'
import { createLogger } from '../lib/logger'
import { CursorStore, type CursorRecord } from './CursorStore'

const log = createLogger('WhiteboardManager')

const SNAPSHOT_DEBOUNCE_MS = 500

export class WhiteboardValidationError extends Error {
  constructor(public code: WhiteboardErrorCode, message: string) {
    super(message)
    this.name = 'WhiteboardValidationError'
  }
}

export class WhiteboardManager {
  /** chatId → debounce timer snapshot */
  private snapshotTimers = new Map<string, NodeJS.Timeout>()

  private readCursors = new Map<string, number>()

  private cache = new Map<string, WhiteboardEntry[]>()

  /**
   * chatId →  seq
   *  loadEntries  +1
   * Node  →
   */
  private latestSeq = new Map<string, number>()

  /**  agent  cursor KV lastReadSeq by agentInstanceId */
  private cursorStore = new CursorStore()

  private chatDir(chatId: string): string {
    return join(WHITEBOARD_ROOT, chatId)
  }

  private entriesPath(chatId: string): string {
    return join(this.chatDir(chatId), 'entries.jsonl')
  }

  private snapshotPath(chatId: string): string {
    return join(this.chatDir(chatId), 'snapshot.json')
  }

  ensureChatDir(chatId: string): string {
    const dir = this.chatDir(chatId)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
      log.info('Created whiteboard dir', { chatId })
    }
    return dir
  }

  /**
   *  entry JSONL snapshot
   * @throws WhiteboardValidationError
   */
  appendEntry(chatId: string, input: WhiteboardEntryInput): WhiteboardEntry {
    this.validateInput(chatId, input)

    this.ensureChatDir(chatId)

    this.loadEntries(chatId)

    const nextSeq = (this.latestSeq.get(chatId) ?? 0) + 1

    const entry: WhiteboardEntry = {
      id: nanoid(12),
      chatId,
      seq: nextSeq,
      type: input.type,
      by: input.by,
      summary: input.summary.trim(),
      refs: input.refs,
      tags: input.tags,
      status: input.status ?? 'active',
      timestamp: new Date().toISOString(),
    }

    const line = JSON.stringify(entry) + '\n'
    appendFileSync(this.entriesPath(chatId), line, { flag: 'a' })

    const lineBytes = Buffer.byteLength(line, 'utf-8')
    this.readCursors.set(chatId, (this.readCursors.get(chatId) ?? 0) + lineBytes)

    const list = this.cache.get(chatId) ?? []
    list.push(entry)
    this.cache.set(chatId, list)
    this.latestSeq.set(chatId, nextSeq)

    this.scheduleSnapshotRebuild(chatId)
    log.info('Whiteboard entry recorded', {
      chatId,
      entryId: entry.id,
      type: entry.type,
      by: entry.by,
      summaryPreview: entry.summary.slice(0, 40),
    })
    return entry
  }

  /**  entry  archived status  entry  */
  archive(chatId: string, entryId: string, by: string): void {
    const entries = this.loadEntries(chatId)
    const target = entries.find((e) => e.id === entryId)
    if (!target) {
      throw new WhiteboardValidationError(WHITEBOARD_ERROR.ENTRY_NOT_FOUND, `Entry ${entryId} not found in chat ${chatId}`)
    }
    if (target.status === 'archived') return

    this.appendEntry(chatId, {
      type: target.type,
      by,
      summary: `[archived] ${target.summary}`.slice(0, WHITEBOARD_SUMMARY_MAX),
      refs: { entries: [entryId] },
      tags: ['_archive'],
      status: 'archived',
    })

    target.status = 'archived'
    this.scheduleSnapshotRebuild(chatId)
  }

  /**  entry  entry entry status → superseded supersededBy */
  supersede(chatId: string, oldEntryId: string, newInput: WhiteboardEntryInput): WhiteboardEntry {
    const entries = this.loadEntries(chatId)
    const old = entries.find((e) => e.id === oldEntryId)
    if (!old) {
      throw new WhiteboardValidationError(WHITEBOARD_ERROR.ENTRY_NOT_FOUND, `Entry ${oldEntryId} not found`)
    }

    old.status = 'superseded'

    const newEntry = this.appendEntry(chatId, {
      ...newInput,
      refs: { ...(newInput.refs ?? {}), entries: [...(newInput.refs?.entries ?? []), oldEntryId] },
      tags: [...(newInput.tags ?? []), '_supersede'],
    })

    old.supersededBy = newEntry.id
    this.scheduleSnapshotRebuild(chatId)
    return newEntry
  }

  query(chatId: string, opts: WhiteboardQueryOptions = {}): WhiteboardEntry[] {
    let list = this.loadEntries(chatId).slice()

    if (opts.status) list = list.filter((e) => e.status === opts.status)
    if (opts.types?.length) list = list.filter((e) => opts.types!.includes(e.type))
    if (opts.byAgent) {
      const norm = normalizeAgentId(opts.byAgent)
      list = list.filter((e) => normalizeAgentId(e.by) === norm)
    }
    if (opts.tags?.length) list = list.filter((e) => e.tags?.some((t) => opts.tags!.includes(t)))
    if (opts.sinceTs) list = list.filter((e) => e.timestamp > opts.sinceTs!)

    list.sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1))
    if (opts.limit && opts.limit > 0) list = list.slice(-opts.limit)
    return list
  }

  /** / snapshot ContextBriefing  */
  getSnapshot(chatId: string): WhiteboardSnapshot {
    const entries = this.loadEntries(chatId)
    const active = entries.filter((e) => e.status === 'active')
    const goal = active.find((e) => e.type === 'goal') ?? null
    const archivedCount = entries.length - active.length

    return {
      chatId,
      goal,
      active: active
        .filter((e) => e.type !== 'goal')
        .sort((a, b) => (a.timestamp < b.timestamp ? -1 : 1)),
      archivedCount,
      updatedAt: new Date().toISOString(),
    }
  }

  /**  chat  mailbox  cleanupChat  */
  async cleanupChat(chatId: string): Promise<void> {
    const dir = this.chatDir(chatId)
    if (existsSync(dir)) {
      try {
        await rm(dir, { recursive: true, force: true })
        log.info('Cleaned up whiteboard', { chatId })
      } catch (err) {
        log.warn('Failed to cleanup whiteboard', { chatId, error: err instanceof Error ? err.message : String(err) })
      }
    }
    this.cache.delete(chatId)
    this.readCursors.delete(chatId)
    this.latestSeq.delete(chatId)
    this.cursorStore.cleanupChat(chatId)
    const timer = this.snapshotTimers.get(chatId)
    if (timer) {
      clearTimeout(timer)
      this.snapshotTimers.delete(chatId)
    }
  }

  getLatestSeq(chatId: string): number {
    this.loadEntries(chatId)
    return this.latestSeq.get(chatId) ?? 0
  }

  /**
   *  seq > sinceSeq  seq
   * - sinceSeq < 0 / NaN →  0
   * -  entries seq loadEntries
   */
  getDiff(chatId: string, sinceSeq: number): WhiteboardEntry[] {
    const entries = this.loadEntries(chatId)
    const since = Number.isFinite(sinceSeq) && sinceSeq > 0 ? sinceSeq : 0
    return entries
      .filter((e) => e.seq > since)
      .sort((a, b) => a.seq - b.seq)
  }

  /**  agentInstanceId  lastReadSeq → null fallback */
  getCursor(chatId: string, instanceId: string): CursorRecord | null {
    return this.cursorStore.get(chatId, instanceId)
  }

  /**
   *  agentInstanceId  lastReadSeq
   * - seq  →  latestSeq snapshot
   * - seq
   */
  setCursor(chatId: string, instanceId: string, seq?: number): CursorRecord {
    const target = seq ?? this.getLatestSeq(chatId)
    return this.cursorStore.set(chatId, instanceId, target)
  }

  private validateInput(chatId: string, input: WhiteboardEntryInput): void {
    if (!input.by || !input.by.trim()) {
      throw new WhiteboardValidationError(WHITEBOARD_ERROR.MISSING_BY, 'whiteboard entry requires `by` (agentId)')
    }
    const summary = (input.summary ?? '').trim()
    if (!summary) {
      throw new WhiteboardValidationError(WHITEBOARD_ERROR.SUMMARY_EMPTY, 'whiteboard entry requires non-empty summary')
    }
    if (summary.length > WHITEBOARD_SUMMARY_MAX) {
      throw new WhiteboardValidationError(
        WHITEBOARD_ERROR.SUMMARY_TOO_LONG,
        `summary must be ≤${WHITEBOARD_SUMMARY_MAX} chars (got ${summary.length}), please refine`,
      )
    }
    if (input.type === 'goal') {
      const existing = this.loadEntries(chatId).find((e) => e.type === 'goal' && e.status === 'active')
      if (existing) {
        throw new WhiteboardValidationError(
          WHITEBOARD_ERROR.GOAL_ALREADY_EXISTS,
          `chat ${chatId} already has active goal entry ${existing.id}; supersede it instead`,
        )
      }
    }
  }

  private loadEntries(chatId: string): WhiteboardEntry[] {
    const path = this.entriesPath(chatId)
    if (!existsSync(path)) {
      this.cache.set(chatId, this.cache.get(chatId) ?? [])
      return this.cache.get(chatId)!
    }

    const fileSize = statSync(path).size
    const cursor = this.readCursors.get(chatId) ?? 0
    if (fileSize <= cursor) return this.cache.get(chatId) ?? []

    const buffer = Buffer.alloc(fileSize - cursor)
    const fd = openSync(path, 'r')
    try {
      readSync(fd, buffer, 0, buffer.length, cursor)
    } finally {
      closeSync(fd)
    }

    const list = this.cache.get(chatId) ?? []
    let seqCounter = this.latestSeq.get(chatId) ?? 0
    const lines = buffer.toString('utf-8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const raw = JSON.parse(line) as WhiteboardEntry & { seq?: number }
        if (typeof raw.seq !== 'number' || !Number.isFinite(raw.seq)) {
          seqCounter += 1
          raw.seq = seqCounter
        } else {
          seqCounter = Math.max(seqCounter, raw.seq)
        }
        list.push(raw as WhiteboardEntry)
      } catch (err) {
        log.warn('Failed to parse whiteboard line', { chatId, line: line.slice(0, 100) })
      }
    }
    const byId = new Map(list.map((e) => [e.id, e]))
    for (const entry of list) {
      if (entry.tags?.includes('_archive') && entry.refs?.entries?.[0]) {
        const target = byId.get(entry.refs.entries[0])
        if (target && target.status === 'active') target.status = 'archived'
      }
      if (entry.tags?.includes('_supersede') && entry.refs?.entries?.length) {
        const oldId = entry.refs.entries[entry.refs.entries.length - 1]
        const target = byId.get(oldId)
        if (target && target.status === 'active') {
          target.status = 'superseded'
          target.supersededBy = entry.id
        }
      }
    }

    this.cache.set(chatId, list)
    this.latestSeq.set(chatId, seqCounter)
    this.readCursors.set(chatId, fileSize)
    return list
  }

  private scheduleSnapshotRebuild(chatId: string): void {
    const existing = this.snapshotTimers.get(chatId)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      try {
        const snap = this.getSnapshot(chatId)
        writeFileSync(this.snapshotPath(chatId), JSON.stringify(snap, null, 2), 'utf-8')
        log.debug('Snapshot rebuilt', { chatId, active: snap.active.length, archived: snap.archivedCount })
      } catch (err) {
        log.warn('Failed to rebuild snapshot', { chatId, error: err instanceof Error ? err.message : String(err) })
      } finally {
        this.snapshotTimers.delete(chatId)
      }
    }, SNAPSHOT_DEBOUNCE_MS)
    this.snapshotTimers.set(chatId, timer)
  }

  flushSnapshot(chatId: string): WhiteboardSnapshot {
    const timer = this.snapshotTimers.get(chatId)
    if (timer) {
      clearTimeout(timer)
      this.snapshotTimers.delete(chatId)
    }
    const snap = this.getSnapshot(chatId)
    this.ensureChatDir(chatId)
    writeFileSync(this.snapshotPath(chatId), JSON.stringify(snap, null, 2), 'utf-8')
    return snap
  }

  /**  snapshot.json cold start  */
  readSnapshotFile(chatId: string): WhiteboardSnapshot | null {
    const path = this.snapshotPath(chatId)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, 'utf-8')) as WhiteboardSnapshot
    } catch {
      return null
    }
  }
}
