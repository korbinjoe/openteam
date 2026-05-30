
import express from 'express'
import { createServer } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { existsSync, readFileSync } from 'fs'

import { PORTS } from '../shared/ports'
import { setServerPort } from './lib/serverPort'
import { writePortFile, writePidFile, removePorts } from './lib/portFile'

const IS_DAEMON_FILE_OWNER = process.env.OPENTEAM_NO_PORTFILE !== '1'

import './config/loadServerEnv'
import { warmupShellPath } from './lib/resolveCliCommand'

import { AgentRegistry } from './config/AgentRegistry'
import { SkillManager } from './config/SkillManager'
import { agentDefToAgent } from './config/types'
import { OPENTEAM_HOME } from './config/paths'

import { ConfigCompiler } from './runtime/ConfigCompiler'
import { HooksConfigManager } from './runtime/HooksConfigManager'

import { WSRouter, ExpertHandler } from './ws'
import { SemanticLogBroadcaster } from './ws/SemanticLogBroadcaster'

import {
  AgentStore, WorkspaceStore, ChatStore,
  ExecutionLogStore,
  CronJobStore, NotificationStore, MemoryStore, GrowthStore,
  TokenUsageStore,
  EventStore,
} from './stores'

import { ChatService } from './services/chat/ChatService'
import { CronScheduler } from './services/cron/CronScheduler'
import { CronJobLauncher } from './services/cron/CronJobLauncher'
import { NLCronParser } from './services/cron/NLCronParser'
import { SenseiUpgradeService } from './services/update/SenseiUpgradeService'
import { UpdateManager } from './services/update/UpdateManager'
import { BundleStorage } from './services/bundle/BundleStorage'
import { UpdateMonitor } from './services/update/UpdateMonitor'
import { WorkspaceSeeder } from './services/WorkspaceSeeder'
import { VersionGate } from './services/update/VersionGate'

import { SessionRegistry } from './terminal/SessionRegistry'
import { IdleReaper } from './terminal/IdleReaper'
import { TerminalViewManager } from './terminal/TerminalViewManager'

import { WhiteboardManager } from './whiteboard/WhiteboardManager'
import { ExecutionPlanManager } from './mailbox/ExecutionPlanManager'
import { WorkflowRegistry } from './orchestration/WorkflowRegistry'

import { createLogger, getLogDir } from './lib/logger'
import { ensureAvatarDir } from './lib/avatarStorage'
import { initEventTracker, trackEvent } from './lib/eventTracker'

import { setProjectRoot } from './runtime/SlashCommandResolver'
import { healStaleChatStatuses, watchAiAssetsDev } from './startup/StartupHealers'
import { runAsyncBoot, getExternalDirWatcher, type AsyncBootResult } from './startup/AsyncBoot'
import { setupRoutes } from './startup/routeSetup'
import { setupWebSocket } from './startup/wsSetup'

const log = createLogger('Server')

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const parentDirName = basename(dirname(__dirname))
const isBundled = parentDirName === 'dist'
const PROJECT_ROOT = isBundled ? join(__dirname, '..', '..') : join(__dirname, '..')
setProjectRoot(PROJECT_ROOT)

log.info('Path debug info', {
  __filename, __dirname, parentDirName, isBundled, PROJECT_ROOT,
  existsSync_dist: existsSync(join(PROJECT_ROOT, 'dist')),
  existsSync_aiAssets: existsSync(join(PROJECT_ROOT, 'ai-assets')),
})

const serverVersion: string = (() => {
  try {
    const pkg = JSON.parse(readFileSync(join(PROJECT_ROOT, 'package.json'), 'utf8'))
    return pkg.version ?? 'unknown'
  } catch { return 'unknown' }
})()

warmupShellPath()

const app = express()
const httpServer = createServer(app)
const wss = new WebSocketServer({ server: httpServer, path: '/ws' })

