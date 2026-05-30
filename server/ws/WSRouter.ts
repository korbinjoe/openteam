
import type { WebSocket } from 'ws'
import { ExpertHandler } from './ExpertHandler'
import { ShellHandler } from './ShellHandler'
import { GitWatchHandler } from './GitWatchHandler'
import { ShellManager } from '../terminal/ShellManager'
import type { TerminalViewManager } from '../terminal/TerminalViewManager'
import type { SenseiUpgradeService } from '../services/update/SenseiUpgradeService'
import type { ChatStore } from '../stores/ChatStore'
import type { WorkspaceStore } from '../stores/WorkspaceStore'
import type { DevInspector } from '../dev/DevInspector'
import type { GitWatchManager } from '../git/GitWatchManager'
import type { ExecutionModeRouter } from '../orchestration/ExecutionModeRouter'
import { createLogger } from '../lib/logger'
import { trackEvent } from '../lib/eventTracker'

const log = createLogger('WSRouter')

export class WSRouter {
  private expertHandler: ExpertHandler
  private shellHandler: ShellHandler
  private gitWatchHandler?: GitWatchHandler
  private terminalViewManager?: TerminalViewManager
  private senseiUpgradeService?: SenseiUpgradeService
  private chatStore?: ChatStore
  private workspaceStore?: WorkspaceStore
  private devInspector?: DevInspector
  private broadcast?: (msg: Record<string, unknown>) => void
  private executionModeRouter?: ExecutionModeRouter

  constructor(deps: {
    expertHandler: ExpertHandler
    gitWatchManager?: GitWatchManager
    terminalViewManager?: TerminalViewManager
    senseiUpgradeService?: SenseiUpgradeService
    chatStore?: ChatStore
    workspaceStore?: WorkspaceStore
    devInspector?: DevInspector
    broadcast?: (msg: Record<string, unknown>) => void
    executionModeRouter?: ExecutionModeRouter
  }) {
    this.expertHandler = deps.expertHandler
    this.terminalViewManager = deps.terminalViewManager
    this.senseiUpgradeService = deps.senseiUpgradeService
    this.chatStore = deps.chatStore
    this.workspaceStore = deps.workspaceStore
    this.devInspector = deps.devInspector
    this.broadcast = deps.broadcast
    this.executionModeRouter = deps.executionModeRouter

    const shellManager = new ShellManager()
    this.shellHandler = new ShellHandler(shellManager)

    if (deps.gitWatchManager) {
      this.gitWatchHandler = new GitWatchHandler(deps.gitWatchManager)
    }
  }

