/**
 * Tray Preload — contextBridge API for the macOS tray-panel renderer.
 *
 * Exposes a minimal API: `openMission(chatId)` for card clicks,
 * `openWorkbench()` for the empty-state CTA, and `getServerPort()` so
 * the renderer can talk to the WS / REST endpoints without hardcoding
 * the port.
 */

import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('trayBridge', {
  openMission: (chatId: string) => {
    ipcRenderer.send('tray:open-mission', { chatId })
  },
  openWorkbench: () => {
    ipcRenderer.send('tray:open-workbench')
  },
  getServerPort: (): Promise<number> => ipcRenderer.invoke('tray:get-server-port'),
})
