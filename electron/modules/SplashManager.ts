import { BrowserWindow } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const SPLASH_WIDTH = 480
const SPLASH_HEIGHT = 360
const MIN_DISPLAY_MS = 1000
const EXIT_ANIMATION_MS = 400

export class SplashManager {
  private window: BrowserWindow | null = null
  private showTime = 0

  create(): void {
    this.window = new BrowserWindow({
      width: SPLASH_WIDTH,
      height: SPLASH_HEIGHT,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      center: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
    })

    const splashPath = join(dirname(fileURLToPath(import.meta.url)), 'splash.html')
    this.window.loadFile(splashPath)

    this.window.once('ready-to-show', () => {
      this.window?.show()
      this.showTime = Date.now()
    })
  }

  async close(): Promise<void> {
    if (!this.window || this.window.isDestroyed()) return

    const elapsed = Date.now() - this.showTime
    const remaining = MIN_DISPLAY_MS - elapsed
    if (remaining > 0) {
      await new Promise(r => setTimeout(r, remaining))
    }

    if (!this.window || this.window.isDestroyed()) return

    this.window.webContents.executeJavaScript(
      `document.body.classList.add('exiting')`
    )

    await new Promise(r => setTimeout(r, EXIT_ANIMATION_MS))

    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }

  destroy(): void {
    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
  }
}
