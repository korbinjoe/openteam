/** Electron preload  Bridge API  */
interface OpenTeamBridge {
  // Main → Renderer StatusListen（Back unsubscribe Function）
  onAgentStatus: (callback: (data: unknown) => void) => () => void
  onNotification: (callback: (data: unknown) => void) => () => void
  onNavigateToChat: (callback: (data: { chatId: string }) => void) => () => void

  openWorkbench: () => void

  onUpdateStatus: (callback: (data: unknown) => void) => () => void
  onUpdateAvailable: (callback: (data: unknown) => void) => () => void
  onUpdateApplying: (callback: (data: unknown) => void) => () => void
  onUpdateApplied: (callback: (data: unknown) => void) => () => void
  onUpdateError: (callback: (data: unknown) => void) => () => void
  checkForUpdates: () => void
  applyUpdate: () => void

  getPreventSleep: () => Promise<boolean>
  setPreventSleep: (enabled: boolean) => Promise<boolean>

  pickDirectory: () => Promise<string | null>
}

declare global {
  interface Window {
    openteamBridge?: OpenTeamBridge
  }
}

export {}
