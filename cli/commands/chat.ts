/**
 * chat  - TUI
 *
 * 1. Ink TUIOpenCode Logo + Model/Agent  +
 * 2.  Ink PTYSessionManagerraw mode  + Agent
 */

import React from 'react'
import { render } from 'ink'
import chalk from 'chalk'
import open from 'open'
import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import App, { type ChatReadyParams } from '../tui/App.js'
import { PTYSessionManager } from './PTYSessionManager.js'
import { OPENTEAM_HOME } from '../../shared/openteam-home'

interface LastSession {
  workspaceId: string
  workspaceName: string
  agentId: string
  repoPaths: string[]
}

type WorkspaceResolution =
  | { type: 'resolved'; workspace: any; chatId: string; agentName?: string }
  | { type: 'select'; candidates: any[] }

const LAST_SESSION_FILE = join(OPENTEAM_HOME, 'last-session.json')

const loadLastSession = (): LastSession | null => {
  try {
    if (!existsSync(LAST_SESSION_FILE)) return null
    const data = JSON.parse(readFileSync(LAST_SESSION_FILE, 'utf8'))
    if (!data.workspaceId || !data.agentId) return null
    return data as LastSession
  } catch {
    return null
  }
}

const tryResume = async (port: number, last: LastSession): Promise<ChatReadyParams | null> => {
  try {
    const wsRes = await fetch(`http://127.0.0.1:${port}/api/workspaces/${last.workspaceId}`)
    if (!wsRes.ok) return null
    const workspace = await wsRes.json() as any

    const chatRes = await fetch(`http://127.0.0.1:${port}/api/workspaces/${last.workspaceId}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'CLI Chat' }),
    })
    if (!chatRes.ok) return null

    const chat = await chatRes.json() as any
    return {
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      chatId: chat.id,
      repoPaths: workspace.repositories?.map((r: any) => r.path) ?? last.repoPaths,
      agentName: last.agentId,
    }
  } catch {
    return null
  }
}

const ensureAuthenticated = async (port: number): Promise<void> => {
  const statusRes = await fetch(`http://127.0.0.1:${port}/api/auth/openteam/status`)
  const status = await statusRes.json() as { authenticated: boolean }

  if (status.authenticated) return

  const urlRes = await fetch(`http://127.0.0.1:${port}/api/auth/openteam/login-url`)
  const { url } = await urlRes.json() as { url: string }

  console.log(chalk.yellow('Not signed in, opening browser...'))
  console.log(chalk.dim(url))
  await open(url)

  console.log(chalk.dim('WaitingSign inDone...'))
  const maxWait = 5 * 60 * 1000
  const pollInterval = 2000
  const start = Date.now()

  while (Date.now() - start < maxWait) {
    await new Promise((r) => setTimeout(r, pollInterval))
    const pollRes = await fetch(`http://127.0.0.1:${port}/api/auth/openteam/status`)
    const pollStatus = await pollRes.json() as { authenticated: boolean; name?: string }
    if (pollStatus.authenticated) {
      console.log(chalk.green(`Sign inSuccess${pollStatus.name ? ` (${pollStatus.name})` : ''}`))
      return
    }
  }

  console.error(chalk.red('Sign-in timed out, please re-run openteam'))
  process.exit(1)
}

/**
 *  targetDir  repoPath
 *  targetDir  repoPath .git
 *  targetDir  git root
 *
 * repoPath=/home/user, targetDir=/home/user/work/other-project
 *     other-project has its own .git → false
 * repoPath=/home/user/work/myproject, targetDir=/home/user/work/myproject/server
 *     server has no .git → true
 */
const isSameProject = (repoPath: string, targetDir: string): boolean => {
  if (repoPath === '/') return true
  let dir = targetDir
  while (dir !== repoPath && dir.startsWith(repoPath + '/')) {
    if (existsSync(join(dir, '.git'))) {
      return false
    }
    dir = dirname(dir)
  }
  return true
}

const resolveWorkspace = async (port: number): Promise<WorkspaceResolution> => {
  const cwd = process.cwd()

  const res = await fetch(`http://127.0.0.1:${port}/api/workspaces`)
  const workspaces = (await res.json()) as any[]

  const matches = workspaces.filter((ws: any) =>
    ws.repositories.some((r: any) =>
      cwd === r.path || (cwd.startsWith(r.path + '/') && isSameProject(r.path, cwd))
    )
  )

  if (matches.length === 1) {
    const chatRes = await fetch(`http://127.0.0.1:${port}/api/workspaces/${matches[0].id}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'CLI Chat' }),
    })
    const chat = await chatRes.json() as any
    return { type: 'resolved', workspace: matches[0], chatId: chat.id }
  }

  if (matches.length === 0) {
    const qsRes = await fetch(`http://127.0.0.1:${port}/api/workspaces/quick-start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repoPath: cwd }),
    })
    const { workspace, chat } = await qsRes.json() as any
    return { type: 'resolved', workspace, chatId: chat.id }
  }

  const exactMatches = matches.filter((ws: any) =>
    ws.repositories.some((r: any) => r.path === cwd)
  )

  if (exactMatches.length > 0) {
    const primaryMatch = exactMatches.find((ws: any) => ws.repositories[0]?.path === cwd)
    const best = primaryMatch || exactMatches[0]
    const chatRes = await fetch(`http://127.0.0.1:${port}/api/workspaces/${best.id}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'CLI Chat' }),
    })
    const chat = await chatRes.json() as any
    return { type: 'resolved', workspace: best, chatId: chat.id }
  }

  const sorted = [...matches].sort((a: any, b: any) => {
    const aMax = Math.max(...a.repositories.map((r: any) => r.path.length))
    const bMax = Math.max(...b.repositories.map((r: any) => r.path.length))
    return bMax - aMax
  })
  const best = sorted[0]
  const chatRes = await fetch(`http://127.0.0.1:${port}/api/workspaces/${best.id}/chats`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'CLI Chat' }),
  })
  const chat = await chatRes.json() as any
  return { type: 'resolved', workspace: best, chatId: chat.id }
}

const loadDefaultModel = (): string | undefined => {
  try {
    const cwd = process.cwd()
    const configPath = join(cwd, 'openteam.json')
    if (!existsSync(configPath)) return undefined
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    return config?.agents?.defaults?.model
  } catch {
    return undefined
  }
}

const loadDefaultAgent = (): string => {
  try {
    const configPath = join(OPENTEAM_HOME, 'config.json')
    if (!existsSync(configPath)) return 'lead'
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    return config.defaultAgent || 'lead'
  } catch {
    return 'lead'
  }
}

const resolveAgent = (workspace: any, preselectedAgent?: string): string | undefined => {
  if (preselectedAgent) return preselectedAgent
  const last = loadLastSession()
  if (last && last.workspaceId === workspace.id && last.agentId) return last.agentId
  if (workspace.agentTeam?.primaryAgentId) return workspace.agentTeam.primaryAgentId
  return loadDefaultAgent()
}

const getVersion = (): string => {
  try {
    const dir = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(join(dir, '../../package.json'), 'utf8'))
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const updateChatModel = async (port: number, chatId: string, model: string): Promise<void> => {
  try {
    await fetch(`http://127.0.0.1:${port}/api/chats/${chatId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
    })
  } catch {
  }
}

export const chatCommand = async (options?: { agent?: string; resume?: boolean }) => {
  const { ensureDaemon } = await import('../lib/daemonConnect.js') as typeof import('../lib/daemonConnect')

  let port: number
  try {
    process.stdout.write(chalk.dim('  Connecting...'))
    const daemon = await ensureDaemon()
    port = daemon.port
    process.stdout.write('\r\x1b[K')
  } catch (err) {
    process.stdout.write('\r\x1b[K')
    console.error(chalk.red(`  Failed to start daemon: ${err instanceof Error ? err.message : err}`))
    process.exit(1)
  }

  await ensureAuthenticated(port)

  try {
    const envRes = await fetch(`http://127.0.0.1:${port}/api/env-check`)
    const envCheck = await envRes.json() as { npmAvailable: boolean }
    if (!envCheck.npmAvailable) {
      console.log(chalk.yellow('⚠ Node.js/npm not detected, AI Agent CLI tools cannot be auto-installed'))
      console.log(chalk.dim('  Please install Node.js: https://nodejs.org/'))
      console.log()
    }
  } catch { /* env-check optional */ }

  try {
    const pfRes = await fetch(`http://127.0.0.1:${port}/api/preflight`)
    const pfData = await pfRes.json() as { items?: Array<{ id: string; status: string; label: string; hint?: string; fixCommand?: string }> }
    if (pfData.items) {
      for (const item of pfData.items) {
        if (item.id.endsWith('-auth') && item.status === 'warn') {
          console.log(chalk.yellow(`⚠ ${item.label}: ${item.hint || 'Not signed in, some features are limited'}`))
          if (item.fixCommand) console.log(chalk.dim(`  Please run: ${item.fixCommand}`))
          console.log()
        }
      }
    }
  } catch { /* preflight optional */ }

  const version = getVersion()

  // Fast Resume
  if (options?.resume) {
    const last = loadLastSession()
    if (last) {
      const resumed = await tryResume(port, last)
      if (resumed) {
        process.stdout.write('\x1b[2J\x1b[H')
        process.stdout.write(chalk.dim(`[${resumed.workspaceName}]`) + ' ' + chalk.cyan(resumed.agentName || 'default') + chalk.dim(`  ~ switch | Ctrl+C×2 exit  http://127.0.0.1:${port}`) + '\n')
        const session = new PTYSessionManager(port, resumed)
        session.start()
        return
      }
    }
    process.stdout.write(chalk.yellow('  No previous session found, entering selection mode...\n\n'))
  }

  // Parse workspace
  process.stdout.write(chalk.dim('  Resolving workspace...'))
  const resolution = await resolveWorkspace(port)
  process.stdout.write('\r\x1b[K')

  if (resolution.type !== 'resolved') {
    console.error(chalk.red('  Failed to resolve workspace'))
    process.exit(1)
  }

  const { workspace, chatId } = resolution
  const defaultModel = loadDefaultModel()
  const defaultAgent = resolveAgent(workspace, options?.agent)

  process.stdout.write('\x1b[?1049h\x1b[H')

  const chatReady = await new Promise<ChatReadyParams | null>((resolve) => {
    const { unmount, waitUntilExit } = render(
      React.createElement(App, {
        port,
        workspace,
        chatId,
        defaultModel,
        defaultAgent,
        version,
        onChatReady: (params: ChatReadyParams) => {
          unmount()
          process.stdout.write('\x1b[?1049l')
          resolve(params)
        },
      }),
      { exitOnCtrlC: false },
    )
    // Ctrl+C → useApp().exit() → waitUntilExit resolves → QuitProcess
    waitUntilExit().then(() => resolve(null))
  })

  if (!chatReady) {
    process.stdout.write('\x1b[?1049l')
    process.exit(0)
  }

  if (chatReady.model) {
    await updateChatModel(port, chatId, chatReady.model)
  }

  process.stdout.write('\x1b[2J\x1b[H')
  process.stdout.write(chalk.dim(`[${chatReady.workspaceName}]`) + ' ' + chalk.cyan(chatReady.agentName || 'default') + chalk.dim(`  ~ switch | Ctrl+C×2 exit  http://127.0.0.1:${port}`) + '\n')

  const session = new PTYSessionManager(port, chatReady)
  session.start()
}
