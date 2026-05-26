/**
 * TerminalPanel -  / Tab
 *
 * - tabs Tab
 * - splitCSS Grid
 *
 *  @xterm/xterm v6
 * -  visible  open()
 * -  tab
 */
import { useRef, useState, useEffect, useMemo, forwardRef, useImperativeHandle, lazy, Suspense } from 'react'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { useTranslation } from 'react-i18next'
import { CheckCircle, XCircle, X, RefreshCcw, Eye, GitBranch, Columns2, Layers } from 'lucide-react'
import '@xterm/xterm/css/xterm.css'
import { getWebSocketClient } from '../../services/WebSocketClient'
import AgentAvatar from '@/components/ui/agent-avatar'
import type { GitStatusData } from '@/hooks/useGitStatus'
import { useTheme } from '@/contexts/ThemeContext'
import { estimateSize } from './constants'
import { useTerminalWsEvents } from './useTerminalWsEvents'
import { useTerminalInstances } from './useTerminalInstances'

export interface TerminalPanelHandle {
  getEstimatedSize: () => { cols: number; rows: number }
  prepareTerminal: (agentId: string) => Promise<{ cols: number; rows: number }>
  stopAll: () => void
  switchToChangesTab: () => void
  reactivateAll?: () => void
  /** Move keyboard focus into the currently active agent's xterm.
   *  No-op if no agent is active or the instance is not yet opened. */
  focusActive: () => void
}

