/**
 * useTerminalInstances —
 *
 *  TerminalPanel
 * - TerminalInstance //Map
 * - tryOpen  +  +
 * -  DOM ref
 * - activeKey  open/reactivate
 */

import { useRef, useEffect, useCallback } from 'react'
import type { WebSocketClient } from '../../services/WebSocketClient'
import { TerminalInstance } from './TerminalInstance'
import { estimateSize, TERMINAL_THEME, TERMINAL_THEME_LIGHT } from './constants'

const PREWARM_TAB_COUNT = 2

const isContainerRenderable = (container: HTMLDivElement): boolean => {
  if (container.offsetWidth === 0 || container.offsetHeight === 0) return false
  const style = window.getComputedStyle(container)
  return style.visibility !== 'hidden' && style.display !== 'none'
}

interface ExpertInfo {
  agentId: string
  sessionId: string
  agentName: string
  agentIcon: string
  status: 'running' | 'completed'
  exitCode?: number
  completedAt?: string
}

interface UseTerminalInstancesOptions {
  wsClient: WebSocketClient
  chatId?: string
  theme: string
  experts: ExpertInfo[]
  activeKey: string
  terminalAreaRef: React.RefObject<HTMLDivElement | null>
  layoutMode: 'split' | 'tabs'
}

export const useTerminalInstances = ({
  wsClient,
  chatId,
  theme,
  experts,
  activeKey,
  layoutMode,
}: UseTerminalInstancesOptions) => {
  const terminalsRef = useRef<Map<string, TerminalInstance>>(new Map())
  const containersRef = useRef<Map<string, HTMLDivElement>>(new Map())
  const containerRefCallbacksRef = useRef<Map<string, (el: HTMLDivElement | null) => void>>(new Map())
  const pendingPrepareRef = useRef<Map<string, Array<(size: { cols: number; rows: number }) => void>>>(new Map())
  const themeRef = useRef(theme)
  themeRef.current = theme
  const tryOpenRef = useRef<(agentId: string) => Promise<void>>(async () => {})
  const chatIdRef = useRef(chatId)
  chatIdRef.current = chatId

  const getOrCreateInstance = useCallback((agentId: string): TerminalInstance => {
    let inst = terminalsRef.current.get(agentId)
    if (!inst || inst.isDisposed) {
      inst = new TerminalInstance()
      inst.onData((data) => {
        const cid = chatIdRef.current
        if (!cid) return
        if (wsClient.isConnected()) {
          wsClient.send('expert:input', { chatId: cid, agentId, data })
        }
      })
      let lastSentCols = 0, lastSentRows = 0
      inst.onResize((size) => {
        if (size.cols === lastSentCols && size.rows === lastSentRows) return
        lastSentCols = size.cols; lastSentRows = size.rows
        const cid = chatIdRef.current
        if (!cid) return
        if (wsClient.isConnected()) {
          wsClient.send('expert:resize', { chatId: cid, agentId, cols: size.cols, rows: size.rows })
        }
      })
      terminalsRef.current.set(agentId, inst)
      const container = containersRef.current.get(agentId)
      if (container) inst.attach(container)
    }
    return inst
  }, [wsClient])

  const tryOpen = useCallback(async (agentId: string) => {
    const inst = terminalsRef.current.get(agentId)
    if (!inst || inst.isOpened || inst.isOpening || inst.isDisposed) return

    const container = containersRef.current.get(agentId)
    if (!container || !isContainerRenderable(container)) return

    const initSize = estimateSize(container)
    const size = await inst.open(initSize.cols, initSize.rows)

    if (themeRef.current === 'light') {
      inst.setTheme(TERMINAL_THEME_LIGHT)
    }

    const resolvers = pendingPrepareRef.current.get(agentId)
    if (resolvers && resolvers.length > 0) {
      pendingPrepareRef.current.delete(agentId)
      for (const r of resolvers) r(size)
    }
  }, [])
  tryOpenRef.current = tryOpen

  const disposeTerminal = useCallback((agentId: string) => {
    const inst = terminalsRef.current.get(agentId)
    if (inst) {
      inst.dispose()
      terminalsRef.current.delete(agentId)
    }
    containersRef.current.delete(agentId)
    containerRefCallbacksRef.current.delete(agentId)
  }, [])

  const getContainerRefCallback = useCallback((agentId: string) => {
    let cb = containerRefCallbacksRef.current.get(agentId)
    if (!cb) {
      cb = (el: HTMLDivElement | null) => {
        if (el) {
          containersRef.current.set(agentId, el)
          const inst = terminalsRef.current.get(agentId)
          if (inst && !inst.isDisposed) {
            inst.attach(el)
            if (!inst.isOpened && !inst.isOpening) {
            requestAnimationFrame(() => tryOpenRef.current(agentId))
            }
          }
        } else {
          containersRef.current.delete(agentId)
        }
      }
      containerRefCallbacksRef.current.set(agentId, cb)
    }
    return cb
  }, [])

  useEffect(() => {
    if (layoutMode !== 'split') return
    const targets = experts
      .map((e) => e.agentId)
      .filter((id) => id !== '__changes__')
    if (targets.length === 0) return

    const DATA_WAIT_FRAMES = 5
    let cancelled = false
    let attempts = 0
    const tryOpenAll = () => {
      if (cancelled) return
      attempts++
      const pending = targets.filter((id) => {
        const inst = terminalsRef.current.get(id)
        return inst && !inst.isOpened && !inst.isOpening && !inst.isDisposed
      })
      for (const id of pending) {
        const inst = terminalsRef.current.get(id)
        if (inst && (inst.hasPendingData || attempts > DATA_WAIT_FRAMES)) {
          tryOpen(id)
        }
      }
      if (pending.length > 0 && attempts < 30) {
        requestAnimationFrame(tryOpenAll)
      }
    }
    requestAnimationFrame(tryOpenAll)

    const refreshTimer = setTimeout(() => {
      if (cancelled) return
      terminalsRef.current.forEach((inst) => {
        if (inst.isOpened && !inst.isDisposed) {
          inst.reactivate()
        }
      })
    }, 800)

    return () => { cancelled = true; clearTimeout(refreshTimer) }
  }, [layoutMode, experts, tryOpen])

  useEffect(() => {
    if (layoutMode === 'split') return
    if (!activeKey || activeKey === '__changes__') return

    const inst = terminalsRef.current.get(activeKey)
    if (!inst || inst.isDisposed) return

    if (inst.isOpened) {
      const rafId = requestAnimationFrame(() => inst.reactivate())
      return () => cancelAnimationFrame(rafId)
    }

    let cancelled = false
    let rafId = 0
    let pollCount = 0
    const MAX_POLL = 30

    const pollAndOpen = () => {
      if (cancelled || inst.isOpened || inst.isOpening || inst.isDisposed) return
      pollCount++
      const container = containersRef.current.get(activeKey)
      if (!container || !isContainerRenderable(container)) {
        if (pollCount < MAX_POLL) {
          rafId = requestAnimationFrame(pollAndOpen)
        }
        return
      }
      tryOpen(activeKey)
    }
    rafId = requestAnimationFrame(pollAndOpen)

    return () => {
      cancelled = true
      cancelAnimationFrame(rafId)
    }
  }, [activeKey, tryOpen, layoutMode])

  useEffect(() => {
    if (experts.length === 0) return
    const targets = experts
      .map((e) => e.agentId)
      .filter((id) => id !== '__changes__' && id !== activeKey)
      .slice(0, PREWARM_TAB_COUNT)
    for (const agentId of targets) {
      getOrCreateInstance(agentId)
    }
  }, [experts, activeKey, getOrCreateInstance])

  useEffect(() => {
    const termTheme = theme === 'light' ? TERMINAL_THEME_LIGHT : TERMINAL_THEME
    terminalsRef.current.forEach((inst) => {
      if (inst.isOpened && !inst.isDisposed) {
        inst.setTheme(termTheme)
      }
    })
  }, [theme])

  useEffect(() => {
    const currentIds = new Set(experts.map(e => e.agentId))
    terminalsRef.current.forEach((_, id) => {
      if (!currentIds.has(id)) disposeTerminal(id)
    })
  }, [experts, disposeTerminal])

  useEffect(() => {
    return () => {
      terminalsRef.current.forEach((_, id) => disposeTerminal(id))
    }
  }, [disposeTerminal])

  return {
    terminalsRef,
    pendingPrepareRef,
    getOrCreateInstance,
    tryOpen,
    disposeTerminal,
    getContainerRefCallback,
  }
}
