/**
 * portFile — daemon /PID
 *
 * daemon  ~/.openteam/daemon.port  ~/.openteam/daemon.pid
 * SIGTERM Electron/CLI daemon
 *
 *  IO warn server
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { OPENTEAM_HOME } from '../config/paths'

const OPENTEAM_DIR = OPENTEAM_HOME

const IS_DEV = process.env.OPENTEAM_DEV === '1' || fileURLToPath(import.meta.url).endsWith('.ts')
const SUFFIX = IS_DEV ? '.dev' : ''
const PORT_FILE = join(OPENTEAM_DIR, `daemon${SUFFIX}.port`)
const PID_FILE = join(OPENTEAM_DIR, `daemon${SUFFIX}.pid`)

const ensureDir = () => {
  if (!existsSync(OPENTEAM_DIR)) {
    mkdirSync(OPENTEAM_DIR, { recursive: true })
  }
}

export const writePortFile = (port: number): void => {
  try {
    ensureDir()
    writeFileSync(PORT_FILE, String(port), { encoding: 'utf8', mode: 0o600 })
  } catch (err) {
    console.warn('[portFile] Failed to write daemon.port:', err instanceof Error ? err.message : err)
  }
}

export const readPortFile = (): number | null => {
  try {
    if (!existsSync(PORT_FILE)) return null
    const raw = readFileSync(PORT_FILE, 'utf8').trim()
    const port = Number(raw)
    return Number.isFinite(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

export const writePidFile = (pid: number): void => {
  try {
    ensureDir()
    writeFileSync(PID_FILE, String(pid), { encoding: 'utf8', mode: 0o600 })
  } catch (err) {
    console.warn('[portFile] Failed to write daemon.pid:', err instanceof Error ? err.message : err)
  }
}

export const readPidFile = (): number | null => {
  try {
    if (!existsSync(PID_FILE)) return null
    const raw = readFileSync(PID_FILE, 'utf8').trim()
    const pid = Number(raw)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export const removePorts = (): void => {
  const filePid = readPidFile()
  if (filePid !== null && filePid !== process.pid) {
    return
  }

  for (const file of [PORT_FILE, PID_FILE]) {
    try {
      if (existsSync(file)) unlinkSync(file)
    } catch (err) {
      console.warn(`[portFile] Failed to remove ${file}:`, err instanceof Error ? err.message : err)
    }
  }
}
