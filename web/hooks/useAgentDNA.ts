import { useState, useEffect, useCallback } from 'react'
import { API_BASE, authFetch } from '@/config/api'

export interface AgentDNASkill {
  name: string
  level: number
  missionCount: number
}

export interface AgentDNAMetrics {
  successRate: number
  firstPassRate: number
  avgDurationMs: number
  totalTasks: number
  qualityScore: string
}

export interface AgentDNA {
  agentName: string
  skills: AgentDNASkill[]
  metrics: AgentDNAMetrics
  evolutionLog: unknown[]
}

const useAgentDNA = (agentId: string | undefined) => {
  const [dna, setDna] = useState<AgentDNA | null>(null)
  const [loading, setLoading] = useState(false)

  const fetch_ = useCallback(async () => {
    if (!agentId || agentId === 'new') return
    setLoading(true)
    try {
      const res = await authFetch(`${API_BASE}/api/agents/${encodeURIComponent(agentId)}/dna`)
      if (res.ok) setDna(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [agentId])

  useEffect(() => { fetch_() }, [fetch_])

  return { dna, loading, refetch: fetch_ }
}

export default useAgentDNA
