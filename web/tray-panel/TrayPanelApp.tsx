import { useTrayMissions } from './useTrayMissions'
import { MissionCard } from './MissionCard'

export const TrayPanelApp = () => {
  const missions = useTrayMissions()

  const handleOpenMission = (chatId: string) => {
    window.trayBridge?.openMission(chatId)
  }

  const handleOpenWorkbench = () => {
    window.trayBridge?.openWorkbench()
  }

  return (
    <div className="flex h-full w-full flex-col rounded-xl bg-bg-elevated/95 shadow-2xl ring-1 ring-border-subtle backdrop-blur-md">
      <header className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-xs font-medium text-text-secondary">Active Missions</span>
        <span className="text-[11px] text-text-muted">{missions.length}</span>
      </header>

      {missions.length === 0 ? (
        <EmptyState onOpenWorkbench={handleOpenWorkbench} />
      ) : (
        <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
          {missions.map((mission) => (
            <MissionCard
              key={mission.chatId}
              mission={mission}
              onOpen={() => handleOpenMission(mission.chatId)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const EmptyState = ({ onOpenWorkbench }: { onOpenWorkbench: () => void }) => (
  <div className="flex flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
    <p className="text-sm text-text-muted">No active missions</p>
    <button
      type="button"
      onClick={onOpenWorkbench}
      className="text-xs text-text-secondary underline-offset-2 hover:underline"
    >
      Open OpenTeam
    </button>
  </div>
)
