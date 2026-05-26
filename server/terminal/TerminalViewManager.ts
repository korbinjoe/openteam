/**
 * TerminalViewManager — Resume-PTY bridge for terminal view mode.
 *
 * When the user toggles a chat pane into terminal view, the server spawns a
 * sibling `claude --resume <cliSessionId>` (or equivalent) in the chat's cwd
 * via node-pty, streams raw TUI bytes back as `expert:data`, and forwards web
 * `expert:input` / `expert:resize` to PTY stdin. The ACP stream-json process
 * keeps running in the background — handoff / orchestration / scheduling stay
 * on ACP. Terminal mode only serves the user's optional native CLI experience.
 *
 * Lifetime keying: (connectionId, chatId, agentId). A given (chat, agent) can
 * have at most one view-PTY per WebSocket connection. Disconnecting the WS
 * (or sending `expert:cli-detach`) kills the PTY.
 */

import * as pty from 'node-pty'
import type { WebSocket } from 'ws'
import { existsSync } from 'fs'
import type { SessionRegistry } from './SessionRegistry'
import type { ChatStore } from '../stores/ChatStore'
import { resolveCliCommandAsync, resolveInterpreter } from '../lib/resolveCliCommand'
import { createLogger } from '../lib/logger'

const log = createLogger('TerminalViewManager')

interface ViewPty {
  pty: pty.IPty
  cwd: string
  agentId: string
  chatId: string
  connectionId: string
  cols: number
  rows: number
  firstChunkSent: boolean
}

const keyOf = (connectionId: string, chatId: string, agentId: string): string =>
  `${connectionId}::${chatId}::${agentId}`

// Grace window after `handleDetach` before we actually kill the PTY. Lets the
// user toggle terminal mode off/on rapidly (or trigger a re-attach via WS
// reconnect) without thrashing `claude --resume` spawns.
const DETACH_GRACE_MS = 300

export class TerminalViewManager {
  private views = new Map<string, ViewPty>()
  private pendingDetach = new Map<string, NodeJS.Timeout>()

  constructor(
    private sessionRegistry: SessionRegistry,
    private chatStore: ChatStore,
  ) {}

  private cancelPendingDetach(key: string): boolean {
    const timer = this.pendingDetach.get(key)
    if (!timer) return false
    clearTimeout(timer)
    this.pendingDetach.delete(key)
    return true
  }

  /**
   * True iff this (connectionId, chatId, agentId) has an active view-PTY that
   * should receive input/resize events instead of the ACP adapter.
   */
  has(connectionId: string, chatId: string, agentId: string): boolean {
    return this.views.has(keyOf(connectionId, chatId, agentId))
  }

  async handleAttach(
    ws: WebSocket,
    payload: { chatId: string; agentId: string; cols: number; rows: number },
    connectionId: string,
  ): Promise<void> {
    const { chatId, agentId } = payload
    const cols = payload.cols && payload.cols > 0 ? payload.cols : 80
    const rows = payload.rows && payload.rows > 0 ? payload.rows : 24
    const key = keyOf(connectionId, chatId, agentId)

    if (this.cancelPendingDetach(key)) {
      log.debug('Re-attach cancelled pending detach; reusing PTY', { key })
    }

    if (this.views.has(key)) {
      log.debug('Re-attach to existing view-PTY; resizing only', { key, cols, rows })
      this.handleResize({ chatId, agentId, cols, rows }, connectionId)
      return
    }

    const live = this.sessionRegistry.findByChat(chatId, agentId)
    const persisted = this.chatStore.get(chatId)?.expertSessions?.[agentId]
    const cliSessionId = live?.cliSessionId ?? persisted?.cliSessionId
    const cwd = live?.cwd ?? persisted?.cwd
    const provider = persisted?.provider ?? 'claude'

    if (!cliSessionId) {
      this.send(ws, 'expert:error', {
        agentId,
        chatId,
        error: 'terminal_view_unavailable',
        message: `No CLI session id for agent ${agentId}; launch it in message view first`,
      })
      return
    }
    if (!cwd || !existsSync(cwd)) {
      this.send(ws, 'expert:error', {
        agentId,
        chatId,
        error: 'terminal_view_unavailable',
        message: `Working directory unavailable for agent ${agentId}`,
      })
      return
    }

    let command: string
    let args: string[]
    if (provider === 'claude' || provider === 'qoder') {
      command = provider === 'qoder' ? 'qodercli' : 'claude'
      args = ['--resume', cliSessionId]
    } else {
      this.send(ws, 'expert:error', {
        agentId,
        chatId,
        error: 'terminal_view_unsupported_provider',
        message: `Terminal view does not yet support provider "${provider}"`,
      })
      return
    }

    const resolved = await resolveCliCommandAsync(command)
    if (!resolved) {
      this.send(ws, 'expert:error', {
        agentId,
        chatId,
        error: 'terminal_view_cli_not_found',
        message: `CLI command "${command}" not found on PATH`,
      })
      return
    }
    const { command: spawnCmd, prependArgs } = resolveInterpreter(resolved)

    let ptyProcess: pty.IPty
    try {
      ptyProcess = pty.spawn(spawnCmd, [...prependArgs, ...args], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLORTERM: 'truecolor',
          LANG: process.env.LANG || 'en_US.UTF-8',
          LC_ALL: process.env.LC_ALL || process.env.LANG || 'en_US.UTF-8',
        },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error('Failed to spawn view-PTY', { key, command, message })
      this.send(ws, 'expert:error', {
        agentId,
        chatId,
        error: 'terminal_view_spawn_failed',
        message,
      })
      return
    }

    const view: ViewPty = {
      pty: ptyProcess,
      cwd,
      agentId,
      chatId,
      connectionId,
      cols,
      rows,
      firstChunkSent: false,
    }
    this.views.set(key, view)
    log.info('View-PTY spawned', { key, command, cliSessionId, cwd, pid: ptyProcess.pid })

    // Tell the web client the view-PTY is ready and which agent / cliSessionId
    // it is bound to. Web uses this to pre-populate the ExpertInfo entry (so
    // xterm has a slot to mount) before the first `expert:data` frame arrives.
    this.send(ws, 'expert:view-attached', { agentId, chatId, sessionId: cliSessionId, cwd })

    ptyProcess.onData((data) => {
      this.send(ws, 'expert:data', {
        agentId,
        chatId,
        sessionId: cliSessionId,
        snapshot: !view.firstChunkSent,
        data,
        ptySize: { cols: view.cols, rows: view.rows },
      })
      view.firstChunkSent = true
    })

    ptyProcess.onExit(({ exitCode }) => {
      log.info('View-PTY exited', { key, exitCode })
      this.views.delete(key)
      this.send(ws, 'expert:exit', { agentId, chatId, exitCode: exitCode ?? 0 })
    })
  }

