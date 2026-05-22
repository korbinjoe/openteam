/**
 * URL helpers for the workspace surface.
 *
 * The URL is the single source of truth for navigation state:
 *   /workspace/:wsId                              → workspace home (no task)
 *   /workspace/:wsId/task/:taskId                 → task overview
 *   /workspace/:wsId/task/:taskId?agent=:agentId  → agent 1:1 view
 *
 * Anything that wants to change task/agent selection MUST go through this
 * helper — `WorkspaceContext.selectAgent` and `.openTaskOverview` are thin
 * wrappers that call `navigate(buildTaskUrl(...))`.
 */

export const buildWorkspaceUrl = (wsId: string): string =>
  `/workspace/${wsId}`

export const buildTaskUrl = (wsId: string, taskId: string, agentId?: string): string => {
  const base = `/workspace/${wsId}/task/${taskId}`
  return agentId ? `${base}?agent=${encodeURIComponent(agentId)}` : base
}
