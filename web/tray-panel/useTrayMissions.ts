import { useEffect, useRef, useState } from 'react'
import { WebSocketClient } from '@/services/WebSocketClient'
import { authFetch, getWsUrl } from '@/config/api'
import type { TrayActiveMissionsResponse, TrayMissionDTO } from '@shared/tray-types'

const TERMINAL_PHASES = new Set(['completed', 'error', 'idle'])

const isRunningAgent = (phase: string): boolean => !TERMINAL_PHASES.has(phase)

export const useTrayMissions = () => {
  const [missions, setMissions] = useState<TrayMissionDTO[]>([])
  const wsRef = useRef<WebSocketClient | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await authFetch('/api/tray/active-missions')
        if (!res.ok) return
        const body = await res.json() as TrayActiveMissionsResponse
        if (cancelled) return
        setMissions(body.missions)
      } catch {
        /* offline — wait for WS reconnect */
      }
    }
    load()

    const ws = new WebSocketClient(getWsUrl())
    wsRef.current = ws
    ws.connect()

    ws.on('chat:activity', (data) => {
      const payload = data as {
        chatId: string
        agentActivities?: Array<{
          agentId: string
          agentName: string
          phase: string
          currentTool?: string
          toolCount: number
          toolCompleted: number
          cost?: number
        }>
      }
      if (!payload?.chatId) return

      setMissions((prev) => {
        const idx = prev.findIndex((m) => m.chatId === payload.chatId)
        const agents = payload.agentActivities ?? []
        const running = agents.filter((a) => isRunningAgent(a.phase))

        if (running.length === 0) {
          return idx === -1 ? prev : prev.filter((m) => m.chatId !== payload.chatId)
        }

        if (idx === -1) {
          // Mission missing from snapshot — defer to the next /api/tray
          // fetch rather than fabricating a card from partial data.
          load()
          return prev
        }

        const next = [...prev]
        const totalToolProgress = agents.reduce(
          (acc, a) => ({ completed: acc.completed + a.toolCompleted, total: acc.total + a.toolCount }),
          { completed: 0, total: 0 },
        )
        const totalCost = agents.reduce((sum, a) => sum + (a.cost ?? 0), 0)
        next[idx] = {
          ...next[idx],
          agents,
          topPhase: running[0].phase,
          totalToolProgress,
          totalCost,
        }
        return next
      })
    })

    ws.on('chat:status-changed', () => {
      load()
    })

    return () => {
      cancelled = true
      ws.disconnect()
      wsRef.current = null
    }
  }, [])

  return missions
}
