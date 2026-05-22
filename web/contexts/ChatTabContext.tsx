/**
 * ChatTabContext — Tab state management
 */

import { createContext, useContext, useReducer, useCallback, useRef, useEffect, type ReactNode } from 'react'
import { toast } from 'sonner'

// ── Types ──

export interface ChatTabItem {
  chatId: string
  workspaceId: string
  title: string
  order: number
  openedAt: number
}

export interface ChatTabStatus {
  changedFiles?: number
}

interface ChatTabState {
  tabs: ChatTabItem[]
  activeTabId: string | null
  tabStatus: Record<string, ChatTabStatus>
  /**
   *  Tab  —  phase
   * activateTab waiting_confirmation  phase
   */
  unreadTabs: string[]
  collapsedGroups: string[]
}

interface ChatTabContextValue extends ChatTabState {
  openTab: (chatId: string, workspaceId: string, title?: string) => void
  closeTab: (chatId: string) => void
  activateTab: (chatId: string) => void
  closeOtherTabs: (keepChatId: string) => void
  closeRightTabs: (chatId: string) => void
  closeCompletedTabs: (completedChatIds: string[]) => void
  updateTabTitle: (chatId: string, title: string) => void
  updateTabStatus: (chatId: string, status: ChatTabStatus) => void
  markTabUnread: (chatId: string) => void
  clearTabUnread: (chatId: string) => void
  reorderTabs: (orderedIds: string[]) => void
  toggleGroupCollapse: (workspaceId: string) => void
}

// ── Constants ──

const STORAGE_KEY = 'openteam:chat-tabs'
const MAX_TABS = 10

// ── Reducer ──

type Action =
  | { type: 'OPEN_TAB'; chatId: string; workspaceId: string; title: string }
  | { type: 'CLOSE_TAB'; chatId: string }
  | { type: 'ACTIVATE_TAB'; chatId: string }
  | { type: 'CLOSE_OTHER_TABS'; keepChatId: string }
  | { type: 'CLOSE_RIGHT_TABS'; chatId: string }
  | { type: 'CLOSE_TABS'; chatIds: string[] }
  | { type: 'UPDATE_TITLE'; chatId: string; title: string }
  | { type: 'UPDATE_STATUS'; chatId: string; status: ChatTabStatus }
  | { type: 'MARK_UNREAD'; chatId: string }
  | { type: 'CLEAR_UNREAD'; chatId: string }
  | { type: 'REORDER_TABS'; orderedIds: string[] }
  | { type: 'TOGGLE_GROUP_COLLAPSE'; workspaceId: string }
  | { type: 'RESTORE'; state: ChatTabState }

