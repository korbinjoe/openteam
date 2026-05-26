/**
 * IPCBridge — IPC + WebSocket
 *
 *  Express Server  WS Agent  Renderer
 */

import { ipcMain, Notification } from 'electron'
import { WebSocket } from 'ws'
import type { WindowManager } from './WindowManager'
import type { TrayManager, TrayStatus } from './TrayManager'
import { PORTS } from '../../shared/ports'

export const IPC_CHANNELS = {
  AGENT_STATUS_UPDATE: 'companion:agent-status',
  NOTIFICATION: 'companion:notification',
  OPEN_WORKBENCH: 'companion:open-workbench',
  NAVIGATE_TO_CHAT: 'companion:navigate-to-chat',
} as const

/** Debounce window before a mission that went terminal is dropped from
 *  the active set — protects the tray count from `tool_running` ↔
 *  `responding` flicker. */
const ACTIVE_DEBOUNCE_MS = 1500

type TerminalRemovalTimer = ReturnType<typeof setTimeout>

export class IPCBridge {
  private ws: WebSocket | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private serverPort = PORTS.DEV_SERVER
  private reconnectAttempts = 0
  private lastTrayStatus: TrayStatus | null = null
  private notifiedChatIds = new Set<string>()
  private activeMissionChatIds = new Set<string>()
  private pendingRemovals = new Map<string, TerminalRemovalTimer>()

  constructor(
    private windowManager: WindowManager,
    private trayManager: TrayManager,
  ) {}

  setup(): void {
    ipcMain.on(IPC_CHANNELS.OPEN_WORKBENCH, () => {
      this.windowManager.focusMain()
    })
  }

  connectToServer(port: number): void {
    this.serverPort = port
    const url = `ws://localhost:${port}/ws`
    this.doConnect(url)
  }

  destroy(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    for (const pending of this.pendingRemovals.values()) clearTimeout(pending)
    this.pendingRemovals.clear()
    this.activeMissionChatIds.clear()
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    ipcMain.removeAllListeners(IPC_CHANNELS.OPEN_WORKBENCH)
  }

