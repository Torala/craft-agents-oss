import { ipcMain } from 'electron'
import { IPC_CHANNELS, type BrowserPaneCreateOptions, type BrowserEmptyStateLaunchPayload } from '../../shared/types'
import type { BrowserScreenshotOptions } from '../browser-pane-manager'
import { ipcLog } from '../logger'
import type { IpcContext } from './types'

export const HANDLED_CHANNELS = [
  IPC_CHANNELS.browserPane.CREATE,
  IPC_CHANNELS.browserPane.DESTROY,
  IPC_CHANNELS.browserPane.LIST,
  IPC_CHANNELS.browserPane.NAVIGATE,
  IPC_CHANNELS.browserPane.GO_BACK,
  IPC_CHANNELS.browserPane.GO_FORWARD,
  IPC_CHANNELS.browserPane.RELOAD,
  IPC_CHANNELS.browserPane.STOP,
  IPC_CHANNELS.browserPane.FOCUS,
  IPC_CHANNELS.browserPane.LAUNCH,
  IPC_CHANNELS.browserPane.SNAPSHOT,
  IPC_CHANNELS.browserPane.CLICK,
  IPC_CHANNELS.browserPane.FILL,
  IPC_CHANNELS.browserPane.SELECT,
  IPC_CHANNELS.browserPane.SCREENSHOT,
  IPC_CHANNELS.browserPane.EVALUATE,
  IPC_CHANNELS.browserPane.SCROLL,
] as const

export function registerBrowserHandlers({ browserPaneManager, windowManager }: IpcContext): void {
  if (!browserPaneManager) return

  ipcMain.handle(IPC_CHANNELS.browserPane.CREATE, (_event, input?: string | BrowserPaneCreateOptions) => {
    if (typeof input === 'string') {
      return browserPaneManager.createInstance(input)
    }

    if (input?.bindToSessionId) {
      return browserPaneManager.createForSession(input.bindToSessionId, { show: input.show ?? false })
    }

    return browserPaneManager.createInstance(input?.id, { show: input?.show })
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.DESTROY, (_event, id: string) => {
    browserPaneManager.destroyInstance(id)
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.LIST, () => {
    return browserPaneManager.listInstances()
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.NAVIGATE, async (_event, id: string, url: string) => {
    try {
      return await browserPaneManager.navigate(id, url)
    } catch (err) {
      ipcLog.error(`[browser-pane] navigate failed for ${id}:`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.GO_BACK, async (_event, id: string) => {
    try {
      return await browserPaneManager.goBack(id)
    } catch (err) {
      ipcLog.error(`[browser-pane] goBack failed for ${id}:`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.GO_FORWARD, async (_event, id: string) => {
    try {
      return await browserPaneManager.goForward(id)
    } catch (err) {
      ipcLog.error(`[browser-pane] goForward failed for ${id}:`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.RELOAD, (_event, id: string) => {
    browserPaneManager.reload(id)
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.STOP, (_event, id: string) => {
    browserPaneManager.stop(id)
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.FOCUS, (_event, id: string) => {
    browserPaneManager.focus(id)
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.LAUNCH, async (event, payload: BrowserEmptyStateLaunchPayload) => {
    try {
      return await browserPaneManager.handleEmptyStateLaunchFromRenderer(event.sender.id, payload)
    } catch (err) {
      ipcLog.error('[browser-pane] empty-state launch IPC failed:', err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.SNAPSHOT, async (_event, id: string) => {
    try {
      return await browserPaneManager.getAccessibilitySnapshot(id)
    } catch (err) {
      ipcLog.error(`[browser-pane] snapshot failed for ${id}:`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.CLICK, async (_event, id: string, ref: string) => {
    try {
      return await browserPaneManager.clickElement(id, ref)
    } catch (err) {
      ipcLog.error(`[browser-pane] click failed for ${id} ref=${ref}:`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.FILL, async (_event, id: string, ref: string, value: string) => {
    try {
      return await browserPaneManager.fillElement(id, ref, value)
    } catch (err) {
      ipcLog.error(`[browser-pane] fill failed for ${id} ref=${ref}:`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.SELECT, async (_event, id: string, ref: string, value: string) => {
    try {
      return await browserPaneManager.selectOption(id, ref, value)
    } catch (err) {
      ipcLog.error(`[browser-pane] select failed for ${id} ref=${ref}:`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.SCREENSHOT, async (_event, id: string, options?: BrowserScreenshotOptions) => {
    try {
      const result = await browserPaneManager.screenshot(id, options)
      return {
        base64: result.imageBuffer.toString('base64'),
        imageFormat: result.imageFormat,
        metadata: result.metadata,
      }
    } catch (err) {
      ipcLog.error(`[browser-pane] screenshot failed for ${id}:`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.EVALUATE, async (_event, id: string, expression: string) => {
    try {
      return await browserPaneManager.evaluate(id, expression)
    } catch (err) {
      ipcLog.error(`[browser-pane] evaluate failed for ${id}:`, err)
      throw err
    }
  })

  ipcMain.handle(IPC_CHANNELS.browserPane.SCROLL, async (_event, id: string, direction: string, amount?: number) => {
    const validDirections = ['up', 'down', 'left', 'right']
    if (!validDirections.includes(direction)) {
      throw new Error(`Invalid scroll direction: ${direction}`)
    }
    try {
      return await browserPaneManager.scroll(id, direction as 'up' | 'down' | 'left' | 'right', amount)
    } catch (err) {
      ipcLog.error(`[browser-pane] scroll failed for ${id}:`, err)
      throw err
    }
  })

  // Forward browser state changes to all windows
  browserPaneManager.onStateChange((info) => {
    windowManager.broadcastToAll(IPC_CHANNELS.browserPane.STATE_CHANGED, info)
  })

  // Forward browser removals so renderer can immediately drop stale tabs
  browserPaneManager.onRemoved((id) => {
    windowManager.broadcastToAll(IPC_CHANNELS.browserPane.REMOVED, id)
  })

  // Forward browser interaction/focus events so renderer can align panel focus.
  browserPaneManager.onInteracted((id) => {
    windowManager.broadcastToAll(IPC_CHANNELS.browserPane.INTERACTED, id)
  })
}
