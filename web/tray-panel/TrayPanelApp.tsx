import { useTrayMissions } from './useTrayMissions'

export const TrayPanelApp = () => {
  const missions = useTrayMissions()

  const handleOpenMission = (chatId: string) => {
    window.trayBridge?.openMission(chatId)
  }

  const handleOpenWorkbench = () => {
    window.trayBridge?.openWorkbench()
  }

  return (
    <div className="flex h-full w-full flex-col rounded-lg bg-[#f6f6f6] shadow-xl ring-1 ring-black/10">
      {missions.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-6">
          <p className="text-[13px] text-[#86868b]">No active missions</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto py-1">
          {missions.map((mission, idx) => (
            <div key={mission.chatId}>
              <button
                type="button"
                onClick={() => handleOpenMission(mission.chatId)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/5 active:bg-black/8"
              >
                <MissionIcon phase={mission.topPhase} />
                <span className="flex-1 truncate text-[13px] text-[#1d1d1f]">
                  {mission.title}
                </span>
                <AgentCount count={mission.agents.filter(a => a.phase !== 'completed').length} />
              </button>
              {idx < missions.length - 1 && (
                <div className="mx-3 border-b border-black/5" />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-black/8">
        <button
          type="button"
          onClick={handleOpenWorkbench}
          className="flex w-full items-center px-3 py-2 text-[13px] text-[#1d1d1f] transition-colors hover:bg-black/5 active:bg-black/8"
        >
          Open OpenTeam
        </button>
      </div>
    </div>
  )
}

const MissionIcon = ({ phase }: { phase: string }) => {
  const isRunning = ['tool_running', 'thinking', 'responding', 'initializing'].includes(phase)
  const color = isRunning ? '#007aff' : phase === 'error' ? '#ff3b30' : '#86868b'

  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path
        d="M2 3.5C2 2.67 2.67 2 3.5 2h9c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5H5l-2.3 2.3a.5.5 0 0 1-.7-.35V3.5Z"
        fill={color}
        opacity={0.85}
      />
    </svg>
  )
}

const AgentCount = ({ count }: { count: number }) => {
  if (count <= 0) return null
  return (
    <span className="min-w-[18px] rounded-full bg-black/8 px-1.5 py-0.5 text-center text-[11px] font-medium text-[#86868b]">
      {count}
    </span>
  )
}
