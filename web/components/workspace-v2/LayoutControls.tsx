import { useWorkspace } from '../../contexts/WorkspaceContext'
import { cn } from '../../lib/utils'

const LayoutControls = () => {
  const { layoutMode, setLayoutMode } = useWorkspace()

  return (
    <div className="flex items-center gap-px p-0.5 rounded-[5px] bg-white/[0.03] border border-border">
      <LayoutBtn active={layoutMode === 'single'} onClick={() => setLayoutMode('single')} title="Chat only (⌘\\)">
        <svg width={10} height={10} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </LayoutBtn>
      <LayoutBtn active={layoutMode === 'split'} onClick={() => setLayoutMode('split')} title="Chat + IDE (⌘\\)">
        <svg width={10} height={10} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <line x1="9" y1="1" x2="9" y2="15" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </LayoutBtn>
      <LayoutBtn active={layoutMode === 'quad'} onClick={() => setLayoutMode('quad')} title="Quad (⌘\\)">
        <svg width={10} height={10} viewBox="0 0 16 16" fill="none">
          <rect x="1" y="1" width="14" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <line x1="8" y1="1" x2="8" y2="15" stroke="currentColor" strokeWidth="1.5" />
          <line x1="1" y1="8" x2="15" y2="8" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </LayoutBtn>
    </div>
  )
}

const LayoutBtn = ({ active, onClick, title, children }: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) => (
  <button
    className={cn(
      'w-[22px] h-[18px] rounded-[3px] flex items-center justify-center cursor-pointer transition-colors',
      active ? 'bg-accent-brand/[0.15] text-accent-brand-light' : 'text-text-muted hover:bg-white/[0.06]',
    )}
    onClick={onClick}
    title={title}
  >
    {children}
  </button>
)

export default LayoutControls