const bundledAssetsDir = isBundled
  ? join(__dirname, '..', '..', '..', 'ai-assets')
  : join(PROJECT_ROOT, 'ai-assets')

const sharedWorkspaceDir = join(OPENTEAM_HOME, 'system')

const skillManager = new SkillManager(join(OPENTEAM_HOME, 'skills'))
const agentRegistry = new AgentRegistry(
  join(OPENTEAM_HOME, 'agents'),
  join(OPENTEAM_HOME, 'system'),
  join(PROJECT_ROOT, 'openteam.json'),
  join(OPENTEAM_HOME, 'openteam.json'),
)

const agentStore = new AgentStore()
const workspaceStore = new WorkspaceStore()
workspaceStore.migrateDefaultId()
workspaceStore.ensureDefault()
const chatStore = new ChatStore()
const executionLogStore = new ExecutionLogStore()
const cronJobStore = new CronJobStore()
const notificationStore = new NotificationStore()
const memoryStore = new MemoryStore()
const growthStore = new GrowthStore()
const tokenUsageStore = new TokenUsageStore()
const eventStore = new EventStore()
initEventTracker(eventStore)

const updateManager = new UpdateManager()
const bundleStorage = new BundleStorage()
const versionGate = new VersionGate()
const whiteboardManager = new WhiteboardManager()
const executionPlanManager = new ExecutionPlanManager()
const workflowRegistry = new WorkflowRegistry()
const chatService = new ChatService({ chatStore, workspaceStore, agentStore })

const hooksConfigManager = new HooksConfigManager()

const configCompiler = new ConfigCompiler(
  skillManager, hooksConfigManager, memoryStore, undefined, PROJECT_ROOT, whiteboardManager,
)

const broadcast = (msg: Record<string, unknown>) => {
  const data = JSON.stringify(msg)
  wss.clients.forEach((c) => { if (c.readyState === WebSocket.OPEN) c.send(data) })
}

const updateMonitor = new UpdateMonitor(updateManager, broadcast)

const sessionRegistry = new SessionRegistry(hooksConfigManager, chatStore)
sessionRegistry.onChatStatusChanged((chatId, status) => {
  const chat = chatStore.get(chatId)
  broadcast({ type: 'chat:status-changed', payload: { chatId, status, taskStatus: chat?.taskStatus } })
})
sessionRegistry.onActivityChanged((payload) => {
  if (!payload.latestMessage) {
    const latest = expertHandler.getLatestMessage(payload.chatId)
    if (latest) payload.latestMessage = latest
  }
  broadcast({ type: 'chat:activity', payload })
  semanticLogBroadcaster.handle(payload)
  const sessions = sessionRegistry.findAllByChat(payload.chatId)
  for (const s of sessions) {
    if (s.connectionType === 'virtual') {
      sessionRegistry.sendToSession(s.sessionId, { type: 'chat:activity', payload })
    }
  }
})

const idleReaper = new IdleReaper(sessionRegistry)
const broadcastToChat = (chatId: string, msg: Record<string, unknown>) => {
  let targetConnIds: Iterable<string> = sessionRegistry.getConnectionsForChat(chatId)
  if ((targetConnIds as Set<string>).size === 0) {
    const viewing = expertHandler.getConnectionsViewingChat(chatId)
    if (viewing.length === 0) {
      log.warn('broadcastToChat dropped: no connections for chat', { chatId, type: msg.type })
      return
    }
    targetConnIds = viewing
  }
  const data = JSON.stringify(msg)
  let sent = 0
  for (const connId of targetConnIds) {
    const ws = expertHandler.getConnectionWs(connId)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(data)
      sent++
    }
  }
  if (sent === 0) {
    log.warn('broadcastToChat dropped: no open ws among connections', { chatId, type: msg.type })
  }
}
workflowRegistry.setDeps({ whiteboardManager, broadcastToChat })
const expertHandler = new ExpertHandler(configCompiler, agentRegistry, agentStore, chatStore, tokenUsageStore, executionLogStore, undefined, sessionRegistry, versionGate, broadcastToChat, whiteboardManager, broadcast)
const semanticLogBroadcaster = new SemanticLogBroadcaster(agentRegistry, sessionRegistry, (connId) => expertHandler.getConnectionWs(connId))
const cronJobLauncher = new CronJobLauncher(
  configCompiler, agentRegistry, sessionRegistry, workspaceStore,
  chatStore, sharedWorkspaceDir,
)
const cronScheduler = new CronScheduler(cronJobStore, notificationStore, chatService, workspaceStore, cronJobLauncher, broadcast)
const nlCronParser = new NLCronParser()
const senseiPromptPaths = [
  join(bundledAssetsDir, 'agents', 'sensei', 'AGENTS.md'),
  join(bundledAssetsDir, 'agents', 'sensei.md'),
]

