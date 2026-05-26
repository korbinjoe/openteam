import express, { type Express } from 'express'
import { join } from 'path'
import { existsSync, readFileSync } from 'fs'
import { createLogger } from '../lib/logger'
import { trackEvent } from '../lib/eventTracker'
import { requestLogger } from '../middleware/requestLogger'
import { createAuthMiddleware, getAuthToken } from '../middleware/auth'

import directoryRoutes from '../routes/workspace/directoryRoutes'
import conversationRoutes from '../routes/chat/conversationRoutes'
import worktreeRoutes from '../routes/workspace/worktreeRoutes'
import { createAgentRoutes } from '../routes/agent/agentRoutes'
import { createExpertRoutes } from '../routes/agent/expertRoutes'
import { createWorkspaceApiRoutes } from '../routes/workspace/workspaceApiRoutes'
import { createChatRoutes } from '../routes/chat/chatRoutes'
import { createWhiteboardRoutes } from '../routes/chat/whiteboardRoutes'
import { createExternalSessionRoutes } from '../routes/external/externalSessionRoutes'
import { createExecutionLogRoutes } from '../routes/system/executionLogRoutes'
import { createCronJobRoutes } from '../routes/system/cronJobRoutes'
import { createNotificationRoutes } from '../routes/system/notificationRoutes'
import { createMemoryRoutes } from '../routes/agent/memoryRoutes'
import { createTokenUsageRoutes } from '../routes/system/tokenUsageRoutes'
import { createPreferencesRoutes } from '../routes/system/preferencesRoutes'
import { createAdminRoutes } from '../routes/system/adminRoutes'
import { createEventRoutes } from '../routes/system/eventRoutes'
import { createLogRoutes } from '../routes/system/logRoutes'
import { createUpdateRoutes } from '../routes/system/updateRoutes'
import { createTrayRoutes } from '../routes/system/trayRoutes'
import geminiRoutes from '../routes/system/geminiRoutes'
import fileRoutes from '../routes/workspace/fileRoutes'

import { PreflightChecker, type PreflightResult } from '../services/PreflightChecker'
import { getDatabase } from '../stores'
import { errorResponder } from '../middleware/errorResponder'
import { getLastWsMessageAt } from '../lib/wsHealthBeat'

const log = createLogger('RouteSetup')

interface RouteDeps {
  agentRegistry: Parameters<typeof createAgentRoutes>[0]['agentRegistry']
  agentStore: Parameters<typeof createAgentRoutes>[0]['agentStore']
  skillManager: Parameters<typeof createAgentRoutes>[0]['skillManager']
  senseiPromptPaths: Parameters<typeof createAgentRoutes>[0]['senseiPromptPaths']
  expertHandler: Parameters<typeof createExpertRoutes>[0]['expertHandler']
  mailboxManager: Parameters<typeof createExpertRoutes>[0]['mailboxManager']
  executionPlanManager: Parameters<typeof createExpertRoutes>[0]['executionPlanManager']
  workspaceStore: Parameters<typeof createWorkspaceApiRoutes>[0]['workspaceStore']
  chatStore: Parameters<typeof createChatRoutes>[0]['chatStore']
  chatService: Parameters<typeof createWorkspaceApiRoutes>[0]['chatService']
  tokenUsageStore: Parameters<typeof createTokenUsageRoutes>[0]['tokenUsageStore']
  executionLogStore: Parameters<typeof createExecutionLogRoutes>[0]
  cronJobStore: Parameters<typeof createCronJobRoutes>[0]['cronJobStore']
  cronScheduler: Parameters<typeof createCronJobRoutes>[0]['cronScheduler']
  nlCronParser: Parameters<typeof createCronJobRoutes>[0]['nlCronParser']
  notificationStore: Parameters<typeof createNotificationRoutes>[0]['notificationStore']
  memoryStore: Parameters<typeof createMemoryRoutes>[0]['memoryStore']
  growthStore: Parameters<typeof createMemoryRoutes>[0]['growthStore']
  eventStore: Parameters<typeof createEventRoutes>[0]
  sessionRegistry: Parameters<typeof createChatRoutes>[0]['sessionRegistry']
  whiteboardManager: Parameters<typeof createWhiteboardRoutes>[0]['whiteboardManager']
  updateManager: Parameters<typeof createUpdateRoutes>[0]['updateManager']
  bundleStorage: Parameters<typeof createUpdateRoutes>[0]['bundleStorage']
  updateMonitor: Parameters<typeof createUpdateRoutes>[0]['updateMonitor']
  signatureVerifier: Parameters<typeof createUpdateRoutes>[0]['signatureVerifier']
  broadcastToChat: (chatId: string, msg: Record<string, unknown>) => void
  broadcast: (msg: Record<string, unknown>) => void
  projectRoot: string
  getServerPort: () => number
  getPreflightResult: () => PreflightResult | null
  setPreflightResult: (r: PreflightResult) => void
  getEnvCheckResult: () => { npmAvailable: boolean } | null
}

