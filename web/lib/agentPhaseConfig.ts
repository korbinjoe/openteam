/**
 * Agent Phase  —  &
 *  AgentActivityPanel
 */

import type { AgentPhase } from '@/types/chat'

export interface PhaseStyle {
  color: string
  pulse: boolean
}

export const PHASE_STYLES: Record<AgentPhase, PhaseStyle> = {
  initializing: { color: 'rgb(var(--text-muted))', pulse: false },
  thinking: { color: 'rgb(var(--accent-brand))', pulse: true },
  tool_running: { color: 'rgb(var(--accent-green))', pulse: true },
  responding: { color: 'rgb(var(--accent-purple))', pulse: true },
  waiting_input: { color: 'rgb(var(--accent-yellow) / 0.6)', pulse: false },
  waiting_confirmation: { color: 'rgb(var(--accent-yellow, --accent-brand))', pulse: true },
  completed: { color: 'rgb(var(--accent-green))', pulse: false },
  error: { color: 'rgb(var(--accent-red))', pulse: false },
}
