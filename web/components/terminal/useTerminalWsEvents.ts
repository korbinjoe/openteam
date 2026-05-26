/**
 * useTerminalWsEvents —  WS
 *
 * -  pendingChunks / flushRaf / enqueueWrite  rAF
 * - handleExpertData  inst.write() / inst.resetAndWriteSnapshot()
 * -  TerminalInstance
 * - seq  snapshotApplied Map
 * - open  activeKey effect
 */

import { useEffect, useRef } from 'react'
import type { WebSocketClient } from '../../services/WebSocketClient'
import type { TerminalInstance } from './TerminalInstance'

interface ExpertInfo {
  agentId: string
  sessionId: string
  agentName: string
  agentIcon: string
  status: 'running' | 'completed'
  exitCode?: number
  completedAt?: string
}

interface UseTerminalWsEventsOptions {
  wsClient: WebSocketClient
  chatId?: string
  terminalsRef: React.RefObject<Map<string, TerminalInstance> | null>
  expertsRef: React.MutableRefObject<ExpertInfo[]>
  activeKey: string
  getOrCreateInstance: (agentId: string) => TerminalInstance
  tryOpen: (agentId: string) => Promise<void>
  disposeTerminal: (agentId: string) => void
  setExperts: React.Dispatch<React.SetStateAction<ExpertInfo[]>>
  setActiveKey: React.Dispatch<React.SetStateAction<string>>
}