  private doConnect(url: string): void {
    try {
      this.ws = new WebSocket(url)

      this.ws.on('open', () => {
        console.log('[IPCBridge] Connected to server WS')
        this.reconnectAttempts = 0
        this.bootstrapActiveMissions()
      })

      this.ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as { type: string; payload: unknown }
          this.handleServerMessage(msg)
        } catch {
          // ignore parse errors
        }
      })

      this.ws.on('close', () => {
        console.log('[IPCBridge] WS disconnected, will reconnect...')
        this.ws = null
        this.scheduleReconnect(url)
      })

      this.ws.on('error', (err) => {
        console.log(`[IPCBridge] WS error: ${err.message}, will retry...`)
      })
    } catch (err) {
      console.error('[IPCBridge] WS connect failed:', err)
      this.scheduleReconnect(url)
    }
  }

  private scheduleReconnect(url: string): void {
    if (this.reconnectTimer) return
    this.reconnectAttempts++
    const backoff = Math.min(3000 * Math.pow(2, this.reconnectAttempts - 1), 30000)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.doConnect(url)
    }, backoff)
  }

  private handleServerMessage(msg: { type: string; payload: unknown }): void {
    switch (msg.type) {
      case 'chat:activity':
        this.windowManager.sendToAll(IPC_CHANNELS.AGENT_STATUS_UPDATE, msg.payload)
        this.updateTrayFromActivity(msg.payload)
        break
      case 'notification:new':
        this.windowManager.sendToAll(IPC_CHANNELS.NOTIFICATION, msg.payload)
        break
    }
  }

  private updateTrayFromActivity(payload: unknown): void {
    if (!payload || typeof payload !== 'object') return
    const data = payload as {
      phase?: string
      chatId?: string
      expertActivities?: Array<{ agentName: string }>
    }
    const phase = data.phase
    if (!phase) return

    let status: TrayStatus = 'idle'
    if (['thinking', 'tool_running', 'responding', 'initializing'].includes(phase)) {
      status = 'working'
    } else if (phase === 'completed') {
      status = 'completed'
    } else if (phase === 'error') {
      status = 'error'
    }

    if (status === 'working' && data.chatId) {
      this.notifiedChatIds.delete(`${data.chatId}:completed`)
      this.notifiedChatIds.delete(`${data.chatId}:error`)
    }

    if (this.lastTrayStatus !== status) {
      this.lastTrayStatus = status
      this.trayManager.updateStatus(status)
    }

    if (data.chatId) {
      this.trackMissionActivity(data.chatId, status)
    }

    if (status === 'completed' || status === 'error') {
      const agentActivities = (data as { agentActivities?: Array<{ agentName: string }> }).agentActivities
      const agentName = agentActivities?.[0]?.agentName || 'Agent'
      const payloadData = data as { toolCompleted?: number; cost?: number }
      this.showNativeNotification(data.chatId, agentName, status, payloadData.toolCompleted ?? 0, payloadData.cost)
    }
  }

  private showNativeNotification(
    chatId: string | undefined,
    agentName: string,
    status: 'completed' | 'error',
    toolCompleted: number,
    cost?: number,
  ): void {
    if (!Notification.isSupported()) return

    if (chatId) {
      const key = `${chatId}:${status}`
      if (this.notifiedChatIds.has(key)) return
      this.notifiedChatIds.add(key)
    }

    this.buildNotificationBody(chatId, agentName, status, toolCompleted, cost).then((body) => {
      const notification = new Notification({
        title: status === 'completed' ? 'Task Completed' : 'Task Error',
        body,
        silent: false,
      })

      notification.on('click', () => {
        this.windowManager.focusMain()
        if (chatId) {
          this.windowManager.sendToAll(IPC_CHANNELS.NAVIGATE_TO_CHAT, { chatId })
        }
      })

      notification.show()
    }).catch(() => {
      // ignore — notification skipped on error
    })
  }

  private async buildNotificationBody(
    chatId: string | undefined,
    agentName: string,
    status: 'completed' | 'error',
    toolCompleted: number,
    cost?: number,
  ): Promise<string> {
    let label = agentName

    if (chatId) {
      try {
        const res = await fetch(`http://localhost:${this.serverPort}/api/chats/${chatId}`)
        if (res.ok) {
          const chat = await res.json() as { title?: string }
          if (chat.title) label = chat.title
        }
      } catch { /* fallback to agentName */ }
    }

    const parts: string[] = [label]
    if (toolCompleted > 0) parts.push(`${toolCompleted} tools`)
    if (cost && cost > 0) parts.push(`$${cost.toFixed(3)}`)
    if (status === 'error') parts.push('error')

    return parts.join(' · ')
  }

  /** Updates the active-mission set in response to a chat:activity event.
   *  Running missions are added immediately; terminal missions are
   *  removed only after `ACTIVE_DEBOUNCE_MS` of continuous non-running
   *  state, so quick `tool_running` ↔ `responding` churn does not
   *  flicker the tray count. */
  private trackMissionActivity(chatId: string, status: TrayStatus): void {
    if (status === 'working') {
      const pending = this.pendingRemovals.get(chatId)
      if (pending) {
        clearTimeout(pending)
        this.pendingRemovals.delete(chatId)
      }
      if (!this.activeMissionChatIds.has(chatId)) {
        this.activeMissionChatIds.add(chatId)
        this.publishMissionCount()
      }
      return
    }

    if (!this.activeMissionChatIds.has(chatId)) return
    if (this.pendingRemovals.has(chatId)) return

    const timer = setTimeout(() => {
      this.pendingRemovals.delete(chatId)
      if (this.activeMissionChatIds.delete(chatId)) {
        this.publishMissionCount()
      }
    }, ACTIVE_DEBOUNCE_MS)
    this.pendingRemovals.set(chatId, timer)
  }

  private publishMissionCount(): void {
    this.trayManager.setMissionCount(this.activeMissionChatIds.size)
  }

  /** Seeds the active-mission set from the server snapshot whenever the
   *  WS reconnects, so the tray count doesn't read `● 0` while we wait
   *  for the next activity event. */
  private async bootstrapActiveMissions(): Promise<void> {
    try {
      const res = await fetch(`http://localhost:${this.serverPort}/api/tray/active-missions`)
      if (!res.ok) return
      const body = await res.json() as { missions: Array<{ chatId: string }> }
      for (const pending of this.pendingRemovals.values()) clearTimeout(pending)
      this.pendingRemovals.clear()
      this.activeMissionChatIds = new Set(body.missions.map((m) => m.chatId))
      this.publishMissionCount()
    } catch {
      // fall back to event-driven updates
    }
  }
}
