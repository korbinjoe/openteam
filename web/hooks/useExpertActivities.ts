import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import type { AgentActivity } from '../types/chat'

const PHASE_PRIORITY = ['error', 'tool_running', 'responding', 'thinking', 'waiting_confirmation', 'waiting_input', 'completed', 'initializing'] as const

/**
 * Expert Agent
 * -  Expert  activity
 * -  Expert  currentMergedActivity
 * -  completed
 */
export const useExpertActivities = () => {
  const [expertActivities, setExpertActivities] = useState<Record<string, AgentActivity>>({})
  const [showCompletion, setShowCompletion] = useState(false)
  const lastCompletionRef = useRef<AgentActivity | null>(null)
  const cleanupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const expertActivitiesRef = useRef(expertActivities)
  expertActivitiesRef.current = expertActivities

  const mergeActivity = useCallback((experts: Record<string, AgentActivity>): AgentActivity | null => {
    const all = Object.values(experts).filter((a): a is AgentActivity => !!a)
    if (all.length === 0) return null

    const phases = all.map((a) => a.phase)
    const phase = (PHASE_PRIORITY.find((p) => phases.includes(p)) ?? 'initializing') as AgentActivity['phase']

    const currentTool = all.find((a) => a.currentTool)?.currentTool
    const toolCount = all.reduce((acc, a) => acc + (a.toolCount || 0), 0)
    const toolCompleted = all.reduce((acc, a) => acc + (a.toolCompleted || 0), 0)
    const hasText = all.some((a) => a.hasText)
    const cost = all.reduce((acc, a) => acc + (a.cost || 0), 0) || undefined
    const tokenInput = all.reduce((acc, a) => acc + (a.tokens?.input || 0), 0)
    const tokenOutput = all.reduce((acc, a) => acc + (a.tokens?.output || 0), 0)
    const background = all.some((a) => a.background)
    const exitReason = all.find((a) => a.exitReason)?.exitReason

    return {
      phase,
      background,
      currentTool,
      toolCount,
      toolCompleted,
      hasText,
      cost,
      tokens: tokenInput || tokenOutput ? { input: tokenInput, output: tokenOutput } : undefined,
      exitReason,
      updatedAt: Date.now(),
    }
  }, [])

  const currentMergedActivity = useMemo(
    () => mergeActivity(expertActivities),
    [expertActivities, mergeActivity],
  )

  useEffect(() => {
    if (!currentMergedActivity) return
    if (currentMergedActivity.phase === 'completed' && lastCompletionRef.current !== currentMergedActivity) {
      lastCompletionRef.current = currentMergedActivity
      if (currentMergedActivity.toolCompleted > 0 && !currentMergedActivity.exitReason) {
        setShowCompletion(true)
      }

      cleanupTimerRef.current = setTimeout(() => {
        setExpertActivities((prev) => {
          const next: Record<string, AgentActivity> = {}
          for (const [id, a] of Object.entries(prev)) {
            if (a.phase !== 'completed') next[id] = a
          }
          return Object.keys(next).length === Object.keys(prev).length ? prev : next
        })
      }, 30_000)
    } else if (currentMergedActivity.phase !== 'completed' && cleanupTimerRef.current) {
      clearTimeout(cleanupTimerRef.current)
      cleanupTimerRef.current = null
    }
  }, [currentMergedActivity])

  return {
    expertActivities,
    setExpertActivities,
    expertActivitiesRef,
    currentMergedActivity,
    showCompletion,
    setShowCompletion,
  }
}
