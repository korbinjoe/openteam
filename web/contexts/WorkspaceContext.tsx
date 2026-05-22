import { createContext, useContext, useReducer, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { buildTaskUrl, buildWorkspaceUrl } from '../components/workspace/urls'

// ── Types ──

export type ViewMode = 'agent' | 'task-overview'
export type LayoutMode = 'single' | 'split' | 'quad'
export type IdeTab = 'IDE' | 'War Room'
const VALID_IDE_TABS: IdeTab[] = ['IDE', 'War Room']

// IDE region defaults to collapsed in single mode (focus on chat),
// expanded in split/quad mode (coordination needs task context visible)
const defaultIdeCollapsedFor = (mode: LayoutMode): boolean => mode === 'single'

// User-resizable panel width bounds
export const SIDEBAR_WIDTH_MIN = 200
export const SIDEBAR_WIDTH_MAX = 360
export const SIDEBAR_WIDTH_DEFAULT = 240

export const IDE_WIDTH_MIN = 280
export const IDE_WIDTH_MAX = 640
export const IDE_WIDTH_DEFAULT = 380

// Chat width in split mode (px). null = use default percentage (44% or 50% on narrow).
export const CHAT_SPLIT_WIDTH_MIN = 320
export const CHAT_SPLIT_WIDTH_MAX = 1200

const clamp = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, v))

interface WorkspaceState {
  layoutMode: LayoutMode
  panelCollapsed: boolean
  terminalOpen: boolean
  activeIdeTab: IdeTab
  expandedTasks: Record<string, boolean>
  commandPaletteOpen: boolean
  newTaskOpen: boolean
  addAgentOpen: boolean
  addAgentTaskId: string | null
  ideCollapsed: boolean
  sidebarWidth: number
  idePanelWidth: number
  chatSplitWidth: number | null
}

interface WorkspaceContextValue extends WorkspaceState {
  // URL-derived navigation state (NOT in reducer, comes from layout props)
  workspaceId: string | null
  activeChatId: string | null
  selectedAgentId: string | null
  /** Derived: 'agent' when selectedAgentId is set, 'task-overview' otherwise. */
  viewMode: ViewMode
  /** Alias for activeChatId — preserved so legacy consumers keep compiling. */
  selectedTaskId: string | null

  // Transient per-task target index for @target cycle in group chat input.
  taskChatTargetIndex: number
  cycleTargetAgent: (agentCount: number) => void

  /** DOM node where V2 IDEPanel wants ChatInstance's RightPanel to portal. Null when
   *  IDE column is showing a non-chat tab (e.g. War Room) or no chat is active. */
  ideMountNode: HTMLElement | null
  setIdeMountNode: (node: HTMLElement | null) => void

  // Navigation helpers — all write to the URL, never to local state.
  selectAgent: (agentId: string) => void
  openTaskOverview: (taskId: string) => void

  setLayoutMode: (mode: LayoutMode) => void
  cycleLayoutMode: () => void
  togglePanel: () => void
  collapsePanel: () => void
  expandPanel: () => void
  toggleTerminal: () => void
  setIdeTab: (tab: IdeTab) => void
  toggleTask: (taskId: string) => void
  openCommandPalette: () => void
  closeCommandPalette: () => void
  openNewTask: () => void
  closeNewTask: () => void
  openAddAgent: (taskId: string) => void
  closeAddAgent: () => void
  toggleIde: () => void
  setSidebarWidth: (w: number) => void
  setIdePanelWidth: (w: number) => void
  setChatSplitWidth: (w: number | null) => void
}

// ── Constants ──

const STORAGE_KEY = 'openteam:workspace-layout'
const LAYOUT_CYCLE: LayoutMode[] = ['single', 'split', 'quad']

// ── Reducer ──

