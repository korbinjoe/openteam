/**
 * Shared types for the macOS tray mission overview surface.
 *
 * Electron main (`TrayManager`) and the server endpoint
 * (`/api/tray/active-missions`) import these to stay in sync.
 */

export interface TrayMissionAgent {
  agentId: string
  agentName: string
  phase: string
  currentTool?: string
  toolCompleted: number
  toolCount: number
  cost?: number
}

export interface TrayMissionDTO {
  chatId: string
  title: string
  workspaceId: string
  workspaceName: string
  topPhase: string
  agents: TrayMissionAgent[]
  totalToolProgress: { completed: number; total: number }
  totalCost: number
  startedAt: number
}

export interface TrayActiveMissionsResponse {
  missions: TrayMissionDTO[]
}
