import { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Files, GitBranch, Terminal, ChevronDown, ClipboardList, Globe, Maximize2, Minimize2 } from 'lucide-react'
import FileTree from './FileTree'
import { isMacElectron } from '@/utils/env'
import { useWebIDEState } from '@/hooks/useWebIDEState'
import { getWebSocketClient } from '@/services/WebSocketClient'
import type { GitStatusData } from '@/hooks/useGitStatus'
import type { MultiRepoGitStatus } from '@/hooks/useMultiRepoGitStatus'
import { buildChangeMap, buildDirAggregate } from '@/lib/changeTree'
import TerminalSkeleton from './TerminalSkeleton'
import { emptySearchCache, type SearchCache } from './SearchPanel'

const EditorTabs = lazy(() => import('./EditorTabs'))
const ChangesTab = lazy(() => import('@/components/changes/ChangesTab'))
const IDETerminalTabs = lazy(() => import('./IDETerminalTabs'))
const SearchPanel = lazy(() => import('./SearchPanel'))
const WhiteboardSidebar = lazy(() => import('@/components/chat/sidebar/WhiteboardSidebar'))
const BrowserPanel = lazy(() => import('./BrowserPanel'))

const preloadTerminal = () => import('./IDETerminalTabs')

export interface WebIDERoot {
  path: string
  name: string
}

interface WebIDEPanelProps {
  chatId?: string
  roots: WebIDERoot[]
  gitStatus?: GitStatusData | null
  multiGitStatus?: Map<string, GitStatusData>
  onMultiOptimisticUpdate?: MultiRepoGitStatus['optimisticUpdate']
  agentActive?: boolean
  worktreePath?: string
  changesTabRequest?: number
}

type ViewTab = 'files' | 'changes' | 'whiteboard' | 'browser'

const MIN_TREE_WIDTH = 140
const DEFAULT_TREE_WIDTH = 220
const DEFAULT_TERMINAL_HEIGHT = 40
const MIN_TERMINAL_HEIGHT = 20

