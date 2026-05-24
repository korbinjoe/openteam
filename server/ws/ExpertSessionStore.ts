/**
 * ExpertSessionStore — Expert Agent runtime state
 *
 * Holds the in-memory per-key state for spawned/attached experts (running entries,
 * starting locks, completed entries, pending-task queue, activity, meta).
 * Every entry is keyed by the composite `connectionId::chatId::agentId` so that
 * one Tab cannot leak state into another even when both target the same agent.
 *
 * The pending-task queue exists for messages that arrive while an expert is
 * still in its `starting` window. Entries are queued via `enqueuePendingTask`
 * and drained via `drainPendingTasks` at the provider-specific readiness
 * boundary. A bounded TTL guarantees queued entries never sit in memory
 * indefinitely; TTL expiry, `cleanup`, and `cleanupWithStop` all fire any
 * registered loss listeners so the surrounding handler can surface a
 * `pending_task_dropped` error to the originating connection.
 */

import type { ACPClient } from '../acp/ACPClient'
import type { ActivityState } from '../terminal/ActivityDeriver'

/** Hard ceiling on how long a pending task may sit in-memory before it is surfaced as dropped. */
export const PENDING_TASK_TTL_MS = 30_000

/** connectionId::chatId::agentId */
export function compositeKey(connectionId: string, chatId: string, agentId: string): string {
  return `${connectionId}::${chatId}::${agentId}`
}

export function parseAgentId(key: string): string {
  const parts = key.split('::')
  return parts.length >= 3 ? parts[2] : parts[parts.length - 1]
}

export function parseChatId(key: string): string {
  const parts = key.split('::')
  return parts.length >= 3 ? parts[1] : ''
}

export interface ExpertEntry {
  sessionId: string
  acpClient: ACPClient
  agentName: string
  agentIcon: string
  cwd: string
  cliSessionId?: string
  provider?: import('../config/types').CliProvider
  connectionId: string
  chatId: string
  model?: string
}

export interface CompletedEntry {
  sessionId: string
  agentName: string
  agentIcon: string
  exitCode?: number
  completedAt: string
  connectionId: string
  chatId: string
  model?: string
}

export interface ExpertListItem {
  agentId: string
  sessionId: string
  agentName: string
  agentIcon: string
  status: 'running' | 'completed'
  exitCode?: number
  completedAt?: string
  cwd?: string
}

export type ActivityChangeListener = (key: string, chatId: string, agentId: string, activity: ActivityState) => void

export interface PendingTaskEntry {
  task: string
  images?: Array<{ data: string; mediaType: string }>
  enqueuedAt: number
  /** Connection that originally produced this entry — used for routing the loss error. */
  connectionId: string
}

export type PendingTaskLossReason = 'ttl' | 'stop' | 'cleanup'
export type PendingTaskLossListener = (entry: PendingTaskEntry, key: string, reason: PendingTaskLossReason) => void

export class ExpertSessionStore {
  private running = new Map<string, ExpertEntry>()
  private completed = new Map<string, CompletedEntry>()
  private starting = new Set<string>()
  private pendingTask = new Map<string, PendingTaskEntry[]>()
  private pendingTaskTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private lastActivity = new Map<string, ActivityState>()
  /** executionLogId etc, keyed by `${key}::${metaKey}` */
  private meta = new Map<string, unknown>()

  private activityListeners = new Set<ActivityChangeListener>()
  private lossListeners = new Set<PendingTaskLossListener>()

  onActivityChange(listener: ActivityChangeListener): () => void {
    this.activityListeners.add(listener)
    return () => { this.activityListeners.delete(listener) }
  }

  onPendingTaskLoss(listener: PendingTaskLossListener): () => void {
    this.lossListeners.add(listener)
    return () => { this.lossListeners.delete(listener) }
  }

  // ── Meta ──

  setMeta(key: string, metaKey: string, value: unknown): void {
    this.meta.set(`${key}::${metaKey}`, value)
  }

