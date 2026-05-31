import { Router } from 'express'
import type { MemoryStore } from '../../stores/MemoryStore'
import type { GrowthStore } from '../../stores/GrowthStore'

type EvolutionType = 'skill_acquired' | 'memory_updated' | 'strategy_evolved' | 'milestone'

interface EvolutionEntry {
  id: string
  type: EvolutionType
  title: string
  description: string
  agentName: string
  timestamp: number
}

interface EvolutionRouteDeps {
  memoryStore: MemoryStore
  growthStore: GrowthStore
}

const EVOLUTION_LIMIT = 100
const MILESTONE_THRESHOLD_LEVEL = 2

export const createEvolutionRoutes = (deps: EvolutionRouteDeps): Router => {
  const router = Router()
  const { memoryStore, growthStore } = deps

  router.get('/api/agents/:id/evolution', (req, res) => {
    const agentId = req.params.id
    const entries: EvolutionEntry[] = []

    const memories = memoryStore.listByAgent(agentId)
    for (const mem of memories) {
      entries.push({
        id: `mem-${mem.id}`,
        type: 'memory_updated' as EvolutionType,
        title: mem.category,
        description: mem.content.slice(0, 160),
        agentName: agentId,
        timestamp: new Date(mem.updatedAt).getTime(),
      })
    }

    const growthMetrics = growthStore.listByAgent(agentId)
    for (const metric of growthMetrics) {
      if (metric.level >= MILESTONE_THRESHOLD_LEVEL) {
        entries.push({
          id: `growth-${metric.id}`,
          type: 'milestone' as EvolutionType,
          title: `Reached level ${metric.level} in ${metric.metric}`,
          description: `Accumulated ${metric.value} points in ${metric.metric.replace(/_/g, ' ')}`,
          agentName: agentId,
          timestamp: new Date(metric.updatedAt).getTime(),
        })
      }
    }

    entries.sort((a, b) => b.timestamp - a.timestamp)
    res.json(entries.slice(0, EVOLUTION_LIMIT))
  })

  return router
}
