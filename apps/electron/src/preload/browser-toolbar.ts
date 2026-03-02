/**
 * Preload script for browser toolbar windows.
 *
 * Exposes a minimal API for the React BrowserControls component
 * to send navigation actions and receive state updates from the
 * main process BrowserPaneManager.
 */

import { contextBridge, ipcRenderer } from 'electron'
import { BROWSER_TOOLBAR_CHANNELS as CHANNELS } from '../shared/types'

// Instance ID is passed via query parameter by BrowserPaneManager
const instanceId = new URLSearchParams(location.search).get('instanceId') || ''

contextBridge.exposeInMainWorld('browserToolbar', {
  instanceId,
  navigate: (url: string) => ipcRenderer.invoke(CHANNELS.NAVIGATE, instanceId, url),
  goBack: () => ipcRenderer.invoke(CHANNELS.GO_BACK, instanceId),
  goForward: () => ipcRenderer.invoke(CHANNELS.GO_FORWARD, instanceId),
  reload: () => ipcRenderer.invoke(CHANNELS.RELOAD, instanceId),
  stop: () => ipcRenderer.invoke(CHANNELS.STOP, instanceId),
  openWindowMenu: (x: number, y: number) => ipcRenderer.invoke(CHANNELS.OPEN_MENU, instanceId, x, y),
  hideWindow: () => ipcRenderer.invoke(CHANNELS.HIDE, instanceId),
  closeWindowEntirely: () => ipcRenderer.invoke(CHANNELS.DESTROY, instanceId),
  onStateUpdate: (callback: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => callback(state)
    ipcRenderer.on(CHANNELS.STATE_UPDATE, handler)
    return () => { ipcRenderer.removeListener(CHANNELS.STATE_UPDATE, handler) }
  },
  onThemeColor: (callback: (color: string | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, color: string | null) => callback(color)
    ipcRenderer.on(CHANNELS.THEME_COLOR, handler)
    return () => { ipcRenderer.removeListener(CHANNELS.THEME_COLOR, handler) }
  },
})