export const setupRoutes = (app: Express, d: RouteDeps) => {
  app.use(requestLogger)
  app.use(express.json())
  app.use((req, res, next) => {
    const origin = req.headers.origin
    if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.header('Access-Control-Allow-Origin', origin || '*')
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    next()
  })
  app.options('*', (_req, res) => res.sendStatus(204))

  const authToken = getAuthToken()
  app.use(createAuthMiddleware(authToken))
  if (authToken) {
    log.info('Token authentication enabled for remote access')
  } else {
    log.info('No auth token set — remote API access will be denied')
  }

  const serverVersion: string = (() => {
    try {
      const pkg = JSON.parse(readFileSync(join(d.projectRoot, 'package.json'), 'utf8'))
      return pkg.version ?? 'unknown'
    } catch { return 'unknown' }
  })()

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: serverVersion,
      timestamp: Date.now(),
      lastWsMessageAt: getLastWsMessageAt(),
    })
  })

  app.get('/api/env-check', (_req, res) => res.json(d.getEnvCheckResult() ?? { npmAvailable: true }))

  app.get('/api/preflight', (_req, res) => {
    const result = d.getPreflightResult()
    if (result) { res.json(result); return }
    new PreflightChecker().run().then((r) => {
      d.setPreflightResult(r)
      res.json(r)
    }).catch(() => res.json({ timestamp: Date.now(), overall: 'warn', items: [] }))
  })

  app.post('/api/telemetry', (req, res) => {
    const { category, event, properties } = req.body
    if (category && event) trackEvent(category as string, event as string, properties)
    res.sendStatus(204)
  })

  app.use(directoryRoutes)
  app.use(conversationRoutes)
  app.use(worktreeRoutes)
  app.use(createAgentRoutes({ agentRegistry: d.agentRegistry, agentStore: d.agentStore, skillManager: d.skillManager, senseiPromptPaths: d.senseiPromptPaths }))
  app.use(createExpertRoutes({ expertHandler: d.expertHandler, agentRegistry: d.agentRegistry, mailboxManager: d.mailboxManager, executionPlanManager: d.executionPlanManager }))
  app.use(createWorkspaceApiRoutes({ workspaceStore: d.workspaceStore, chatStore: d.chatStore, chatService: d.chatService }))
  app.use(createExternalSessionRoutes({ workspaceStore: d.workspaceStore, chatStore: d.chatStore }))
  app.use(createChatRoutes({ chatStore: d.chatStore, chatService: d.chatService, tokenUsageStore: d.tokenUsageStore, sessionRegistry: d.sessionRegistry, broadcast: d.broadcast }))
  app.use(createWhiteboardRoutes({ whiteboardManager: d.whiteboardManager, chatStore: d.chatStore, broadcastToChat: d.broadcastToChat }))
  app.use(createExecutionLogRoutes(d.executionLogStore))
  app.use(createCronJobRoutes({ cronJobStore: d.cronJobStore, cronScheduler: d.cronScheduler, nlCronParser: d.nlCronParser, workspaceStore: d.workspaceStore, agentStore: d.agentStore }))
  app.use(createNotificationRoutes({ notificationStore: d.notificationStore, broadcast: d.broadcast }))
  app.use(createMemoryRoutes({ memoryStore: d.memoryStore, growthStore: d.growthStore }))
  app.use(createTokenUsageRoutes({ tokenUsageStore: d.tokenUsageStore }))
  app.use(createPreferencesRoutes({ db: getDatabase() }))
  app.use(createAdminRoutes({ db: getDatabase() }))
  app.use(createEventRoutes(d.eventStore))
  app.use(createLogRoutes())
  app.use(createUpdateRoutes({ updateManager: d.updateManager, bundleStorage: d.bundleStorage, updateMonitor: d.updateMonitor, signatureVerifier: d.signatureVerifier }))
  app.use(createTrayRoutes({ chatStore: d.chatStore, workspaceStore: d.workspaceStore, sessionRegistry: d.sessionRegistry }))
  app.use(geminiRoutes)
  app.use(fileRoutes)

  app.use('/avatars', express.static(join(d.projectRoot, 'ai-assets', 'avatars')))

  const distPath = join(d.projectRoot, 'dist')
  if (existsSync(distPath)) {
    log.info('Serving static files', { from: distPath })
    app.use(express.static(distPath))
    app.get('*', async (req, res, next) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return next()
      const indexPath = join(distPath, 'index.html')
      res.type('html').send(readFileSync(indexPath, 'utf-8'))
    })
  }

  app.use(errorResponder)

  return { authToken }
}