const senseiUpgradeService = new SenseiUpgradeService(
  senseiPromptPaths,
  (connectionId, event, data) => {
    const ws = expertHandler.getConnectionWs(connectionId)
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ type: event, payload: data }))
    }
  },
)

import { DevInspector } from './dev/DevInspector'
const devInspector = process.env.NODE_ENV !== 'production' || process.env.DEV_PANEL === 'true'
  ? new DevInspector(sessionRegistry, chatStore, expertHandler.getExpertStore())
  : undefined

import { GitWatchManager } from './git/GitWatchManager'
const gitWatchManager = new GitWatchManager()

const terminalViewManager = new TerminalViewManager(sessionRegistry, chatStore)
import { ExecutionModeRouter } from './orchestration/ExecutionModeRouter'
const executionModeRouter = new ExecutionModeRouter(agentRegistry)

const wsRouter = new WSRouter({ expertHandler, gitWatchManager, terminalViewManager, senseiUpgradeService, chatStore, workspaceStore, devInspector, broadcast, executionModeRouter })

let serverPort = PORTS.DEV_SERVER
let asyncBootResult: AsyncBootResult | null = null

const { authToken } = setupRoutes(app, {
  agentRegistry, agentStore, skillManager, senseiPromptPaths,
  expertHandler, executionPlanManager,
  workspaceStore, chatStore, chatService,
  tokenUsageStore, executionLogStore,
  cronJobStore, cronScheduler, nlCronParser,
  notificationStore, memoryStore, growthStore, eventStore,
  sessionRegistry, whiteboardManager, workflowRegistry,
  updateManager, bundleStorage, updateMonitor,
  broadcastToChat, broadcast,
  projectRoot: PROJECT_ROOT,
  getServerPort: () => serverPort,
  getPreflightResult: () => asyncBootResult?.preflightResult ?? null,
  setPreflightResult: (r) => { if (asyncBootResult) asyncBootResult.preflightResult = r },
  getEnvCheckResult: () => asyncBootResult?.envCheckResult ?? null,
})

const { heartbeatTimer } = setupWebSocket({
  wss, wsRouter, expertHandler, sessionRegistry, notificationStore,
  authToken, serverVersion,
  getEnvCheckResult: () => asyncBootResult?.envCheckResult ?? null,
  getPreflightResult: () => asyncBootResult?.preflightResult ?? null,
})