  getMeta(key: string, metaKey: string): unknown {
    return this.meta.get(`${key}::${metaKey}`)
  }

  private clearMeta(key: string): void {
    const prefix = `${key}::`
    for (const k of this.meta.keys()) {
      if (k.startsWith(prefix)) this.meta.delete(k)
    }
  }

  // ── Starting Lock ──

  markStarting(key: string): void {
    this.starting.add(key)
  }

  clearStarting(key: string): void {
    this.starting.delete(key)
  }

  isStarting(key: string): boolean {
    return this.starting.has(key)
  }

  // ── Running Map ──

  set(key: string, entry: ExpertEntry): void {
    this.running.set(key, entry)
  }

  get(key: string): ExpertEntry | undefined {
    return this.running.get(key)
  }

  has(key: string): boolean {
    return this.running.has(key)
  }

  runningEntries(): IterableIterator<[string, ExpertEntry]> {
    return this.running.entries()
  }

  // ── Activity Map ──

  getActivity(key: string): ActivityState | undefined {
    return this.lastActivity.get(key)
  }

  setActivity(key: string, activity: ActivityState): void {
    this.lastActivity.set(key, activity)
    const chatId = parseChatId(key)
    const agentId = parseAgentId(key)
    for (const listener of this.activityListeners) {
      try { listener(key, chatId, agentId, activity) } catch {}
    }
  }

  // ── Completed Map ──

  setCompleted(key: string, entry: CompletedEntry): void {
    this.completed.set(key, entry)
  }

  getCompleted(key: string): CompletedEntry | undefined {
    return this.completed.get(key)
  }

  // ── Pending Task Queue ──

  /**
   * Queue a pending-task entry for the key. First enqueue per key arms a
   * single TTL timer (PENDING_TASK_TTL_MS). The timer is not refreshed by
   * subsequent enqueues — the oldest entry's deadline governs the queue.
   */
  enqueuePendingTask(key: string, entry: PendingTaskEntry): void {
    let queue = this.pendingTask.get(key)
    if (!queue) {
      queue = []
      this.pendingTask.set(key, queue)
    }
    queue.push(entry)

    if (!this.pendingTaskTimers.has(key)) {
      const timer = setTimeout(() => {
        this.pendingTaskTimers.delete(key)
        const drained = this.pendingTask.get(key)
        if (!drained || drained.length === 0) return
        this.pendingTask.delete(key)
        this.fireLoss(drained, key, 'ttl')
      }, PENDING_TASK_TTL_MS)
      // Don't keep the event loop alive for a stray timer.
      if (typeof (timer as { unref?: () => void }).unref === 'function') {
        (timer as { unref: () => void }).unref()
      }
      this.pendingTaskTimers.set(key, timer)
    }
  }

  hasPendingTask(key: string): boolean {
    const queue = this.pendingTask.get(key)
    return !!queue && queue.length > 0
  }

  /**
   * Drain and return all queued entries for the key, clearing queue + TTL timer.
   * Caller is responsible for delivering the entries (e.g. flushing them to ACP).
   * Does NOT fire the loss listener — callers that need to surface losses go
   * through `cleanup` / `cleanupWithStop` (which emit reason='stop'|'cleanup'),
   * or rely on TTL expiry (reason='ttl').
   */
  drainPendingTasks(key: string): PendingTaskEntry[] {
    const queue = this.pendingTask.get(key)
    this.pendingTask.delete(key)
    this.clearPendingTaskTimer(key)
    return queue ?? []
  }

  /** Cancel and drop the TTL timer for the key without touching the queue. */
  clearPendingTaskTimer(key: string): void {
    const timer = this.pendingTaskTimers.get(key)
    if (timer) {
      clearTimeout(timer)
      this.pendingTaskTimers.delete(key)
    }
  }