type Action =
  | { type: 'SET_LAYOUT_MODE'; mode: LayoutMode }
  | { type: 'CYCLE_LAYOUT_MODE' }
  | { type: 'TOGGLE_PANEL' }
  | { type: 'COLLAPSE_PANEL' }
  | { type: 'EXPAND_PANEL' }
  | { type: 'TOGGLE_TERMINAL' }
  | { type: 'SET_IDE_TAB'; tab: IdeTab }
  | { type: 'TOGGLE_TASK'; taskId: string }
  | { type: 'OPEN_COMMAND_PALETTE' }
  | { type: 'CLOSE_COMMAND_PALETTE' }
  | { type: 'OPEN_NEW_TASK' }
  | { type: 'CLOSE_NEW_TASK' }
  | { type: 'OPEN_ADD_AGENT'; taskId: string }
  | { type: 'CLOSE_ADD_AGENT' }
  | { type: 'TOGGLE_IDE' }
  | { type: 'SET_SIDEBAR_WIDTH'; width: number }
  | { type: 'SET_IDE_PANEL_WIDTH'; width: number }
  | { type: 'SET_CHAT_SPLIT_WIDTH'; width: number | null }
  | { type: 'RESTORE'; state: Partial<WorkspaceState> }

const reducer = (state: WorkspaceState, action: Action): WorkspaceState => {
  switch (action.type) {
    case 'SET_LAYOUT_MODE':
      return { ...state, layoutMode: action.mode, ideCollapsed: defaultIdeCollapsedFor(action.mode) }

    case 'CYCLE_LAYOUT_MODE': {
      const idx = LAYOUT_CYCLE.indexOf(state.layoutMode)
      const next = LAYOUT_CYCLE[(idx + 1) % LAYOUT_CYCLE.length]
      return { ...state, layoutMode: next, ideCollapsed: defaultIdeCollapsedFor(next) }
    }

    case 'TOGGLE_PANEL':
      return { ...state, panelCollapsed: !state.panelCollapsed }

    case 'COLLAPSE_PANEL':
      return state.panelCollapsed ? state : { ...state, panelCollapsed: true }

    case 'EXPAND_PANEL':
      return state.panelCollapsed ? { ...state, panelCollapsed: false } : state

    case 'TOGGLE_TERMINAL':
      return { ...state, terminalOpen: !state.terminalOpen }

    case 'SET_IDE_TAB':
      return { ...state, activeIdeTab: action.tab }

    case 'TOGGLE_TASK':
      return { ...state, expandedTasks: { ...state.expandedTasks, [action.taskId]: !state.expandedTasks[action.taskId] } }

    case 'OPEN_COMMAND_PALETTE':
      return { ...state, commandPaletteOpen: true }

    case 'CLOSE_COMMAND_PALETTE':
      return { ...state, commandPaletteOpen: false }

    case 'OPEN_NEW_TASK':
      return { ...state, newTaskOpen: true, commandPaletteOpen: false }

    case 'CLOSE_NEW_TASK':
      return { ...state, newTaskOpen: false }

    case 'OPEN_ADD_AGENT':
      return { ...state, addAgentOpen: true, addAgentTaskId: action.taskId }

    case 'CLOSE_ADD_AGENT':
      return { ...state, addAgentOpen: false, addAgentTaskId: null }

    case 'TOGGLE_IDE':
      return { ...state, ideCollapsed: !state.ideCollapsed }

    case 'SET_SIDEBAR_WIDTH':
      return { ...state, sidebarWidth: clamp(action.width, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX) }

    case 'SET_IDE_PANEL_WIDTH':
      return { ...state, idePanelWidth: clamp(action.width, IDE_WIDTH_MIN, IDE_WIDTH_MAX) }

    case 'SET_CHAT_SPLIT_WIDTH':
      return {
        ...state,
        chatSplitWidth: action.width === null
          ? null
          : clamp(action.width, CHAT_SPLIT_WIDTH_MIN, CHAT_SPLIT_WIDTH_MAX),
      }

    case 'RESTORE': {
      const restored = { ...state, ...action.state }
      // Drop legacy 'War Room' tab from old persisted state
      if (!VALID_IDE_TABS.includes(restored.activeIdeTab)) {
        restored.activeIdeTab = 'IDE'
      }
      return restored
    }

    default:
      return state
  }
}

// ── Initial State ──

