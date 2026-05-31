import { API_BASE, authFetch } from '@/config/api'
import type { EvolutionEntry } from '../types/team'

export const fetchEvolutionEntries = async (agentId: string): Promise<EvolutionEntry[]> => {
  const res = await authFetch(`${API_BASE}/api/agents/${encodeURIComponent(agentId)}/evolution`)
  if (!res.ok) return []
  return res.json()
}
