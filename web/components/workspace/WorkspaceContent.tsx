import { useEffect, useRef, useState } from 'react'
import { useWorkspace, IDE_WIDTH_DEFAULT } from '../../contexts/WorkspaceContext'
import { useWorkspaceChats } from '../../hooks/useWorkspaceChats'
import ChatPane from './ChatPane'
import IDEPanel from './IDEPanel'
import QuadAgentTile from './QuadAgentTile'
import ResizeHandle from './ResizeHandle'
import { Plus } from './icons'

// Quad tiles MiniAgentPanes (which don't mount ChatInstance), so we keep an
// off-screen ChatPane to feed the IDE portal source. Single/split layouts render
// ChatPane + IdeRegion at stable React positions (see UnifiedFrame).
const HiddenChatPortalSource = () => (
  <div
    aria-hidden
    style={{
      position: 'absolute',
      left: '-99999px',
      top: 0,
      width: '1px',
      height: '1px',
      overflow: 'hidden',
      pointerEvents: 'none',
    }}
  >
    <ChatPane />
  </div>
)

// Split mode chat-width breakpoint:
// 44% gives IDE room for code review at >=1280px; below that chat <400px wraps badly,
// so fall back to 50/50. Subscribed to resize for true reactivity.
const SPLIT_NARROW_BREAKPOINT = 1280

const useSplitChatWidth = (): string => {
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.innerWidth < SPLIT_NARROW_BREAKPOINT,
  )
  useEffect(() => {
    const handle = () => setIsNarrow(window.innerWidth < SPLIT_NARROW_BREAKPOINT)
    window.addEventListener('resize', handle)
    return () => window.removeEventListener('resize', handle)
  }, [])
  return isNarrow ? 'w-1/2' : 'w-[44%]'
}

const WorkspaceContent = () => {
  const { layoutMode, ideCollapsed, activeChatId } = useWorkspace()

  if (!activeChatId) {
    return <ChatPane />
  }

  if (layoutMode === 'quad') {
    return <QuadFrame ideCollapsed={ideCollapsed} />
  }

  return <UnifiedFrame layoutMode={layoutMode} ideCollapsed={ideCollapsed} />
}

/** Stable frame for single/split layouts. ChatPane and IdeRegion stay put. */
const UnifiedFrame = ({
  layoutMode,
  ideCollapsed,
}: {
  layoutMode: 'single' | 'split'
  ideCollapsed: boolean
}) => {
  const splitChatWidth = useSplitChatWidth()

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden">
      <ChatColumn
        key="chat"
        layoutMode={layoutMode}
        ideCollapsed={ideCollapsed}
        splitChatWidth={splitChatWidth}
      >
        <ChatPane />
      </ChatColumn>
      <IdeRegion key="ide" mode={layoutMode} collapsed={ideCollapsed} />
    </div>
  )
}

const ChatColumn = ({
  layoutMode,
  ideCollapsed,
  splitChatWidth,
  children,
}: {
  layoutMode: 'single' | 'split'
  ideCollapsed: boolean
  splitChatWidth: string
  children: React.ReactNode
}) => {
  if (layoutMode === 'single') {
    return <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>
  }
  return (
    <SplitChatContainer ideCollapsed={ideCollapsed} fallbackWidthClass={splitChatWidth}>
      {children}
    </SplitChatContainer>
  )
}

// Chat container in split mode — supports drag-to-resize via right-edge handle.
// chatSplitWidth (px) overrides the percentage-based fallback. When ide is collapsed,
// chat fills remaining space (flex-1) so resize handle is suppressed (nothing to resize against).
const SplitChatContainer = ({
  ideCollapsed,
  fallbackWidthClass,
  children,
}: {
  ideCollapsed: boolean
  fallbackWidthClass: string
  children: React.ReactNode
}) => {
  const { chatSplitWidth, setChatSplitWidth } = useWorkspace()
  const containerRef = useRef<HTMLDivElement>(null)

  if (ideCollapsed) {
    return <div className="flex-1 flex flex-col overflow-hidden min-w-0">{children}</div>
  }

  const hasCustomWidth = chatSplitWidth !== null
  const widthClass = hasCustomWidth ? '' : fallbackWidthClass
  const widthStyle = hasCustomWidth ? { width: chatSplitWidth } : undefined

  // Measure current rendered width for the resize start point. When chatSplitWidth is null
  // we read offsetWidth from the DOM so the first drag delta lands on top of the actual
  // rendered percentage width — no jump.
  const getMeasuredWidth = () => containerRef.current?.offsetWidth ?? 600

  return (
    <div
      ref={containerRef}
      className={`${widthClass} flex flex-col overflow-hidden border-r border-border-subtle relative flex-shrink-0`}
      style={widthStyle}
    >
      {children}
      <ResizeHandle
        side="right"
        getStartWidth={getMeasuredWidth}
        onResize={setChatSplitWidth}
        onReset={() => setChatSplitWidth(null)}
        ariaLabel="Resize chat / IDE divider"
      />
    </div>
  )
}

