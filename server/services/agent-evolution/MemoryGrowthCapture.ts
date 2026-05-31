import type { MemoryStore } from '../../stores/MemoryStore'
import type { GrowthStore } from '../../stores/GrowthStore'
import type { WhiteboardManager } from '../../whiteboard/WhiteboardManager'
import type { AgentRegistry } from '../../config/AgentRegistry'
import type { WhiteboardEntry } from '../../../shared/whiteboard-types'
import type { MemoryCategory } from '../../config/types'
import { createLogger } from '../../lib/logger'

const log = createLogger('MemoryGrowthCapture')

const CAPTURE_TYPES = new Set(['decision', 'constraint', 'open_question'])

const TYPE_CATEGORY_MAP: Record<string, { category: MemoryCategory; importance: number }> = {
  decision: { category: 'context', importance: 2 },
  constraint: { category: 'context', importance: 3 },
  open_question: { category: 'feedback', importance: 2 },
}

export class MemoryGrowthCapture {
  private sourceSeen = new Map<string, true>()

  constructor(
    private memoryStore: MemoryStore,
    private growthStore: GrowthStore,
    private whiteboardManager: WhiteboardManager,
    private agentRegistry: AgentRegistry,
  ) {
    this.loadSourceIndex()
  }

  private loadSourceIndex(): void {
    try {
      const sources = this.memoryStore.listAllSources()
      for (const key of sources) {
        this.sourceSeen.set(key, true)
      }
      log.info('Loaded source dedup index', { count: this.sourceSeen.size })
    } catch (err) {
      log.warn('Failed to load source index', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  onTaskCompleted(agentId: string, _chatId: string): void {
    if (!this.agentRegistry.get(agentId)) {
      log.debug('Skipping task-completed for unknown agent', { agentId })
      return
    }

    try {
      this.growthStore.increment(agentId, 'tasks_completed', 1)
      log.info('Incremented tasks_completed', { agentId })
    } catch (err) {
      log.error('Failed to increment growth', { agentId, error: err instanceof Error ? err.message : String(err) })
    }
  }

  onTaskFailed(_agentId: string, _chatId: string): void {
    // Phase 1: no-op — avoids gaming and bad signal until recovery-credit design
  }

  onWhiteboardEntry(chatId: string, entry: WhiteboardEntry): void {
    if (!CAPTURE_TYPES.has(entry.type)) return

    if (entry.type === 'open_question' && entry.status !== 'archived') return

    const agentId = this.resolveAgentId(entry.by)
    if (!agentId) return

    const source = `wb:${chatId}:${entry.id}`
    if (this.sourceSeen.has(source)) return

    const mapping = TYPE_CATEGORY_MAP[entry.type]
    if (!mapping) return

    try {
      this.memoryStore.create({
        agentId,
        content: entry.summary,
        category: mapping.category,
        source,
        chatId,
        importance: mapping.importance,
      })
      this.sourceSeen.set(source, true)
      log.info('Captured whiteboard entry as memory', { agentId, type: entry.type, entryId: entry.id })
    } catch (err) {
      log.error('Failed to capture whiteboard entry', { agentId, entryId: entry.id, error: err instanceof Error ? err.message : String(err) })
    }
  }

  private resolveAgentId(by: string): string | null {
    if (!by) return null

    const suffixed = by.replace(/:auto$/, '')
    if (this.agentRegistry.get(suffixed)) return suffixed

    const baseId = suffixed.split(':')[0]
    if (this.agentRegistry.get(baseId)) return baseId

    log.debug('Skipping unrecognized agent', { by })
    return null
  }
}
