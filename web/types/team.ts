
export type CollaborationMode = 'hierarchical' | 'pipeline' | 'swarm' | 'custom'

export type DispatchStrategy = 'static' | 'dynamic' | 'adaptive' | 'competitive'

export interface TeamNode {
  id: string
  agentName: string
  icon: string
  position: { x: number; y: number }
  config: TeamNodeConfig
}

export interface TeamNodeConfig {
  [key: string]: unknown
  trigger?: string
  input?: string
  output?: string
  fallback?: string
  model?: string
  maxRetries?: number
  timeout?: number
}

export interface TeamEdge {
  id: string
  source: string
  target: string
  label?: string
  condition?: string
}

export interface Team {
  id: string
  name: string
  description?: string
  icon?: string
  mode: CollaborationMode
  dispatchStrategy: DispatchStrategy
  nodes: TeamNode[]
  edges: TeamEdge[]
  source: 'builtin' | 'user'
  createdAt: string
  updatedAt: string
}

export interface TeamTemplate {
  id: string
  name: string
  description: string
  icon: string
  tags: string[]
  mode: CollaborationMode
  dispatchStrategy: DispatchStrategy
  nodes: TeamNode[]
  edges: TeamEdge[]
}

export interface AgentDNA {
  agentName: string
  skills: AgentSkill[]
  metrics: AgentMetrics
  evolutionLog: EvolutionEntry[]
}

export interface AgentSkill {
  name: string
  level: number
  maxLevel: number
  missionCount: number
  missionsToNextLevel: number
}

export interface AgentMetrics {
  successRate: number
  firstPassRate: number
  avgDurationMs: number
  prevSuccessRate?: number
  prevFirstPassRate?: number
  prevAvgDurationMs?: number
  totalTasks: number
  qualityScore: string
}

export type EvolutionType = 'skill_acquired' | 'memory_updated' | 'strategy_evolved' | 'milestone'

export interface EvolutionEntry {
  id: string
  type: EvolutionType
  title: string
  description: string
  agentName: string
  timestamp: number
  metadata?: Record<string, unknown>
}