export async function startServer(port?: number): Promise<number> {
  const finalPort = port ?? (Number(process.env.PORT) || PORTS.DEV_SERVER)

  try {
    await new WorkspaceSeeder(bundledAssetsDir, OPENTEAM_HOME).seed()

    await skillManager.loadBuiltinSkills()
    await skillManager.syncBuiltinToClaudeHome()
    await agentRegistry.load()

    await agentStore.load()
    await workspaceStore.load()
    await chatStore.load()
    await executionLogStore.load()
    await cronJobStore.load()
    await notificationStore.load()
    await ensureAvatarDir()

    const builtinAgents = agentRegistry.list().map(agentDefToAgent)
    await agentStore.importBuiltin(builtinAgents)

    agentRegistry.onReload(async () => {
      const updated = agentRegistry.list().map(agentDefToAgent)
      await agentStore.importBuiltin(updated)
      broadcast({ type: 'agents:updated', payload: { agents: agentStore.list(), configVersion: agentRegistry.configVersion } })
    })

    if (!isBundled) {
      watchAiAssetsDev({ bundledAssetsDir, openteamHome: OPENTEAM_HOME, agentRegistry, skillManager, seederFactory: () => new WorkspaceSeeder(bundledAssetsDir, OPENTEAM_HOME) })
    }

    healStaleChatStatuses(chatStore)

    idleReaper.start()
    cronScheduler.start()
    updateMonitor.start()

    warmupShellPath().catch(() => {})

    return new Promise((resolve, reject) => {
      httpServer.listen(finalPort, () => {
        const addr = httpServer.address()
        const actualPort = typeof addr === 'object' && addr ? addr.port : finalPort
        serverPort = actualPort
        setServerPort(actualPort)
        if (IS_DAEMON_FILE_OWNER) {
          writePortFile(actualPort)
          writePidFile(process.pid)
        }
        log.info(`Server running on port ${actualPort}`)
        log.info(`WebSocket endpoint: ws://localhost:${actualPort}/ws`)
        log.info(`Health check: http://localhost:${actualPort}/api/health`)
        log.info(`Logs at ${getLogDir()} (set LOG_LEVEL=debug for verbose)`)
        trackEvent('system', 'server.started', { port: actualPort })

        asyncBootResult = runAsyncBoot(broadcast)

        workflowRegistry.reconcileOnStartup(sessionRegistry).catch(err =>
          log.warn('Workflow reconciliation failed', { error: err instanceof Error ? err.message : String(err) }),
        )

        resolve(actualPort)
      })
      httpServer.on('error', reject)
    })
  } catch (err) {
    log.error('Failed to load managers', { error: err instanceof Error ? err.message : String(err) })
    trackEvent('system', 'server.start_failed', { error: err instanceof Error ? err.message : String(err) })
    process.exit(1)
  }
}

if (!process.env.ELECTRON && !process.env.OPENTEAM_CLI) {
  startServer()
}

process.on('unhandledRejection', (reason) => {
  log.error('Unhandled Promise rejection', { error: reason instanceof Error ? reason.message : String(reason), stack: reason instanceof Error ? reason.stack : undefined })
  trackEvent('system', 'server.unhandled_rejection', { error: reason instanceof Error ? reason.message : String(reason) })
})

process.on('uncaughtException', (err) => {
  log.error('Uncaught exception — process will exit', { error: err.message, stack: err.stack })
  trackEvent('system', 'server.uncaught_exception', { error: err.message })
  if (IS_DAEMON_FILE_OWNER) removePorts()
  process.exit(1)
})

const gracefulShutdown = async (signal: string) => {
  log.info(`${signal} received, shutting down gracefully...`)
  if (IS_DAEMON_FILE_OWNER) removePorts()
  clearInterval(heartbeatTimer)
  const forceTimer = setTimeout(() => {
    log.warn('Graceful shutdown timed out, forcing exit')
    process.exit(1)
  }, 5000)
  forceTimer.unref()
  await workflowRegistry.suspendAll().catch(err =>
    log.warn('Workflow suspend error', { error: err instanceof Error ? err.message : String(err) }),
  )
  sessionRegistry.killAll()
  cronScheduler.stop()
  idleReaper.stop()
  updateMonitor.stop()
  void getExternalDirWatcher()?.stop()
  httpServer.close(() => {
    log.info('Server closed')
    process.exit(0)
  })
}

if (process.env.OPENTEAM_CLI) {
  process.on('SIGINT', () => {})
} else {
  process.on('SIGINT', () => gracefulShutdown('SIGINT'))
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
