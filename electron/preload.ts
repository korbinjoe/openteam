/**
 * Preload — Electron contextBridge API
 *
 *  Renderer  IPC
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'

const onIpc = (channel: string, callback: (data: unknown) => void): (() => void) => {
  const handler = (_event: IpcRendererEvent, data: unknown) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('openteamBridge', {
  // ─── Main → Renderer StatusListen（Back unsubscribe Function） ───
  onAgentStatus: (callback: (data: unknown) => void) => onIpc('companion:agent-status', callback),
  onNotification: (callback: (data: unknown) => void) => onIpc('companion:notification', callback),
  onNavigateToChat: (callback: (data: { chatId: string }) => void) => onIpc('companion:navigate-to-chat', callback),

  openWorkbench: () => {
    ipcRenderer.send('companion:open-workbench')
  },

  onUpdateStatus: (callback: (data: unknown) => void) => onIpc('update:status', callback),
  onUpdateAvailable: (callback: (data: unknown) => void) => onIpc('update:available', callback),
  onUpdateApplying: (callback: (data: unknown) => void) => onIpc('update:applying', callback),
  onUpdateApplied: (callback: (data: unknown) => void) => onIpc('update:applied', callback),
  onUpdateError: (callback: (data: unknown) => void) => onIpc('update:error', callback),
  checkForUpdates: () => {
    ipcRenderer.send('update:check-now')
  },
  applyUpdate: () => {
    ipcRenderer.send('update:apply-now')
  },

  getPreventSleep: () => ipcRenderer.invoke('power-save:get-enabled') as Promise<boolean>,
  setPreventSleep: (enabled: boolean) => ipcRenderer.invoke('power-save:set-enabled', enabled) as Promise<boolean>,

  pickDirectory: () => ipcRenderer.invoke('pick-directory') as Promise<string | null>,
})