  handleDetach(payload: { chatId: string; agentId: string }, connectionId: string): void {
    const key = keyOf(connectionId, payload.chatId, payload.agentId)
    const view = this.views.get(key)
    if (!view) return
    if (this.pendingDetach.has(key)) return
    log.debug('View-PTY detach scheduled', { key, graceMs: DETACH_GRACE_MS })
    const timer = setTimeout(() => {
      this.pendingDetach.delete(key)
      const current = this.views.get(key)
      if (!current) return
      log.info('View-PTY detach (grace expired)', { key })
      try { current.pty.kill() } catch (err) {
        log.warn('view.pty.kill failed', { key, error: err instanceof Error ? err.message : String(err) })
      }
      this.views.delete(key)
    }, DETACH_GRACE_MS)
    this.pendingDetach.set(key, timer)
  }

  /**
   * Forward web input to the view-PTY when one is active for this target.
   * Returns true if the input was consumed; false if the caller should fall
   * back to the normal ACP path.
   */
  forwardInput(payload: { chatId: string; agentId: string; data: string }, connectionId: string): boolean {
    const view = this.views.get(keyOf(connectionId, payload.chatId, payload.agentId))
    if (!view) return false
    try { view.pty.write(payload.data) } catch (err) {
      log.warn('view.pty.write failed', { connectionId, error: err instanceof Error ? err.message : String(err) })
    }
    return true
  }

  forwardResize(
    payload: { chatId: string; agentId: string; cols: number; rows: number },
    connectionId: string,
  ): boolean {
    const view = this.views.get(keyOf(connectionId, payload.chatId, payload.agentId))
    if (!view) return false
    const cols = payload.cols > 0 ? payload.cols : view.cols
    const rows = payload.rows > 0 ? payload.rows : view.rows
    view.cols = cols
    view.rows = rows
    try { view.pty.resize(cols, rows) } catch (err) {
      log.warn('view.pty.resize failed', { connectionId, error: err instanceof Error ? err.message : String(err) })
    }
    return true
  }

  handleResize(
    payload: { chatId: string; agentId: string; cols: number; rows: number },
    connectionId: string,
  ): void {
    this.forwardResize(payload, connectionId)
  }

  handleDisconnect(connectionId: string): void {
    const toKill: string[] = []
    for (const [key, view] of this.views) {
      if (view.connectionId === connectionId) toKill.push(key)
    }
    for (const key of toKill) {
      this.cancelPendingDetach(key)
      const view = this.views.get(key)
      if (!view) continue
      try { view.pty.kill() } catch { /* best effort */ }
      this.views.delete(key)
      log.info('View-PTY cleaned up on WS disconnect', { key })
    }
  }

  private send(ws: WebSocket, type: string, payload: Record<string, unknown>): void {
    if (ws.readyState !== 1 /* OPEN */) return
    try { ws.send(JSON.stringify({ type, payload })) } catch (err) {
      log.warn('ws.send failed', { type, error: err instanceof Error ? err.message : String(err) })
    }
  }
}
