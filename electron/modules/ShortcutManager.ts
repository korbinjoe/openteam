
import { globalShortcut } from 'electron'
import type { WindowManager } from './WindowManager'

export class ShortcutManager {
  private shortcuts: Map<string, () => void> = new Map()

  constructor(private windowManager: WindowManager) {}

  register(): void {
  }

  unregisterAll(): void {
    for (const [accelerator] of this.shortcuts) {
      globalShortcut.unregister(accelerator)
    }
    this.shortcuts.clear()
  }

  private bind(accelerator: string, handler: () => void): void {
    const success = globalShortcut.register(accelerator, handler)
    if (success) {
      this.shortcuts.set(accelerator, handler)
    } else {
      console.warn(`[ShortcutManager] Failed to register: ${accelerator}`)
    }
  }
}