const IdeRegion = ({ mode, collapsed }: { mode: 'single' | 'split' | 'quad'; collapsed: boolean }) => {
  const { idePanelWidth, setIdePanelWidth } = useWorkspace()

  // Collapsed: 36px strip in all modes
  // Expanded: split mode uses flex-1 (large IDE — chat<->ide ratio governed by chat width),
  // single/quad use a user-resizable fixed width (peripheral panel)
  if (collapsed) {
    return <IDEPanel />
  }
  if (mode === 'split') {
    return (
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <IDEPanel />
      </div>
    )
  }
  return (
    <div className="flex flex-col flex-shrink-0 overflow-hidden relative" style={{ width: idePanelWidth }}>
      <ResizeHandle
        side="left"
        currentWidth={idePanelWidth}
        onResize={setIdePanelWidth}
        onReset={() => setIdePanelWidth(IDE_WIDTH_DEFAULT)}
        ariaLabel="Resize IDE panel"
      />
      <IDEPanel />
    </div>
  )
}

/** Quad: 2×2 of the active mission's agent members.
 *  No active mission → guidance placeholder + empty IDE. >4 members → first 3 + "more".
 *  HiddenChatPortalSource feeds the IDE portal (MiniAgentPanes don't mount ChatInstance). */
const QuadFrame = ({ ideCollapsed }: { ideCollapsed: boolean }) => {
  const QUAD_SIZE = 4
  const { workspaceId, activeChatId, openAddAgent } = useWorkspace()
  const { chats } = useWorkspaceChats(workspaceId)
  const chat = activeChatId ? chats.find((c) => c.id === activeChatId) : undefined
  const members = chat?.members ?? []
  const total = members.length
  const handleAdd = () => { if (activeChatId) openAddAgent(activeChatId) }

  return (
    <div className="flex-1 flex min-h-0 overflow-hidden relative">
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div className="flex-1 grid grid-cols-2 grid-rows-2 gap-px bg-border overflow-hidden min-w-0">
          {!chat ? (
            <NoTaskHint />
          ) : total >= QUAD_SIZE ? (
            <>
              {members.slice(0, 3).map((m, i) => (
                <QuadAgentTile key={m.agentId} member={m} parentChat={chat} shortcutKey={String(i + 1)} />
              ))}
              <MoreAgentsSlot count={total - 3} />
            </>
          ) : (
            <>
              {members.map((m, i) => (
                <QuadAgentTile key={m.agentId} member={m} parentChat={chat} shortcutKey={String(i + 1)} />
              ))}
              {Array.from({ length: QUAD_SIZE - total }).map((_, i) => (
                <AddAgentSlot key={`add-${i}`} onClick={handleAdd} />
              ))}
            </>
          )}
        </div>
        <IdeRegion mode="quad" collapsed={ideCollapsed} />
      </div>
      {activeChatId && <HiddenChatPortalSource />}
    </div>
  )
}

const NoTaskHint = () => (
  <div className="col-span-2 row-span-2 bg-bg-primary flex flex-col items-center justify-center gap-2 text-text-muted px-6 text-center">
    <div className="text-xs text-text-secondary">No mission selected</div>
    <div className="text-[11px] text-text-muted max-w-[320px] leading-relaxed">
      Quad shows the agents of the active mission side-by-side. Pick a mission from the sidebar to populate this view.
    </div>
  </div>
)

const AddAgentSlot = ({ onClick }: { onClick?: () => void }) => (
  <button
    type="button"
    aria-label="Add agent to this mission"
    onClick={onClick}
    disabled={!onClick}
    className="bg-bg-primary flex items-center justify-center text-text-muted text-[11px] hover:bg-bg-hover hover:text-text-secondary transition-colors group disabled:opacity-50 disabled:cursor-not-allowed"
  >
    <Plus size={12} className="mr-1.5 opacity-60 group-hover:opacity-100 transition-opacity" />
    Add Agent
  </button>
)

const MoreAgentsSlot = ({ count }: { count: number }) => (
  <button
    type="button"
    aria-label={`Show ${count} more agent${count > 1 ? 's' : ''}`}
    className="bg-bg-primary flex flex-col items-center justify-center text-text-muted hover:bg-bg-hover hover:text-text-secondary transition-colors gap-0.5"
  >
    <span className="font-mono text-[16px] tabular-nums text-text-secondary">+{count}</span>
    <span className="text-[10px]">more</span>
  </button>
)

export default WorkspaceContent
