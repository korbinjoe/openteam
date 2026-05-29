import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '../../contexts/ThemeContext'
import { History, Handshake, Zap, Repeat, FolderGit, Moon, Sun, Bell, Settings } from './icons'
import { API_BASE, authFetch } from '@/config/api'

const useResourceCounts = () => {
  const [counts, setCounts] = useState({ agents: 0, skills: 0, cronJobs: 0, workspaces: 0 })

  useEffect(() => {
    const controller = new AbortController()
    const { signal } = controller
    Promise.all([
      authFetch(`${API_BASE}/api/agents`, { signal }).then((r) => r.ok ? r.json() : []).catch(() => []),
      authFetch(`${API_BASE}/api/skills`, { signal }).then((r) => r.ok ? r.json() : []).catch(() => []),
      authFetch(`${API_BASE}/api/cron-jobs`, { signal }).then((r) => r.ok ? r.json() : []).catch(() => []),
      authFetch(`${API_BASE}/api/workspaces`, { signal }).then((r) => r.ok ? r.json() : []).catch(() => []),
    ]).then(([agents, skills, cronJobs, workspaces]) => {
      if (signal.aborted) return
      setCounts({
        agents: agents.length,
        skills: skills.length,
        cronJobs: cronJobs.length,
        workspaces: workspaces.length,
      })
    }).catch(() => {})
    return () => controller.abort()
  }, [])

  return counts
}

/** All resource pages live at single canonical top-level URLs. The sidebar
 *  navigates with absolute paths; the active workspace context is preserved
 *  by the shared sidebar shell rather than by URL prefix. */

export const ResourcesSection = () => {
  const navigate = useNavigate()
  const counts = useResourceCounts()
  return (
    <div className="px-1.5 py-1.5 border-t border-border-subtle">
      <ResourceItem icon={<Handshake size={14} />} label="Team"       count={counts.agents}     onClick={() => navigate('/agents')} />
      <ResourceItem icon={<Zap size={14} />}       label="Skills"     count={counts.skills}     onClick={() => navigate('/skills')} />
      <ResourceItem icon={<Repeat size={14} />}    label="Schedules"  count={counts.cronJobs}   onClick={() => navigate('/cron-jobs')} />
      <ResourceItem icon={<FolderGit size={14} />} label="Workspaces" count={counts.workspaces} onClick={() => navigate('/workspaces')} />
    </div>
  )
}

const ResourceItem = ({ icon, label, count, onClick }: {
  icon: React.ReactNode
  label: string
  count?: number
  onClick?: () => void
}) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-bg-hover transition-colors group"
  >
    <span className="text-text-muted group-hover:text-text-secondary transition-colors">{icon}</span>
    <span className="text-[12px] text-text-primary flex-1 text-left">{label}</span>
    {count != null && count > 0 && (
      <span className="text-[11px] text-text-muted tabular-nums">{count}</span>
    )}
  </button>
)

const SidebarFooter = () => {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  return (
    <div className="px-2 py-1.5 border-t border-border-subtle flex items-center gap-1">
      <IconBtn title="Mission History" onClick={() => navigate('/missions')}><History size={14} /></IconBtn>
      <span className="flex-1" />
      <IconBtn
        title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        onClick={toggleTheme}
      >
        {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
      </IconBtn>
      <IconBtn title="Notifications">
        <Bell size={14} />
      </IconBtn>
      <IconBtn title="Settings" onClick={() => navigate('/settings')}><Settings size={14} /></IconBtn>
    </div>
  )
}

const IconBtn = ({ children, title, onClick }: { children: React.ReactNode; title: string; onClick?: () => void }) => (
  <button
    onClick={onClick}
    className="w-8 h-8 rounded-md flex items-center justify-center cursor-pointer text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors relative"
    title={title}
    aria-label={title}
  >
    {children}
  </button>
)

export default SidebarFooter