const WebIDEPanel = ({ chatId, roots, gitStatus, multiGitStatus, onMultiOptimisticUpdate, agentActive = false, worktreePath, changesTabRequest }: WebIDEPanelProps) => {
  const { t } = useTranslation('workspace')
  const primaryRoot = roots[0]?.path ?? ''
  const [viewTab, setViewTab] = useState<ViewTab>('files')
  const [treeWidth, setTreeWidth] = useState(DEFAULT_TREE_WIDTH)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(DEFAULT_TERMINAL_HEIGHT)
  const [terminalMounted, setTerminalMounted] = useState(false)
  const draggingRef = useRef(false)
  const termDraggingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const [contentSearchOpen, setContentSearchOpen] = useState(false)
  const [searchCache, setSearchCache] = useState<SearchCache>(emptySearchCache)
  const [treeRefreshTrigger, setTreeRefreshTrigger] = useState(0)
  const [revealPath, setRevealPath] = useState<string | null>(null)
  const [revealCounter, setRevealCounter] = useState(0)
  const [isFullScreen, setIsFullScreen] = useState(false)
  const [fontSize, setFontSize] = useState<'S' | 'M' | 'L'>(() => {
    try {
      const raw = localStorage.getItem('webide:reader')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed?.fontSize === 'S' || parsed?.fontSize === 'M' || parsed?.fontSize === 'L') {
          return parsed.fontSize
        }
      }
    } catch {
      // ignore parse errors — fall back to default
    }
    return 'M'
  })

  useEffect(() => {
    try {
      const raw = localStorage.getItem('webide:reader')
      const prev = raw ? JSON.parse(raw) : {}
      localStorage.setItem('webide:reader', JSON.stringify({ ...prev, fontSize }))
    } catch {
      // localStorage may be unavailable (private mode); ignore.
    }
  }, [fontSize])

  const { tabs, activeTabPath, setActiveTabPath, openFile, closeTab, updateContent, saveFile, pendingLine, pendingKeyword, clearPendingLine, pruneDeletedTabs, refreshOpenTabs, refreshTab } = useWebIDEState(worktreePath)

  const wsClient = getWebSocketClient()

  useEffect(() => {
    if (!primaryRoot) return
    if (!wsClient.isConnected()) {
      const onConnect = () => {
        wsClient.send('shell:precreate', { cwd: primaryRoot })
        wsClient.off('connected', onConnect)
        wsClient.off('reconnected', onConnect)
      }
      wsClient.on('connected', onConnect)
      wsClient.on('reconnected', onConnect)
      return () => {
        wsClient.off('connected', onConnect)
        wsClient.off('reconnected', onConnect)
      }
    }
    wsClient.send('shell:precreate', { cwd: primaryRoot })
  }, [wsClient, primaryRoot])

  useEffect(() => {
    const onTreeChanged = () => {
      setTreeRefreshTrigger(v => v + 1)
      pruneDeletedTabs()
      refreshOpenTabs()
    }
    const onGitChanges = () => {
      refreshOpenTabs()
    }
    const onFileOperation = (event: { operations: Array<{ operation: string }> }) => {
      const hasStructural = event.operations.some(op => op.operation === 'create' || op.operation === 'delete')
      if (hasStructural) onTreeChanged()
      refreshOpenTabs()
    }
    wsClient.on('git:tree-changed', onTreeChanged)
    wsClient.on('git:changes', onGitChanges)
    wsClient.on('session:file-operation', onFileOperation)
    return () => {
      wsClient.off('git:tree-changed', onTreeChanged)
      wsClient.off('git:changes', onGitChanges)
      wsClient.off('session:file-operation', onFileOperation)
    }
  }, [wsClient, pruneDeletedTabs, refreshOpenTabs])

  useEffect(() => {
    preloadTerminal().then(() => {
      setTerminalMounted(true)
    })
  }, [])

  useEffect(() => {
    if (changesTabRequest && changesTabRequest > 0) {
      setViewTab('changes')
    }
  }, [changesTabRequest])

  useEffect(() => {
    const handleOpenFile = (e: Event) => {
      const { filePath, line } = (e as CustomEvent).detail as { filePath: string; line?: number }
      if (!filePath) return
      const resolved = filePath.startsWith('/') ? filePath : primaryRoot ? `${primaryRoot}/${filePath}` : filePath
      openFile(resolved, line)
      setViewTab('files')
      setRevealPath(resolved)
      setRevealCounter(c => c + 1)
    }
    window.addEventListener('ide:open-file', handleOpenFile)
    return () => window.removeEventListener('ide:open-file', handleOpenFile)
  }, [openFile])

  const handleSearchFileSelect = useCallback((filePath: string, line?: number, keyword?: string) => {
    openFile(filePath, line, keyword)
  }, [openFile])

  const handleToggleContentSearch = useCallback(() => {
    setContentSearchOpen(v => !v)
  }, [])

  const handleToggleTerminal = useCallback(() => {
    setTerminalOpen(v => {
      const next = !v
      if (next && !terminalMounted) setTerminalMounted(true)
      return next
    })
  }, [terminalMounted])

  // Bridges: V2 CollapsedStrip / keyboard shortcuts / CommandPalette drive
  // inner state without coupling React contexts across the portal boundary.
  useEffect(() => {
    const onSetTab = (e: Event) => {
      const detail = (e as CustomEvent<{ tab?: ViewTab }>).detail
      if (detail?.tab) setViewTab(detail.tab)
    }
    const onToggleTerminal = () => handleToggleTerminal()
    window.addEventListener('ide:set-tab', onSetTab)
    window.addEventListener('ide:toggle-terminal', onToggleTerminal)
    return () => {
      window.removeEventListener('ide:set-tab', onSetTab)
      window.removeEventListener('ide:toggle-terminal', onToggleTerminal)
    }
  }, [handleToggleTerminal])

  // IDE fullscreen mode: lifts the entire WebIDE (file tree, tabs, editor,
  // terminal, all view tabs) out of the right column into a `fixed inset-0`
  // overlay. CSS-only — the component is not remounted, so all in-memory state
  // (open tabs, Monaco models, treeWidth, terminalOpen) survives the toggle.
  // Triggered by the header button, ⌘⇧F, or `ide:toggle-fullscreen-ide` event.
  useEffect(() => {
    const onToggle = () => setIsFullScreen(s => !s)
    const onShortcut = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault()
        setIsFullScreen(s => !s)
      }
    }
    const onEsc = (e: KeyboardEvent) => {
      // Only exit on Esc when nothing inside the IDE owns the keystroke
      // (Monaco swallows Esc for its own actions). We let Monaco have it
      // first; user can press Esc once more on empty focus to exit.
      if (e.key !== 'Escape' || !isFullScreen) return
      const target = e.target as HTMLElement | null
      if (target?.closest('.monaco-editor, input, textarea, [contenteditable="true"]')) return
      setIsFullScreen(false)
    }
    window.addEventListener('ide:toggle-fullscreen-ide', onToggle)
    window.addEventListener('keydown', onShortcut)
    window.addEventListener('keydown', onEsc)
    return () => {
      window.removeEventListener('ide:toggle-fullscreen-ide', onToggle)
      window.removeEventListener('keydown', onShortcut)
      window.removeEventListener('keydown', onEsc)
    }
  }, [isFullScreen])

  const handleDragStart = (e: React.MouseEvent) => {
    e.preventDefault()
    draggingRef.current = true
    const startX = e.clientX
    const startWidth = treeWidth

    const onMove = (ev: MouseEvent) => {
      if (!draggingRef.current) return
      const delta = ev.clientX - startX
      const containerWidth = containerRef.current?.getBoundingClientRect().width || 800
      setTreeWidth(Math.max(MIN_TREE_WIDTH, Math.min(containerWidth * 0.5, startWidth + delta)))
    }
    const onUp = () => {
      draggingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const handleTerminalDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    termDraggingRef.current = true
    const startY = e.clientY
    const startHeight = terminalHeight
    const panelHeight = panelRef.current?.getBoundingClientRect().height || 600

    const onMove = (ev: MouseEvent) => {
      if (!termDraggingRef.current) return
      const deltaPercent = ((startY - ev.clientY) / panelHeight) * 100
      setTerminalHeight(Math.max(MIN_TERMINAL_HEIGHT, Math.min(80, startHeight + deltaPercent)))
    }
    const onUp = () => {
      termDraggingRef.current = false
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [terminalHeight])

  const diffEntries = gitStatus?.diffEntries || []
  const changesCount = useMemo(() => {
    if (multiGitStatus && multiGitStatus.size > 1) {
      let total = 0
      for (const s of multiGitStatus.values()) total += s.diffEntries.length
      return total
    }
    return diffEntries.length
  }, [multiGitStatus, diffEntries])
  const changeMap = useMemo(() => buildChangeMap(diffEntries), [diffEntries])
  const dirAggregate = useMemo(() => buildDirAggregate(diffEntries), [diffEntries])

  const tabClass = (active: boolean) => cn(
    'relative flex items-center gap-1.5 px-2 h-9 text-xs whitespace-nowrap shrink-0 transition-colors',
    active
      ? 'text-text-primary after:absolute after:left-2 after:right-2 after:-bottom-px after:h-px after:bg-accent-brand'
      : 'text-text-muted hover:text-text-secondary',
  )

  return (
    <div
      ref={panelRef}
      className={cn(
        'h-full flex flex-col bg-bg-primary overflow-hidden',
        isFullScreen && 'fixed inset-0 z-[90] h-screen w-screen',
      )}
    >
      {/* Top tab bar */}
      <div
        className="flex items-center h-9 bg-bg-secondary border-b border-border shrink-0 pr-1"
        style={isFullScreen && isMacElectron ? { paddingLeft: 76 } : undefined}
      >
        <div className="flex-1 min-w-0 overflow-x-auto flex items-center pl-2 gap-1 scrollbar-none">
          <button onClick={() => setViewTab('files')} className={tabClass(viewTab === 'files')}>
            <Files size={13} className="shrink-0" />
            <span className="whitespace-nowrap">File</span>
          </button>
          {chatId && (
            <button onClick={() => setViewTab('whiteboard')} className={tabClass(viewTab === 'whiteboard')}>
              <ClipboardList size={13} className="shrink-0" />
              <span className="whitespace-nowrap">War room</span>
            </button>
          )}
          <button onClick={() => setViewTab('browser')} className={tabClass(viewTab === 'browser')}>
            <Globe size={13} className="shrink-0" />
            <span className="whitespace-nowrap">{t('browser.label')}</span>
          </button>
          <button onClick={() => setViewTab('changes')} className={tabClass(viewTab === 'changes')}>
            <GitBranch size={13} className="shrink-0" />
            <span className="whitespace-nowrap">Changes</span>
            {changesCount > 0 && (
              <span className={cn(
                'ml-0.5 px-1 py-px rounded-full text-[10px] font-medium leading-none shrink-0',
                viewTab === 'changes'
                  ? 'bg-bg-tertiary text-text-primary'
                  : 'bg-bg-tertiary text-text-secondary',
              )}>
                {changesCount}
              </span>
            )}
          </button>
        </div>
        <div className="shrink-0 flex items-center gap-0.5 pl-1">
          <div
            className="flex items-center gap-0.5 mr-1"
            role="group"
            aria-label={t('ide.fontSize.label', { defaultValue: 'Font size' })}
          >
            {(['S', 'M', 'L'] as const).map(size => (
              <button
                key={size}
                type="button"
                onClick={() => setFontSize(size)}
                title={t('ide.fontSize.label', { defaultValue: 'Font size' }) + ` ${size}`}
                aria-pressed={fontSize === size}
                className={cn(
                  'flex items-center justify-center w-6 h-6 text-[11px] rounded transition-colors',
                  fontSize === size
                    ? 'bg-bg-tertiary text-text-primary'
                    : 'text-text-muted hover:text-text-primary hover:bg-bg-hover',
                )}
              >
                {size}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIsFullScreen(s => !s)}
            title={t('ide.fullscreen.toggleTooltip', { defaultValue: isFullScreen ? 'Exit fullscreen (⌘⇧F)' : 'Fullscreen IDE (⌘⇧F)' })}
            aria-label={isFullScreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            className="flex items-center justify-center w-7 h-7 text-text-muted hover:text-text-primary hover:bg-bg-hover rounded transition-colors"
          >
            {isFullScreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 min-h-0 overflow-hidden flex flex-col">
        {/* Editor / Changes area */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {viewTab === 'files' && (
            <div ref={containerRef} className="flex h-full">
              {/* File tree / Search sidebar */}
              <div className="shrink-0 border-r border-border-subtle overflow-hidden" style={{ width: treeWidth }}>
                {contentSearchOpen ? (
                  <Suspense fallback={
                    <div className="h-full flex items-center justify-center text-text-secondary text-sm">
                      SearchLoading…
                    </div>
                  }>
                    <SearchPanel roots={roots.map(r => r.path).join(',')} onFileSelect={handleSearchFileSelect} onClose={handleToggleContentSearch} cache={searchCache} onCacheChange={setSearchCache} />
                  </Suspense>
                ) : (
                  <FileTree
                    roots={roots}
                    onFileSelect={openFile}
                    selectedFile={activeTabPath}
                    changeMap={changeMap}
                    dirAggregate={dirAggregate}
                    onContentSearch={handleToggleContentSearch}
                    refreshTrigger={treeRefreshTrigger}
                    onFileDelete={closeTab}
                    revealPath={revealPath}
                    revealTrigger={revealCounter}
                  />
                )}
              </div>

              {/* Resize handle */}
              <div
                onMouseDown={handleDragStart}
                className="w-1 shrink-0 cursor-col-resize hover:bg-accent-brand/50 transition-colors"
              />

              {/* Editor area */}
              <div className="flex-1 min-w-0">
                <Suspense fallback={
                  <div className="h-full flex items-center justify-center text-text-secondary text-sm">
                    Loading editor…
                  </div>
                }>
                  <EditorTabs
                    tabs={tabs}
                    activeTabPath={activeTabPath}
                    onTabSelect={setActiveTabPath}
                    onTabClose={closeTab}
                    onContentChange={updateContent}
                    onSave={saveFile}
                    worktreePath={gitStatus?.worktreePath}
                    baseBranch={gitStatus?.baseBranch}
                    changeMap={changeMap}
                    agentActive={agentActive}
                    pendingLine={pendingLine}
                    pendingKeyword={pendingKeyword}
                    onPendingLineHandled={clearPendingLine}
                    onRefreshTab={refreshTab}
                    fontSize={fontSize}
                  />
                </Suspense>
              </div>
            </div>
          )}

          {viewTab === 'changes' && (
            <Suspense fallback={
              <div className="h-full flex items-center justify-center text-text-secondary text-sm">
                ChangesLoading…
              </div>
            }>
              {gitStatus ? (
                <ChangesTab
                  gitStatus={gitStatus}
                  multiGitStatus={multiGitStatus}
                  repositories={roots}
                  agentActive={agentActive}
                  onMultiOptimisticUpdate={onMultiOptimisticUpdate}
                  onPushed={() => setViewTab('files')}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-text-secondary text-sm select-none">
                  <div className="text-center space-y-1">
                    <div className="text-lg opacity-40">✓</div>
                    <div>No changes</div>
                  </div>
                </div>
              )}
            </Suspense>
          )}

          {viewTab === 'whiteboard' && (
            <Suspense fallback={
              <div className="h-full flex items-center justify-center text-text-secondary text-sm">
                War roomLoading…
              </div>
            }>
              <WhiteboardSidebar chatId={chatId} />
            </Suspense>
          )}

          {viewTab === 'browser' && (
            <Suspense fallback={
              <div className="h-full flex items-center justify-center text-text-secondary text-sm">
                Loading browser…
              </div>
            }>
              <BrowserPanel chatId={chatId} workingDirectory={primaryRoot} />
            </Suspense>
          )}
        </div>

        {terminalMounted && (
          <div
            className="border-t border-border-subtle shrink-0 flex flex-col overflow-hidden"
            style={{ height: terminalOpen ? `${terminalHeight}%` : '26px' }}
          >
            {terminalOpen && (
              <div
                onMouseDown={handleTerminalDragStart}
                className="h-1 shrink-0 cursor-row-resize hover:bg-accent-brand/50 transition-colors"
              />
            )}
            <button
              type="button"
              onClick={handleToggleTerminal}
              onMouseEnter={() => preloadTerminal()}
              className="h-[26px] shrink-0 flex items-center px-2 gap-1.5 bg-bg-secondary hover:bg-bg-hover text-left transition-colors"
              aria-label={terminalOpen ? 'CloseTerminal' : 'OpenTerminal'}
              aria-expanded={terminalOpen}
            >
              <Terminal size={11} className="text-text-secondary" />
              <span className="text-[10px] font-medium text-text-secondary">Terminal</span>
              <span className="text-[9px] font-mono text-text-muted">zsh</span>
              <span className="flex-1" />
              <ChevronDown
                size={10}
                className={cn(
                  'text-text-muted transition-transform',
                  !terminalOpen && 'rotate-180',
                )}
              />
            </button>
            <div
              style={terminalOpen
                ? undefined
                : {
                    position: 'fixed' as const,
                    left: '-9999px',
                    width: '600px',
                    height: '300px',
                  }
              }
              className={cn(terminalOpen && 'flex-1 min-h-0 overflow-hidden')}
            >
              <Suspense fallback={<TerminalSkeleton />}>
                <IDETerminalTabs cwd={primaryRoot} hidden={!terminalOpen} />
              </Suspense>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default WebIDEPanel
