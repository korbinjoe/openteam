/**
 * Electron Main Process
 *
 * WindowManager / TrayManager / ShortcutManager / IPCBridge
 */

import { app, dialog, Menu } from 'electron'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
import { WindowManager } from './modules/WindowManager'
import { TrayManager } from './modules/TrayManager'
import { ShortcutManager } from './modules/ShortcutManager'
import { IPCBridge } from './modules/IPCBridge'
import { PowerSaveManager } from './modules/PowerSaveManager'
import { UpdateBridge } from './modules/UpdateBridge'
import { NotchManager } from './modules/NotchManager'
import { PORTS } from '../shared/ports'

import { existsSync, readlinkSync } from 'fs'
import { OPENTEAM_HOME } from '../shared/openteam-home'

const isDev = !app.isPackaged
let isQuitting = false
let bootstrapServerPort = PORTS.DEV_SERVER

if (!isDev) {
  const gotLock = app.requestSingleInstanceLock()
  if (!gotLock) {
    app.quit()
  }
}

/**  server  Electron fire-and-forget */
const sendElectronTelemetry = (category: string, event: string, properties?: Record<string, unknown>): void => {
  if (!bootstrapServerPort) return
  fetch(`http://localhost:${bootstrapServerPort}/api/telemetry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category, event, properties: { source: 'electron', ...properties } }),
  }).catch(() => {})
}
const preloadPath = join(dirname(fileURLToPath(import.meta.url)), 'preload.cjs')
const notchPreloadPath = join(dirname(fileURLToPath(import.meta.url)), 'notch-preload.cjs')

/**
 * 
 *  app.asar.unpacked/node_modules
 *  Node.js
 */
function setupNativeModulePaths() {
  if (isDev) return

  const require = createRequire(import.meta.url)
  const resourcesPath = process.resourcesPath || join(dirname(app.getPath('exe')), '..', 'Resources')
  const unpackedPath = join(resourcesPath, 'app.asar.unpacked', 'node_modules')
  const asarPath = join(resourcesPath, 'app.asar', 'node_modules')

  console.log('[Electron] Native module paths debug:', {
    resourcesPath,
    unpackedPath,
    unpackedExists: existsSync(unpackedPath),
    asarPath,
  })

  if (existsSync(unpackedPath)) {
    const nodePath = process.env.NODE_PATH || ''
    process.env.NODE_PATH = unpackedPath + (nodePath ? `:${nodePath}` : '')
    require('module').Module._initPaths()
    console.log(`[Electron] Added native module path: ${unpackedPath}`)
    console.log(`[Electron] NODE_PATH is now: ${process.env.NODE_PATH}`)
  } else {
    console.error('[Electron] Unpacked path does not exist:', unpackedPath)
    sendElectronTelemetry('system', 'electron.native_path_missing', { unpackedPath })
  }
}

setupNativeModulePaths()

/**
 *  server bundle
 *  ~/.openteam/current/server/  server
 */
const resolveServerBundle = (): string => {
  const currentLink = join(OPENTEAM_HOME, 'current')
  if (existsSync(currentLink)) {
    try {
      const target = readlinkSync(currentLink)
      const serverDir = join(target, 'server')
      const serverIndex = join(serverDir, 'index.js')
      if (existsSync(serverIndex)) {
        return serverIndex
      }
    } catch {
    }
  }
  return '../server/index.js'
}

const windowManager = new WindowManager()
const trayManager = new TrayManager(windowManager)
const shortcutManager = new ShortcutManager(windowManager)
const powerSaveManager = new PowerSaveManager()
const ipcBridge = new IPCBridge(windowManager, trayManager)
const updateBridge = new UpdateBridge(windowManager)
let notchManager: NotchManager | null = null

// Trigger representedObject is not a WeakPtrToElectronMenuModelAsNSObject Warning
if (process.platform === 'darwin') {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]))
}

async function bootstrap() {
  if (!isDev) {
    process.env.ELECTRON = '1'

    const { tryConnectDaemon } = await import('../cli/lib/daemonConnect.js') as typeof import('../cli/lib/daemonConnect')
    const daemon = await tryConnectDaemon()
    if (daemon) {
      bootstrapServerPort = daemon.port
      console.log(`[Electron] Connected to daemon on port: ${bootstrapServerPort}`)
    } else {
      const serverPath = resolveServerBundle()
      console.log(`[Electron] Loading server from: ${serverPath}`)

      try {
        const { startServer } = await import(serverPath) as { startServer: (port?: number) => Promise<number> }
        bootstrapServerPort = await startServer(PORTS.DYNAMIC)
        console.log(`[Electron] Server started on port: ${bootstrapServerPort}`)
      } catch (err) {
        console.error('[Electron] Failed to start server:', err)
        sendElectronTelemetry('system', 'electron.server_start_failed', { error: err instanceof Error ? err.message : String(err) })
        throw err
      }
    }
  }

  const mainWindow = windowManager.createMainWindow(bootstrapServerPort, isDev, preloadPath, { deferShow: true })

  mainWindow.webContents.once('did-finish-load', () => {
    mainWindow.show()
  })

  trayManager.setServerPort(bootstrapServerPort)
  trayManager.create()

  shortcutManager.register()

  ipcBridge.setPowerSaveManager(powerSaveManager)
  ipcBridge.setup()
  ipcBridge.connectToServer(bootstrapServerPort)

  updateBridge.setup(bootstrapServerPort)

  // if (process.platform === 'darwin') {
  //   notchManager = new NotchManager(windowManager, bootstrapServerPort, isDev, notchPreloadPath)
  //   notchManager.init()
  //   shortcutManager.setNotchManager(notchManager)
  //   const mainWindow = windowManager.getMainWindow()
  //   mainWindow?.on('enter-full-screen', () => notchManager?.hide())
  //   mainWindow?.on('leave-full-screen', () => notchManager?.show())
  // }

  if (process.platform === 'darwin') {
    const mainWindow = windowManager.getMainWindow()
    mainWindow?.on('close', (e) => {
      if (isQuitting) return
      e.preventDefault()
      mainWindow.hide()
    })
  }
}

if (!isDev) {
  app.on('second-instance', () => {
    windowManager.focusMain()
  })
}

app.whenReady().then(bootstrap).catch((err) => {
  console.error('[Electron] Bootstrap failed:', err)
  sendElectronTelemetry('system', 'electron.bootstrap_failed', { error: err instanceof Error ? err.message : String(err) })
  dialog.showErrorBox(
    'OpenTeam StartFailed',
    `Server startup error. Check logs and retry.\n\n${err instanceof Error ? err.message : String(err)}`,
  )
  app.quit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (windowManager.getMainWindow()) {
    windowManager.focusMain()
  } else {
    windowManager.createMainWindow(bootstrapServerPort, isDev, preloadPath)
  }
})

app.on('before-quit', () => {
  isQuitting = true
  notchManager?.destroy()
  shortcutManager.unregisterAll()
  updateBridge.destroy()
  powerSaveManager.destroy()
  ipcBridge.destroy()
  trayManager.destroy()
})
