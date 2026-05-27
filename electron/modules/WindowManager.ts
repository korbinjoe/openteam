/**
 * WindowManager — Electron
 *
 *  IPC
 */

import { BrowserWindow, shell } from 'electron'
import { existsSync } from 'fs'
import { PORTS } from '../../shared/ports'

export class WindowManager {
  private mainWindow: BrowserWindow | null = null

  createMainWindow(serverPort: number, isDev: boolean, preloadPath?: string, options?: { deferShow?: boolean }): BrowserWindow {
    const validPreload = preloadPath && existsSync(preloadPath) ? preloadPath : undefined
    if (preloadPath && !validPreload) {
      console.warn(`[WindowManager] Preload not found: ${preloadPath}`)
    }

    this.mainWindow = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 900,
      minHeight: 600,
      show: false,
      backgroundColor: '#09090b',
      titleBarStyle: 'hiddenInset',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        ...(validPreload ? { preload: validPreload } : {}),
      },
    })

    if (!options?.deferShow) {
      this.mainWindow.once('ready-to-show', () => {
        this.mainWindow?.show()
      })
    }

    const url = isDev ? `http://localhost:${PORTS.DEV_UI}` : `http://localhost:${serverPort}`
    console.log(`[WindowManager] Loading: ${url} (preload: ${validPreload || 'none'})`)

    this.mainWindow.loadURL(url)

    if (isDev) {
      this.mainWindow.webContents.openDevTools()
    }

    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    const isInternalUrl = (target: string): boolean => {
      try {
        const u = new URL(target)
        if (u.protocol === 'file:') return true
        return u.hostname === 'localhost' || u.hostname === '127.0.0.1'
      } catch {
        return false
      }
    }

    this.mainWindow.webContents.on('will-navigate', (e, target) => {
      if (!isInternalUrl(target)) {
        e.preventDefault()
        shell.openExternal(target)
      }
    })

    this.mainWindow.webContents.on('will-redirect', (e, target) => {
      if (!isInternalUrl(target)) {
        e.preventDefault()
        shell.openExternal(target)
      }
    })

    this.mainWindow.webContents.on('before-input-event', (e, input) => {
      const isRefresh =
        (input.key === 'r' && (input.meta || input.control)) ||
        input.key === 'F5'
      if (isRefresh && !isDev) {
        e.preventDefault()
      }
      if (input.key === 'd' && input.shift && (input.meta || input.control)) {
        e.preventDefault()
        this.mainWindow?.webContents.sendInputEvent({
          type: 'keyDown',
          keyCode: 'D',
          modifiers: ['shift', ...(input.meta ? ['meta' as const] : ['control' as const])],
        })
      }
    })

    this.mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
      console.error(`[WindowManager] Page load failed: ${code} ${desc}`)
    })

    this.mainWindow.on('closed', () => {
      this.mainWindow = null
    })

    return this.mainWindow
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  focusMain(): void {
    if (!this.mainWindow) return
    if (this.mainWindow.isMinimized()) this.mainWindow.restore()
    this.mainWindow.show()
    this.mainWindow.focus()
  }

  sendToAll(channel: string, data: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(channel, data)
    }
  }
}
