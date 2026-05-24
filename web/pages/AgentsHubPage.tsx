import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Users, Plus, RefreshCw, ShoppingBag, Loader2 } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import type { Agent } from '../types/agentConfig'
import { isElectron, ELECTRON_TITLEBAR_PADDING } from '../utils/env'
import {
  hireAgent, fireAgent, initDefaultHiredAgents,
} from '../utils/teamStorage'
import { API_BASE, authFetch } from '@/config/api'
import { AGENT_NEW_OPEN_AI_GENERATE_STATE_KEY } from '@/hooks/useAgentEditor'
import { TeamTab, MarketTab } from './AgentListSection'

type Tab = 'team' | 'market'

const AGENTS_BASE = '/agents'

const AgentsHubPage = () => {
  const { t } = useTranslation(['agents', 'common'])
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()

  const TABS: Array<{ value: Tab; label: string; icon: typeof Users }> = [
    { value: 'team', label: t('agents:tabs.team'), icon: Users },
    { value: 'market', label: t('agents:tabs.market'), icon: ShoppingBag },
  ]

  const activeTab = (searchParams.get('tab') as Tab) || 'team'

  const [agents, setAgents] = useState<Agent[]>([])
  const [hiredIds, setHiredIds] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  // Dialogs
  const [fireConfirmOpen, setFireConfirmOpen] = useState(false)
  const [fireTarget, setFireTarget] = useState<Agent | null>(null)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null)
  const [cloneModalOpen, setCloneModalOpen] = useState(false)
  const [cloneSource, setCloneSource] = useState<Agent | null>(null)
  const [cloneName, setCloneName] = useState('')

  const fetchAgents = useCallback(async () => {
    setLoading(true)
    try {
      const res = await authFetch(`${API_BASE}/api/agents`)
      if (!res.ok) throw new Error()
      setAgents(await res.json())
    } catch {
      toast.error(t('agents:fetchFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchAgents() }, [fetchAgents])

  useEffect(() => {
    if (agents.length === 0) return
    initDefaultHiredAgents(agents).then(setHiredIds)
  }, [agents])

  const handleTabChange = (tab: Tab) => {
    if (tab === 'team') {
      setSearchParams({})
    } else {
      setSearchParams({ tab })
    }
    setSearch('')
  }

  // -- Team members (hired) --
  const teamMembers = useMemo(
    () => agents.filter((a) => hiredIds.includes(a.id)),
    [agents, hiredIds],
  )

  // -- Market agents (all agents, with hire status) --
  const marketAgents = useMemo(() => {
    let list = [...agents]
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter((a) =>
        a.name.toLowerCase().includes(q)
        || a.description.toLowerCase().includes(q)
        || a.tags?.some((t) => t.toLowerCase().includes(q)),
      )
    }
    return list
  }, [agents, search])

  const marketBuiltin = useMemo(() => marketAgents.filter((a) => a.source === 'builtin'), [marketAgents])
  const marketUser = useMemo(() => marketAgents.filter((a) => a.source === 'user'), [marketAgents])

  // -- Actions --
  const handleHire = async (agent: Agent) => {
    const updated = await hireAgent(agent.id)
    setHiredIds(updated)
    toast.success(t('agents:toast.hired', { name: agent.name }))
  }

  const handleFireClick = (agent: Agent) => {
    setFireTarget(agent)
    setFireConfirmOpen(true)
  }

  const confirmFire = async () => {
    if (!fireTarget) return
    const updated = await fireAgent(fireTarget.id)
    setHiredIds(updated)
    toast.success(t('agents:toast.fired', { name: fireTarget.name }))
    setFireConfirmOpen(false)
    setFireTarget(null)
  }

  const handleDeleteClick = (agent: Agent) => {
    setDeleteTarget(agent)
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      const res = await authFetch(`${API_BASE}/api/agents/${encodeURIComponent(deleteTarget.id)}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success(t('agents:toast.deleted', { name: deleteTarget.name }))
      fetchAgents()
    } catch {
      toast.error(t('agents:toast.actionFailed'))
    } finally {
      setDeleteConfirmOpen(false)
      setDeleteTarget(null)
    }
  }

  const handleCloneClick = (agent: Agent) => {
    setCloneSource(agent)
    setCloneName(`${agent.name}-copy`)
    setCloneModalOpen(true)
  }

  const submitClone = async () => {
    if (!cloneSource || !cloneName.trim()) return
    try {
      const res = await authFetch(
        `${API_BASE}/api/agents/${encodeURIComponent(cloneSource.id)}/clone`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: cloneName.trim() }),
        },
      )
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error || t('agents:toast.cloneFailed'))
        return
      }
      toast.success(t('agents:toast.cloneSuccess'))
      setCloneModalOpen(false)
      fetchAgents()
    } catch {
      toast.error(t('agents:toast.cloneFailedRetry'))
    }
  }

  return (
    <div className="flex flex-col h-full bg-bg-primary">
      {/* Header */}
      <div
        className={cn(
          'h-9 border-b border-border-subtle flex items-center px-2.5 gap-1.5 shrink-0',
          isElectron && '-webkit-app-region-drag',
        )}
        style={{ paddingLeft: isElectron ? ELECTRON_TITLEBAR_PADDING : 14 }}
      >
        <Users size={14} className="text-text-emphasis" />
        <span className="text-xs font-semibold text-text-emphasis">{t('agents:title')}</span>

        {/* Tab switcher */}
        <div className="-webkit-app-region-no-drag flex gap-0.5 ml-1">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => handleTabChange(tab.value)}
              tabIndex={0}
              aria-label={tab.label}
              className={cn(
                'px-2.5 py-[3px] rounded-sm border-none text-xs cursor-pointer transition-all inline-flex items-center gap-1',
                activeTab === tab.value
                  ? 'bg-accent-brand/15 text-accent-brand font-medium'
                  : 'bg-transparent text-text-secondary font-normal hover:text-text-primary',
              )}
            >
              <tab.icon size={11} />
              {tab.label}
              {tab.value === 'team' && !loading && (
                <span className="text-xs opacity-70">({teamMembers.length})</span>
              )}
            </button>
          ))}
        </div>

        <span className="flex-1" />

        {/* Actions */}
        <div className="-webkit-app-region-no-drag flex items-center gap-1">
          <button
            onClick={fetchAgents}
            title={t('common:action.refresh')}
            aria-label={t('common:action.refresh')}
            tabIndex={0}
            className="inline-flex items-center justify-center rounded px-1.5 py-1 text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={() => navigate(`${AGENTS_BASE}/new/edit`, {
              state: { [AGENT_NEW_OPEN_AI_GENERATE_STATE_KEY]: true },
            })}
            aria-label={t('agents:recruitNew')}
            tabIndex={0}
            className="inline-flex items-center gap-1 rounded bg-accent-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={12} />
            {t('agents:recruitNew')}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-[1000px] mx-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-text-secondary text-sm">
              <Loader2 size={16} className="animate-spin" />
              {t('agents:loadingAgents')}
            </div>
          ) : activeTab === 'team' ? (
            <TeamTab
              members={teamMembers}
              onClickAgent={(a) => navigate(`${AGENTS_BASE}/${encodeURIComponent(a.id)}/edit`)}
              onFire={handleFireClick}
              onEdit={(a) => navigate(`${AGENTS_BASE}/${encodeURIComponent(a.id)}/edit`)}
              onGoMarket={() => handleTabChange('market')}
            />
          ) : (
            <MarketTab
              builtinAgents={marketBuiltin}
              userAgents={marketUser}
              hiredIds={hiredIds}
              search={search}
              onSearchChange={setSearch}
              onHire={handleHire}
              onFire={handleFireClick}
              onEdit={(a) => navigate(`${AGENTS_BASE}/${encodeURIComponent(a.id)}/edit`)}
              onDelete={handleDeleteClick}
              onClone={handleCloneClick}
            />
          )}
        </div>
      </div>

      {/* Fire Confirm Dialog */}
      <Dialog open={fireConfirmOpen} onOpenChange={setFireConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('agents:dialog.fire.title', { name: fireTarget?.name })}</DialogTitle>
            <DialogDescription>{t('agents:dialog.fire.desc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setFireConfirmOpen(false)}
              className="rounded px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              {t('common:action.cancel')}
            </button>
            <button
              onClick={confirmFire}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            >
              {t('agents:dialog.fire.confirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('agents:dialog.delete.title', { name: deleteTarget?.name })}</DialogTitle>
            <DialogDescription>{t('agents:dialog.delete.desc')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setDeleteConfirmOpen(false)}
              className="rounded px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              {t('common:action.cancel')}
            </button>
            <button
              onClick={confirmDelete}
              className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            >
              {t('agents:dialog.delete.confirm')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Clone Dialog */}
      <Dialog open={cloneModalOpen} onOpenChange={setCloneModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('agents:dialog.clone.title', { name: cloneSource?.name })}</DialogTitle>
            <DialogDescription>{t('agents:dialog.clone.desc')}</DialogDescription>
          </DialogHeader>
          <div className="mt-3">
            <div className="text-xs mb-1.5 text-text-secondary">{t('agents:dialog.clone.nameLabel')}</div>
            <input
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
              placeholder={t('agents:dialog.clone.namePlaceholder')}
              onKeyDown={(e) => { if (e.key === 'Enter') submitClone() }}
              className="w-full rounded-md border border-border bg-bg-input px-3 py-1.5 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent-brand"
            />
          </div>
          <DialogFooter>
            <button
              onClick={() => setCloneModalOpen(false)}
              className="rounded px-3 py-1.5 text-xs text-text-secondary hover:text-text-primary transition-colors"
            >
              {t('common:action.cancel')}
            </button>
            <button
              onClick={submitClone}
              disabled={!cloneName.trim()}
              className="rounded bg-accent-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t('agents:dialog.clone.submit')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

export default AgentsHubPage