  handle(ws: WebSocket, message: { type: string; payload: any }, connectionId: string): void {
    const { type, payload } = message

    if (type === 'expert:start') {
      if (this.executionModeRouter && payload.agentId === 'lead' && payload.task) {
        const decision = this.executionModeRouter.classify(payload.task)
        if (decision.tier === 'single-expert' && decision.agentId) {
          log.info('T1 direct routing', { targetAgent: decision.agentId, confidence: decision.confidence, task: payload.task?.slice(0, 60) })
          this.expertHandler.handleStart(ws, { ...payload, agentId: decision.agentId, executionMode: 't1' }, connectionId)
          return
        }
      }
      this.expertHandler.handleStart(ws, payload, connectionId)
      return
    }
    if (type === 'expert:cli-attach') {
      this.terminalViewManager?.handleAttach(ws, payload, connectionId).catch((err) => {
        log.error('expert:cli-attach error', { error: err instanceof Error ? err.message : String(err) })
      })
      return
    }
    if (type === 'expert:cli-detach') {
      this.terminalViewManager?.handleDetach(payload, connectionId)
      return
    }
    if (type === 'expert:input') {
      if (this.terminalViewManager?.forwardInput(payload, connectionId)) return
      this.expertHandler.handleInput(ws, payload, connectionId)
      return
    }
    if (type === 'expert:resize') {
      if (this.terminalViewManager?.forwardResize(payload, connectionId)) return
      this.expertHandler.handleResize(ws, payload, connectionId)
      return
    }
    if (type === 'expert:direct-input') {
      this.expertHandler.handleDirectInput(ws, payload, connectionId).catch((err) => {
        log.error('expert:direct-input error', { error: err instanceof Error ? err.message : String(err) })
        ws.send(JSON.stringify({
          type: 'expert:error',
          payload: { chatId: payload.chatId, agentId: payload.agentId, message: err instanceof Error ? err.message : 'Failed to send direct input' },
        }))
      })
      return
    }
    if (type === 'expert:stop') {
      this.expertHandler.handleStop(ws, payload, connectionId)
      return
    }
    if (type === 'expert:stop-all') {
      this.expertHandler.handleStopAll(ws, connectionId)
      return
    }
    if (type === 'expert:list') {
      this.expertHandler.handleList(ws, connectionId, payload?.chatId)
      return
    }
    if (type === 'expert:clear-completed') {
      this.expertHandler.clearCompleted(connectionId, payload?.chatId)
      return
    }
    if (type === 'expert:permission-response') {
      this.expertHandler.handlePermissionResponse(ws, payload, connectionId)
      return
    }
    if (type === 'expert:user-input') {
      this.expertHandler.handleUserInput(ws, payload, connectionId).catch((err) => {
        log.error('expert:user-input error', { error: err instanceof Error ? err.message : String(err) })
      })
      return
    }

    // Sensei CapabilitiesUpgrade
    if (type === 'sensei:upgrade') {
      if (this.senseiUpgradeService) {
        this.senseiUpgradeService.start({
          agentId: payload.agentId,
          markdown: payload.markdown,
          connectionId,
        }).catch((err) => {
          log.error('sensei:upgrade error', { error: err instanceof Error ? err.message : String(err) })
        })
      }
      return
    }
    if (type === 'sensei:cancel') {
      this.senseiUpgradeService?.cancel(connectionId)
      return
    }
    if (type === 'sensei:generate') {
      if (this.senseiUpgradeService) {
        this.senseiUpgradeService.generate({
          agentId: payload.agentId ?? 'new',
          description: payload.description ?? '',
          connectionId,
        }).catch((err) => {
          log.error('sensei:generate error', { error: err instanceof Error ? err.message : String(err) })
        })
      }
      return
    }

    if (type === 'chat:set-context') {
      if (payload.chatId) this.expertHandler.setChatId(connectionId, payload.chatId)
      return
    }
    if (type === 'chat:resume-experts') {
      if (payload.chatId) {
        this.expertHandler.resumeFromChat(ws, payload.chatId, connectionId).catch((err) => {
          log.error('resumeFromChat error', { error: err instanceof Error ? err.message : String(err) })
        })

      }
      return
    }

    if (type === 'telemetry:track') {
      if (payload?.category && payload?.event) {
        trackEvent(
          payload.category as string,
          payload.event as string,
          { ...(payload.properties as Record<string, unknown> | undefined), connectionId },
        )
      }
      return
    }

    if (type === 'git:subscribe') {
      this.gitWatchHandler?.handleSubscribe(ws, payload, connectionId)
      return
    }
    if (type === 'git:unsubscribe') {
      this.gitWatchHandler?.handleUnsubscribe(payload, connectionId)
      return
    }

    if (type === 'shell:precreate') {
      this.shellHandler.handlePrecreate(ws, payload, connectionId)
      return
    }
    if (type === 'shell:create') {
      this.shellHandler.handleCreate(ws, payload, connectionId)
      return
    }
    if (type === 'shell:input') {
      this.shellHandler.handleInput(ws, payload, connectionId)
      return
    }
    if (type === 'shell:resize') {
      this.shellHandler.handleResize(ws, payload, connectionId)
      return
    }
    if (type === 'shell:destroy') {
      this.shellHandler.handleDestroy(ws, payload, connectionId)
      return
    }

    // Dev Panel
    if (type.startsWith('dev:') && this.devInspector) {
      this.handleDevMessage(ws, type, payload, connectionId)
      return
    }

    log.warn('Unknown ws message type', { type, connectionId })
    ws.send(JSON.stringify({
      type: 'error',
      payload: { message: `Unknown message type: ${type}` },
    }))
  }

