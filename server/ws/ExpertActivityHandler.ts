import type { ActivityState } from '../terminal/ActivityDeriver'
import type { ExpertSessionStore } from './ExpertSessionStore'
import type { SessionRegistry } from '../terminal/SessionRegistry'
import type { FileOperationCollector } from '../terminal/FileOperationCollector'
import type { ExpertTokenTracker } from './ExpertTokenTracker'
import type { MailboxManager } from '../mailbox/MailboxManager'
import { createAgentMessage } from '../../shared/agent-message-types'
import { getGitWatchManager } from '../git/GitWatchManager'
import { createLogger } from '../lib/logger'

const log = createLogger('Expert')

export interface ActivityHandlerContext {
  store: ExpertSessionStore
  sessionRegistry: SessionRegistry
  sessionId: string
  key: string
  agentId: string
  chatId: string
  fileCollector: FileOperationCollector
  tokenTracker: ExpertTokenTracker
  mailboxManager?: MailboxManager
}

export const createActivityHandler = (ctx: ActivityHandlerContext) => {
  const { store, sessionRegistry, sessionId, key, agentId, chatId, fileCollector, tokenTracker, mailboxManager } = ctx

  return (activity: ActivityState) => {
    const currentKey = store.findBySessionId(sessionId)?.key ?? key

    store.setActivity(currentKey, activity)
    sessionRegistry.updateActivity(sessionId, activity)
    fileCollector.onActivity(activity)

    const getMessages = () => {
      const expert = store.get(currentKey)
      return expert?.acpClient?.getCurrentMessages() || []
    }

    if (activity.phase === 'completed') {
      tokenTracker.flush(activity)
      getGitWatchManager()?.notifyChangeForChat(chatId)
    } else if (activity.phase === 'waiting_confirmation') {
      tokenTracker.flush(activity)
      if (mailboxManager && chatId) {
        try {
          const taskId = store.getMeta(currentKey, 'taskEnvelopeId') as string || store.getMeta(currentKey, 'executionLogId') as string || ''
          const allMessages = getMessages()
          const lastAsk = [...allMessages].reverse().find(
            (m: any) => m.type === 'toolUse' && m.toolUse?.toolName === 'AskUserQuestion'
          )
          let question: string
          try {
            const input = lastAsk?.toolUse?.input
            const parsed = typeof input === 'string' ? JSON.parse(input) : input
            const qs = parsed?.questions?.map((q: any) => q.question) || []
            question = qs.length > 0 ? qs.join('\n') : 'Expert is waiting for confirmation'
          } catch {
            question = 'Expert is waiting for confirmation'
          }
          const msg = createAgentMessage('task:input_required', {
            from: agentId, to: 'lead', chatId, taskId,
            payload: { taskId, question },
          })
          mailboxManager.writeMessage(chatId, agentId, 'lead', msg)
          log.info('Wrote task:input_required to mailbox', { agentId, chatId, question: question.substring(0, 80) })
        } catch (err) {
          log.warn('Failed to write task:input_required to mailbox', { agentId, error: err instanceof Error ? err.message : String(err) })
        }
      }
    } else if (activity.phase === 'waiting_input') {
      tokenTracker.flush(activity)
      getGitWatchManager()?.notifyChangeForChat(chatId)
    } else {
      tokenTracker.throttledUpsert(activity)
    }
  }
}
