/**
 * StreamJsonManager - Agent
 *
 *  child_process.spawn  CLI
 * stdin/stdout JSON
 *
 *   spawn / write / kill / isAlive / getSessionId / getCliSessionId / getPid / getCurrentMessages
 */

import { spawn, type ChildProcess } from 'child_process'
import { createInterface, type Interface as ReadlineInterface } from 'readline'
import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { existsSync } from 'fs'
import { ActivityDeriver } from './ActivityDeriver'
import {
  createStreamParserState,
  parseStreamJsonLine,
  type StreamParserState,
} from './StreamJsonParser'
import type { ParsedMessage } from './ConversationParser'
import type { CliProvider } from '../config/types'
import { createLogger } from '../lib/logger'
import { trackEvent } from '../lib/eventTracker'
import { resolveCliCommandAsync, resolveInterpreter } from '../lib/resolveCliCommand'

const log = createLogger('StreamJsonManager')

export interface StreamJsonOptions {
  command: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  provider?: CliProvider
}

export class StreamJsonManager extends EventEmitter {
  private child: ChildProcess | null = null
  private readline: ReadlineInterface | null = null
  private sessionId: string
  private cliSessionId: string | null = null
  private provider: CliProvider = 'claude'
  private parserState: StreamParserState
  private activityDeriver: ActivityDeriver
  private startTime: number = 0
  private lastOutputAt: number = 0
  /** spawn  hang 30s  → warn + emit cli-hang */
  private hangProbeTimer: ReturnType<typeof setTimeout> | null = null
  private readonly HANG_PROBE_MS = 30_000

  constructor(sessionId?: string) {
    super()
    this.sessionId = sessionId || randomUUID()
    this.parserState = createStreamParserState()
    this.activityDeriver = new ActivityDeriver()

    this.activityDeriver.on('activity', (state) => {
      this.emit('activity', state)
    })
  }

