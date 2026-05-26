interface TrayBridgeApi {
  openMission: (chatId: string) => void
  openWorkbench: () => void
  getServerPort: () => Promise<number>
}

interface Window {
  trayBridge?: TrayBridgeApi
}
