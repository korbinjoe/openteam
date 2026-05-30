import type { AgentRegistry } from '../config/AgentRegistry'
import { DISPATCH_RULES, CONJUNCTIONS, DEPENDENCIES, type DispatchRule } from './dispatchRules'
import { createLogger } from '../lib/logger'

const log = createLogger('ExecutionModeRouter')

export interface RouteDecision {
  tier: 'single-expert' | 'lead'
  agentId?: string
  confidence: number
}

export interface RouterConfig {
  enabled: boolean
  t1Enabled: boolean
  t1ConfidenceThreshold: number
}

const DEFAULT_CONFIG: RouterConfig = {
  enabled: true,
  t1Enabled: false,
  t1ConfidenceThreshold: 0.85,
}

export class ExecutionModeRouter {
  private rules: DispatchRule[]
  private config: RouterConfig

  constructor(
    private agentRegistry: AgentRegistry,
    config?: Partial<RouterConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.rules = DISPATCH_RULES.filter(r => agentRegistry.get(r.agentId))
  }

  classify(input: string): RouteDecision {
    if (!this.config.enabled || !this.config.t1Enabled) {
      return { tier: 'lead', confidence: 1.0 }
    }

    const normalized = input.toLowerCase().trim()

    if (this.hasConjunctions(normalized) || this.hasDependencies(normalized)) {
      return { tier: 'lead', confidence: 1.0 }
    }

    const matches = this.matchRules(normalized)

    if (matches.length === 1 && matches[0].score >= this.config.t1ConfidenceThreshold) {
      log.info('T1 classification', { agentId: matches[0].agentId, confidence: matches[0].score, input: input.slice(0, 80) })
      return {
        tier: 'single-expert',
        agentId: matches[0].agentId,
        confidence: matches[0].score,
      }
    }

    return { tier: 'lead', confidence: 1.0 }
  }

  private hasConjunctions(input: string): boolean {
    for (const word of CONJUNCTIONS.en) {
      if (this.containsWord(input, word)) return true
    }
    for (const word of CONJUNCTIONS.zh) {
      if (input.includes(word)) return true
    }
    return false
  }

  private hasDependencies(input: string): boolean {
    for (const word of DEPENDENCIES.en) {
      if (this.containsWord(input, word)) return true
    }
    for (const word of DEPENDENCIES.zh) {
      if (input.includes(word)) return true
    }
    return false
  }

  private matchRules(input: string): Array<{ agentId: string; score: number }> {
    const results: Array<{ agentId: string; score: number; matchCount: number }> = []

    for (const rule of this.rules) {
      let matchCount = 0
      const totalKeywords = rule.keywords.en.length + rule.keywords.zh.length

      for (const kw of rule.keywords.en) {
        if (this.containsWord(input, kw)) matchCount++
      }
      for (const kw of rule.keywords.zh) {
        if (input.includes(kw)) matchCount++
      }

      if (matchCount > 0) {
        const score = Math.min(0.5 + (matchCount / totalKeywords) * 0.5, 0.95)
        results.push({ agentId: rule.agentId, score, matchCount })
      }
    }

    results.sort((a, b) => b.score - a.score)
    return results.map(({ agentId, score }) => ({ agentId, score }))
  }

  private containsWord(input: string, word: string): boolean {
    if (word.length <= 3) {
      const re = new RegExp(`\\b${this.escapeRegex(word)}\\b`, 'i')
      return re.test(input)
    }
    return input.includes(word.toLowerCase())
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }
}
