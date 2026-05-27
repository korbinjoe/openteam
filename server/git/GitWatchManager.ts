/**
 * GitWatchManager —  Git
 *
 *   - watcher  path refCount repo  chat  fd
 *   -  chatId  ChatA  ChatB
 *
 *   subscribe(chatId, path) → refCount++ →  chokidar
 *   fs event → debounce 500ms → computeWorkingChanges() → emit('changes', chatId, payload)
 *   unsubscribe(chatId, path) → refCount-- →  0  watcher.close()
 *
 *  design.md 5
 *   1. watcher  path  +
 *   2.  chatId  WS
 *   3. WS disconnect  unsubscribeAllFor(chatId)
 *   4. diff  path path  chat  payload
 *   5.  unsub  sub
 */

import chokidar from 'chokidar'
import { EventEmitter } from 'events'
import { resolve } from 'path'
import { createLogger } from '../lib/logger'
import { computeWorkingChanges, type WorkingChanges } from './workingChanges'

const log = createLogger('GitWatchManager')

const DEBOUNCE_MS = 200

const IGNORED_PATTERNS: Array<string | ((filePath: string) => boolean)> = [
  '**/node_modules/**',
  '**/dist/**',
  '**/.next/**',
  '**/build/**',
  '**/.cache/**',
  '**/.turbo/**',
  '**/coverage/**',
  (filePath: string) => {
    if (!filePath.includes('/.git/')) return false
    if (filePath.endsWith('/.git/index')) return false
    if (filePath.endsWith('/.git/HEAD')) return false
    if (filePath.includes('/.git/refs/')) return false
    return true
  },
]

export interface GitChangeEvent {
  chatId: string
  path: string
  payload: WorkingChanges
}

export interface TreeChangeEvent {
  chatId: string
  path: string
}

interface WatcherEntry {
  watcher: ReturnType<typeof chokidar.watch>
  subscribers: Set<string> // chatId set
  debounceTimer: ReturnType<typeof setTimeout> | null
  treeDebounceTimer: ReturnType<typeof setTimeout> | null
}

let _instance: GitWatchManager | null = null
export const getGitWatchManager = (): GitWatchManager | null => _instance

export class GitWatchManager extends EventEmitter {
  // path → WatcherEntry
  private readonly watchers = new Map<string, WatcherEntry>()
  private readonly chatPaths = new Map<string, Set<string>>()

  constructor() {
    super()
    _instance = this
  }

  subscribe(chatId: string, rawPath: string): void {
    const path = resolve(rawPath)

    let paths = this.chatPaths.get(chatId)
    if (!paths) {
      paths = new Set()
      this.chatPaths.set(chatId, paths)
    }
    if (paths.has(path)) {
      return
    }
    paths.add(path)

    let entry = this.watchers.get(path)
    if (!entry) {
      entry = this.createWatcher(path)
      this.watchers.set(path, entry)
    }
    entry.subscribers.add(chatId)
    log.debug('subscribed', { chatId, path, refCount: entry.subscribers.size })
  }

  unsubscribe(chatId: string, rawPath: string): void {
    const path = resolve(rawPath)

    const paths = this.chatPaths.get(chatId)
    if (paths) {
      paths.delete(path)
      if (paths.size === 0) this.chatPaths.delete(chatId)
    }

    const entry = this.watchers.get(path)
    if (!entry) return
    entry.subscribers.delete(chatId)
    log.debug('unsubscribed', { chatId, path, refCount: entry.subscribers.size })

    if (entry.subscribers.size === 0) {
      this.closeEntry(path, entry)
    }
  }

  unsubscribeAllFor(chatId: string): void {
    const paths = this.chatPaths.get(chatId)
    if (!paths) return
    for (const path of Array.from(paths)) {
      this.unsubscribe(chatId, path)
    }
  }