const reducer = (state: ChatTabState, action: Action): ChatTabState => {
  switch (action.type) {
    case 'OPEN_TAB': {
      const existing = state.tabs.find((t) => t.chatId === action.chatId)
      const autoExpand = state.collapsedGroups.includes(action.workspaceId)
        ? state.collapsedGroups.filter((id) => id !== action.workspaceId)
        : state.collapsedGroups
      if (existing) {
        const nextUnread = state.unreadTabs.includes(action.chatId)
          ? state.unreadTabs.filter((id) => id !== action.chatId)
          : state.unreadTabs
        return { ...state, activeTabId: action.chatId, unreadTabs: nextUnread, collapsedGroups: autoExpand }
      }
      if (state.tabs.length >= MAX_TABS) {
        return state // caller shows toast
      }
      const newTab: ChatTabItem = {
        chatId: action.chatId,
        workspaceId: action.workspaceId,
        title: action.title || '',
        order: state.tabs.length,
        openedAt: Date.now(),
      }
      return { ...state, tabs: [...state.tabs, newTab], activeTabId: action.chatId, collapsedGroups: autoExpand }
    }

    case 'CLOSE_TAB': {
      const idx = state.tabs.findIndex((t) => t.chatId === action.chatId)
      if (idx === -1) return state
      const closedTab = state.tabs[idx]
      const newTabs = state.tabs.filter((t) => t.chatId !== action.chatId)
      let newActive = state.activeTabId
      if (state.activeTabId === action.chatId) {
        const sameGroup = newTabs.filter((t) => t.workspaceId === closedTab.workspaceId)
        if (sameGroup.length > 0) {
          const groupBefore = state.tabs.filter((t) => t.workspaceId === closedTab.workspaceId)
          const closedGroupIdx = groupBefore.findIndex((t) => t.chatId === action.chatId)
          const rightInGroup = groupBefore[closedGroupIdx + 1]
          const leftInGroup = groupBefore[closedGroupIdx - 1]
          newActive = rightInGroup?.chatId ?? leftInGroup?.chatId ?? null
        } else {
          const rightTab = state.tabs[idx + 1]
          const leftTab = state.tabs[idx - 1]
          newActive = rightTab?.chatId ?? leftTab?.chatId ?? null
        }
      }
      const { [action.chatId]: _, ...nextStatus } = state.tabStatus
      const nextUnread = state.unreadTabs.filter((id) => id !== action.chatId)
      return { tabs: newTabs, activeTabId: newActive, tabStatus: nextStatus, unreadTabs: nextUnread, collapsedGroups: state.collapsedGroups }
    }

    case 'ACTIVATE_TAB': {
      if (!state.tabs.some((t) => t.chatId === action.chatId)) return state
      const nextUnread = state.unreadTabs.includes(action.chatId)
        ? state.unreadTabs.filter((id) => id !== action.chatId)
        : state.unreadTabs
      return { ...state, activeTabId: action.chatId, unreadTabs: nextUnread }
    }

    case 'CLOSE_OTHER_TABS': {
      const kept = state.tabs.filter((t) => t.chatId === action.keepChatId)
      const keptStatus = state.tabStatus[action.keepChatId]
      return {
        tabs: kept,
        activeTabId: action.keepChatId,
        tabStatus: keptStatus ? { [action.keepChatId]: keptStatus } : {},
        unreadTabs: state.unreadTabs.includes(action.keepChatId) ? [action.keepChatId] : [],
        collapsedGroups: [],
      }
    }

    case 'CLOSE_RIGHT_TABS': {
      const idx = state.tabs.findIndex((t) => t.chatId === action.chatId)
      if (idx === -1 || idx >= state.tabs.length - 1) return state
      const closeIds = new Set(state.tabs.slice(idx + 1).map((t) => t.chatId))
      const newTabs = state.tabs.filter((t) => !closeIds.has(t.chatId))
      const newActive = closeIds.has(state.activeTabId ?? '') ? action.chatId : state.activeTabId
      const nextStatus: Record<string, ChatTabStatus> = {}
      for (const [k, v] of Object.entries(state.tabStatus)) {
        if (!closeIds.has(k)) nextStatus[k] = v
      }
      const nextUnread = state.unreadTabs.filter((id) => !closeIds.has(id))
      return { tabs: newTabs, activeTabId: newActive, tabStatus: nextStatus, unreadTabs: nextUnread, collapsedGroups: state.collapsedGroups }
    }

    case 'CLOSE_TABS': {
      const closeSet = new Set(action.chatIds)
      const newTabs = state.tabs.filter((t) => !closeSet.has(t.chatId))
      let newActive = state.activeTabId
      if (newActive && closeSet.has(newActive)) {
        newActive = newTabs[0]?.chatId ?? null
      }
      const nextStatus: Record<string, ChatTabStatus> = {}
      for (const [k, v] of Object.entries(state.tabStatus)) {
        if (!closeSet.has(k)) nextStatus[k] = v
      }
      const nextUnread = state.unreadTabs.filter((id) => !closeSet.has(id))
      return { tabs: newTabs, activeTabId: newActive, tabStatus: nextStatus, unreadTabs: nextUnread, collapsedGroups: state.collapsedGroups }
    }

    case 'UPDATE_TITLE': {
      return {
        ...state,
        tabs: state.tabs.map((t) =>
          t.chatId === action.chatId ? { ...t, title: action.title } : t,
        ),
      }
    }

    case 'UPDATE_STATUS': {
      const prev = state.tabStatus[action.chatId]
      const merged = { ...prev, ...action.status }
      if (prev && prev.changedFiles === merged.changedFiles) return state
      return {
        ...state,
        tabStatus: { ...state.tabStatus, [action.chatId]: merged },
      }
    }

    case 'MARK_UNREAD': {
      if (state.activeTabId === action.chatId) return state
      if (state.unreadTabs.includes(action.chatId)) return state
      if (!state.tabs.some((t) => t.chatId === action.chatId)) return state
      return { ...state, unreadTabs: [...state.unreadTabs, action.chatId] }
    }

    case 'CLEAR_UNREAD': {
      if (!state.unreadTabs.includes(action.chatId)) return state
      return { ...state, unreadTabs: state.unreadTabs.filter((id) => id !== action.chatId) }
    }

    case 'REORDER_TABS': {
      if (action.orderedIds.length !== state.tabs.length) return state
      const map = new Map(state.tabs.map((t) => [t.chatId, t]))
      const next: ChatTabItem[] = []
      for (const id of action.orderedIds) {
        const tab = map.get(id)
        if (!tab) return state
        next.push(tab)
      }
      let changed = false
      for (let i = 0; i < next.length; i++) {
        if (state.tabs[i].chatId !== next[i].chatId) { changed = true; break }
      }
      if (!changed) return state
      return { ...state, tabs: next.map((t, i) => ({ ...t, order: i })) }
    }

    case 'TOGGLE_GROUP_COLLAPSE': {
      const collapsed = state.collapsedGroups.includes(action.workspaceId)
      return {
        ...state,
        collapsedGroups: collapsed
          ? state.collapsedGroups.filter((id) => id !== action.workspaceId)
          : [...state.collapsedGroups, action.workspaceId],
      }
    }

    case 'RESTORE': {
      return action.state
    }

    default:
      return state
  }
}

