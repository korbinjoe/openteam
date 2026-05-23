/**
 * ExternalDirWatcher — top-level chokidar watcher for the external session
 * scanner.
 *
 * Watches only `~/.claude/projects/` and `~/.codex/sessions/` at depth 1.
 * Per-file watching is deliberately avoided — Claude alone has 3500+ jsonl
 * files which would blow past macOS fd limits. Tier-1 enumeration is cheap
 * enough to re-run end-to-end on any change.
 *
 * Debounced 500 ms so a flurry of writes from a running CLI collapses into
 * one rescan. Emits `external-dirs:changed` with the affected provider so the
 * sidebar can invalidate that group's cached expansion.
 */

import chokidar from 'chokidar'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { createLogger } from '../../lib/logger'
import { DirectoryEnumerator } from './DirectoryEnumerator'

const log = createLogger('ExternalDirWatcher')

const CLAUDE_ROOT = join(homedir(), '.claude', 'projects')
const CODEX_ROOT = join(homedir(), '.codex', 'sessions')
const DEBOUNCE_MS = 500

type Broadcast = (msg: Record<string, unknown>) => void

export class ExternalDirWatcher {
  private watchers: chokidar.FSWatcher[] = []
  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private pendingProviders = new Set<'claude' | 'codex'>()
  private rescanInFlight = false
  private rescanQueued = false

  constructor(private broadcast: Broadcast) {}

  start(): void {
    if (this.watchers.length > 0) return

    if (existsSync(CLAUDE_ROOT)) {
      this.watchers.push(this.makeWatcher(CLAUDE_ROOT, 'claude'))
    }
    if (existsSync(CODEX_ROOT)) {
      this.watchers.push(this.makeWatcher(CODEX_ROOT, 'codex'))
    }
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    await Promise.all(this.watchers.map((w) => w.close()))
    this.watchers = []
  }

  private makeWatcher(root: string, provider: 'claude' | 'codex'): chokidar.FSWatcher {
    // depth: 2 covers claude/projects/<key>/<file> and codex/sessions/<yyyy>/<mm>.
    // We only need *that* a change happened, not which file. Day-level changes
    // bubble up via mm-dir mtime, so depth: 2 is enough and keeps fd count low.
    const watcher = chokidar.watch(root, {
      ignored: ['**/node_modules/**'],
      ignoreInitial: true,
      depth: 2,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      followSymlinks: false,
    })

    const onChange = () => {
      this.pendingProviders.add(provider)
      this.scheduleRescan()
    }

    watcher.on('add', onChange)
    watcher.on('addDir', onChange)
    watcher.on('unlink', onChange)
    watcher.on('unlinkDir', onChange)
    watcher.on('change', onChange)
    watcher.on('error', (err) => {
      log.warn('watcher error', {
        provider,
        error: err instanceof Error ? err.message : String(err),
      })
    })
    return watcher
  }

  private scheduleRescan(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer)
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.runRescan()
    }, DEBOUNCE_MS)
  }

  private async runRescan(): Promise<void> {
    if (this.rescanInFlight) {
      this.rescanQueued = true
      return
    }
    const providers = Array.from(this.pendingProviders)
    this.pendingProviders.clear()
    this.rescanInFlight = true
    try {
      const r = await new DirectoryEnumerator().enumerate()
      this.broadcast({
        type: 'external-dirs:changed',
        payload: { providers, dirCount: r.dirCount, durationMs: r.durationMs },
      })
    } catch (err) {
      log.warn('rescan failed', {
        error: err instanceof Error ? err.message : String(err),
      })
    } finally {
      this.rescanInFlight = false
      if (this.rescanQueued) {
        this.rescanQueued = false
        this.scheduleRescan()
      }
    }
  }
}