  async dispose(): Promise<void> {
    const entries = Array.from(this.watchers.entries())
    this.watchers.clear()
    this.chatPaths.clear()
    await Promise.all(
      entries.map(async ([path, entry]) => {
        if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
        if (entry.treeDebounceTimer) clearTimeout(entry.treeDebounceTimer)
        try {
          await entry.watcher.close()
        } catch (err) {
          log.warn('watcher close error', { path, error: String(err) })
        }
      }),
    )
  }

  notifyChange(rawPath: string): void {
    const path = resolve(rawPath)
    const entry = this.watchers.get(path)
    if (!entry || entry.subscribers.size === 0) return
    this.scheduleEmit(path, entry)
  }

  notifyChangeForChat(chatId: string): void {
    const paths = this.chatPaths.get(chatId)
    if (!paths) return
    for (const path of paths) {
      const entry = this.watchers.get(path)
      if (entry && entry.subscribers.size > 0) {
        this.scheduleEmit(path, entry)
      }
    }
  }

  /**
   *  watcher
   *  WebIDE —— repo
   */
  notifyChangeForFile(filePath: string): void {
    const resolved = resolve(filePath)
    for (const [watchedPath, entry] of this.watchers) {
      if (resolved.startsWith(watchedPath + '/') && entry.subscribers.size > 0) {
        this.scheduleEmit(watchedPath, entry)
        return
      }
    }
  }

  getRefCount(rawPath: string): number {
    const entry = this.watchers.get(resolve(rawPath))
    return entry ? entry.subscribers.size : 0
  }

  private createWatcher(path: string): WatcherEntry {
    const watcher = chokidar.watch(path, {
      ignored: IGNORED_PATTERNS,
      ignoreInitial: true,
      awaitWriteFinish: false,
      followSymlinks: false,
    })

    const entry: WatcherEntry = {
      watcher,
      subscribers: new Set(),
      debounceTimer: null,
      treeDebounceTimer: null,
    }

    const onFsEvent = () => this.scheduleEmit(path, entry)
    const onStructuralEvent = () => {
      onFsEvent()
      this.scheduleTreeEmit(path, entry)
    }
    watcher.on('add', onStructuralEvent)
    watcher.on('change', onFsEvent)
    watcher.on('unlink', onStructuralEvent)
    watcher.on('addDir', onStructuralEvent)
    watcher.on('unlinkDir', onStructuralEvent)
    watcher.on('error', (err) => log.warn('watcher error', { path, error: String(err) }))

    log.info('watcher created', { path })
    return entry
  }

  private scheduleTreeEmit(path: string, entry: WatcherEntry): void {
    if (entry.treeDebounceTimer) clearTimeout(entry.treeDebounceTimer)
    entry.treeDebounceTimer = setTimeout(() => {
      entry.treeDebounceTimer = null
      for (const chatId of entry.subscribers) {
        const event: TreeChangeEvent = { chatId, path }
        this.emit('tree-changed', event)
      }
    }, DEBOUNCE_MS)
  }

  private scheduleEmit(path: string, entry: WatcherEntry): void {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    entry.debounceTimer = setTimeout(() => {
      entry.debounceTimer = null
      this.computeAndEmit(path, entry).catch((err) =>
        log.warn('compute/emit failed', { path, error: String(err) }),
      )
    }, DEBOUNCE_MS)
  }

  private async computeAndEmit(path: string, entry: WatcherEntry): Promise<void> {
    if (entry.subscribers.size === 0) return

    const payload = await computeWorkingChanges(path)

    if (entry.subscribers.size === 0) return

    for (const chatId of entry.subscribers) {
      const event: GitChangeEvent = { chatId, path, payload }
      this.emit('changes', event)
    }
  }

  private closeEntry(path: string, entry: WatcherEntry): void {
    if (entry.debounceTimer) clearTimeout(entry.debounceTimer)
    if (entry.treeDebounceTimer) clearTimeout(entry.treeDebounceTimer)
    this.watchers.delete(path)
    entry.watcher.close().catch((err) => log.warn('close error', { path, error: String(err) }))
    log.info('watcher closed', { path })
  }
}