  async spawn(options: StreamJsonOptions): Promise<void> {
    if (this.child) {
      throw new Error('StreamJson session already started')
    }

    const { command, args, env = {} } = options
    let cwd = options.cwd || process.cwd()

    if (!existsSync(cwd)) {
      const fallbackCwd = process.cwd()
      log.warn('CWD does not exist, falling back', { sid: this.sessionId, cwd, fallback: fallbackCwd })
      cwd = fallbackCwd
    }

    log.info('Spawning stream-json process', { sid: this.sessionId, command, cwd })

    const resolvedCommand = await resolveCliCommandAsync(command)
    if (!resolvedCommand) {
      const error = new Error(`Command not found: ${command}. Please check if the command exists in PATH or provide an absolute path.`)
      log.error('Command not found', { sid: this.sessionId, command })
      throw error
    }

    const { command: spawnCommand, prependArgs } = resolveInterpreter(resolvedCommand)

    try {
      this.child = spawn(spawnCommand, [...prependArgs, ...args], {
        cwd,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ...env,
        },
      })

      this.startTime = Date.now()
      this.provider = options.provider || 'claude'

      if (this.provider === 'codex') {
        this.child.stdin?.end()
      }

      this.lastOutputAt = Date.now()

      this.readline = createInterface({ input: this.child.stdout! })
      this.readline.on('line', (line) => {
        this.lastOutputAt = Date.now()
        this.handleStdoutLine(line)
      })

      this.hangProbeTimer = setTimeout(() => {
        const silentMs = Date.now() - this.lastOutputAt
        if (silentMs >= this.HANG_PROBE_MS && this.child) {
          log.warn('CLI process silent — no stdout/stderr since spawn', {
            sid: this.sessionId,
            pid: this.child.pid,
            provider: this.provider,
            silentMs,
          })
          trackEvent('agent', 'agent.cli_hang_detected', {
            sessionId: this.sessionId, provider: this.provider, silentMs,
          })
          this.emit('cli-hang', { silentMs })
        }
      }, this.HANG_PROBE_MS)

      this.child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString().trim()
        if (text) {
          const level = /error|reconnect|disconnect|fail|rate.?limit|quota|unauthor|forbidden/i.test(text) ? 'warn' : 'info'
          log[level]('stderr', { sid: this.sessionId, provider: this.provider, text: text.slice(0, 500) })
          this.lastOutputAt = Date.now()
        }
      })

      this.child.on('close', (exitCode, signal) => {
        const level = (exitCode === 0 || exitCode === null) ? 'info' : 'warn'
        log[level]('Process exited', { sid: this.sessionId, exitCode, signal })
        if (this.hangProbeTimer) {
          clearTimeout(this.hangProbeTimer)
          this.hangProbeTimer = null
        }
        if (this.readline) {
          this.readline.close()
          this.readline = null
        }
        this.activityDeriver.onProcessExit(exitCode ?? 1)
        this.emit('exit', { exitCode, signal })
        this.child = null
      })

      this.child.on('error', (err) => {
        log.error('Process error', { sid: this.sessionId, error: err.message })
        trackEvent('agent', 'agent.stream_json_spawn_failed', { sessionId: this.sessionId, error: err.message })
        this.emit('exit', { exitCode: 1, signal: null })
        this.child = null
      })

      log.info('Process started', { sid: this.sessionId, pid: this.child.pid })
      this.emit('started', { sessionId: this.sessionId, pid: this.child.pid })
    } catch (error) {
      log.error('Failed to spawn', { sid: this.sessionId, error: error instanceof Error ? error.message : String(error) })
      trackEvent('agent', 'agent.stream_json_spawn_failed', { sessionId: this.sessionId, error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }

  /**
   *  stdinstream-json
   * images  base64  multimodal content
   */
  write(message: string, images?: Array<{ data: string; mediaType: string }>): void {
    if (!this.child || !this.child.stdin) {
      throw new Error('StreamJson session not started')
    }

    log.debug('Writing to stdin', { sid: this.sessionId, length: message.length, imageCount: images?.length ?? 0, provider: this.provider })
    this.activityDeriver.onUserInput()

    if (this.provider === 'codex') {
      this.child.stdin.write(message)
      this.child.stdin.end()
      return
    }

    const content = images?.length
      ? [
          ...images.map((img) => ({
            type: 'image' as const,
            source: { type: 'base64' as const, media_type: img.mediaType, data: img.data },
          })),
          { type: 'text' as const, text: message },
        ]
      : message

    const payload = JSON.stringify({
      type: 'user',
      message: { role: 'user', content },
    })

    this.child.stdin.write(payload + '\n')
  }

  kill(signal: string = 'SIGTERM'): void {
    if (!this.child) {
      log.warn('Cannot kill: session not started', { sid: this.sessionId })
      return
    }
    log.info('Killing process', { sid: this.sessionId, signal })
    this.activityDeriver.destroy()
    if (this.hangProbeTimer) {
      clearTimeout(this.hangProbeTimer)
      this.hangProbeTimer = null
    }
    if (this.readline) {
      this.readline.close()
      this.readline = null
    }
    this.child.kill(signal as NodeJS.Signals)
    this.child = null
  }

  getPid(): number | undefined {
    return this.child?.pid
  }

  getSessionId(): string {
    return this.sessionId
  }

  isAlive(): boolean {
    return this.child !== null
  }

  getUptime(): number {
    if (!this.child) return 0
    return Date.now() - this.startTime
  }

  /**
   *  CLI  session ID system.init
   */
  getCliSessionId(): string | null {
    return this.cliSessionId
  }

  getProvider(): CliProvider {
    return this.provider
  }

  getCurrentMessages(): ParsedMessage[] | null {
    return this.parserState.messages.length > 0
      ? [...this.parserState.messages]
      : null
  }

  /** stream-json  JSONL watcher */
  isWatcherReady(): boolean { return true }

  /** stream-json  setCliSessionId init  */
  setCliSessionId(_sid: string): void { /* no-op */ }

  forceRedraw(): void { /* no-op */ }

  /** stream-json  SessionFileWatcher  */
  restartSessionFileWatcher(): void { /* no-op */ }

  getInspectState() {
    return {
      streamJson: {
        alive: this.isAlive(),
        pid: this.getPid() ?? null,
        spawnedAt: this.startTime || null,
        provider: this.provider,
        cliSessionId: this.cliSessionId,
        messageCount: this.parserState.messages.length,
        turnIndex: this.parserState.turnIndex,
        model: this.parserState.model,
      },
      activity: this.activityDeriver.getInspectState(),
    }
  }

  private handleStdoutLine(line: string): void {
    const result = parseStreamJsonLine(line, this.parserState)

    if (result.systemEvent) {
      const { subtype, sessionId } = result.systemEvent
      if (subtype === 'init') {
        if (sessionId) {
          this.cliSessionId = sessionId as string
          log.info('CLI session ID extracted', { sid: this.sessionId, cliSessionId: this.cliSessionId })
          this.emit('cli-session-id', this.cliSessionId)
        }
        // Always emit cli-init on system init so downstream can merge plugin
        // commands even when the CLI itself reports no built-in slash commands
        // (stream-json mode returns an empty slash_commands list).
        const slashCommands = (result.systemEvent.slashCommands as string[] | undefined) ?? []
        this.emit('cli-init', {
          sessionId: sessionId as string,
          slashCommands,
          model: result.systemEvent.model as string | undefined,
        })
      }
    }

    if (result.newMessages.length > 0) {
      this.emit('session:structured-message', {
        type: 'delta',
        messages: result.newMessages,
        replacedStatsId: null,
      })
      this.activityDeriver.onDeltaMessages(result.newMessages)
    }

    if (result.partialText) {
      this.emit('session:partial-text', result.partialText)
    }
  }
}
