import { ipcRenderer, type IpcRendererEvent } from 'electron'

/**
 * Create a function that invokes an IPC channel (request-response).
 * Usage: getSessions: invoke(IPC_CHANNELS.sessions.GET)
 */
export function invoke(channel: string) {
  return (...args: unknown[]) => ipcRenderer.invoke(channel, ...args)
}

/**
 * Create a function that sends to an IPC channel (fire-and-forget).
 * Usage: debugLog: send(IPC_CHANNELS.debug.LOG)
 */
export function send(channel: string) {
  return (...args: unknown[]) => ipcRenderer.send(channel, ...args)
}

/**
 * Create a function that listens on an IPC channel and returns a cleanup function.
 * The callback receives the first argument after the event.
 * Usage: onSessionEvent: listen(IPC_CHANNELS.sessions.EVENT)
 */
export function listen<T = any>(channel: string) {
  return (callback: (data: T) => void): (() => void) => {
    const handler = (_event: IpcRendererEvent, ...args: unknown[]) => callback(args[0] as T)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}

/**
 * Create a listener that passes no arguments (just notifies).
 * Usage: onCloseRequested: listenVoid(IPC_CHANNELS.window.CLOSE_REQUESTED)
 */
export function listenVoid(channel: string) {
  return (callback: () => void): (() => void) => {
    const handler = () => callback()
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  }
}
