/**
 * TrayManager —
 *
 * macOS Template Image
 */

import { Tray, Menu, nativeImage, app } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { WindowManager } from './WindowManager'
import type { TrayPanelManager } from './TrayPanelManager'

export type TrayStatus = 'idle' | 'working' | 'completed' | 'error'

const STATUS_LABELS: Record<TrayStatus, string> = {
  idle: 'Idle',
  working: 'Working...',
  completed: 'Completed',
  error: 'Error',
}

/**
 *  Tray
 *  electron/assets/
 * macOS Template Image +
 */
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
  /**  MenuItem  Menu  macOS representedObject  */
  private statusMenuItem: Electron.MenuItem | null = null

  constructor(
    private windowManager: WindowManager,
    private trayPanelManager?: TrayPanelManager,
  ) {}

  onStatusChange(cb: (status: TrayStatus) => void): void {
    this.onStatusChangeCallback = cb
  }

  create(): void {
    try {
      const icon = createTrayIcon()
      this.tray = new Tray(icon)
      this.tray.setToolTip('OpenTeam')
      this.buildContextMenu()

      this.tray.on('click', () => {
        if (this.trayPanelManager) {
          this.trayPanelManager.toggle(this.tray?.getBounds())
        } else {
          this.windowManager.focusMain()
        }
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
    if (this.statusMenuItem) {
      this.statusMenuItem.label = STATUS_LABELS[status]
    }
    this.onStatusChangeCallback?.(status)
  }

  setMissionCount(count: number): void {
    this.tray?.setTitle(count > 0 ? `● ${count}` : '')
  }

  destroy(): void {
    this.statusMenuItem = null
    this.tray?.destroy()
    this.tray = null
  }

  /**  create  statusMenuItem  label */
  private buildContextMenu(): void {
    const menu = Menu.buildFromTemplate([
      {
        label: 'Show OpenTeam',
        click: () => this.windowManager.focusMain(),
      },
      { type: 'separator' },
      {
        label: STATUS_LABELS[this.status],
        enabled: false,
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => app.quit(),
      },
    ])
    this.statusMenuItem = menu.items[2] ?? null
    this.tray?.setContextMenu(menu)
  }
}