// ── Persistence ──

const saveToStorage = (state: ChatTabState) => {
  try {
    const data = {
      tabs: state.tabs.map(({ chatId, workspaceId, order }) => ({ chatId, workspaceId, order })),
      activeTabId: state.activeTabId,
      collapsedGroups: state.collapsedGroups,
    }
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch { /* quota exceeded — ignore */ }
}

const loadFromStorage = (): ChatTabState | null => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as { tabs: Array<{ chatId: string; workspaceId: string; order: number }>; activeTabId: string | null; collapsedGroups?: string[] }
    if (!Array.isArray(data.tabs)) return null
    return {
      tabs: data.tabs.map((t) => ({
        chatId: t.chatId,
        workspaceId: t.workspaceId,
        title: '',
        order: t.order,
        openedAt: Date.now(),
      })),
      activeTabId: data.activeTabId,
      tabStatus: {},
      unreadTabs: [],
      collapsedGroups: data.collapsedGroups ?? [],
    }
  } catch {
    return null
  }
}

// ── Ref-based actions getter for non-component code ──

let globalActionsRef: { openTab: ChatTabContextValue['openTab'] } | null = null

export const getChatTabActions = () => globalActionsRef

// ── Context ──

const ChatTabContext = createContext<ChatTabContextValue | null>(null)

const INIT_STATE: ChatTabState = { tabs: [], activeTabId: null, tabStatus: {}, unreadTabs: [], collapsedGroups: [] }

export const ChatTabProvider = ({ children }: { children: ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, INIT_STATE, () => {
    return loadFromStorage() ?? INIT_STATE
  })

  const stateRef = useRef(state)
  stateRef.current = state

  // Persist on every state change
  useEffect(() => {
    saveToStorage(state)
  }, [state])

  const openTab = useCallback((chatId: string, workspaceId: string, title?: string) => {
    if (stateRef.current.tabs.length >= MAX_TABS && !stateRef.current.tabs.some((t) => t.chatId === chatId)) {
      toast.warning(`Maximum ${MAX_TABS} tabs open. Please close completed tabs first.`)
      return
    }
    dispatch({ type: 'OPEN_TAB', chatId, workspaceId, title: title ?? '' })
  }, [])

  const closeTab = useCallback((chatId: string) => {
    dispatch({ type: 'CLOSE_TAB', chatId })
  }, [])

  const activateTab = useCallback((chatId: string) => {
    const tab = stateRef.current.tabs.find((t) => t.chatId === chatId)
    if (!tab) return
    dispatch({ type: 'ACTIVATE_TAB', chatId })
  }, [])

  const closeOtherTabs = useCallback((keepChatId: string) => {
    dispatch({ type: 'CLOSE_OTHER_TABS', keepChatId })
  }, [])

  const closeRightTabs = useCallback((chatId: string) => {
    dispatch({ type: 'CLOSE_RIGHT_TABS', chatId })
  }, [])

  const closeCompletedTabs = useCallback((completedChatIds: string[]) => {
    if (completedChatIds.length === 0) return
    dispatch({ type: 'CLOSE_TABS', chatIds: completedChatIds })
  }, [])

  const updateTabTitle = useCallback((chatId: string, title: string) => {
    dispatch({ type: 'UPDATE_TITLE', chatId, title })
  }, [])

  const updateTabStatus = useCallback((chatId: string, status: ChatTabStatus) => {
    dispatch({ type: 'UPDATE_STATUS', chatId, status })
  }, [])

  const markTabUnread = useCallback((chatId: string) => {
    dispatch({ type: 'MARK_UNREAD', chatId })
  }, [])

  const clearTabUnread = useCallback((chatId: string) => {
    dispatch({ type: 'CLEAR_UNREAD', chatId })
  }, [])

  const reorderTabs = useCallback((orderedIds: string[]) => {
    dispatch({ type: 'REORDER_TABS', orderedIds })
  }, [])

  const toggleGroupCollapse = useCallback((workspaceId: string) => {
    dispatch({ type: 'TOGGLE_GROUP_COLLAPSE', workspaceId })
  }, [])

  // Expose ref-based actions for non-component code
  useEffect(() => {
    globalActionsRef = { openTab }
    return () => { globalActionsRef = null }
  }, [openTab])

  const value: ChatTabContextValue = {
    ...state,
    openTab,
    closeTab,
    activateTab,
    closeOtherTabs,
    closeRightTabs,
    closeCompletedTabs,
    updateTabTitle,
    updateTabStatus,
    markTabUnread,
    clearTabUnread,
    reorderTabs,
    toggleGroupCollapse,
  }

  return (
    <ChatTabContext.Provider value={value}>
      {children}
    </ChatTabContext.Provider>
  )
}

export const useChatTabs = (): ChatTabContextValue => {
  const ctx = useContext(ChatTabContext)
  if (!ctx) throw new Error('useChatTabs must be used within ChatTabProvider')
  return ctx
}
