import { useNavigate } from 'react-router-dom'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { useTheme } from '../../contexts/ThemeContext'
import { History, Handshake, Zap, Repeat, FolderGit, Moon, Sun, Bell, Settings } from './icons'

/** Build a URL that stays inside the workspace context when available,
 *  falling back to the top-level resource routes when no workspace is
 *  loaded (e.g. on the empty-workspace landing page). */
const useResourcePrefix = (): string => {
  const { workspaceId } = useWorkspace()
  return workspaceId ? `/workspace/${workspaceId}` : ''
}

export const ResourcesSection = () => {
  const navigate = useNavigate()
  const prefix = useResourcePrefix()
  return (
    <div className="px-1.5 py-1.5 border-t border-border-subtle">
      <ResourceItem icon={<Handshake size={14} />} label="Team"       onClick={() => navigate(`${prefix}/agents`)} />
      <ResourceItem icon={<Zap size={14} />}       label="Skills"     onClick={() => navigate(`${prefix}/skills`)} />
      <ResourceItem icon={<Repeat size={14} />}    label="Schedules"  onClick={() => navigate(`${prefix}/cron-jobs`)} />
      <ResourceItem icon={<FolderGit size={14} />} label="Workspaces" onClick={() => navigate(`${prefix}/workspaces`)} />
    </div>
  )
}

const ResourceItem = ({ icon, label, onClick }: {
  icon: React.ReactNode
  label: string
  onClick?: () => void
}) => (
  <button
    onClick={onClick}
    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-bg-hover transition-colors group"
  >
    <span className="text-text-muted group-hover:text-text-secondary transition-colors">{icon}</span>
    <span className="text-[12px] text-text-primary flex-1 text-left">{label}</span>
  </button>
)

const SidebarFooter = () => {
  const navigate = useNavigate()
  const prefix = useResourcePrefix()
  const { theme, toggleTheme } = useTheme()
  return (
    <div className="px-2 py-1.5 border-t border-border-subtle flex items-center gap-1">
      <IconBtn title="History" onClick={() => navigate(`${prefix}/chats`)}><History size={14} /></IconBtn>
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
      <IconBtn title="Settings" onClick={() => navigate(`${prefix}/settings`)}><Settings size={14} /></IconBtn>
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
