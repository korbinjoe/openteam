import type { ActivityState } from '../terminal/ActivityDeriver'
import type { ExpertSessionStore } from './ExpertSessionStore'
import type { SessionRegistry } from '../terminal/SessionRegistry'
import type { FileOperationCollector } from '../terminal/FileOperationCollector'
import type { ExpertTokenTracker } from './ExpertTokenTracker'
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
}

export const createActivityHandler = (ctx: ActivityHandlerContext) => {
  const { store, sessionRegistry, sessionId, key, agentId, chatId, fileCollector, tokenTracker } = ctx

  return (activity: ActivityState) => {
    const currentKey = store.findBySessionId(sessionId)?.key ?? key

    store.setActivity(currentKey, activity)
    sessionRegistry.updateActivity(sessionId, activity)
    fileCollector.onActivity(activity)

    if (activity.phase === 'completed') {
      tokenTracker.flush(activity)
      getGitWatchManager()?.notifyChangeForChat(chatId)
    } else if (activity.phase === 'waiting_confirmation') {
      tokenTracker.flush(activity)
    } else if (activity.phase === 'waiting_input') {
      tokenTracker.flush(activity)
      getGitWatchManager()?.notifyChangeForChat(chatId)
    } else {
      tokenTracker.throttledUpsert(activity)
    }
  }
}
