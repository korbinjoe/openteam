/**
 * NewChatForm —
 *
 *  +
 *  NewChatFullDialog EmptyTabPage
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Search, ChevronDown, Check, Loader2, Plus, ArrowRight } from 'lucide-react'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import AgentAvatar from '@/components/ui/agent-avatar'
import WorkspaceIcon from '@/components/icons/WorkspaceIcon'
import { cn } from '@/lib/utils'
import { DEFAULT_MODEL, DEFAULT_MODELS, getModelsForProvider } from '@/lib/models'
import { sortAgents } from '@/utils/teamStorage'
import { loadLastSession, saveLastSession } from '@/components/home/storage'
import { API_BASE, authFetch } from '@/config/api'
import { WS_EVENTS, useWorkspaceCreatedRefresh } from '@/hooks/useWorkspaceEvents'
import { sendAESEvent } from '@/lib/aes'
import type { AgentSummary } from '@/types/agentConfig'
import type { WorkspaceInfo } from '@/components/home/types'

interface NewChatFormProps {
  currentWorkspaceId?: string
  currentAgentId?: string | null
  onCreated?: () => void
  /** Route prefix the form should navigate to after create. Defaults to "/workspace". */
  routePrefix?: string
  /** URL segment for the chat/task id. Defaults to "task". */
  chatSegment?: string
}

