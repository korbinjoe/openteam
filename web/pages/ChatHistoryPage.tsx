import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Search, Clock, Home, ChevronRight, RefreshCw, Trash2, Loader2, FolderOpen, Wrench, Coins } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import AgentAvatar from '@/components/ui/agent-avatar'
import WorktreeSessionBadges from '@/components/worktree/WorktreeSessionBadges'
import type { WorktreeSession } from '../types/chat'
import { isElectron, ELECTRON_TITLEBAR_PADDING } from '../utils/env'

import { API_BASE, authFetch } from '@/config/api'
import { useChatTabs } from '@/contexts/ChatTabContext'
import { deleteChatWithJsonl, formatPurgeFailures } from '@/services/chatService'

interface ChatRecord {
  id: string
  workspaceId: string
  title: string
  primaryAgentId: string
  teamAgentIds?: string[]
  model?: string
  usedModels?: string[]
  status: string
  totalCost?: number
  totalTokens?: { input: number; output: number; cacheRead?: number; cacheCreation?: number }
  totalToolCalls?: number
  worktreeSessions?: WorktreeSession[]
  expertSessions?: Record<string, unknown>
  createdAt: string
  lastMessageAt: string
}

const relativeTime = (ts: number, t: TFunction) => {
  const diff = Date.now() - ts
  if (diff < 60_000) return t('common:time.justNow')
  if (diff < 3_600_000) return t('common:time.minutesAgo', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('common:time.hoursAgo', { count: Math.floor(diff / 3_600_000) })
  return t('common:time.daysAgo', { count: Math.floor(diff / 86_400_000) })
}

type TimeGroup = 'today' | 'yesterday' | 'thisWeek' | 'earlier'

const getTimeGroup = (ts: number): TimeGroup => {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86_400_000
  const weekStart = todayStart - (now.getDay() * 86_400_000)

  if (ts >= todayStart) return 'today'
  if (ts >= yesterdayStart) return 'yesterday'
  if (ts >= weekStart) return 'thisWeek'
  return 'earlier'
}

const TIME_GROUP_ORDER: TimeGroup[] = ['today', 'yesterday', 'thisWeek', 'earlier']

const groupByTime = (chats: ChatRecord[]): { group: TimeGroup; items: ChatRecord[] }[] => {
  const groups = new Map<TimeGroup, ChatRecord[]>()
  for (const chat of chats) {
    const g = getTimeGroup(new Date(chat.lastMessageAt).getTime())
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(chat)
  }
  return TIME_GROUP_ORDER
    .filter((g) => groups.has(g))
    .map((g) => ({ group: g, items: groups.get(g)! }))
}

interface WorkspaceInfo {
  id: string
  name: string
}

const formatTokens = (n: number): string => {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return `${n}`
}

const WORKSPACE_BASE = '/workspace'
const MISSION_SEGMENT = 'mission'
const HOME_PATH = '/'

const ChatHistoryPage = () => {
  const { t } = useTranslation(['chat', 'common'])
  const navigate = useNavigate()
  const { closeTab, closeCompletedTabs } = useChatTabs()
  const [chats, setChats] = useState<ChatRecord[]>([])
  const [workspaceMap, setWorkspaceMap] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'running' | 'idle' | 'stopped'>('all')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ChatRecord | null>(null)

  const fetchChats = useCallback(async () => {
    setLoading(true)
    try {
      const [chatsRes, wsRes] = await Promise.all([
        authFetch(`${API_BASE}/api/chats/recent?limit=100`),
        authFetch(`${API_BASE}/api/workspaces`),
      ])
      if (chatsRes.ok) setChats(await chatsRes.json())
      if (wsRes.ok) {
        const wsList: WorkspaceInfo[] = await wsRes.json()
        const map: Record<string, string> = {}
        wsList.forEach((ws) => { map[ws.id] = ws.name })
        setWorkspaceMap(map)
      }
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchChats() }, [fetchChats])

  const filtered = useMemo(() => {
    let list = [...chats]
    if (statusFilter !== 'all') {
      list = list.filter((c) => c.status === statusFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((c) =>
        c.title.toLowerCase().includes(q) ||
        c.primaryAgentId.toLowerCase().includes(q) ||
        (workspaceMap[c.workspaceId] ?? '').toLowerCase().includes(q) ||
        (c.model ?? '').toLowerCase().includes(q) ||
        (c.usedModels ?? []).some((m) => m.toLowerCase().includes(q))
      )
    }
    return list
  }, [chats, statusFilter, search])

  const timeGroups = useMemo(() => groupByTime(filtered), [filtered])

  // V2 mission URL with no `?agent=` lands on mission-overview (whiteboard timeline),
  // which is empty for chats that never wrote whiteboard entries. Single-agent
  // chats (the vast majority) should drop straight into the agent 1:1 view so
  // the real JSONL conversation renders. Multi-agent chats keep the overview.
  const buildOpenUrl = useCallback((chat: ChatRecord): string => {
    const base = `${WORKSPACE_BASE}/${chat.workspaceId}/${MISSION_SEGMENT}/${chat.id}`
    const singleAgent = !chat.teamAgentIds || chat.teamAgentIds.length === 0
    if (singleAgent && chat.primaryAgentId) {
      return `${base}?agent=${encodeURIComponent(chat.primaryAgentId)}`
    }
    return base
  }, [])

  const timeGroupLabels: Record<TimeGroup, string> = {
    today: t('chat:history.today', { defaultValue: 'Today' }),
    yesterday: t('chat:history.yesterday', { defaultValue: 'Yesterday' }),
    thisWeek: t('chat:history.thisWeek', { defaultValue: 'This Week' }),
    earlier: t('chat:history.earlier', { defaultValue: 'Earlier' }),
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      const result = await deleteChatWithJsonl(deleteTarget.id)
      setChats((prev) => prev.filter((c) => c.id !== deleteTarget.id))
      closeTab(deleteTarget.id)
      const failures = formatPurgeFailures(result.purged)
      if (failures.length > 0) {
        // Non-blocking surfacing; project has no toast primitive imported here.
        // eslint-disable-next-line no-console
        console.warn('Some JSONL files could not be deleted:\n' + failures.join('\n'))
      }
    } catch { /* ignore */ } finally {
      setDeleteConfirmOpen(false)
      setDeleteTarget(null)
    }
  }

  const deleteJsonlCount = deleteTarget?.expertSessions
    ? Object.keys(deleteTarget.expertSessions).length
    : 0

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <div
        className={cn(
          'h-10 border-b border-border-subtle flex items-center px-3.5 gap-2 shrink-0',
          isElectron && '-webkit-app-region-drag',
        )}
        style={{ paddingLeft: isElectron ? ELECTRON_TITLEBAR_PADDING : 14 }}
      >
        <nav className="flex items-center gap-1 text-xs -webkit-app-region-no-drag">
          <button
            onClick={() => navigate(HOME_PATH)}
            tabIndex={0}
            aria-label="Home"
            className="bg-transparent border-none cursor-pointer text-text-secondary hover:text-text-emphasis transition-colors p-0 flex items-center"
          >
            <Home size={14} />
          </button>
          <ChevronRight size={10} className="text-text-secondary opacity-50" />
          <span className="text-text-emphasis font-semibold">{t('chat:history.title')}</span>
        </nav>

        <div className="-webkit-app-region-no-drag flex-1 max-w-[240px] flex items-center gap-[6px] bg-bg-input border border-border rounded-md px-2.5 py-1">
          <Search size={12} className="text-text-secondary shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('chat:history.searchPlaceholder')}
            className="bg-transparent border-none outline-none text-text-primary text-xs w-full"
          />
        </div>

        <div className="-webkit-app-region-no-drag flex items-center gap-1 text-xs">
          {(['all', 'running', 'idle', 'stopped'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              tabIndex={0}
              aria-label={s}
              className={cn(
                'px-2 py-0.5 rounded-md border-none cursor-pointer transition-colors',
                statusFilter === s
                  ? 'bg-bg-hover text-text-emphasis'
                  : 'bg-transparent text-text-secondary hover:text-text-primary',
              )}
            >
              {s === 'all' ? t('chat:history.filterAll') : t(`common:status.${s}`)}
            </button>
          ))}
        </div>

        <span className="flex-1" />

        {/* Batch actions */}
        <button
          onClick={() => {
            const completedIds = chats.filter((c) => c.status === 'stopped' || c.status === 'idle').map((c) => c.id)
            if (completedIds.length > 0) closeCompletedTabs(completedIds)
          }}
          tabIndex={0}
          aria-label={t('chat:history.closeCompleted', { defaultValue: 'Close Completed' })}
          className="-webkit-app-region-no-drag text-[11px] px-2.5 py-1 rounded-md border border-border bg-transparent text-text-secondary hover:text-text-primary cursor-pointer transition-colors"
        >
          {t('chat:history.closeCompleted', { defaultValue: 'Close Completed' })}
        </button>

        <button
          onClick={fetchChats}
          title={t('common:action.refresh')}
          aria-label={t('common:action.refresh')}
          tabIndex={0}
          className="-webkit-app-region-no-drag bg-transparent border-none cursor-pointer text-text-secondary hover:text-text-primary p-1 rounded-md transition-colors"
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-[800px] mx-auto">
          {loading && chats.length === 0 ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 size={20} className="animate-spin text-text-secondary" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <Clock size={32} className="text-text-secondary opacity-40" />
              <div className="text-sm text-text-secondary">
                {chats.length === 0 ? t('chat:history.noRecords') : t('chat:history.noMatch')}
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {timeGroups.map(({ group, items }) => (
                <div key={group}>
                  <div className="flex items-center gap-2 mb-1.5 px-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                      {timeGroupLabels[group]}
                    </span>
                    <span className="text-[10px] text-text-muted font-mono">
                      {items.length}
                    </span>
                    <span className="flex-1 h-px bg-border-subtle/40" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {items.map((chat) => (
                      <div
                        key={chat.id}
                        onClick={() => navigate(buildOpenUrl(chat))}
                        onKeyDown={(e) => { if (e.key === 'Enter') navigate(buildOpenUrl(chat)) }}
                        tabIndex={0}
                        role="button"
                        aria-label={t('chat:history.openChat', { title: chat.title })}
                        className="group flex items-center gap-3 rounded-md px-3.5 py-3 cursor-pointer transition-colors hover:bg-bg-hover-subtle relative"
                      >
                        <AgentAvatar name={chat.primaryAgentId} agentId={chat.primaryAgentId} size="md" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-medium text-text-emphasis truncate">
                              {chat.title}
                            </span>
                            <span className={cn(
                              'shrink-0 rounded px-1.5 py-px text-xs font-medium',
                              chat.status === 'running'
                                ? 'bg-accent-green/10 text-accent-green'
                                : chat.status === 'idle'
                                  ? 'bg-accent-yellow/10 text-accent-yellow'
                                  : 'bg-bg-hover-muted text-text-secondary',
                            )}>
                              {t(`common:status.${chat.status}`, { defaultValue: chat.status })}
                            </span>
                          </div>
                          {/* Meta line */}
                          <div className="flex items-center gap-2 mt-1 text-[11px] text-text-secondary">
                            <span className="flex items-center gap-1">
                              <FolderOpen size={10} className="opacity-60" />
                              <span className="truncate max-w-[120px]">
                                {workspaceMap[chat.workspaceId] ?? chat.workspaceId}
                              </span>
                            </span>
                            <span className="opacity-30">·</span>
                            <span>{chat.primaryAgentId}</span>
                            {(chat.usedModels || chat.model) && (
                              <>
                                <span className="opacity-30">·</span>
                                <span>{chat.usedModels ? chat.usedModels[0] : chat.model}</span>
                              </>
                            )}
                          </div>
                          {/* Stat pills */}
                          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                            {chat.totalToolCalls != null && chat.totalToolCalls > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-bg-hover-muted text-text-secondary font-mono">
                                <Wrench size={9} className="opacity-50" />
                                {chat.totalToolCalls} tools
                              </span>
                            )}
                            {chat.totalTokens && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-bg-hover-muted text-text-secondary font-mono">
                                {formatTokens(chat.totalTokens.input)} in / {formatTokens(chat.totalTokens.output)} out
                              </span>
                            )}
                            {chat.totalCost != null && chat.totalCost > 0 && (
                              <span className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-bg-hover-muted text-text-secondary font-mono">
                                <Coins size={9} className="opacity-50" />
                                ${chat.totalCost.toFixed(4)}
                              </span>
                            )}
                            <span className="inline-flex items-center gap-1 text-[10px] text-text-muted ml-auto">
                              <Clock size={9} />
                              {relativeTime(new Date(chat.lastMessageAt).getTime(), t)}
                            </span>
                          </div>
                          {chat.worktreeSessions && chat.worktreeSessions.length > 0 && (
                            <WorktreeSessionBadges sessions={chat.worktreeSessions} className="mt-1" />
                          )}
                        </div>

                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setDeleteTarget(chat)
                            setDeleteConfirmOpen(true)
                          }}
                          tabIndex={0}
                          aria-label={t('common:action.delete')}
                          className="flex bg-transparent border-none cursor-pointer text-text-secondary hover:text-red-400 p-1 rounded-sm transition-colors opacity-0 group-hover:opacity-100"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Delete confirm */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('chat:history.deleteTitle')}</DialogTitle>
            <DialogDescription>
              {t('chat:history.deleteDesc', { title: deleteTarget?.title })}
              {deleteJsonlCount > 0 && (
                <span className="block mt-2 text-text-secondary">
                  {t('chat:history.deletePurgeWarn', {
                    defaultValue: 'Also delete {{count}} local CLI session file(s) (cannot be undone).',
                    count: deleteJsonlCount,
                  })}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setDeleteConfirmOpen(false)}
              tabIndex={0}
              aria-label={t('common:action.cancel')}
              className="px-3 py-1.5 rounded-md text-xs text-text-secondary hover:text-text-primary transition-colors bg-transparent border border-border"
            >
              {t('common:action.cancel')}
            </button>
            <button
              onClick={handleDelete}
              tabIndex={0}
              aria-label={t('common:action.delete')}
              className="px-3 py-1.5 rounded-md text-xs text-white bg-red-600 hover:bg-red-700 transition-colors border-none"
            >
              {t('common:action.delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default ChatHistoryPage
