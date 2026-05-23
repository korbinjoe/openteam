export const isElectron = navigator.userAgent.includes('Electron')

export const isMacElectron =
  isElectron && typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

/** Electron  macOS
 *  68px8px + 3×12px + 2×8px + 8px
 *  48pxw-1268 - 48 = 20px
 */
export const ELECTRON_TITLEBAR_PADDING = 30