const defaultState: WorkspaceState = {
  layoutMode: 'split',
  panelCollapsed: false,
  terminalOpen: true,
  activeIdeTab: 'IDE',
  expandedTasks: {},
  commandPaletteOpen: false,
  newTaskOpen: false,
  addAgentOpen: false,
  addAgentTaskId: null,
  ideCollapsed: false,
  sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
  idePanelWidth: IDE_WIDTH_DEFAULT,
  chatSplitWidth: null,
}

const loadPersistedState = (): Partial<WorkspaceState> => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    // Strip legacy keys that are now URL-driven; ignore unknown shapes silently.
    delete parsed.viewMode
    delete parsed.selectedAgentId
    delete parsed.selectedTaskId
    delete parsed.taskChatTargetIndex
    delete parsed.workspaceId
    delete parsed.activeChatId
    return parsed as Partial<WorkspaceState>
  } catch {
    return {}
  }
}

// ── Context ──

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

interface WorkspaceProviderProps {
  children: ReactNode
  workspaceId?: string | null
  activeChatId?: string | null
  selectedAgentId?: string | null
}

export const WorkspaceProvider = ({
  children,
  workspaceId = null,
  activeChatId = null,
  selectedAgentId = null,
}: WorkspaceProviderProps) => {
  const [state, dispatch] = useReducer(reducer, defaultState, (initial) => {
    const merged: WorkspaceState = { ...initial, ...loadPersistedState() }
    if (!VALID_IDE_TABS.includes(merged.activeIdeTab)) {
      merged.activeIdeTab = 'IDE'
    }
    merged.sidebarWidth = clamp(merged.sidebarWidth ?? SIDEBAR_WIDTH_DEFAULT, SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX)
    merged.idePanelWidth = clamp(merged.idePanelWidth ?? IDE_WIDTH_DEFAULT, IDE_WIDTH_MIN, IDE_WIDTH_MAX)
    return merged
  })

  const navigate = useNavigate()

  // viewMode is purely derived from the URL-driven selectedAgentId.
  const viewMode: ViewMode = selectedAgentId ? 'agent' : 'task-overview'

  // Transient @target cycle index, reset whenever the task changes.
  const [taskChatTargetIndex, setTaskChatTargetIndex] = useState(0)
  useEffect(() => { setTaskChatTargetIndex(0) }, [activeChatId])
  const cycleTargetAgent = useCallback((agentCount: number) => {
    if (agentCount <= 0) return
    setTaskChatTargetIndex((i) => (i + 1) % agentCount)
  }, [])

  useEffect(() => {
    const persisted: Partial<WorkspaceState> = {
      layoutMode: state.layoutMode,
      panelCollapsed: state.panelCollapsed,
      terminalOpen: state.terminalOpen,
      activeIdeTab: state.activeIdeTab,
      expandedTasks: state.expandedTasks,
      ideCollapsed: state.ideCollapsed,
      sidebarWidth: state.sidebarWidth,
      idePanelWidth: state.idePanelWidth,
      chatSplitWidth: state.chatSplitWidth,
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  }, [state.layoutMode, state.panelCollapsed, state.terminalOpen, state.activeIdeTab, state.expandedTasks, state.ideCollapsed, state.sidebarWidth, state.idePanelWidth, state.chatSplitWidth])

  // Navigation helpers — these are the public API. They drive the URL, which
  // is then read back as props by the layout and threaded into this provider.
  const selectAgent = useCallback((agentId: string) => {
    if (!workspaceId || !activeChatId) return
    navigate(buildTaskUrl(workspaceId, activeChatId, agentId))
  }, [navigate, workspaceId, activeChatId])

  const openTaskOverview = useCallback((taskId: string) => {
    if (!workspaceId) return
    navigate(buildTaskUrl(workspaceId, taskId))
  }, [navigate, workspaceId])

  const setLayoutMode = useCallback((mode: LayoutMode) => dispatch({ type: 'SET_LAYOUT_MODE', mode }), [])
  const cycleLayoutMode = useCallback(() => dispatch({ type: 'CYCLE_LAYOUT_MODE' }), [])
  const togglePanel = useCallback(() => dispatch({ type: 'TOGGLE_PANEL' }), [])
  const collapsePanel = useCallback(() => dispatch({ type: 'COLLAPSE_PANEL' }), [])
  const expandPanel = useCallback(() => dispatch({ type: 'EXPAND_PANEL' }), [])
  // toggleTerminal is a bridge to WebIDEPanel (which owns the terminal drawer
  // state). The reducer's `terminalOpen` is now unused; kept only to avoid a
  // localStorage schema bump.
  const toggleTerminal = useCallback(() => {
    window.dispatchEvent(new CustomEvent('ide:toggle-terminal'))
  }, [])
  const setIdeTab = useCallback((tab: IdeTab) => dispatch({ type: 'SET_IDE_TAB', tab }), [])
  const toggleTask = useCallback((taskId: string) => dispatch({ type: 'TOGGLE_TASK', taskId }), [])
  const openCommandPalette = useCallback(() => dispatch({ type: 'OPEN_COMMAND_PALETTE' }), [])
  const closeCommandPalette = useCallback(() => dispatch({ type: 'CLOSE_COMMAND_PALETTE' }), [])
  const openNewTask = useCallback(() => dispatch({ type: 'OPEN_NEW_TASK' }), [])
  const closeNewTask = useCallback(() => dispatch({ type: 'CLOSE_NEW_TASK' }), [])
  const openAddAgent = useCallback((taskId: string) => dispatch({ type: 'OPEN_ADD_AGENT', taskId }), [])
  const closeAddAgent = useCallback(() => dispatch({ type: 'CLOSE_ADD_AGENT' }), [])
  const toggleIde = useCallback(() => dispatch({ type: 'TOGGLE_IDE' }), [])
  const setSidebarWidth = useCallback((width: number) => dispatch({ type: 'SET_SIDEBAR_WIDTH', width }), [])
  const setIdePanelWidth = useCallback((width: number) => dispatch({ type: 'SET_IDE_PANEL_WIDTH', width }), [])
  const setChatSplitWidth = useCallback((width: number | null) => dispatch({ type: 'SET_CHAT_SPLIT_WIDTH', width }), [])

  // IDE portal target: V2 IDEPanel registers a DOM node when its IDE tab is active;
  // ChatInstance reads this and createPortal()s RightPanel into it.
  const [ideMountNode, setIdeMountNode] = useState<HTMLElement | null>(null)

  const value: WorkspaceContextValue = useMemo(() => ({
    ...state,
    workspaceId,
    activeChatId,
    selectedAgentId,
    selectedTaskId: activeChatId,
    viewMode,
    taskChatTargetIndex,
    cycleTargetAgent,
    ideMountNode,
    setIdeMountNode,
    selectAgent,
    openTaskOverview,
    setLayoutMode,
    cycleLayoutMode,
    togglePanel,
    collapsePanel,
    expandPanel,
    toggleTerminal,
    setIdeTab,
    toggleTask,
    openCommandPalette,
    closeCommandPalette,
    openNewTask,
    closeNewTask,
    openAddAgent,
    closeAddAgent,
    toggleIde,
    setSidebarWidth,
    setIdePanelWidth,
    setChatSplitWidth,
  }), [
    state, workspaceId, activeChatId, selectedAgentId, viewMode,
    taskChatTargetIndex, cycleTargetAgent,
    ideMountNode,
    selectAgent, openTaskOverview,
    setLayoutMode, cycleLayoutMode, togglePanel, collapsePanel, expandPanel,
    toggleTerminal, setIdeTab, toggleTask,
    openCommandPalette, closeCommandPalette, openNewTask, closeNewTask,
    openAddAgent, closeAddAgent, toggleIde,
    setSidebarWidth, setIdePanelWidth, setChatSplitWidth,
  ])

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export const useWorkspace = (): WorkspaceContextValue => {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return ctx
}

// Re-export for callers that import via the context for convenience.
export { buildTaskUrl, buildWorkspaceUrl }
