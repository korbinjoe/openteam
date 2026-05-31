/// <reference types="vite/client" />

declare const __APP_VERSION__: string

/** Electron preload  Bridge API electron/preload.ts  */
interface OpenTeamBridge {
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

interface Window {
  openteamBridge?: OpenTeamBridge
}

declare module '*.css' {
  const content: string
  export default content
}

declare module '*.module.css' {
  const classes: { [key: string]: string }
  export default classes
}
