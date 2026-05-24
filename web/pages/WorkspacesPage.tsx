import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { TFunction } from 'i18next'
import {
  Plus, Search, RefreshCw, Trash2, Pencil, Check, X,
  Clock, Loader2, MessageSquare,
} from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import AgentAvatar from '@/components/ui/agent-avatar'
import WorkspaceIcon from '@/components/icons/WorkspaceIcon'
import CreateWorkspaceDialog from '@/components/home/CreateWorkspaceDialog'
import DirPickerDialog from '@/components/home/DirPickerDialog'
import { loadDirHistory, saveDirHistory } from '@/components/home/storage'
import { useDirPicker } from '../hooks/useDirPicker'
import { isElectron, ELECTRON_TITLEBAR_PADDING } from '../utils/env'

import { API_BASE, authFetch } from '@/config/api'

interface WorkspaceInfo {
  id: string
  name: string
  repositories: Array<{ path: string; name: string }>
  agentTeam?: { primaryAgentId: string; teamAgentIds: string[] }
  chatCount: number
  lastAccessedAt: string
  createdAt: string
}

const WORKSPACE_BASE = '/workspace'

const WorkspacesPage = () => {
  const navigate = useNavigate()
  const { t } = useTranslation(['workspace', 'common'])
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<WorkspaceInfo | null>(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [createRepos, setCreateRepos] = useState<string[]>([])
  const [creating, setCreating] = useState(false)
  const [dirHistory, setDirHistory] = useState<string[]>(() => loadDirHistory())
  const dirPicker = useDirPicker(dirHistory)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const wsRes = await authFetch(`${API_BASE}/api/workspaces`)
      if (wsRes.ok) setWorkspaces(await wsRes.json())
    } catch {
      toast.error(t('workspace:loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const filtered = useMemo(() => {
    if (!search.trim()) return workspaces
    const q = search.toLowerCase()
    return workspaces.filter((ws) =>
      ws.name.toLowerCase().includes(q)
      || ws.repositories.some((r) => r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)),
    )
  }, [workspaces, search])

  const handleDelete = (ws: WorkspaceInfo) => {
    setDeleteTarget(ws)
    setDeleteConfirmOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      const res = await authFetch(`${API_BASE}/api/workspaces/${deleteTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error()
      toast.success(t('workspace:list.deleted'))
      fetchData()
    } catch {
      toast.error(t('workspace:list.deleteFailed'))
    } finally {
      setDeleteConfirmOpen(false)
      setDeleteTarget(null)
    }
  }

  const handleRename = async (ws: WorkspaceInfo, newName: string) => {
    try {
      const res = await authFetch(`${API_BASE}/api/workspaces/${ws.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName }),
      })
      if (!res.ok) throw new Error()
      setWorkspaces((prev) => prev.map((w) => w.id === ws.id ? { ...w, name: newName } : w))
      toast.success(t('workspace:renamed'))
    } catch {
      toast.error(t('workspace:renameFailed'))
    }
  }

  const handleCreate = async (andStart: boolean) => {
    if (!createName.trim() || createRepos.length === 0) return
    setCreating(true)
    try {
      const res = await authFetch(`${API_BASE}/api/workspaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          repositories: createRepos.map((p) => ({ path: p })),
        }),
      })
      if (!res.ok) throw new Error()
      const ws = await res.json()
      toast.success(t('workspace:list.created'))
      setCreateOpen(false)
      if (andStart) {
        navigate(`${WORKSPACE_BASE}/${ws.id}`)
      } else {
        fetchData()
      }
    } catch {
      toast.error(t('workspace:list.createFailed'))
    } finally {
      setCreating(false)
    }
  }

  const openCreateDialog = () => {
    setCreateName('')
    setCreateRepos([])
    setCreateOpen(true)
  }

  const handleAddRepoToCreateWs = () => {
    dirPicker.openDirPickerForCreateWs()
  }

  const handlePickDir = (path: string) => {
    setDirHistory(saveDirHistory(path))
    dirPicker.setDirModalOpen(false)
    dirPicker.setPickingForCreateWs(false)
    setCreateRepos((prev) => prev.includes(path) ? prev : [...prev, path])
    setCreateName((prev) => prev || path.split('/').pop() || '')
  }

  const handleQuickSelectRepo = (path: string) => {
    setCreateRepos((prev) => prev.includes(path) ? prev : [...prev, path])
    setCreateName((prev) => prev || path.split('/').pop() || '')
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
        <WorkspaceIcon size={14} className="text-text-emphasis" />
        <span className="text-xs text-text-emphasis font-semibold -webkit-app-region-no-drag">
          {t('workspace:title')}
        </span>

        <div className="-webkit-app-region-no-drag flex-1 max-w-[240px] flex items-center gap-[6px] bg-bg-input border border-border rounded-md px-2.5 py-1">
          <Search size={12} className="text-text-secondary shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('workspace:list.searchPlaceholder')}
            className="bg-transparent border-none outline-none text-text-primary text-xs w-full"
          />
        </div>

        <span className="flex-1" />

        <div className="-webkit-app-region-no-drag flex gap-1">
          <button
            onClick={fetchData}
            title={t('common:action.refresh')}
            aria-label={t('common:action.refresh')}
            tabIndex={0}
            className="inline-flex items-center justify-center rounded px-1.5 py-1 text-text-secondary hover:text-text-primary hover:bg-white/5 transition-colors"
          >
            <RefreshCw size={12} />
          </button>
          <button
            onClick={openCreateDialog}
            aria-label={t('workspace:list.createWorkspace')}
            tabIndex={0}
            className="inline-flex items-center gap-1 rounded bg-accent-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus size={12} />
            {t('common:action.new')}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-[960px] mx-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-2 p-10 text-text-secondary text-sm">
              <Loader2 size={16} className="animate-spin" />
              {t('workspace:list.loadingWorkspaces')}
            </div>
          ) : (
            <>
              {/* Workspace list */}
              {filtered.length === 0 && !search ? (
                <div className="flex flex-col items-center gap-3 p-10 text-center border border-dashed border-border rounded-md">
                  <WorkspaceIcon size={32} className="text-text-secondary opacity-40" />
                  <div className="text-sm text-text-secondary">{t('workspace:list.noWorkspaces')}</div>
                  <button
                    onClick={openCreateDialog}
                    aria-label={t('workspace:list.createWorkspace')}
                    tabIndex={0}
                    className="inline-flex items-center gap-1.5 rounded-md bg-accent-brand px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
                  >
                    <Plus size={12} />
                    {t('workspace:list.createWorkspace')}
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center p-10 text-text-secondary text-[13px]">
                  {t('workspace:list.noMatch')}
                </div>
              ) : (
                <div className="mb-6">
                  <div className="text-xs font-semibold uppercase tracking-[0.8px] text-text-secondary mb-2.5">
                    {t('workspace:list.allWorkspaces', { count: filtered.length })}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    {filtered.map((ws) => (
                      <WorkspaceCard
                        key={ws.id}
                        workspace={ws}
                        onOpen={() => navigate(`${WORKSPACE_BASE}/${ws.id}`)}
                        onDelete={() => handleDelete(ws)}
                        onRename={(newName) => handleRename(ws, newName)}
                      />
                    ))}
                  </div>
                </div>
              )}

            </>
          )}
        </div>
      </div>

      {/* Delete Confirm Dialog */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('workspace:deleteDialog.title', { name: deleteTarget?.name })}</DialogTitle>
            <DialogDescription>{t('workspace:deleteDialog.desc')}</DialogDescription>
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
              className="rounded bg-accent-red px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 transition-opacity"
            >
              {t('common:action.delete')}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CreateWorkspaceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        name={createName}
        onNameChange={setCreateName}
        repos={createRepos}
        creating={creating}
        dirHistory={dirHistory}
        onAddRepo={handleAddRepoToCreateWs}
        onRemoveRepo={(path) => setCreateRepos((prev) => prev.filter((p) => p !== path))}
        onQuickSelectRepo={handleQuickSelectRepo}
        onCreate={handleCreate}
      />

      <DirPickerDialog
        open={dirPicker.dirModalOpen}
        onOpenChange={(open) => { dirPicker.setDirModalOpen(open); if (!open) dirPicker.setPickingForCreateWs(false) }}
        browsePath={dirPicker.browsePath}
        homeDir={dirPicker.homeDir}
        dirs={dirPicker.dirs}
        loadingDirs={dirPicker.loadingDirs}
        dirSearch={dirPicker.dirSearch}
        onDirSearchChange={dirPicker.setDirSearch}
        searchResults={dirPicker.searchResults}
        searchLoading={dirPicker.searchLoading}
        newFolderMode={dirPicker.newFolderMode}
        onNewFolderModeChange={dirPicker.setNewFolderMode}
        newFolderName={dirPicker.newFolderName}
        onNewFolderNameChange={dirPicker.setNewFolderName}
        newFolderError={dirPicker.newFolderError}
        onNewFolderErrorChange={dirPicker.setNewFolderError}
        pickingForCreateWs={dirPicker.pickingForCreateWs}
        onLoadDirs={dirPicker.loadDirs}
        onPickAndLaunch={handlePickDir}
        onCreateFolder={() => dirPicker.handleCreateFolder(handlePickDir)}
      />
    </div>
  )
}

/* -- Workspace Card -------------------------------------- */

const WorkspaceCard = ({ workspace, onOpen, onDelete, onRename }: {
  workspace: WorkspaceInfo
  onOpen: () => void
  onDelete: () => void
  onRename: (newName: string) => void
}) => {
  const { t } = useTranslation(['workspace', 'common'])
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const startRename = () => {
    setDraft(workspace.name)
    setIsEditing(true)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const handleSave = () => {
    const trimmed = draft.trim()
    setIsEditing(false)
    if (!trimmed || trimmed === workspace.name) return
    onRename(trimmed)
  }

  const handleCancel = () => {
    setIsEditing(false)
    setDraft(workspace.name)
  }

  return (
    <div
      onClick={() => { if (!isEditing) onOpen() }}
      role="button"
      tabIndex={0}
      aria-label={t('workspace:list.openWorkspace', { name: workspace.name })}
      onKeyDown={(e) => { if (!isEditing && (e.key === 'Enter' || e.key === ' ')) onOpen() }}
      className="group px-3.5 py-2.5 rounded-md cursor-pointer border border-border bg-transparent hover:bg-bg-hover-subtle transition-[background] duration-150 flex items-center gap-2.5 relative"
    >
      <WorkspaceIcon size={16} className="text-text-secondary shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            {isEditing ? (
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave()
                    if (e.key === 'Escape') handleCancel()
                  }}
                  onBlur={handleSave}
                  className="text-sm font-medium text-text-emphasis bg-bg-input border border-accent-brand rounded px-1.5 py-0.5 outline-none w-[200px]"
                />
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleSave}
                  aria-label={t('workspace:confirmRename')}
                  tabIndex={0}
                  className="p-0.5 rounded text-accent-green hover:bg-bg-hover-muted transition-colors"
                >
                  <Check size={12} />
                </button>
                <button
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={handleCancel}
                  aria-label={t('workspace:cancelRename')}
                  tabIndex={0}
                  className="p-0.5 rounded text-text-secondary hover:bg-bg-hover-muted transition-colors"
                >
                  <X size={12} />
                </button>
              </div>
            ) : (
              <span className="text-sm font-medium text-text-emphasis truncate">
                {workspace.name}
              </span>
            )}
            {workspace.id === 'default' && (
              <span className="text-xs px-1.5 py-px rounded bg-accent-brand/10 text-accent-brand shrink-0">
                Default
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-text-secondary">
              {t('workspace:list.repoCount', { count: workspace.repositories.length })}
            </span>
            <span className="text-xs text-text-secondary flex items-center gap-[3px]">
              <MessageSquare size={10} />
              {t('workspace:list.chatCount', { count: workspace.chatCount })}
            </span>
            {workspace.agentTeam && (
              <span className="flex -space-x-1 shrink-0">
                <AgentAvatar name={workspace.agentTeam.primaryAgentId} agentId={workspace.agentTeam.primaryAgentId} size="xs" />
                {workspace.agentTeam.teamAgentIds?.map((name) => (
                  <AgentAvatar key={name} name={name} agentId={name} size="xs" />
                ))}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-text-secondary">
            {workspace.repositories.map((r) => r.name).join(', ')}
          </span>
          <span className="text-xs text-text-secondary flex items-center gap-[3px] shrink-0">
            <Clock size={10} /> {relativeTime(new Date(workspace.lastAccessedAt).getTime(), t)}
          </span>
        </div>
      </div>

      <div
        className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={startRename}
          title={t('common:action.rename')}
          aria-label={t('workspace:renameWorkspace')}
          tabIndex={0}
          className="bg-transparent border-none cursor-pointer text-text-secondary p-[5px] rounded-sm flex items-center transition-all hover:bg-bg-hover-muted hover:text-text-primary"
        >
          <Pencil size={11} />
        </button>
        {workspace.id !== 'default' && (
          <button
            onClick={onDelete}
            title={t('common:action.delete')}
            aria-label={t('workspace:list.deleteWorkspace')}
            tabIndex={0}
            className="bg-transparent border-none cursor-pointer text-text-secondary p-[5px] rounded-sm flex items-center transition-all hover:bg-bg-hover-muted hover:text-accent-red"
          >
            <Trash2 size={11} />
          </button>
        )}
      </div>
    </div>
  )
}

function relativeTime(ts: number, t: TFunction): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return t('common:time.justNow')
  if (diff < 3_600_000) return t('common:time.minutesAgo', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('common:time.hoursAgo', { count: Math.floor(diff / 3_600_000) })
  return t('common:time.daysAgo', { count: Math.floor(diff / 86_400_000) })
}

export default WorkspacesPage
