import { useState } from 'react'
import { createPortal } from 'react-dom'
import { X, RefreshCw, GripHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDevPanel } from '@/hooks/useDevPanel'
import { useDragResizePanel } from './panels/useDragResizePanel'
import { DevOverviewTab } from './panels/DevOverviewTab'
import { DevWorkflowTab } from './panels/DevWorkflowTab'
import { DevAgentsTab } from './panels/DevAgentsTab'
import { DevProtocolTab } from './panels/DevProtocolTab'
import { DevEventsTab } from './panels/DevEventsTab'

type DevTab = 'overview' | 'workflow' | 'agents' | 'protocol' | 'events'

const TAB_ITEMS: Array<{ id: DevTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'agents', label: 'Agents' },
  { id: 'protocol', label: 'Protocol' },
  { id: 'events', label: 'Events' },
]

interface DevPanelProps {
  chatId: string
  chatTitle?: string
  isOpen: boolean
  onClose: () => void
}

const DevPanel = ({ chatId, chatTitle, isOpen, onClose }: DevPanelProps) => {
  const {
    snapshot, events, jsonlStreams, rawJsonlCache,
    pipeline, timeline, workflow, whiteboard,
    refreshSnapshot, clearEvents, requestRawJsonl,
  } = useDevPanel(chatId, isOpen)
  const { layout, handleDragStart, handleResizeStart } = useDragResizePanel()
  const [activeTab, setActiveTab] = useState<DevTab>('overview')

  if (!isOpen) return null

  const renderTabContent = () => {
    if (!snapshot) {
      return (
        <div className="flex items-center justify-center h-32 text-xs text-zinc-600">
          Connecting...
        </div>
      )
    }

    switch (activeTab) {
      case 'overview':
        return (
          <DevOverviewTab
            snapshot={snapshot}
            workflow={workflow}
            whiteboard={whiteboard}
            pipeline={pipeline}
          />
        )
      case 'workflow':
        return <DevWorkflowTab workflow={workflow} />
      case 'agents':
        return (
          <DevAgentsTab
            snapshot={snapshot}
            jsonlStreams={jsonlStreams}
            rawJsonlCache={rawJsonlCache}
            onRequestRaw={requestRawJsonl}
          />
        )
      case 'protocol':
        return <DevProtocolTab events={events} timeline={timeline} />
      case 'events':
        return <DevEventsTab events={events} onClear={clearEvents} />
    }
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: layout.x,
        top: layout.y,
        width: layout.w,
        height: layout.h,
        zIndex: 9999,
      }}
      className="bg-zinc-950 border border-zinc-800 rounded-lg flex flex-col shadow-2xl relative"
    >
      {/* Header */}
      <div
        onMouseDown={handleDragStart}
        className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 shrink-0 cursor-grab active:cursor-grabbing select-none"
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripHorizontal size={12} className="text-zinc-600 shrink-0" />
          <span className="text-xs font-medium text-zinc-200 shrink-0">DevPanel</span>
          {chatTitle && <span className="text-[10px] text-zinc-400 truncate">— {chatTitle}</span>}
          <span className="text-[10px] text-zinc-600 font-mono shrink-0">{chatId.slice(0, 8)}</span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={refreshSnapshot} className="text-zinc-500 hover:text-zinc-300 p-1" title="Refresh">
            <RefreshCw size={12} />
          </button>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-300 p-1" title="Close">
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="flex items-center border-b border-zinc-800 shrink-0 px-1">
        {TAB_ITEMS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              'px-2.5 py-1.5 text-[11px] font-medium border-b-2 transition-colors',
              activeTab === tab.id
                ? 'text-zinc-200 border-blue-500'
                : 'text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700',
            )}
          >
            {tab.label}
          </button>
        ))}
        {pipeline && (
          <div className="ml-auto pr-2 flex items-center gap-1">
            <div className={cn(
              'w-1.5 h-1.5 rounded-full',
              pipeline.health === 'green' ? 'bg-green-400' :
              pipeline.health === 'yellow' ? 'bg-yellow-400 animate-pulse' :
              'bg-red-400',
            )} />
          </div>
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {renderTabContent()}
      </div>

      {/* Footer */}
      <div className="px-3 py-1.5 border-t border-zinc-800 text-[10px] text-zinc-600 shrink-0 rounded-b-lg">
        <span>⌘⇧D to toggle</span>
      </div>

      {/* Resize handles */}
      <div onMouseDown={handleResizeStart('right')} className="absolute top-0 right-0 w-1 h-full cursor-ew-resize" />
      <div onMouseDown={handleResizeStart('bottom')} className="absolute bottom-0 left-0 h-1 w-full cursor-ns-resize" />
      <div onMouseDown={handleResizeStart('corner')} className="absolute bottom-0 right-0 w-3 h-3 cursor-nwse-resize" />
    </div>,
    document.body,
  )
}

export default DevPanel
