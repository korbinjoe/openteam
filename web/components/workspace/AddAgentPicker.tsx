import { useRef, useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useAgents } from '../../hooks/useAgents'
import { API_BASE, authFetch } from '@/config/api'
import { toast } from 'sonner'
import { Users } from './icons'
import { buildTaskUrl } from './urls'

const AddAgentPicker = () => {
  const { workspaceId, addAgentOpen, addAgentTaskId, closeAddAgent } = useWorkspace()
  const { availableAgents } = useAgents()
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [filter, setFilter] = useState('')
  const [busyAgentId, setBusyAgentId] = useState<string | null>(null)
  const [existingIds, setExistingIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (addAgentOpen) {
      setFilter('')
      setBusyAgentId(null)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [addAgentOpen])

  // Pre-load existing members so we can disable agents already on the task.
  useEffect(() => {
    if (!addAgentOpen || !addAgentTaskId) {
      setExistingIds(new Set())
      return
    }
    let cancelled = false
    authFetch(`${API_BASE}/api/chats/${addAgentTaskId}`)
      .then((res) => res.ok ? res.json() : null)
      .then((chat) => {
        if (cancelled || !chat) return
        const ids = new Set<string>()
        if (chat.primaryAgentId) ids.add(chat.primaryAgentId)
        for (const id of chat.teamAgentIds ?? []) ids.add(id)
        setExistingIds(ids)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [addAgentOpen, addAgentTaskId])

  const filteredAgents = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return availableAgents
    return availableAgents.filter((a) =>
      a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q),
    )
  }, [availableAgents, filter])

  if (!addAgentOpen) return null

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closeAddAgent()
  }

  const handleSelect = async (agentId: string) => {
    if (!addAgentTaskId || busyAgentId) return
    if (existingIds.has(agentId)) {
      toast.message('Agent already on this task')
      return
    }
    setBusyAgentId(agentId)
    try {
      const getRes = await authFetch(`${API_BASE}/api/chats/${addAgentTaskId}`)
      if (!getRes.ok) throw new Error('Chat not found')
      const chat = await getRes.json()
      const teamAgentIds: string[] = Array.isArray(chat.teamAgentIds) ? [...chat.teamAgentIds] : []
      if (chat.primaryAgentId === agentId || teamAgentIds.includes(agentId)) {
        toast.message('Agent already on this task')
        closeAddAgent()
        return
      }
      teamAgentIds.push(agentId)
      const putRes = await authFetch(`${API_BASE}/api/chats/${addAgentTaskId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamAgentIds }),
      })
      if (!putRes.ok) throw new Error('Update failed')
      window.dispatchEvent(new CustomEvent('openteam:chat-updated', {
        detail: { workspaceId, chatId: addAgentTaskId },
      }))
      toast.success('Agent added to task')
      closeAddAgent()
      // V2: each added agent gets its own 1:1 conversation thread. Jump to it
      // so the user immediately sees the independent surface, not the group.
      if (workspaceId) {
        navigate(buildTaskUrl(workspaceId, addAgentTaskId, agentId))
      }
    } catch (err) {
      console.error('[AddAgentPicker] add failed:', err)
      toast.error('Failed to add agent')
    } finally {
      setBusyAgentId(null)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-start justify-center pt-[16vh] z-[100]"
      onClick={handleBackdropClick}
    >
      <div className="w-[480px] border border-border rounded-xl bg-bg-secondary shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3.5 border-b border-border">
          <div className="flex items-center gap-2 mb-2.5">
            <Users size={14} className="text-accent-brand" />
            <span className="text-[13px] font-semibold text-text-primary">Add Agent to Task</span>
          </div>
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-full bg-bg-primary border border-border rounded-md px-3 py-2 outline-none text-xs text-text-primary font-sans placeholder:text-text-muted"
            placeholder="Search agents…"
            onKeyDown={(e) => { if (e.key === 'Escape') closeAddAgent() }}
          />
        </div>

        {/* Agent list */}
        <div className="p-2 max-h-[320px] overflow-y-auto">
          <div className="text-[10px] font-bold uppercase tracking-wider text-text-muted px-2.5 py-1.5">
            Select Agent
          </div>
          {filteredAgents.length === 0 ? (
            <div className="px-2.5 py-4 text-[11px] text-text-muted text-center">
              {availableAgents.length === 0 ? 'Loading agents…' : 'No agents match your search.'}
            </div>
          ) : filteredAgents.map((ag) => {
            const isMember = existingIds.has(ag.id)
            const isBusy = busyAgentId === ag.id
            const initial = (ag.icon || ag.name.slice(0, 1) || '?').slice(0, 1).toUpperCase()
            return (
              <button
                key={ag.id}
                type="button"
                disabled={isMember || isBusy}
                onClick={() => handleSelect(ag.id)}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md cursor-pointer hover:bg-bg-hover transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
              >
                <div className="w-7 h-7 rounded-md bg-accent-brand/[0.08] border border-border flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-accent-brand-light">{initial}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-text-primary font-medium truncate">{ag.name}</div>
                  <div className="text-[10px] text-text-muted mt-px line-clamp-1">{ag.description}</div>
                </div>
                {isBusy ? (
                  <span className="text-[10px] text-text-muted">Adding…</span>
                ) : isMember ? (
                  <span className="text-[10px] text-text-muted">Joined</span>
                ) : (
                  <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-text-muted">
                    <line x1="5" y1="12" x2="19" y2="12" />
                    <polyline points="12 5 19 12 12 19" />
                  </svg>
                )}
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border flex items-center gap-2">
          <span className="text-[10px] text-text-muted flex-1">Agent will inherit task context and war room.</span>
          <button
            className="px-2.5 py-1 rounded-[5px] border border-border bg-transparent text-text-secondary text-[10px] cursor-pointer"
            onClick={closeAddAgent}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

export default AddAgentPicker