  /** WS  DevInspector  + Shell  + Git watcher  + Sensei  */
  handleDisconnect(ws: WebSocket, connectionId?: string): void {
    this.devInspector?.cleanupWs(ws)
    if (connectionId) {
      this.shellHandler.handleDisconnect(connectionId)
      this.gitWatchHandler?.handleDisconnect(connectionId)
      this.terminalViewManager?.handleDisconnect(connectionId)
      this.senseiUpgradeService?.cancel(connectionId)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private handleDevMessage(ws: WebSocket, type: string, payload: any, _connectionId: string): void {
    if (!this.devInspector) return
    const chatId = payload?.chatId as string

    switch (type) {
      case 'dev:subscribe':
        if (chatId) this.devInspector.subscribe(chatId, ws)
        break
      case 'dev:unsubscribe':
        if (chatId) this.devInspector.unsubscribe(chatId, ws)
        break
      case 'dev:snapshot':
        if (chatId) {
          this.devInspector.collectSnapshot(chatId).then((snapshot) => {
            ws.send(JSON.stringify({ type: 'dev:snapshot', payload: snapshot }))
          }).catch((err) => {
            log.error('dev:snapshot error', { error: err instanceof Error ? err.message : String(err) })
          })
        }
        break
      case 'dev:action':
        if (chatId && payload?.action) {
          this.devInspector.executeAction(chatId, payload.action, payload.params).then((result) => {
            ws.send(JSON.stringify({ type: 'dev:action-result', payload: { chatId, action: payload.action, ...result } }))
            if (result.success) {
              this.devInspector!.collectSnapshot(chatId).then((snapshot) => {
                ws.send(JSON.stringify({ type: 'dev:snapshot', payload: snapshot }))
              }).catch(() => {})
            }
          }).catch((err) => {
            log.error('dev:action error', { error: err instanceof Error ? err.message : String(err) })
          })
        }
        break
      case 'dev:jsonl-read':
        if (chatId && payload?.sessionId) {
          try {
            const result = this.devInspector.readJsonlContent(chatId, payload.sessionId)
            ws.send(JSON.stringify({ type: 'dev:jsonl-content', payload: { chatId, sessionId: payload.sessionId, ...result } }))
          } catch (err) {
            log.error('dev:jsonl-read error', { error: err instanceof Error ? err.message : String(err) })
          }
        }
        break
      case 'dev:raw-jsonl':
        if (chatId && payload?.sessionId) {
          this.devInspector.readRawJsonl(chatId, payload.sessionId).then((result) => {
            ws.send(JSON.stringify({ type: 'dev:raw-jsonl-content', payload: { chatId, sessionId: payload.sessionId, ...result } }))
          }).catch((err) => {
            log.error('dev:raw-jsonl error', { error: err instanceof Error ? err.message : String(err) })
          })
        }
        break
      case 'dev:pipeline':
        if (chatId) {
          this.devInspector.collectPipelineState(chatId).then((pipeline) => {
            ws.send(JSON.stringify({ type: 'dev:pipeline', payload: { chatId, ...pipeline } }))
          }).catch((err) => {
            log.error('dev:pipeline error', { error: err instanceof Error ? err.message : String(err) })
          })
        }
        break
      case 'dev:timeline':
        if (chatId) {
          try {
            const entries = this.devInspector.collectTimeline(chatId, payload?.taskId as string | undefined, payload?.limit as number | undefined)
            ws.send(JSON.stringify({ type: 'dev:timeline', payload: { chatId, entries } }))
          } catch (err) {
            log.error('dev:timeline error', { error: err instanceof Error ? err.message : String(err) })
          }
        }
        break
    }
  }
}
