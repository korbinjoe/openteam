/**
 * daemonConnect —  daemon
 *
 *  ~/.openteam/daemon.port → GET /api/health1s timeout
 *  { port } null
 */

import { execFileSync, execSync, spawn } from 'child_process'
import { existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { OPENTEAM_HOME } from '../../shared/openteam-home'

const HOME = homedir()
const OPENTEAM_DIR = OPENTEAM_HOME

const IS_DEV = process.env.OPENTEAM_DEV === '1' || fileURLToPath(import.meta.url).endsWith('.ts')
const SUFFIX = IS_DEV ? '.dev' : ''
const PORT_FILE = join(OPENTEAM_DIR, `daemon${SUFFIX}.port`)
const PID_FILE = join(OPENTEAM_DIR, `daemon${SUFFIX}.pid`)
const PLIST_LABEL = 'ai.openteam.daemon'
const PLIST_PATH = join(HOME, 'Library', 'LaunchAgents', `${PLIST_LABEL}.plist`)

const CLI_VERSION: string = (() => {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(dir, '../../package.json'), 'utf8'))
    return pkg.version ?? 'unknown'
  } catch {
    return 'unknown'
  }
})()

export interface DaemonConnection {
  port: number
  pid?: number
}

const readPort = (): number | null => {
  try {
    if (!existsSync(PORT_FILE)) return null
    const raw = readFileSync(PORT_FILE, 'utf8').trim()
    const port = Number(raw)
    return Number.isFinite(port) && port > 0 ? port : null
  } catch {
    return null
  }
}

const readPid = (): number | null => {
  try {
    if (!existsSync(PID_FILE)) return null
    const raw = readFileSync(PID_FILE, 'utf8').trim()
    const pid = Number(raw)
    return Number.isFinite(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const stopDaemon = (pid: number | null) => {
  if (pid !== null && pid > 0) {
  }
}

const removeFiles = () => {
  for (const f of [PORT_FILE, PID_FILE]) {
    try { if (existsSync(f)) unlinkSync(f) } catch { /* Ignore */ }
  }
}

/**  daemon health check  kill  */
const removeStaleFiles = () => {
  const pid = readPid()
  if (pid !== null && isProcessAlive(pid)) {
    stopDaemon(pid)
    const deadline = Date.now() + 2000
    while (Date.now() < deadline && isProcessAlive(pid)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
    }
  }
  removeFiles()
}

/**
 *  daemon pid
 * Dev  openteam.ts daemon run openteam.js daemon run
 */
const killStaleDaemons = () => {
  const pattern = IS_DEV ? 'openteam.ts daemon run' : 'openteam.js daemon run'
  try {
    const output = execSync(`pgrep -f "${pattern}" 2>/dev/null || true`, { encoding: 'utf8' }).trim()
    if (!output) return
    const pids = output.split('\n').map(Number).filter((p) => p > 0 && p !== process.pid)
    for (const pid of pids) {
      try { process.kill(pid, 'SIGTERM') } catch { /* already dead */ }
    }
    if (pids.length > 0) {
      const deadline = Date.now() + 2000
      while (Date.now() < deadline && pids.some(isProcessAlive)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100)
      }
    }
  } catch { /* pgrep not available or other error */ }
}

/**
 *  daemon
 * -  { port, pid? }
 * -  null
 */
export const tryConnectDaemon = async (): Promise<DaemonConnection | null> => {
  const port = readPort()
  if (port === null) return null

  const pid = readPid()

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1000)
    const res = await fetch(`http://localhost:${port}/api/health`, { signal: controller.signal })
    clearTimeout(timeoutId)
    if (res.ok) {
      const body = await res.json() as { version?: string }
      if (body.version && CLI_VERSION !== 'unknown' && body.version !== CLI_VERSION) {
        stopDaemon(pid)
        removeFiles()
        return null
      }
      return { port, ...(pid !== null ? { pid } : {}) }
    }
  } catch {
  }

  removeStaleFiles()
  return null
}

/**
 *  launchd plist
 *
 *  buildPlist()
 *  ProgramArgumentsEnvironmentVariables.PATH  node CLI
 */
const ensurePlistUpToDate = async (domain: string): Promise<void> => {
  try {
    const { buildPlist } = await import('../commands/daemon.js') as typeof import('../commands/daemon')

    const expectedPlist = buildPlist()
    const currentPlist = readFileSync(PLIST_PATH, 'utf8')
    if (expectedPlist === currentPlist) return

    const logsDir = join(OPENTEAM_DIR, 'logs')
    mkdirSync(logsDir, { recursive: true })
    writeFileSync(PLIST_PATH, expectedPlist, { encoding: 'utf8', mode: 0o644 })

    // bootout + re-bootstrap
  } catch {
  }
}

/**
 *  daemon
 * -  daemon
 * -  daemon
 */
export const ensureDaemon = async (): Promise<DaemonConnection> => {
  const existing = await tryConnectDaemon()
  if (existing) return existing

  const { waitForHealth } = await import('../commands/daemon.js') as typeof import('../commands/daemon')

  if (process.platform === 'darwin' && existsSync(PLIST_PATH) && !process.env.OPENTEAM_SKIP_LAUNCHD && !IS_DEV) {
    const uid = typeof process.getuid === 'function' ? process.getuid() : 501
    const domain = `gui/${uid}`

    await ensurePlistUpToDate(domain)

    try {
      execFileSync('launchctl', ['kickstart', '-k', `${domain}/${PLIST_LABEL}`], { stdio: 'ignore' })
    } catch {
      try {
        execFileSync('launchctl', ['bootstrap', domain, PLIST_PATH], { stdio: 'ignore' })
        execFileSync('launchctl', ['kickstart', '-k', `${domain}/${PLIST_LABEL}`], { stdio: 'ignore' })
      } catch {
      }
    }

    const port = await waitForHealth(10000)
    if (port !== null) {
      const pid = readPid()
      return { port, ...(pid !== null ? { pid } : {}) }
    }
  }

  killStaleDaemons()
  removeFiles()

  const { buildProgramArguments } = await import('../commands/daemon.js') as typeof import('../commands/daemon')

  const args = buildProgramArguments()

  const logsDir = join(OPENTEAM_DIR, 'logs')
  mkdirSync(logsDir, { recursive: true })
  const outFd = openSync(join(logsDir, 'daemon.log'), 'a')
  const errFd = openSync(join(logsDir, 'daemon.err'), 'a')

  const child = spawn(args[0], args.slice(1), {
    detached: true,
    stdio: ['ignore', outFd, errFd],
  })
  child.unref()

  const port = await waitForHealth(10000)
  if (port === null) {
    throw new Error('Daemon failed to start (10s timeout), check logs: ~/.openteam/logs/daemon.err')
  }

  const pid = readPid()
  return { port, ...(pid !== null ? { pid } : {}) }
}