interface TerminalPanelProps {
  chatId?: string
  gitStatus?: GitStatusData | null
  agentActive?: boolean
  connected?: boolean
  /**
   * When set, the panel locks to this single agent: the multi-agent tablist,
   * the layout-toggle button, and the hidden-experts reopen menu are all
   * suppressed, and the empty state copy switches to a single-agent hint.
   * Used by Agent view (?agent=X) and Quad tiles.
   */
  lockedAgentId?: string | null
  /**
   * When true, the panel is the primary surface of the conversation pane
   * (terminal view mode). Switches empty-state copy to the
   * "switch to message view to launch" hint, since the agent-launch path
   * (cwd / repositories / model / system prompt) is only available via
   * the React composer in message mode.
   */
  inTerminalView?: boolean
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

// ================== Constant ==================
const CHANGES_TAB_KEY = '__changes__'
const LAYOUT_STORAGE_KEY = 'openteam:terminal-layout'

const hiddenStorageKey = (chatId?: string) => chatId ? `cc:terminal:hidden:${chatId}` : null

const loadHiddenExperts = (chatId?: string): Set<string> => {
  const key = hiddenStorageKey(chatId)
  if (!key) return new Set()
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')) } catch { return new Set() }
}

const saveHiddenExperts = (chatId: string | undefined, set: Set<string>) => {
  const key = hiddenStorageKey(chatId)
  if (!key) return
  try {
    if (set.size === 0) { localStorage.removeItem(key) }
    else { localStorage.setItem(key, JSON.stringify([...set])) }
  } catch {}
}
const ChangesTab = lazy(() => import('@/components/changes/ChangesTab'))

const getGridCols = (count: number): number => {
  if (count <= 1) return 1
  if (count <= 4) return 2
  return 3
}

const TABS_STYLE = `
.unified-terminal-tabs {
  flex-shrink: 0;
}
.unified-terminal-tabs [role="tablist"] {
  height: 35px;
  min-height: 35px;
  flex-shrink: 0;
  padding: 0 8px;
  background: rgb(var(--bg-secondary));
  border-bottom: 1px solid rgb(var(--border-color));
  display: flex;
  align-items: center;
  gap: 0;
  overflow-x: auto;
  border-radius: 0;
}
.unified-terminal-tabs [role="tablist"] button[role="tab"] {
  padding: 4px 10px;
  font-size: 12px;
  border-bottom-width: 2px;
  margin-bottom: 0;
  white-space: nowrap;
}
`

const PULSE_STYLE = `
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
`

const TerminalPanel = forwardRef<TerminalPanelHandle, TerminalPanelProps>(
  ({ chatId, gitStatus, agentActive = false, connected = true, lockedAgentId = null, inTerminalView = false }, ref) => {
    const { t } = useTranslation('chat')
    const isLocked = !!lockedAgentId
    const [experts, setExperts] = useState<ExpertInfo[]>([])
    const expertsRef = useRef<ExpertInfo[]>([])
    const [activeKey, setActiveKey] = useState<string>('')
    const [hiddenExperts, setHiddenExperts] = useState<Set<string>>(() => loadHiddenExperts(chatId))
    const [reopenMenuOpen, setReopenMenuOpen] = useState(false)
    const reopenMenuRef = useRef<HTMLDivElement>(null)
    const [layoutMode, setLayoutMode] = useState<'split' | 'tabs'>(() => {
      const saved = localStorage.getItem(LAYOUT_STORAGE_KEY)
      return saved === 'split' ? 'split' : 'tabs'
    })
    const terminalAreaRef = useRef<HTMLDivElement>(null)

    const wsClient = getWebSocketClient()
    const { theme } = useTheme()
    expertsRef.current = experts

    useEffect(() => {
      setHiddenExperts(loadHiddenExperts(chatId))
    }, [chatId])

    const isSplitActive = layoutMode === 'split' && activeKey !== CHANGES_TAB_KEY

    const {
      terminalsRef,
      pendingPrepareRef,
      getOrCreateInstance,
      tryOpen,
      disposeTerminal,
      getContainerRefCallback,
    } = useTerminalInstances({ wsClient, chatId, theme, experts, activeKey, terminalAreaRef, layoutMode })

    // ── Handle ──
    useImperativeHandle(ref, () => ({
      getEstimatedSize: () => estimateSize(terminalAreaRef.current),

      prepareTerminal: (agentId: string) => {
        const inst = terminalsRef.current.get(agentId)
        if (inst?.isOpened) {
          return Promise.resolve({ cols: inst.cols, rows: inst.rows })
        }

        return new Promise<{ cols: number; rows: number }>((resolve) => {
          const timeout = setTimeout(() => {
            const arr = pendingPrepareRef.current.get(agentId)
            if (arr) {
              const idx = arr.indexOf(onReady)
              if (idx >= 0) arr.splice(idx, 1)
              if (arr.length === 0) pendingPrepareRef.current.delete(agentId)
            }
            resolve(estimateSize(terminalAreaRef.current))
          }, 3000)

          const onReady = (size: { cols: number; rows: number }) => {
            clearTimeout(timeout)
            resolve(size)
          }
          const existing = pendingPrepareRef.current.get(agentId) ?? []
          pendingPrepareRef.current.set(agentId, [...existing, onReady])

          setHiddenExperts(prev => {
            if (!prev.has(agentId)) return prev
            const next = new Set(prev)
            next.delete(agentId)
            saveHiddenExperts(chatId, next)
            return next
          })
          setExperts(prev => {
            if (prev.some(e => e.agentId === agentId)) return prev
            return [...prev, { agentId, sessionId: '', agentName: agentId, agentIcon: '', status: 'running' as const }]
          })
          setActiveKey(agentId)
          getOrCreateInstance(agentId)
        })
      },

      stopAll: () => {
        if (!chatId) return
        experts.filter(e => e.status === 'running').forEach(e => {
          wsClient.send('expert:stop', { chatId, agentId: e.agentId })
        })
      },

      switchToChangesTab: () => {
        setActiveKey(CHANGES_TAB_KEY)
      },

      reactivateAll: () => {
        terminalsRef.current.forEach((inst, agentId) => {
          if (inst.isDisposed) return
          if (inst.isOpened) {
            inst.reactivate()
          } else if (!inst.isOpening) {
            tryOpen(agentId)
          }
        })
      },

      focusActive: () => {
        if (!activeKey || activeKey === CHANGES_TAB_KEY) return
        const inst = terminalsRef.current.get(activeKey)
        if (inst && inst.isOpened && !inst.isDisposed) inst.focus()
      },
    }), [wsClient, experts, getOrCreateInstance, tryOpen, activeKey])

    useEffect(() => {
      if (!activeKey && experts.length > 0) {
        const firstVisible = experts.find(e => !hiddenExperts.has(e.agentId))
        if (firstVisible) setActiveKey(firstVisible.agentId)
      }
    }, [activeKey, experts, hiddenExperts])

    useEffect(() => {
      if (!reopenMenuOpen) return
      const handleClickOutside = (e: MouseEvent) => {
        if (reopenMenuRef.current && !reopenMenuRef.current.contains(e.target as Node)) {
          setReopenMenuOpen(false)
        }
      }
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [reopenMenuOpen])

    useTerminalWsEvents({
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
    })

    // ── WS ListSync ──
    useEffect(() => {
      const fetchExpertList = () => {
        if (wsClient.isConnected()) wsClient.send('expert:list', { chatId })
      }
      const handleConnected = () => fetchExpertList()
      fetchExpertList()
      wsClient.on('reconnected', handleConnected)

      return () => {
        wsClient.off('reconnected', handleConnected)
      }
    }, [wsClient, chatId, getOrCreateInstance])

    // Resume-PTY bridge: when the chat pane enters terminal view, ask the
    // server to spawn `claude --resume <cliSessionId>` (or codex equivalent).
    // We attach for ANY agent with a persisted JSONL (running or not) — resume
    // is the whole point. The server falls back to ChatStore.expertSessions
    // when SessionRegistry has nothing live. Server then replies with
    // `expert:view-attached` carrying the sessionId; useTerminalWsEvents uses
    // that to populate the ExpertInfo slot so xterm has a place to mount and
    // the strict `expert:data` validator lets the first frame through.
    //
    // Track attached agentIds in a ref so we only diff (attach new, detach
    // gone). Re-running on every `experts` change with attach/detach in cleanup
    // would kill and respawn the resume-PTY on each `expert:view-attached`
    // round-trip — terminal flickers, server thrashes node-pty.
    const attachedRef = useRef<Set<string>>(new Set())
    const attachedChatIdRef = useRef<string | undefined>(undefined)
    useEffect(() => {
      if (attachedChatIdRef.current !== chatId) {
        attachedRef.current.clear()
        attachedChatIdRef.current = chatId
      }

      if (!inTerminalView || !chatId) {
        if (attachedRef.current.size > 0) {
          for (const agentId of attachedRef.current) {
            if (!wsClient.isConnected()) break
            wsClient.send('expert:cli-detach', { chatId, agentId })
          }
          attachedRef.current.clear()
        }
        return
      }

      const desired = new Set<string>()
      if (isLocked && lockedAgentId) {
        desired.add(lockedAgentId)
      } else {
        for (const e of experts) {
          if (e.agentId !== CHANGES_TAB_KEY) desired.add(e.agentId)
        }
      }

      if (wsClient.isConnected()) {
        for (const agentId of desired) {
          if (!attachedRef.current.has(agentId)) {
            wsClient.send('expert:cli-attach', { chatId, agentId, cols: 80, rows: 24 })
            attachedRef.current.add(agentId)
          }
        }
        for (const agentId of attachedRef.current) {
          if (!desired.has(agentId)) {
            wsClient.send('expert:cli-detach', { chatId, agentId })
            attachedRef.current.delete(agentId)
          }
        }
      }
    }, [inTerminalView, chatId, experts, isLocked, lockedAgentId, wsClient])

    // On unmount only: detach all attached view-PTYs. Chat switches no longer
    // send detach — server-side view-PTYs stay alive so re-entering the chat
    // reuses the existing `claude --resume` instead of killing in-flight turns.
    useEffect(() => () => {
      if (attachedRef.current.size === 0) return
      const cid = attachedChatIdRef.current
      for (const agentId of attachedRef.current) {
        if (!wsClient.isConnected() || !cid) break
        wsClient.send('expert:cli-detach', { chatId: cid, agentId })
      }
      attachedRef.current.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    // ── Agent Actions ──
    const handleHideExpert = (expertAgentId: string, e: React.MouseEvent) => {
      e.stopPropagation()
      // Locked single-agent surfaces should never hide their only agent.
      if (isLocked) return
      setHiddenExperts(prev => {
        const next = new Set(prev)
        next.add(expertAgentId)
        saveHiddenExperts(chatId, next)
        return next
      })
      if (activeKey === expertAgentId) {
        const nextVisible = experts.find(ex => ex.agentId !== expertAgentId && !hiddenExperts.has(ex.agentId))
        setActiveKey(nextVisible ? nextVisible.agentId : '')
      }
    }

    const handleReopenExpert = (expertAgentId: string) => {
      setHiddenExperts(prev => {
        const next = new Set(prev)
        next.delete(expertAgentId)
        saveHiddenExperts(chatId, next)
        return next
      })
      setActiveKey(expertAgentId)
      setReopenMenuOpen(false)
      tryOpen(expertAgentId)
    }

    const handleReopenAll = () => {
      setHiddenExperts(new Set())
      saveHiddenExperts(chatId, new Set())
      setReopenMenuOpen(false)
    }

    const handleRefreshExperts = () => {
      wsClient.send('expert:list', { chatId })
    }

    const handleToggleLayout = () => {
      const next = layoutMode === 'split' ? 'tabs' : 'split'
      setLayoutMode(next)
      localStorage.setItem(LAYOUT_STORAGE_KEY, next)
    }

    const scopedExperts = useMemo(
      () => isLocked
        ? experts.filter(e => e.agentId === lockedAgentId || e.agentName === lockedAgentId)
        : experts,
      [experts, isLocked, lockedAgentId],
    )
    const visibleExperts = isLocked
      ? scopedExperts
      : scopedExperts.filter(e => !hiddenExperts.has(e.agentId))
    const hiddenList = isLocked ? [] : experts.filter(e => hiddenExperts.has(e.agentId))
    const hiddenCount = hiddenList.length
    const gridCols = getGridCols(visibleExperts.length)
    const gridRows = Math.ceil(visibleExperts.length / gridCols)

    return (
      <TooltipProvider delayDuration={300}>
        <div className="flex-1 min-h-0 flex flex-col bg-bg-primary overflow-hidden">
          <style>{TABS_STYLE}</style>
          <Tabs
            className="unified-terminal-tabs"
            value={activeKey}
            onValueChange={setActiveKey}
          >
            {/* Toolbar row suppressed in terminal-view mode: ChatHeader already
                hosts the view-mode toggle, and Mission terminal mode is a clean
                Claude TUI surface — losing the tab strip / layout toggle /
                Changes tab is intentional. Keep the row in non-terminal-view
                hosts (Agent view / Quad tiles) so they retain those controls. */}
            <div className={cn(
              'flex items-center h-9 bg-bg-secondary border-b border-border shrink-0',
              inTerminalView && 'hidden',
            )}>
              <TabsList className="flex-1 border-b-0 h-[35px] min-h-[35px] px-2 bg-transparent">
                {!isSplitActive && !isLocked && visibleExperts.map((expert) => {
                  const isRunning = expert.status === 'running'
                  const isSuccess = expert.exitCode === 0

                  return (
                    <TabsTrigger key={expert.agentId} value={expert.agentId}>
                      <span className="flex items-center gap-1.5">
                        <AgentAvatar name={expert.agentName} agentId={expert.agentId} size="xs" />
                        <span className={cn(isRunning ? "opacity-100" : "opacity-70")}>{expert.agentName}</span>
                        {isRunning && (
                          <span className="inline-block size-1.5 rounded-full bg-accent-brand animate-[pulse_1.5s_ease-in-out_infinite]" />
                        )}
                        {!isRunning && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex">
                                {isSuccess ? (
                                  <CheckCircle size={12} className="text-accent-green" />
                                ) : (
                                  <XCircle size={12} className="text-accent-red" />
                                )}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>{`Completed (exit: ${expert.exitCode})`}</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span
                              role="button"
                              tabIndex={0}
                              aria-label={t('terminal.closeTerminal')}
                              className="cursor-pointer text-text-secondary inline-flex hover:text-text-primary"
                              onClick={(e) => handleHideExpert(expert.agentId, e)}
                              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleHideExpert(expert.agentId, e as unknown as React.MouseEvent) } }}
                            >
                              <X size={12} />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{t('terminal.closeTerminal')}</TooltipContent>
                        </Tooltip>
                      </span>
                    </TabsTrigger>
                  )
                })}

                {gitStatus && gitStatus.diffEntries.length > 0 && (
                  <TabsTrigger value={CHANGES_TAB_KEY} className="ml-auto">
                    <span className="flex items-center gap-1">
                      <GitBranch size={11} />
                      <span>Changes</span>
                      <span className="ml-0.5 px-1 py-px rounded-full bg-accent-brand/20 text-accent-brand text-xs font-medium leading-none">
                        {gitStatus.diffEntries.length}
                      </span>
                    </span>
                  </TabsTrigger>
                )}
              </TabsList>

              <div className="flex gap-1 items-center pr-2 shrink-0">
                {!isLocked && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleToggleLayout}
                        aria-label={layoutMode === 'split' ? t('terminal.tabMode') : t('terminal.splitMode')}
                        tabIndex={0}
                        className="inline-flex items-center justify-center p-1 rounded text-text-secondary hover:text-white/80 hover:bg-bg-hover transition-colors"
                      >
                        {layoutMode === 'split' ? <Layers size={12} /> : <Columns2 size={12} />}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>{layoutMode === 'split' ? t('terminal.tabMode') : t('terminal.splitMode')}</TooltipContent>
                  </Tooltip>
                )}
                {experts.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={handleRefreshExperts}
                        aria-label="Refresh agent list"
                        tabIndex={0}
                        className="inline-flex items-center justify-center p-1 rounded text-text-secondary hover:text-white/80 hover:bg-bg-hover transition-colors"
                      >
                        <RefreshCcw size={12} />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>Refresh agent list</TooltipContent>
                  </Tooltip>
                )}
                {!isLocked && hiddenCount > 0 && (
                  <div className="relative" ref={reopenMenuRef}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => setReopenMenuOpen(v => !v)}
                          aria-label={t('terminal.reopenLabel', { count: hiddenCount })}
                          tabIndex={0}
                          className="inline-flex items-center justify-center gap-0.5 p-1 rounded text-text-secondary hover:text-white/80 hover:bg-bg-hover transition-colors"
                        >
                          <Eye size={12} />
                          <span className="text-[10px] leading-none font-medium">{hiddenCount}</span>
                        </button>
                      </TooltipTrigger>
                      <TooltipContent>{t('terminal.reopenTooltip')}</TooltipContent>
                    </Tooltip>
                    {reopenMenuOpen && (
                      <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-md border border-border bg-bg-secondary shadow-lg py-1">
                        {hiddenList.map(expert => (
                          <button
                            key={expert.agentId}
                            onClick={() => handleReopenExpert(expert.agentId)}
                            className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-text-primary hover:bg-bg-hover transition-colors"
                          >
                            <AgentAvatar name={expert.agentName} agentId={expert.agentId} size="xs" />
                            <span className="truncate flex-1 text-left">{expert.agentName}</span>
                            {expert.status === 'running' ? (
                              <span className="size-1.5 rounded-full bg-accent-brand animate-[pulse_1.5s_ease-in-out_infinite]" />
                            ) : expert.exitCode === 0 ? (
                              <CheckCircle size={10} className="text-accent-green" />
                            ) : (
                              <XCircle size={10} className="text-accent-red" />
                            )}
                          </button>
                        ))}
                        {hiddenCount > 1 && (
                          <>
                            <div className="border-t border-border my-1" />
                            <button
                              onClick={handleReopenAll}
                              className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-accent-brand hover:bg-bg-hover transition-colors"
                            >
                              {t('terminal.openAll')}
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Tabs>

          <div
            ref={terminalAreaRef}
            className={cn(
              'flex-1 relative overflow-hidden',
              isSplitActive && visibleExperts.length > 0 && 'grid gap-px bg-border-subtle',
            )}
            style={isSplitActive && visibleExperts.length > 0 ? {
              gridTemplateColumns: `repeat(${gridCols}, 1fr)`,
              gridTemplateRows: `repeat(${gridRows}, 1fr)`,
            } : undefined}
          >
            {!connected && (
              <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-center gap-2 py-1.5 px-3 bg-yellow-500/10 border-b border-yellow-500/30 text-yellow-400 text-xs select-none">
                <span className="inline-block size-1.5 rounded-full bg-yellow-400 animate-[pulse_1s_ease-in-out_infinite]" />
                <span>{t('terminal.reconnecting')}</span>
              </div>
            )}
            {scopedExperts.length === 0 && activeKey !== CHANGES_TAB_KEY && (
              <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-sm select-none">
                <div className="text-center space-y-2">
                  <div className="text-lg opacity-50">&#x2328;&#xFE0F;</div>
                  <div>
                    {inTerminalView
                      ? (isLocked
                          ? t('chatViewMode.firstTurnHintLocked', { agent: lockedAgentId })
                          : t('chatViewMode.firstTurnHintMulti'))
                      : (isLocked
                          ? t('terminal.emptyHintLocked', { agent: lockedAgentId })
                          : t('terminal.emptyHint'))}
                  </div>
                </div>
              </div>
            )}
            {visibleExperts.length === 0 && hiddenCount > 0 && activeKey !== CHANGES_TAB_KEY && (
              <div className="absolute inset-0 flex items-center justify-center text-text-secondary text-sm select-none z-10">
                <div className="text-center space-y-2">
                  <div className="text-sm opacity-70">{t('terminal.hiddenCount', { count: hiddenCount })}</div>
                  <button
                    onClick={handleReopenAll}
                    className="text-xs text-accent-brand hover:underline"
                  >
                    {t('terminal.openAll')}
                  </button>
                </div>
              </div>
            )}
            {scopedExperts.map((expert) => {
              const isHidden = !isLocked && hiddenExperts.has(expert.agentId)
              return (
              <div
                key={expert.agentId}
                className={cn(
                  'bg-bg-primary',
                  isHidden
                    ? 'absolute inset-0 invisible z-0'
                    : isSplitActive
                      ? cn(
                          'flex flex-col min-h-0 overflow-hidden',
                          activeKey === expert.agentId && 'ring-1 ring-accent-brand/50 ring-inset z-10',
                        )
                      : cn(
                          'absolute inset-0 transition-none',
                          activeKey === expert.agentId && activeKey !== CHANGES_TAB_KEY ? 'visible z-10' : 'invisible z-0',
                        ),
                )}
                onClick={!isHidden && isSplitActive ? () => setActiveKey(expert.agentId) : undefined}
              >
                <div className={cn(
                  'group/split flex items-center gap-1.5 px-2 h-6 bg-bg-secondary/80 border-b border-border-subtle text-xs shrink-0',
                  (!isSplitActive || isHidden) && 'hidden',
                )}>
                  <AgentAvatar name={expert.agentName} agentId={expert.agentId} size="xs" />
                  <span className="truncate text-text-secondary text-[11px]">{expert.agentName}</span>
                  {expert.status === 'running' ? (
                    <span className="size-1.5 rounded-full bg-accent-brand animate-[pulse_1.5s_ease-in-out_infinite]" />
                  ) : expert.exitCode === 0 ? (
                    <CheckCircle size={10} className="text-accent-green" />
                  ) : (
                    <XCircle size={10} className="text-accent-red" />
                  )}
                  <span className="flex-1" />
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={t('terminal.closeTerminal')}
                    className="cursor-pointer text-text-secondary inline-flex hover:text-text-primary opacity-0 group-hover/split:opacity-100 transition-opacity"
                    onClick={(e) => handleHideExpert(expert.agentId, e)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handleHideExpert(expert.agentId, e as unknown as React.MouseEvent) } }}
                  >
                    <X size={10} />
                  </span>
                </div>
                {/* Terminal container */}
                <div
                  ref={getContainerRefCallback(expert.agentId)}
                  className={isSplitActive ? 'flex-1 min-h-0' : 'h-full'}
                />
              </div>
            )})}

            {activeKey === CHANGES_TAB_KEY && gitStatus && (
              <div className="absolute inset-0 z-20 bg-bg-primary">
                <Suspense fallback={
                  <div className="h-full flex items-center justify-center text-text-secondary text-sm">
                    Loading changes...
                  </div>
                }
                >
                  <ChangesTab
                    gitStatus={gitStatus}
                    agentActive={agentActive}
                  />
                </Suspense>
              </div>
            )}
          </div>

          <style>{PULSE_STYLE}</style>
        </div>
      </TooltipProvider>
    )
  }
)

TerminalPanel.displayName = 'TerminalPanel'

export default TerminalPanel