const NewChatForm = ({ currentWorkspaceId, currentAgentId, onCreated, routePrefix = '/workspace', chatSegment = 'task' }: NewChatFormProps) => {
  const navigate = useNavigate()
  const { t } = useTranslation(['home', 'workspace', 'common'])

  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  const [selectedWsId, setSelectedWsId] = useState<string | undefined>(currentWorkspaceId)
  const [selectedAgentIdState, setSelectedAgentIdState] = useState<string | undefined>(
    () => currentAgentId ?? undefined,
  )
  const lastSession = useMemo(() => loadLastSession(), [])
  const [model, setModel] = useState(lastSession?.model ?? DEFAULT_MODEL)

  const [wsDropdownOpen, setWsDropdownOpen] = useState(false)
  const [wsSearch, setWsSearch] = useState('')
  const comboboxRef = useRef<HTMLDivElement>(null)
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false)
  const agentBoxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!currentAgentId) return
    setSelectedAgentIdState(currentAgentId)
  }, [currentAgentId])

  useEffect(() => {
    setLoading(true)
    setSelectedWsId(currentWorkspaceId)
    Promise.all([
      authFetch(`${API_BASE}/api/workspaces`).then((r) => r.ok ? r.json() : []).catch(() => []),
      authFetch(`${API_BASE}/api/agents`).then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([ws, agentList]) => {
      setWorkspaces(ws)
      setAgents(sortAgents(agentList))
    }).finally(() => setLoading(false))
  }, [currentWorkspaceId])

  useEffect(() => {
    if (selectedAgentIdState || agents.length === 0) return
    const defaultAgent = agents.find((a) => a.id === 'fullstack-product-engineer') || agents[0]
    if (!defaultAgent) return
    setSelectedAgentIdState(defaultAgent.id)
    const compatible = getModelsForProvider(defaultAgent.provider)
    if (!compatible.some((m) => m.value === model)) {
      setModel(compatible[0]?.value ?? DEFAULT_MODEL)
    }
  }, [agents, selectedAgentIdState, model])

  useWorkspaceCreatedRefresh(setWorkspaces, setSelectedWsId)

  useEffect(() => {
    if (!wsDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (comboboxRef.current && !comboboxRef.current.contains(e.target as Node)) {
        setWsDropdownOpen(false)
        setWsSearch('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [wsDropdownOpen])

  useEffect(() => {
    if (!agentDropdownOpen) return
    const handler = (e: MouseEvent) => {
      if (agentBoxRef.current && !agentBoxRef.current.contains(e.target as Node)) {
        setAgentDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [agentDropdownOpen])

  const selectedWs = workspaces.find((ws) => ws.id === selectedWsId)
  const selectedAgent = agents.find((a) => a.id === selectedAgentIdState)
  const availableModels = useMemo(
    () => getModelsForProvider(selectedAgent?.provider),
    [selectedAgent?.provider],
  )

  const handleAgentSelect = useCallback((agentId: string) => {
    setSelectedAgentIdState(agentId)
    const agent = agents.find((a) => a.id === agentId)
    const compatible = getModelsForProvider(agent?.provider)
    if (!compatible.some((m) => m.value === model)) {
      setModel(compatible[0]?.value ?? DEFAULT_MODEL)
    }
  }, [agents, model])

  const filteredWorkspaces = useMemo(() => {
    const q = wsSearch.trim().toLowerCase()
    if (!q) return workspaces
    return workspaces.filter((ws) =>
      ws.name.toLowerCase().includes(q) ||
      ws.repositories.some((r) => r.path.toLowerCase().includes(q)),
    )
  }, [workspaces, wsSearch])

  const doCreate = useCallback(async (opts: {
    ws: WorkspaceInfo
    agent?: AgentSummary
    modelValue: string
    title: string
    source: 'form' | 'quick-start'
  }) => {
    setCreating(true)
    try {
      const paths = opts.ws.repositories.map((r) => r.path)
      const finalTitle = opts.title.trim() || 'New Session'
      const body = {
        ...(paths.length === 1 ? { repoPath: paths[0] } : { repoPaths: paths }),
        model: opts.modelValue,
        title: finalTitle,
        ...(opts.agent ? { agentId: opts.agent.id } : {}),
        workspaceId: opts.ws.id,
      }
      saveLastSession({ repos: paths, model: opts.modelValue, agentId: opts.agent?.id })
      sendAESEvent('chat', 'chat_created', {
        agentName: opts.agent?.name,
        workspaceId: opts.ws.id,
        source: opts.source,
      })
      const res = await authFetch(`${API_BASE}/api/workspaces/quick-start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || 'Create failed')
      }
      const { workspace, chat } = await res.json()
      onCreated?.()
      navigate(`${routePrefix}/${workspace.id}/${chatSegment}/${chat.id}`, {
        state: { isNew: true, agentId: opts.agent?.id },
      })
    } catch (err) {
      console.error('[NewChatForm] Create failed:', err)
      toast.error(t('common:error.createFailed'))
    } finally {
      setCreating(false)
    }
  }, [navigate, onCreated, t, routePrefix, chatSegment])

  const handleCreate = useCallback(() => {
    if (!selectedWs) return
    return doCreate({ ws: selectedWs, agent: selectedAgent, modelValue: model, title: 'New Session', source: 'form' })
  }, [doCreate, selectedWs, selectedAgent, model])

  // Match lastSession to a concrete workspace + agent. If both resolve, we can offer
  // one-click "Continue with last setup". repos comparison is by sorted set since
  // path order is not meaningful.
  const quickStart = useMemo(() => {
    if (!lastSession || lastSession.repos.length === 0 || workspaces.length === 0 || agents.length === 0) return null
    const want = [...lastSession.repos].sort().join('|')
    const ws = workspaces.find((w) => {
      const got = w.repositories.map((r) => r.path).sort().join('|')
      return got === want
    })
    if (!ws) return null
    const agent = lastSession.agentId ? agents.find((a) => a.id === lastSession.agentId) : undefined
    if (lastSession.agentId && !agent) return null
    const modelLabel = DEFAULT_MODELS.find((m) => m.value === lastSession.model)?.label ?? lastSession.model
    return { ws, agent, model: lastSession.model, modelLabel }
  }, [lastSession, workspaces, agents])

  const handleQuickStart = useCallback(() => {
    if (!quickStart) return
    return doCreate({
      ws: quickStart.ws,
      agent: quickStart.agent,
      modelValue: quickStart.model,
      title: 'New Session',
      source: 'quick-start',
    })
  }, [doCreate, quickStart])

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-text-secondary text-sm">
        <Loader2 size={16} className="animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Quick Start — one-click continue with last setup. Only rendered when lastSession
       * resolves to a still-existing workspace + agent. */}
      {quickStart && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[1px] text-text-muted mb-2">
            {t('workspace:newChat.quickStart')}
          </div>
          <button
            type="button"
            onClick={handleQuickStart}
            disabled={creating}
            className="group w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border border-accent-brand/20 bg-accent-brand/[0.06] hover:bg-accent-brand/[0.1] hover:border-accent-brand/35 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {quickStart.agent ? (
              <AgentAvatar name={quickStart.agent.name} agentId={quickStart.agent.id} size="md" />
            ) : (
              <div className="h-7 w-7 rounded-md bg-accent-brand/15 flex items-center justify-center shrink-0">
                <Plus size={14} className="text-accent-brand" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-text-emphasis">{t('workspace:newChat.continueLast')}</div>
              <div className="text-xs text-text-secondary truncate mt-0.5">
                {quickStart.ws.name}
                {quickStart.agent ? ` · ${quickStart.agent.name}` : ''}
                {` · ${quickStart.modelLabel}`}
              </div>
            </div>
            {creating ? (
              <Loader2 size={14} className="shrink-0 text-accent-brand animate-spin" />
            ) : (
              <ArrowRight size={14} className="shrink-0 text-accent-brand opacity-70 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
            )}
          </button>
        </div>
      )}

      {/* Divider label — visually demotes the manual config when Quick Start is present. */}
      {quickStart && (
        <div className="text-[10px] font-semibold uppercase tracking-[1px] text-text-muted -mb-1">
          {t('workspace:newChat.configureNew')}
        </div>
      )}

      {/* Inline 3-dropdown row: Workspace + Agent + Model. Matches the prototype's
       * compact config block — no per-field labels above. */}
      <div className="flex gap-2">
        {/* Workspace */}
        <div ref={comboboxRef} className="relative flex-1 min-w-0">
          <button
            type="button"
            onClick={() => setWsDropdownOpen(!wsDropdownOpen)}
            aria-haspopup="listbox"
            aria-expanded={wsDropdownOpen}
            className="flex items-center gap-1.5 h-9 w-full rounded-md border border-border bg-bg-input px-3 cursor-pointer hover:border-accent-brand/40 transition-colors"
          >
            <WorkspaceIcon size={12} className="shrink-0 text-accent-brand" />
            {selectedWs ? (
              <span className="text-xs text-text-emphasis truncate flex-1 text-left">{selectedWs.name}</span>
            ) : (
              <span className="text-xs text-text-secondary truncate flex-1 text-left">{t('home:selectWorkspace')}</span>
            )}
            <ChevronDown size={10} className={cn(
              'shrink-0 text-text-secondary transition-transform',
              wsDropdownOpen && 'rotate-180',
            )} />
          </button>

          {wsDropdownOpen && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-border bg-bg-elevated shadow-lg overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-border-subtle">
                <Search size={12} className="shrink-0 text-text-secondary" />
                <input
                  value={wsSearch}
                  onChange={(e) => setWsSearch(e.target.value)}
                  placeholder={t('home:searchPlaceholder')}
                  autoFocus
                  className="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
                />
              </div>
              <div className="max-h-56 overflow-y-auto py-1">
                {filteredWorkspaces.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-text-secondary">{t('home:noMatch')}</div>
                ) : (
                  filteredWorkspaces.map((ws) => {
                    const isSelected = selectedWsId === ws.id
                    return (
                      <button
                        key={ws.id}
                        onClick={() => { setSelectedWsId(ws.id); setWsDropdownOpen(false); setWsSearch('') }}
                        className={cn(
                          'flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors hover:bg-bg-hover-muted',
                          isSelected && 'bg-bg-hover-muted',
                        )}
                      >
                        <WorkspaceIcon size={12} className="shrink-0 text-accent-brand" />
                        <span className="text-xs text-text-primary truncate flex-1">{ws.name}</span>
                        <span className="text-xs text-text-secondary shrink-0">
                          {ws.repositories.length} repo{ws.repositories.length !== 1 ? 's' : ''}
                        </span>
                        {isSelected && <Check size={12} className="shrink-0 text-accent-green" />}
                      </button>
                    )
                  })
                )}
                <button
                  onClick={() => {
                    setWsDropdownOpen(false)
                    setWsSearch('')
                    window.dispatchEvent(new CustomEvent(WS_EVENTS.OPEN_CREATE_MODAL))
                  }}
                  className="flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors hover:bg-bg-hover-muted border-t border-border-subtle mt-1 pt-1.5"
                >
                  <Plus size={12} className="shrink-0 text-accent-brand" />
                  <span className="text-xs text-accent-brand">{t('home:createWorkspace')}</span>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Agent */}
        <div ref={agentBoxRef} className="relative flex-1 min-w-0">
          <button
            type="button"
            onClick={() => agents.length > 0 && setAgentDropdownOpen(!agentDropdownOpen)}
            disabled={agents.length === 0}
            aria-haspopup="listbox"
            aria-expanded={agentDropdownOpen}
            className="flex items-center gap-1.5 h-9 w-full rounded-md border border-border bg-bg-input px-3 cursor-pointer hover:border-accent-brand/40 transition-colors disabled:cursor-not-allowed disabled:opacity-60"
          >
            {selectedAgent ? (
              <>
                <AgentAvatar name={selectedAgent.name} agentId={selectedAgent.id} size="sm" />
                <span className="text-xs text-text-emphasis truncate flex-1 text-left">{selectedAgent.name}</span>
              </>
            ) : (
              <span className="text-xs text-text-secondary truncate flex-1 text-left">
                {agents.length === 0 ? t('home:noAgents') : t('home:selectAgent')}
              </span>
            )}
            <ChevronDown size={10} className={cn(
              'shrink-0 text-text-secondary transition-transform',
              agentDropdownOpen && 'rotate-180',
            )} />
          </button>

          {agentDropdownOpen && agents.length > 0 && (
            <div className="absolute top-full left-0 right-0 mt-1 z-50 rounded-md border border-border bg-bg-elevated shadow-lg overflow-hidden">
              <div className="max-h-56 overflow-y-auto py-1">
                {agents.map((agent) => {
                  const isSelected = selectedAgentIdState === agent.id
                  return (
                    <Tooltip key={agent.id} delayDuration={400}>
                      <TooltipTrigger asChild>
                        <button
                          onClick={() => { handleAgentSelect(agent.id); setAgentDropdownOpen(false) }}
                          className={cn(
                            'flex items-center gap-2 w-full px-3 py-1.5 text-left transition-colors hover:bg-bg-hover-muted',
                            isSelected && 'bg-bg-hover-muted',
                          )}
                        >
                          <AgentAvatar name={agent.name} agentId={agent.id} size="sm" />
                          <span className="text-xs text-text-primary truncate flex-1">{agent.name}</span>
                          <span className={cn(
                            'text-[10px] px-1 py-px rounded-sm font-mono shrink-0',
                            agent.provider === 'codex'
                              ? 'bg-accent-brand/10 text-accent-brand'
                              : 'bg-accent-orange/10 text-accent-orange',
                          )}>
                            {agent.provider === 'codex' ? 'Codex' : 'CC'}
                          </span>
                          {isSelected && <Check size={12} className="shrink-0 text-accent-green" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right" className="max-w-[220px]">
                        {agent.description || agent.name}
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* Model */}
        <div className="w-[130px] shrink-0">
          <Select value={model} onValueChange={setModel}>
            <SelectTrigger className="h-9 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableModels.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Start — full-width primary CTA below the inline config row. */}
      <button
        onClick={handleCreate}
        disabled={!selectedWs || creating}
        className="w-full inline-flex items-center justify-center gap-1.5 rounded-md bg-accent-brand h-9 text-sm font-medium text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {creating ? (
          <Loader2 size={14} className="animate-spin" />
        ) : (
          <ArrowRight size={14} />
        )}
        {t('home:startChat')}
      </button>

      {/* Keyboard shortcut hint — surfaces the ⌘N entry that mirrors this dialog. */}
      <div className="flex items-center justify-center gap-1.5 pt-1 text-text-muted">
        <kbd className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded border border-border bg-bg-input font-mono text-[10px]">⌘</kbd>
        <kbd className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded border border-border bg-bg-input font-mono text-[10px]">N</kbd>
        <span className="text-[11px] ml-1">{t('workspace:newChat.shortcutHint')}</span>
      </div>
    </div>
  )
}

export default NewChatForm
