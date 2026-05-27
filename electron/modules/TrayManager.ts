/**
 * TrayManager — macOS tray icon with native context menu showing active missions.
 */

import { Tray, Menu, nativeImage, app } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { WindowManager } from './WindowManager'
import type { TrayActiveMissionsResponse } from '../../shared/tray-types'
import { PORTS } from '../../shared/ports'

export type TrayStatus = 'idle' | 'working' | 'completed' | 'error'

const STATUS_LABELS: Record<TrayStatus, string> = {
  idle: 'Idle',
  working: 'Working...',
  completed: 'Completed',
  error: 'Error',
}

const ATTENTION_PHASES = new Set(['waiting_input', 'waiting_confirmation', 'error'])

const PHASE_LABELS: Record<string, string> = {
  tool_running: '⚡ Running',
  thinking: '💭 Thinking',
  responding: '✍️ Writing',
  initializing: '🔄 Starting',
  waiting_input: '⏳ Waiting',
  waiting_confirmation: '⏳ Confirming',
  error: '❌ Error',
}

const createTrayIcon = (): Electron.NativeImage => {
  const __dirname2 = dirname(fileURLToPath(import.meta.url))
  const isDev = !app.isPackaged
  const iconPath = isDev
    ? join(__dirname2, '../../electron/assets/trayIconTemplate.png')
    : join(process.resourcesPath, 'ai-assets/tray/trayIconTemplate.png')

  const img = nativeImage.createFromPath(iconPath)

  if (img.isEmpty()) {
    console.warn('[TrayManager] Icon file failed:', iconPath)
    return nativeImage.createEmpty()
  }

  if (process.platform === 'darwin') {
    img.setTemplateImage(true)
  }
  return img
}

export class TrayManager {
  private tray: Tray | null = null
  private status: TrayStatus = 'idle'
  private onStatusChangeCallback: ((status: TrayStatus) => void) | null = null
  private serverPort = PORTS.DEV_SERVER

  constructor(
    private windowManager: WindowManager,
  ) {}

  setServerPort(port: number): void {
    this.serverPort = port
  }

  onStatusChange(cb: (status: TrayStatus) => void): void {
    this.onStatusChangeCallback = cb
  }

  create(): void {
    try {
      const icon = createTrayIcon()
      this.tray = new Tray(icon)
      this.tray.setToolTip('OpenTeam')

      this.tray.on('click', () => {
        this.showMissionsMenu()
      })

      console.log('[TrayManager] Tray created')
    } catch (err) {
      console.error('[TrayManager] Failed to create tray:', err)
    }
  }

  updateStatus(status: TrayStatus): void {
    if (this.status === status) return
    this.status = status
    this.tray?.setToolTip(`OpenTeam — ${STATUS_LABELS[status]}`)
    this.onStatusChangeCallback?.(status)
  }

  setMissionCount(count: number): void {
    this.tray?.setTitle(count > 0 ? `${count}` : '')
  }

  destroy(): void {
    this.tray?.destroy()
    this.tray = null
  }

  private async showMissionsMenu(): Promise<void> {
    if (!this.tray) return

    const template: Electron.MenuItemConstructorOptions[] = []

    try {
      const res = await fetch(`http://localhost:${this.serverPort}/api/tray/active-missions`)
      if (res.ok) {
        const body = (await res.json()) as TrayActiveMissionsResponse
        if (body.missions.length > 0) {
          const needsAttention = body.missions.filter(m => ATTENTION_PHASES.has(m.topPhase))
          const running = body.missions.filter(m => !ATTENTION_PHASES.has(m.topPhase))

          if (needsAttention.length > 0) {
            template.push({ label: 'Needs Your Attention', enabled: false })
            for (const mission of needsAttention) {
              template.push(this.buildMissionItem(mission))
            }
            template.push({ type: 'separator' })
          }

          if (running.length > 0) {
            template.push({ label: 'Running', enabled: false })
            for (const mission of running) {
              template.push(this.buildMissionItem(mission))
            }
            template.push({ type: 'separator' })
          }
        }
      }
    } catch {
      // Server offline — show fallback menu
    }

    if (template.length === 0) {
      template.push({ label: 'No active missions', enabled: false })
      template.push({ type: 'separator' })
    }

    template.push({
      label: 'Open OpenTeam',
      click: () => this.windowManager.focusMain(),
    })
    template.push({ type: 'separator' })
    template.push({
      label: 'Quit',
      click: () => app.quit(),
    })

    const menu = Menu.buildFromTemplate(template)
    this.tray.popUpContextMenu(menu)
  }

  private buildMissionItem(mission: TrayActiveMissionsResponse['missions'][number]): Electron.MenuItemConstructorOptions {
    const runningCount = mission.agents.filter(a => a.phase !== 'completed').length
    const phaseLabel = PHASE_LABELS[mission.topPhase] ?? mission.topPhase
    const sublabel = `${phaseLabel} · ${runningCount} agent${runningCount > 1 ? 's' : ''}`

    return {
      label: mission.title || 'Untitled Mission',
      sublabel,
      click: () => {
        this.windowManager.focusMain()
        this.windowManager.sendToAll('companion:navigate-to-chat', { chatId: mission.chatId })
      },
    }
  }
}
