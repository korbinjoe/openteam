/**
 * URL helpers for the workspace surface.
 *
 * The URL is the single source of truth for navigation state:
 *   /workspace/:wsId                                    → workspace home (no mission)
 *   /workspace/:wsId/mission/:missionId                 → mission overview
 *   /workspace/:wsId/mission/:missionId?agent=:agentId  → agent 1:1 view
 *
 * Anything that wants to change mission/agent selection MUST go through this
 * helper — `WorkspaceContext.selectAgent` and `.openMissionOverview` are thin
 * wrappers that call `navigate(buildMissionUrl(...))`.
 */

export const buildWorkspaceUrl = (wsId: string): string =>
  `/workspace/${wsId}`

export const buildMissionUrl = (wsId: string, missionId: string, agentId?: string): string => {
  const base = `/workspace/${wsId}/mission/${missionId}`
  return agentId ? `${base}?agent=${encodeURIComponent(agentId)}` : base
}
