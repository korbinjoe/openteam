import { Router } from 'express'
import type { ChatStore } from '../../stores/ChatStore'
import type { WorkspaceStore } from '../../stores/WorkspaceStore'
import type { SessionRegistry } from '../../terminal/SessionRegistry'
import type { TrayActiveMissionsResponse, TrayMissionDTO, TrayMissionAgent } from '../../../shared/tray-types'

interface TrayRouteDeps {
  chatStore: ChatStore
  workspaceStore: WorkspaceStore
  sessionRegistry?: SessionRegistry
}

const PHASE_PRIORITY = ['error', 'waiting_confirmation', 'tool_running', 'responding', 'thinking', 'waiting_input', 'initializing'] as const

const pickTopPhase = (phases: string[]): string => {
  for (const phase of PHASE_PRIORITY) {
    if (phases.includes(phase)) return phase
  }
  return phases[0] ?? 'initializing'
}

export const createTrayRoutes = ({ chatStore, workspaceStore, sessionRegistry }: TrayRouteDeps): Router => {
  const router = Router()

  router.get('/api/tray/active-missions', (_req, res) => {
    const response: TrayActiveMissionsResponse = { missions: [] }
    if (!sessionRegistry) return res.json(response)

    const activities = sessionRegistry.getActiveActivities()
    const workspaceNameCache = new Map<string, string>()

    for (const [chatId, activity] of Object.entries(activities)) {
      const chat = chatStore.get(chatId)
      if (!chat) continue

      const agents: TrayMissionAgent[] = (activity.agentActivities ?? []).map((a) => ({
        agentId: a.agentId,
        agentName: a.agentName,
        phase: a.phase,
        currentTool: a.currentTool,
        toolCompleted: a.toolCompleted,
        toolCount: a.toolCount,
        cost: a.cost,
      }))

      const runningAgents = agents.filter((a) => a.phase !== 'completed')
      if (runningAgents.length === 0) continue

      let workspaceName = workspaceNameCache.get(chat.workspaceId)
      if (workspaceName === undefined) {
        workspaceName = workspaceStore.get(chat.workspaceId)?.name ?? 'Unknown'
        workspaceNameCache.set(chat.workspaceId, workspaceName)
      }

      const totalToolProgress = agents.reduce(
        (acc, a) => ({ completed: acc.completed + a.toolCompleted, total: acc.total + a.toolCount }),
        { completed: 0, total: 0 },
      )
      const totalCost = agents.reduce((sum, a) => sum + (a.cost ?? 0), 0)
      const topPhase = pickTopPhase(runningAgents.map((a) => a.phase))

      const mission: TrayMissionDTO = {
        chatId,
        title: chat.title,
        workspaceId: chat.workspaceId,
        workspaceName,
        topPhase,
        agents,
        totalToolProgress,
        totalCost,
        startedAt: chat.lastMessageAt ? new Date(chat.lastMessageAt).getTime() : Date.now(),
      }
      response.missions.push(mission)
    }

    response.missions.sort((a, b) => b.startedAt - a.startedAt)
    res.json(response)
  })

  return router
}
