import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWorkspace, SIDEBAR_WIDTH_DEFAULT } from '../../contexts/WorkspaceContext'
import { isMacElectron } from '../../utils/env'
import TaskSessionList from './TaskSessionList'
import SidebarFooter, { ResourcesSection } from './SidebarFooter'
import ResizeHandle from './ResizeHandle'
import { ChevronLeft, ChevronRight, Plus, Handshake, Zap, Repeat, FolderGit, Settings, Search } from './icons'

interface TaskSidebarProps {
  collapsed: boolean
}

const TaskSidebar = ({ collapsed }: TaskSidebarProps) => {
  const { togglePanel, sidebarWidth, setSidebarWidth, openNewTask, workspaceId } = useWorkspace()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')

  const resourcePrefix = workspaceId ? `/workspace/${workspaceId}` : ''
  const goResource = (slug: string) => () => navigate(`${resourcePrefix}/${slug}`)

  if (collapsed) {
    return (
      <div className="w-[52px] bg-bg-secondary border-r border-border-subtle flex flex-col flex-shrink-0 transition-[width] duration-200 ease-out">
        {/* Header — logo + expand button */}
        <div
          className={`${isMacElectron ? 'pt-[30px]' : 'pt-2'} pb-1 flex flex-col items-center gap-1.5 border-b border-border-subtle`}
        >
          <button
            onClick={() => navigate('/')}
            className="flex items-center justify-center w-8 h-8 rounded-md hover:bg-bg-hover transition-colors cursor-pointer"
            title="Back to home"
            aria-label="Back to home"
          >
            <Logo size={20} />
          </button>
          <button
            onClick={togglePanel}
            className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors"
            title="Expand sidebar (⌘B)"
            aria-label="Expand sidebar"
          >
            <ChevronRight size={14} />
          </button>
        </div>

        {/* New Task — icon-only */}
        <div className="py-2 flex flex-col items-center">
          <button
            onClick={openNewTask}
            className="w-8 h-8 rounded-md flex items-center justify-center text-text-primary hover:bg-bg-hover transition-colors"
            title="New Task (⌘N)"
            aria-label="New Task"
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="flex-1" />

        {/* Resources — icon-only (preserved per user request to keep bottom as-is) */}
        <div className="py-1.5 flex flex-col items-center gap-0.5 border-t border-border-subtle">
          <CollapsedIconBtn title="Team"       onClick={goResource('agents')}><Handshake size={14} /></CollapsedIconBtn>
          <CollapsedIconBtn title="Skills"     onClick={goResource('skills')}><Zap size={14} /></CollapsedIconBtn>
          <CollapsedIconBtn title="Schedules"  onClick={goResource('cron-jobs')}><Repeat size={14} /></CollapsedIconBtn>
          <CollapsedIconBtn title="Workspaces" onClick={goResource('workspaces')}><FolderGit size={14} /></CollapsedIconBtn>
        </div>

        {/* Footer — settings only */}
        <div className="py-1.5 flex flex-col items-center border-t border-border-subtle">
          <CollapsedIconBtn title="Settings" onClick={goResource('settings')}><Settings size={14} /></CollapsedIconBtn>
        </div>
      </div>
    )
  }

  return (
    <div
      className="bg-bg-secondary border-r border-border-subtle flex flex-col flex-shrink-0 relative"
      style={{ width: sidebarWidth }}
    >
      {/* Header — logo + collapse + new task button */}
      <div className="px-2.5 pt-2 pb-2 border-b border-border-subtle">
        <div
          className={`flex items-center gap-2 pr-2.5 pb-2 ${isMacElectron ? 'pl-[78px]' : 'pl-2.5'}`}
        >
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 rounded-md -ml-1 px-1 py-0.5 hover:bg-bg-hover transition-colors cursor-pointer"
            title="Back to home"
            aria-label="Back to home"
          >
            <Logo size={20} />
            <span className="font-nunito text-[13px] font-extrabold text-text-primary">OpenTeam</span>
          </button>
          <span className="flex-1" />
          <button
            onClick={togglePanel}
            className="w-[22px] h-[22px] rounded-md flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors"
            title="Collapse sidebar (⌘B)"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft size={12} />
          </button>
        </div>
        <button
          onClick={openNewTask}
          className="w-full flex items-center gap-2 px-2.5 py-[7px] rounded-md hover:bg-bg-hover transition-colors group"
        >
          <Plus size={14} className="text-text-primary" />
          <span className="text-[13px] font-medium text-text-primary flex-1 text-left">New Task</span>
          <span className="font-mono text-[11px] text-text-muted">⌘N</span>
        </button>
        <div className="relative mt-1.5">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
            placeholder="Search tasks…"
            aria-label="Search tasks"
            className="w-full bg-bg-tertiary text-[12px] text-text-primary placeholder:text-text-muted rounded-md pl-7 pr-7 py-[6px] outline-none border border-transparent focus:border-border focus:bg-bg-primary transition-colors"
          />
          {query && (
            <button
              onClick={() => setQuery('')}
              title="Clear (Esc)"
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-hover text-[12px] leading-none"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Scrollable task list — grouped by workspace */}
      <div className="flex-1 overflow-y-auto min-h-0 px-1.5 py-1">
        <TaskSessionList query={query} />
      </div>

      {/* Resources */}
      <ResourcesSection />

      {/* Footer */}
      <SidebarFooter />

      <ResizeHandle
        side="right"
        currentWidth={sidebarWidth}
        onResize={setSidebarWidth}
        onReset={() => setSidebarWidth(SIDEBAR_WIDTH_DEFAULT)}
        ariaLabel="Resize sidebar"
      />
    </div>
  )
}

const CollapsedIconBtn = ({ children, title, onClick }: {
  children: React.ReactNode
  title: string
  onClick?: () => void
}) => (
  <button
    onClick={onClick}
    className="w-8 h-8 rounded-md flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors"
    title={title}
    aria-label={title}
  >
    {children}
  </button>
)

const Logo = ({ size }: { size: number }) => (
  <svg width={size} height={size} viewBox="0 0 352 352" fill="none">
    <rect width="352" height="352" rx="56" fill="rgb(var(--accent-brand))" />
    <rect x="75" y="92" width="202" height="48" rx="24" fill="white" />
    <rect x="150" y="92" width="52" height="192" rx="26" fill="white" />
  </svg>
)

export default TaskSidebar