  /**
   * Drop the queue for a key without firing loss listeners. Used by detach
   * paths where the originating connection is gone and surfacing an error
   * has nowhere to land.
   */
  forgetPendingTasks(key: string): void {
    this.pendingTask.delete(key)
    this.clearPendingTaskTimer(key)
  }

  private fireLoss(entries: PendingTaskEntry[], key: string, reason: PendingTaskLossReason): void {
    for (const entry of entries) {
      for (const listener of this.lossListeners) {
        try { listener(entry, key, reason) } catch {}
      }
    }
  }

  /**
   * Remove all per-key state. Any queued pending tasks are surfaced via the
   * loss listener with reason='cleanup' before being deleted. Returns the
   * removed running entry and last activity (if any) for caller bookkeeping.
   */
  cleanup(key: string): { entry?: ExpertEntry; activity?: ActivityState } {
    const entry = this.running.get(key)
    const activity = this.lastActivity.get(key)

    const drainedTasks = this.pendingTask.get(key)
    this.pendingTask.delete(key)
    this.clearPendingTaskTimer(key)

    this.running.delete(key)
    this.starting.delete(key)
    this.lastActivity.delete(key)
    this.clearMeta(key)

    if (drainedTasks && drainedTasks.length > 0) {
      this.fireLoss(drainedTasks, key, 'cleanup')
    }

    return { entry, activity }
  }

  /**
   * cleanup + record a `completed` entry with exitCode -1. Used by
   * handleStop / handleStopAll. Drained pending tasks are surfaced via
   * the loss listener with reason='stop'.
   */
  cleanupWithStop(key: string, connectionId: string): ExpertEntry | undefined {
    const expert = this.running.get(key)
    if (!expert) return undefined

    this.completed.set(key, {
      sessionId: expert.sessionId,
      agentName: expert.agentName,
      agentIcon: expert.agentIcon,
      exitCode: -1,
      completedAt: new Date().toISOString(),
      connectionId,
      chatId: expert.chatId,
    })

    const drainedTasks = this.pendingTask.get(key)
    this.pendingTask.delete(key)
    this.clearPendingTaskTimer(key)

    this.running.delete(key)
    this.starting.delete(key)
    this.lastActivity.delete(key)
    this.clearMeta(key)

    if (drainedTasks && drainedTasks.length > 0) {
      this.fireLoss(drainedTasks, key, 'stop')
    }

    return expert
  }

  /** Collect running entries by chatId — used by team-status API. */
  collectByChatId(chatId: string): Array<{ key: string; expert: ExpertEntry }> {
    const result: Array<{ key: string; expert: ExpertEntry }> = []
    for (const [key, expert] of this.running) {
      if (expert.chatId === chatId) {
        result.push({ key, expert })
      }
    }
    return result
  }

  /** Collect running entries for a connectionId. */
  collectByConnection(connectionId: string): Array<{ key: string; expert: ExpertEntry }> {
    const result: Array<{ key: string; expert: ExpertEntry }> = []
    for (const [key, expert] of this.running) {
      if (expert.connectionId === connectionId) {
        result.push({ key, expert })
      }
    }
    return result
  }

  /** cleanup + remove completed records for a connectionId. */
  cleanupConnection(connectionId: string): void {
    const items = this.collectByConnection(connectionId)
    for (const { key } of items) {
      this.cleanup(key)
      this.completed.delete(key)
    }
  }

  findBySessionId(sessionId: string): { key: string; entry: ExpertEntry } | undefined {
    for (const [key, entry] of this.running) {
      if (entry.sessionId === sessionId) return { key, entry }
    }
    return undefined
  }

