/**
 * PowerSaveManager — prevent macOS (and other OS) sleep while tasks are running.
 *
 * Uses Electron's powerSaveBlocker which wraps IOPMAssertion on macOS,
 * SetThreadExecutionState on Windows, and Inhibit on Linux.
 */

import { powerSaveBlocker, ipcMain, app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

const PREFS_FILE = 'openteam-prefs.json'

interface Prefs {
  preventSleepEnabled: boolean
}

export class PowerSaveManager {
  private blockerId: number | null = null
  private enabled = false
  private hasActiveMissions = false

  constructor() {
    this.enabled = this.loadPref()
    this.registerIPC()
  }

  setHasActiveMissions(active: boolean): void {
    this.hasActiveMissions = active
    if (active && this.enabled) {
      this.startBlocking()
    } else {
      this.stopBlocking()
    }
  }

  isEnabled(): boolean {
    return this.enabled
  }

  isBlocking(): boolean {
    return this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId)
  }

  destroy(): void {
    this.stopBlocking()
    ipcMain.removeHandler('power-save:get-enabled')
    ipcMain.removeHandler('power-save:set-enabled')
  }

  private startBlocking(): void {
    if (this.blockerId !== null && powerSaveBlocker.isStarted(this.blockerId)) return
    this.blockerId = powerSaveBlocker.start('prevent-app-suspension')
    console.log(`[PowerSave] Blocking sleep (id=${this.blockerId})`)
  }

  private stopBlocking(): void {
    if (this.blockerId === null) return
    if (powerSaveBlocker.isStarted(this.blockerId)) {
      powerSaveBlocker.stop(this.blockerId)
      console.log(`[PowerSave] Released sleep block (id=${this.blockerId})`)
    }
    this.blockerId = null
  }

  private registerIPC(): void {
    ipcMain.handle('power-save:get-enabled', () => this.enabled)

    ipcMain.handle('power-save:set-enabled', (_event, value: boolean) => {
      this.enabled = value
      this.savePref(value)
      if (value && this.hasActiveMissions) {
        this.startBlocking()
      } else if (!value) {
        this.stopBlocking()
      }
      return this.enabled
    })
  }

  private prefsPath(): string {
    return join(app.getPath('userData'), PREFS_FILE)
  }

  private loadPref(): boolean {
    try {
      const filePath = this.prefsPath()
      if (!existsSync(filePath)) return false
      const data = JSON.parse(readFileSync(filePath, 'utf-8')) as Partial<Prefs>
      return data.preventSleepEnabled === true
    } catch {
      return false
    }
  }

  private savePref(value: boolean): void {
    try {
      const filePath = this.prefsPath()
      let data: Record<string, unknown> = {}
      if (existsSync(filePath)) {
        try { data = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, unknown> } catch { /* reset */ }
      }
      data.preventSleepEnabled = value
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[PowerSave] Failed to save preference:', err)
    }
  }
}
