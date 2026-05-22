import { useCallback, useEffect } from 'react'
import { useWorkspace } from '../../contexts/WorkspaceContext'
import { Folder, Flag, FolderGit } from './icons'
import { cn } from '../../lib/utils'
import { useWarRoomCounts } from './WarRoomPanel'
import { useWorkspaceMeta } from '../../hooks/useWorkspaceMeta'
import useMultiRepoGitStatus from '../../hooks/useMultiRepoGitStatus'

// V2 IDE column is a thin wrapper:
//   • Expanded → portals ChatInstance's native WebIDEPanel (which owns the single
//     File|War room|Browser|Changes + Terminal tab bar — no second outer tab bar).
//   • Collapsed → 36px peripheral strip with quick-jump icons.
//
// The IDE collapse/expand control lives in the unified WorkspaceToolbar so the
// IDE column never grows a second-level header.

type StripTab = 'IDE' | 'War Room'

interface StripMeta {
  icon: typeof Folder
  badge?: { count: number; tone: 'brand' | 'warn' | 'green' | 'red' }
}

const STRIP_TABS: StripTab[] = ['IDE', 'War Room']

// Maps strip-icon clicks → WebIDEPanel inner viewTab so collapsed → expanded
// lands on the user's intended tab. WebIDEPanel listens via `ide:set-tab`.
const STRIP_TAB_TO_INNER: Record<StripTab, 'files' | 'whiteboard'> = {
  IDE: 'files',
  'War Room': 'whiteboard',
}

const STRIP_BADGE_TONE: Record<NonNullable<StripMeta['badge']>['tone'], string> = {
  brand: 'bg-accent-brand text-white',
  warn:  'bg-accent-yellow text-bg-primary',
  green: 'bg-accent-green text-white',
  red:   'bg-accent-red text-white',
}

const useStripMeta = (): Record<StripTab, StripMeta> => {
  const { open: warRoomOpen } = useWarRoomCounts()
  const { totalChangedFiles } = useWorkspaceGitAggregate()
  return {
    IDE:        { icon: Folder, badge: { count: totalChangedFiles, tone: 'green' } },
    'War Room': { icon: Flag, badge: { count: warRoomOpen, tone: 'warn' } },
  }
}

/** Workspace-level git aggregate badge — uses workspace repos directly (no worktree).
 *  Per-chat worktree-aware diffs live inside the embedded WebIDEPanel. */
const useWorkspaceGitAggregate = () => {
  const { workspaceId, activeChatId } = useWorkspace()
  const { meta } = useWorkspaceMeta(workspaceId)
  const repos = meta?.repositories ?? []
  const { aggregate } = useMultiRepoGitStatus({
    worktreeSessions: [],
    agentActivity: null,
    repositories: repos,
    chatId: activeChatId ?? undefined,
  })
  return aggregate
}

const IDEPanel = () => {
  const { ideCollapsed } = useWorkspace()
  return ideCollapsed ? <CollapsedStrip /> : <ExpandedPanel />
}

const CollapsedStrip = () => {
  const { toggleIde } = useWorkspace()
  const STRIP_META = useStripMeta()

  const handleTabClick = (tab: StripTab) => {
    toggleIde()
    // Defer: WebIDEPanel needs to be mounted before listening for the tab event.
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('ide:set-tab', { detail: { tab: STRIP_TAB_TO_INNER[tab] } }))
    })
  }

  return (
    <div className="w-9 flex-shrink-0 border-l border-border-subtle bg-bg-secondary flex flex-col items-center pt-2 pb-2 select-none">
      {STRIP_TABS.map((tab) => {
        const meta = STRIP_META[tab]
        const Icon = meta.icon
        return (
          <button
            key={tab}
            onClick={() => handleTabClick(tab)}
            title={`${tab} (⌘J)`}
            className="w-7 h-7 my-0.5 rounded flex items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors relative group"
          >
            <Icon size={14} />
            {meta.badge && meta.badge.count > 0 && (
              <span className={cn(
                'absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] rounded-full text-[10px] font-mono font-semibold flex items-center justify-center px-1 border-[1.5px] border-bg-secondary tabular-nums leading-none',
                STRIP_BADGE_TONE[meta.badge.tone],
              )}>
                {meta.badge.count}
              </span>
            )}
          </button>
        )
      })}
      <div className="flex-1" />
      <span className="font-mono text-[10px] text-text-muted mt-1.5">⌘J</span>
    </div>
  )
}

// Expanded panel is a pure mount point — WebIDEPanel (portalled from
// ChatInstance) owns the only tab bar in this column.
const ExpandedPanel = () => {
  const { activeChatId, setIdeMountNode } = useWorkspace()
  const hasChat = !!activeChatId

  const mountRef = useCallback((node: HTMLDivElement | null) => {
    setIdeMountNode(node)
  }, [setIdeMountNode])

  useEffect(() => () => setIdeMountNode(null), [setIdeMountNode])

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden border-l border-border-subtle">
      {hasChat ? (
        <div ref={mountRef} className="flex-1 min-h-0 overflow-hidden flex flex-col" />
      ) : (
        <EmptyState />
      )}
    </div>
  )
}

const EmptyState = () => (
  <div className="flex-1 flex flex-col items-center justify-center gap-2 text-text-muted px-6 text-center">
    <FolderGit size={32} className="opacity-60" />
    <div className="text-xs text-text-secondary">No task selected</div>
    <div className="text-[11px] text-text-muted max-w-[260px] leading-relaxed">
      Pick a task from the sidebar to see its files, terminal, browser preview, and git changes.
    </div>
  </div>
)

export default IDEPanel