  /** Migrate an entry from oldKey → newKey (used by resumeFromChat). */
  migrateKey(oldKey: string, newKey: string, connectionId: string): void {
    const entry = this.running.get(oldKey)
    if (!entry) return

    entry.connectionId = connectionId
    this.running.delete(oldKey)
    this.running.set(newKey, entry)

    const activity = this.lastActivity.get(oldKey)
    if (activity) {
      this.lastActivity.delete(oldKey)
      this.lastActivity.set(newKey, activity)
    }

    const oldPrefix = `${oldKey}::`
    const toMigrate: Array<[string, unknown]> = []
    for (const [k, v] of this.meta) {
      if (k.startsWith(oldPrefix)) {
        toMigrate.push([k.slice(oldPrefix.length), v])
      }
    }
    for (const [metaKey, v] of toMigrate) {
      this.meta.delete(`${oldKey}::${metaKey}`)
      this.meta.set(`${newKey}::${metaKey}`, v)
    }
  }

  /** Locate a key by agentId — running first, completed fallback. */
  findKeyByAgentId(agentId: string): string | undefined {
    for (const key of this.running.keys()) {
      if (parseAgentId(key) === agentId) return key
    }
    for (const key of this.completed.keys()) {
      if (parseAgentId(key) === agentId) return key
    }
    return undefined
  }

  /** Find a running entry by agentId, optionally constrained by connectionId/chatId. */
  findRunning(agentId: string, connectionId?: string, chatId?: string): ExpertEntry | undefined {
    if (connectionId && chatId) {
      return this.running.get(compositeKey(connectionId, chatId, agentId))
    }
    for (const [key, entry] of this.running) {
      if (parseAgentId(key) !== agentId) continue
      if (connectionId && entry.connectionId !== connectionId) continue
      if (chatId && entry.chatId !== chatId) continue
      return entry
    }
    return undefined
  }

  getExpertListForConnection(connectionId: string, chatId?: string): ExpertListItem[] {
    const runningList = Array.from(this.running.entries())
      .filter(([, info]) => info.connectionId === connectionId && (!chatId || info.chatId === chatId))
      .map(([key, info]) => ({
        agentId: parseAgentId(key),
        sessionId: info.sessionId,
        agentName: info.agentName,
        agentIcon: info.agentIcon,
        status: 'running' as const,
        cwd: info.cwd,
      }))

    const completedList = Array.from(this.completed.entries())
      .filter(([key, info]) => info.connectionId === connectionId && !this.running.has(key) && (!chatId || info.chatId === chatId))
      .map(([key, info]) => ({
        agentId: parseAgentId(key),
        sessionId: info.sessionId,
        agentName: info.agentName,
        agentIcon: info.agentIcon,
        status: 'completed' as const,
        exitCode: info.exitCode,
        completedAt: info.completedAt,
      }))

    return [...runningList, ...completedList]
  }

  getExpertList(): ExpertListItem[] {
    const runningList = Array.from(this.running.entries()).map(([key, info]) => ({
      agentId: parseAgentId(key),
      sessionId: info.sessionId,
      agentName: info.agentName,
      agentIcon: info.agentIcon,
      status: 'running' as const,
    }))

    const completedList = Array.from(this.completed.entries())
      .filter(([key]) => !this.running.has(key))
      .map(([key, info]) => ({
        agentId: parseAgentId(key),
        sessionId: info.sessionId,
        agentName: info.agentName,
        agentIcon: info.agentIcon,
        status: 'completed' as const,
        exitCode: info.exitCode,
        completedAt: info.completedAt,
      }))

    return [...runningList, ...completedList]
  }

  clearCompleted(connectionId: string, chatId?: string): number {
    const toDelete: string[] = []
    for (const [key, entry] of this.completed) {
      if (entry.connectionId === connectionId && (!chatId || entry.chatId === chatId)) {
        toDelete.push(key)
      }
    }
    for (const key of toDelete) this.completed.delete(key)
    return toDelete.length
  }

  /** Drop completed entries for a connectionId. */
  clearCompletedByConnection(connectionId: string): void {
    const toDelete = [...this.completed.entries()]
      .filter(([, entry]) => entry.connectionId === connectionId)
      .map(([key]) => key)
    for (const key of toDelete) this.completed.delete(key)
  }
}