export const useTerminalWsEvents = ({
  wsClient,
  chatId,
  terminalsRef,
  expertsRef,
  activeKey,
  getOrCreateInstance,
  tryOpen,
  disposeTerminal,
  setExperts,
  setActiveKey,
}: UseTerminalWsEventsOptions) => {
  const activeKeyRef = useRef(activeKey)
  activeKeyRef.current = activeKey
  const chatIdRef = useRef(chatId)
  chatIdRef.current = chatId
  /**  effect  chatId cleanup  chatId  */
  const prevChatIdRef = useRef(chatId)

  useEffect(() => {
    prevChatIdRef.current = chatId

    const isCurrentChatEvent = (payload?: { chatId?: string }) => {
      if (!payload?.chatId) return false
      if (!chatIdRef.current) return false
      return payload.chatId === chatIdRef.current
    }

    const lastSeqByAgent = new Map<string, { sessionId: string; seq: number }>()

    const handleExpertData = (payload: { agentId: string; chatId?: string; sessionId?: string; seq?: number; snapshot?: boolean; data: string; ptySize?: { cols: number; rows: number } }) => {
      if (!isCurrentChatEvent(payload)) return
      const currentExperts = expertsRef.current ?? []
      const currentExpert = currentExperts.find((e) => e.agentId === payload.agentId)
      if (!currentExpert || !payload.sessionId) return
      if (!currentExpert.sessionId) {
        setExperts(prev => prev.map(e =>
          e.agentId === payload.agentId ? { ...e, sessionId: payload.sessionId! } : e
        ))
        expertsRef.current = (expertsRef.current ?? []).map(e =>
          e.agentId === payload.agentId ? { ...e, sessionId: payload.sessionId! } : e
        )
      } else if (currentExpert.sessionId !== payload.sessionId) {
        return
      }

      const sessionId = payload.sessionId
      if (payload.seq != null) {
        const last = lastSeqByAgent.get(payload.agentId)
        if (last && last.sessionId === sessionId && payload.seq <= last.seq) {
          return
        }
        lastSeqByAgent.set(payload.agentId, { sessionId, seq: payload.seq })
      }

      const current = terminalsRef.current?.get(payload.agentId)
      const inst = (!current || current.isDisposed)
        ? getOrCreateInstance(payload.agentId)
        : current

      if (payload.ptySize) {
        inst.syncSize(payload.ptySize.cols, payload.ptySize.rows)
      }

      if (payload.snapshot) {
        inst.resetAndWriteSnapshot(payload.data)
      } else {
        inst.write(payload.data)
      }

      // First-frame open: when terminal mode is entered for a live ACP agent,
      // the instance is created here (data-driven) AFTER the ref callback ran
      // and AFTER the active-key effect resolved with no instance. Without
      // this kick, pendingData accumulates forever and xterm never mounts —
      // the container stays an empty <div class="h-full">.
      if (!inst.isOpened && !inst.isOpening && !inst.isDisposed) {
        tryOpen(payload.agentId).catch(() => {})
      }
    }

    // expert:started fires for fresh ACP launches AND for chat:resume-experts
    // replays (live re-attach + dead-JSONL playback). Dispose any stale
    // TerminalInstance from a prior run, then UPSERT the entry so terminal
    // mode discovers persisted-but-not-running agents — `replayHistoryForDeadSession`
    // does not trigger `expert:list-updated`, so without this upsert the dead
    // JSONL case never populates `experts` and the cli-attach effect never fires.
    const handleExpertStarted = (payload: ExpertInfo & { chatId?: string }) => {
      if (!isCurrentChatEvent(payload)) return

      disposeTerminal(payload.agentId)
      const next: ExpertInfo = {
        agentId: payload.agentId,
        sessionId: payload.sessionId,
        agentName: payload.agentName,
        agentIcon: payload.agentIcon,
        status: payload.status,
        exitCode: payload.exitCode,
        completedAt: payload.completedAt,
      }
      setExperts(prev => {
        const idx = prev.findIndex(e => e.agentId === payload.agentId)
        if (idx === -1) return [...prev, next]
        const copy = prev.slice()
        copy[idx] = { ...prev[idx], ...next }
        return copy
      })
      const prevRef = expertsRef.current ?? []
      const idxRef = prevRef.findIndex(e => e.agentId === payload.agentId)
      expertsRef.current = idxRef === -1
        ? [...prevRef, next]
        : prevRef.map((e, i) => (i === idxRef ? { ...e, ...next } : e))
      if (!activeKeyRef.current) setActiveKey(payload.agentId)
    }

    // Resume-PTY bridge: server tells us a view-PTY is up for an agent. Make
    // sure that agent has an ExpertInfo slot so xterm renders and so the
    // strict `expert:data` validator (which gates on the entry + sessionId)
    // lets the first bytes through. We synthesize a "completed" entry — the
    // resumed PTY is just a transient view onto an existing JSONL, not a
    // newly-launched ACP session.
    const handleViewAttached = (payload: { agentId: string; chatId?: string; sessionId: string; cwd?: string }) => {
      if (!isCurrentChatEvent(payload)) return
      const existing = (expertsRef.current ?? []).find(e => e.agentId === payload.agentId)
      if (existing) {
        // For live ACP agents the expert:list entry carries the ACP sessionId,
        // not the cliSessionId that view-PTY / expert:data use. Overwrite so the
        // sessionId guard in handleExpertData lets resume-PTY frames through.
        if (existing.sessionId !== payload.sessionId) {
          setExperts(prev => prev.map(e =>
            e.agentId === payload.agentId ? { ...e, sessionId: payload.sessionId } : e
          ))
          expertsRef.current = (expertsRef.current ?? []).map(e =>
            e.agentId === payload.agentId ? { ...e, sessionId: payload.sessionId } : e
          )
        }
      } else {
        const synthesized: ExpertInfo = {
          agentId: payload.agentId,
          sessionId: payload.sessionId,
          agentName: payload.agentId,
          agentIcon: '',
          status: 'running',
        }
        setExperts(prev => prev.some(e => e.agentId === payload.agentId) ? prev : [...prev, synthesized])
        expertsRef.current = [...(expertsRef.current ?? []), synthesized]
      }
      if (!activeKeyRef.current || activeKeyRef.current === '') {
        setActiveKey(payload.agentId)
      }
    }

    const handleExpertExit = (payload: { agentId: string; chatId?: string; exitCode?: number }) => {
      if (!isCurrentChatEvent(payload)) return
      const inst = terminalsRef.current?.get(payload.agentId)
      if (inst) {
        const msg = payload.exitCode !== undefined
          ? `\r\n\x1b[33m[Agent terminated with exit code: ${payload.exitCode}]\x1b[0m\r\n`
          : '\r\n\x1b[33m[Agent terminated]\x1b[0m\r\n'
        inst.write(msg)
      }
      setExperts(prev => prev.map(e =>
        e.agentId === payload.agentId
          ? { ...e, status: 'completed' as const, exitCode: payload.exitCode, completedAt: new Date().toISOString() }
          : e
      ))
    }

    const handleExpertStopped = (payload: { agentId: string; chatId?: string; exitCode?: number }) => {
      if (!isCurrentChatEvent(payload)) return
      const inst = terminalsRef.current?.get(payload.agentId)
      if (inst) inst.write('\r\n\x1b[33m[Agent stopped manually]\x1b[0m\r\n')
      setExperts(prev => prev.map(e =>
        e.agentId === payload.agentId
          ? { ...e, status: 'completed' as const, exitCode: payload.exitCode ?? -1, completedAt: new Date().toISOString() }
          : e
      ))
    }

    const handleExpertResumeFailed = (payload: { agentId: string; chatId?: string; sessionId?: string; reason?: string; message?: string }) => {
      if (!isCurrentChatEvent(payload)) return
      let shouldRemove = false
      let nextActiveKey: string | null = null
      setExperts(prev => {
        const target = prev.find(e => e.agentId === payload.agentId)
        if (!target) return prev

        if (payload.sessionId && target.sessionId && payload.sessionId !== target.sessionId) {
          return prev
        }

        shouldRemove = true
        const filtered = prev.filter(e => e.agentId !== payload.agentId)
        if (filtered.length > 0 && !filtered.some(e => e.agentId === activeKeyRef.current)) {
          nextActiveKey = filtered[0].agentId
        }
        return filtered
      })

      if (shouldRemove) {
        disposeTerminal(payload.agentId)
        if (nextActiveKey) setActiveKey(nextActiveKey)
      }
    }

    const handleExpertError = (payload: { agentId?: string; chatId?: string; error?: string }) => {
      if (!isCurrentChatEvent(payload)) return
      if (!payload?.agentId) return
      // Terminal-view errors (resume-PTY spawn failure, missing CLI, unsupported
      // provider) are scoped to the view-PTY bridge — the underlying ACP agent
      // is still valid and should keep its slot in the experts list.
      if (payload.error?.startsWith('terminal_view_')) return
      disposeTerminal(payload.agentId)
      let nextActiveKeyOnError: string | null = null
      setExperts(prev => {
        const filtered = prev.filter(e => e.agentId !== payload.agentId)
        if (filtered.length > 0 && !filtered.some(e => e.agentId === activeKeyRef.current)) {
          nextActiveKeyOnError = filtered[0].agentId
        }
        return filtered
      })
      if (nextActiveKeyOnError) setActiveKey(nextActiveKeyOnError)
    }

    const handleExpertStartFailed = (payload: { agentId: string; chatId?: string; exitCode?: number; message?: string }) => {
      if (!isCurrentChatEvent(payload)) return
      if (!payload?.agentId) return
      disposeTerminal(payload.agentId)
      let nextActiveKeyOnFail: string | null = null
      setExperts(prev => {
        const filtered = prev.filter(e => e.agentId !== payload.agentId)
        if (filtered.length > 0 && !filtered.some(e => e.agentId === activeKeyRef.current)) {
          nextActiveKeyOnFail = filtered[0].agentId
        }
        return filtered
      })
      if (nextActiveKeyOnFail) setActiveKey(nextActiveKeyOnFail)
    }

    const handleReconnected = () => {
      const cid = chatIdRef.current
      terminalsRef.current?.forEach((inst, agentId) => {
        if (inst.isOpened && !inst.isDisposed) {
          inst.write('\r\n\x1b[33m[Connection restored]\x1b[0m\r\n')
          inst.reactivate()
          if (cid) {
            wsClient.send('expert:resize', { chatId: cid, agentId, cols: inst.cols, rows: inst.rows })
          }
        }
      })
    }

    // Server-authoritative roster sync. Without this, multi-agent terminal view
    // never knows which agents have JSONL sessions to resume — TerminalPanel's
    // cli-attach effect iterates `experts`, finds it empty, and never sends
    // `expert:cli-attach`, so no `claude --resume` PTY ever spawns.
    // Merge instead of replace: preserve `expert:view-attached`-synthesized
    // entries the server's expert list (live ACP processes only) doesn't know
    // about yet.
    const handleExpertListSync = (payload: { chatId?: string; experts: ExpertInfo[] }) => {
      if (!isCurrentChatEvent(payload)) return
      const incoming = payload.experts ?? []
      const merge = (prev: ExpertInfo[]): ExpertInfo[] => {
        const incomingMap = new Map(incoming.map(e => [e.agentId, e]))
        const merged: ExpertInfo[] = prev.map(e => {
          const next = incomingMap.get(e.agentId)
          if (!next) return e
          // Preserve sessionId already bound by view-attached if the server
          // entry is missing one (live list may not include cliSessionId).
          return { ...e, ...next, sessionId: next.sessionId || e.sessionId }
        })
        for (const e of incoming) {
          if (!merged.some(m => m.agentId === e.agentId)) merged.push(e)
        }
        return merged
      }
      setExperts(merge)
      expertsRef.current = merge(expertsRef.current ?? [])
    }

    wsClient.on('expert:data', handleExpertData)
    wsClient.on('expert:started', handleExpertStarted)
    wsClient.on('expert:view-attached', handleViewAttached)
    wsClient.on('expert:list', handleExpertListSync)
    wsClient.on('expert:list-updated', handleExpertListSync)
    wsClient.on('expert:exit', handleExpertExit)
    wsClient.on('expert:stopped', handleExpertStopped)
    wsClient.on('expert:resume-failed', handleExpertResumeFailed)
    wsClient.on('expert:error', handleExpertError)
    wsClient.on('expert:start-failed', handleExpertStartFailed)
    wsClient.on('reconnected', handleReconnected)

    return () => {
      wsClient.off('expert:data', handleExpertData)
      wsClient.off('expert:started', handleExpertStarted)
      wsClient.off('expert:view-attached', handleViewAttached)
      wsClient.off('expert:list', handleExpertListSync)
      wsClient.off('expert:list-updated', handleExpertListSync)
      wsClient.off('expert:exit', handleExpertExit)
      wsClient.off('expert:stopped', handleExpertStopped)
      wsClient.off('expert:resume-failed', handleExpertResumeFailed)
      wsClient.off('expert:error', handleExpertError)
      wsClient.off('expert:start-failed', handleExpertStartFailed)
      wsClient.off('reconnected', handleReconnected)
      const nextChatId = chatIdRef.current
      if (nextChatId !== prevChatIdRef.current) {
        terminalsRef.current?.forEach((_, id) => disposeTerminal(id))
        setExperts([])
        setActiveKey('')
      }
    }
  }, [wsClient, chatId, getOrCreateInstance, tryOpen, disposeTerminal, terminalsRef, expertsRef, setExperts, setActiveKey])
}
