/**
 * LogSemanticizer -  Agent
 *  AgentActivityPanel
 */

import type { AgentActivity, AgentPhase } from '@/types/chat'
import type { AgentPersonality } from '@/types/agentConfig'

const basename = (path: string): string => {
  const parts = path.split('/')
  return parts[parts.length - 1] || path
}

const TOOL_ACTIONS: Record<string, string> = {
  Read: 'Reading',
  Edit: 'Editing',
  Write: 'Writing',
  Glob: 'Searching files',
  Grep: 'Searching code',
  Bash: 'Running commands',
  Agent: 'Dispatching sub-task',
  WebFetch: 'Fetching info',
  WebSearch: 'Searching',
  TodoWrite: 'Updating task',
  AskUserQuestion: 'Waiting for your reply',
}

const getToolAction = (activity: AgentActivity): string => {
  const tool = activity.currentTool || ''
  const action = TOOL_ACTIONS[tool] || 'Working'

  if (activity.fileOp?.path) {
    const file = basename(activity.fileOp.path)
    switch (activity.fileOp.operation) {
      case 'read': return `Reading ${file}`
      case 'edit': return `Editing ${file}`
      case 'create': return `Creating ${file}`
      case 'delete': return `Deleting ${file}`
    }
  }

  return action
}

const PHASE_DESCRIPTIONS: Record<AgentPhase, string> = {
  initializing: 'Starting...',
  thinking: 'Thinking...',
  tool_running: 'Working',
  responding: 'Organizing results...',
  waiting_input: 'Waiting for input',
  waiting_confirmation: 'Awaiting confirmation',
  completed: 'Mission complete',
  error: 'encountered an issue',
}

/**
 * @param activity Agent
 * @param personality Agent
 * @param name Agent fallback
 * @returns   auth.ts
 */
export const semanticize = (
  activity: AgentActivity,
  personality?: AgentPersonality,
  name?: string,
): string => {
  const nick = personality?.nickname || name || 'Agent'

  if (activity.phase === 'tool_running') {
    return `${nick}${getToolAction(activity)}`
  }

  return `${nick}${PHASE_DESCRIPTIONS[activity.phase] || 'Working'}`
}

export const semanticizeWithEmoji = (
  activity: AgentActivity,
  personality?: AgentPersonality,
  name?: string,
): string => {
  const emoji = personality?.emoji || ''
  const text = semanticize(activity, personality, name)
  return emoji ? `${emoji} ${text}` : text
}
