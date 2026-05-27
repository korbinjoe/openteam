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
}

interface NotchBridge {
  onStateChange: (cb: (state: 'compact' | 'expanded' | 'hidden') => void) => () => void
  onNotification: (cb: (data: { agentName: string; message: string }) => void) => () => void
  setIgnoreMouseEvents: (ignore: boolean, opts?: { forward: boolean }) => void
  notchAction: (action: 'expand' | 'compact' | 'hide') => void
  sendQuickCommand: (message: string) => void
  openWorkbench: () => void
}

declare global {
  interface Window {
    openteamBridge?: OpenTeamBridge
    notchBridge?: NotchBridge
  }
}

export {}
