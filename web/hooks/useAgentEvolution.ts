import { useState, useEffect, useCallback } from 'react'
import { fetchEvolutionEntries } from '@/services/agentEvolutionService'
import type { EvolutionEntry } from '../types/team'

const useAgentEvolution = (agentId: string | undefined) => {
  const [entries, setEntries] = useState<EvolutionEntry[]>([])
  const [loading, setLoading] = useState(false)

  const fetch_ = useCallback(async () => {
    if (!agentId || agentId === 'new') return
    setLoading(true)
    try {
      const data = await fetchEvolutionEntries(agentId)
      setEntries(data)
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [agentId])

  useEffect(() => { fetch_() }, [fetch_])

  return { entries, loading, refetch: fetch_ }
}

export default useAgentEvolution
