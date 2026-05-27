/**
 * TrayPanelManager — owns the frameless BrowserWindow that appears under
 * the macOS tray icon when the user left-clicks it. Lazy-creates the
 * window on first toggle, keeps it hidden between opens (so subsequent
 * toggles are instant), and auto-hides on blur.
 */

import { BrowserWindow, screen, ipcMain, type Rectangle } from 'electron'
import type { WindowManager } from './WindowManager'
import { PORTS } from '../../shared/ports'

const PANEL_WIDTH = 280
const PANEL_HEIGHT = 320
const TRAY_GAP_Y = 4

export const TRAY_IPC = {
  PANEL_READY: 'tray:panel-ready',
  OPEN_MISSION: 'tray:open-mission',
  OPEN_WORKBENCH_FROM_TRAY: 'tray:open-workbench',
  GET_SERVER_PORT: 'tray:get-server-port',
} as const

export class TrayPanelManager {
  private panelWindow: BrowserWindow | null = null
  private serverPort = PORTS.DEV_SERVER

  constructor(
    private windowManager: WindowManager,
    private isDev: boolean,
    private preloadPath: string,
  ) {}

  setServerPort(port: number): void {
    this.serverPort = port
  }

  setup(): void {
    ipcMain.on(TRAY_IPC.OPEN_MISSION, (_e, payload: { chatId: string }) => {
      if (!payload?.chatId) return
      this.windowManager.focusMain()
      this.windowManager.sendToAll('companion:navigate-to-chat', { chatId: payload.chatId })
      this.hide()
    })

    ipcMain.on(TRAY_IPC.OPEN_WORKBENCH_FROM_TRAY, () => {
      this.windowManager.focusMain()
      this.hide()
    })

    ipcMain.handle(TRAY_IPC.GET_SERVER_PORT, () => this.serverPort)
  }

  /** Toggle the panel visibility, positioning it under the tray icon. */
  toggle(trayBounds: Rectangle | undefined): void {
    if (this.panelWindow && this.panelWindow.isVisible()) {
      this.hide()
      return
    }
    this.show(trayBounds)
  }

  show(trayBounds: Rectangle | undefined): void {
    if (!this.panelWindow) this.createPanelWindow()
    if (!this.panelWindow) return

    const position = this.computePosition(trayBounds)
    this.panelWindow.setPosition(position.x, position.y, false)
    this.panelWindow.show()
    this.panelWindow.focus()
  }

  hide(): void {
    this.panelWindow?.hide()
  }

  destroy(): void {
    ipcMain.removeAllListeners(TRAY_IPC.OPEN_MISSION)
    ipcMain.removeAllListeners(TRAY_IPC.OPEN_WORKBENCH_FROM_TRAY)
    ipcMain.removeHandler(TRAY_IPC.GET_SERVER_PORT)
    this.panelWindow?.destroy()
    this.panelWindow = null
  }

  private createPanelWindow(): void {
    this.panelWindow = new BrowserWindow({
      width: PANEL_WIDTH,
      height: PANEL_HEIGHT,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: true,
      resizable: false,
      movable: false,
      skipTaskbar: true,
      show: false,
      alwaysOnTop: true,
      webPreferences: {
        preload: this.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    this.panelWindow.setAlwaysOnTop(true, 'pop-up-menu')
    this.panelWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    const url = this.isDev
      ? `http://localhost:${PORTS.DEV_UI}/web/tray-panel/index.html`
      : `http://localhost:${this.serverPort}/tray-panel/index.html`
    this.panelWindow.loadURL(url)

    this.panelWindow.on('blur', () => {
      if (!this.panelWindow) return
      if (this.panelWindow.webContents.isDevToolsFocused()) return
      this.panelWindow.hide()
    })

    this.panelWindow.on('closed', () => {
      this.panelWindow = null
    })
  }

  private computePosition(trayBounds: Rectangle | undefined): { x: number; y: number } {
    const cursorPoint = screen.getCursorScreenPoint()
    const anchor = trayBounds && trayBounds.width > 0
      ? { x: trayBounds.x + trayBounds.width / 2, y: trayBounds.y + trayBounds.height }
      : { x: cursorPoint.x, y: cursorPoint.y + 22 }

    const display = screen.getDisplayNearestPoint(anchor)
    const { workArea } = display

    let x = Math.round(anchor.x - PANEL_WIDTH / 2)
    let y = Math.round(anchor.y + TRAY_GAP_Y)

    x = Math.min(Math.max(x, workArea.x + 8), workArea.x + workArea.width - PANEL_WIDTH - 8)
    y = Math.min(Math.max(y, workArea.y + 4), workArea.y + workArea.height - PANEL_HEIGHT - 8)

    return { x, y }
  }
}
