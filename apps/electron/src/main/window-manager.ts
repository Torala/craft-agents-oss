import { BrowserWindow, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { IPC_CHANNELS } from '../shared/types'

// Vite dev server URL for hot reload
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

interface ManagedWindow {
  window: BrowserWindow
  workspaceId: string
  mode?: string
}

export class WindowManager {
  private windows: Map<number, ManagedWindow> = new Map()  // webContents.id → ManagedWindow

  /**
   * Create a new window for a workspace
   * @param workspaceId - The workspace to open (empty string for onboarding/add-workspace)
   * @param mode - Optional mode: 'add-workspace' opens the add workspace wizard
   */
  createWindow(workspaceId: string, mode?: string): BrowserWindow {
    // Load platform-specific app icon
    const getIconPath = () => {
      const resourcesDir = join(__dirname, '../resources')
      if (process.platform === 'darwin') {
        return join(resourcesDir, 'icon.icns')
      } else if (process.platform === 'win32') {
        return join(resourcesDir, 'icon.ico')
      } else {
        return join(resourcesDir, 'icon.png')
      }
    }

    const iconPath = getIconPath()
    const iconExists = existsSync(iconPath)

    if (!iconExists) {
      console.warn('[WindowManager] App icon not found at:', iconPath)
    }

    const window = new BrowserWindow({
      width: 1400,
      height: 900,
      minWidth: 800,
      minHeight: 600,
      title: '',
      icon: iconExists ? iconPath : undefined,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: true // Enable webview for browser panel
      }
    })

    // Open external links in default browser
    window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Handle navigation in webviews to external URLs
    window.webContents.on('will-navigate', (event, url) => {
      // Allow navigation within the app, but open external URLs in browser
      if (!url.startsWith('file://')) {
        event.preventDefault()
        shell.openExternal(url)
      }
    })

    // Load the renderer with workspace ID and mode as query params
    const query: Record<string, string> = { workspaceId }
    if (mode) {
      query.mode = mode
    }

    if (VITE_DEV_SERVER_URL) {
      const params = new URLSearchParams(query).toString()
      window.loadURL(`${VITE_DEV_SERVER_URL}?${params}`)
    } else {
      window.loadFile(join(__dirname, 'renderer/index.html'), { query })
    }

    // Store the window mapping
    const webContentsId = window.webContents.id
    this.windows.set(webContentsId, { window, workspaceId, mode })

    // Handle window close
    window.on('closed', () => {
      this.windows.delete(webContentsId)
      console.log(`[WindowManager] Window closed for workspace ${workspaceId}`)
    })

    // Listen for system theme changes and notify this window's renderer
    const themeHandler = () => {
      if (!window.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.SYSTEM_THEME_CHANGED, nativeTheme.shouldUseDarkColors)
      }
    }
    nativeTheme.on('updated', themeHandler)

    // Clean up theme listener when window is destroyed
    window.on('closed', () => {
      nativeTheme.removeListener('updated', themeHandler)
    })

    console.log(`[WindowManager] Created window for workspace ${workspaceId}`)
    return window
  }

  /**
   * Get window by workspace ID
   */
  getWindowByWorkspace(workspaceId: string): BrowserWindow | null {
    for (const managed of this.windows.values()) {
      if (managed.workspaceId === workspaceId && !managed.window.isDestroyed()) {
        return managed.window
      }
    }
    return null
  }

  /**
   * Get workspace ID for a window (by webContents.id)
   */
  getWorkspaceForWindow(webContentsId: number): string | null {
    const managed = this.windows.get(webContentsId)
    return managed?.workspaceId ?? null
  }

  /**
   * Get mode for a window (by webContents.id)
   */
  getModeForWindow(webContentsId: number): string | null {
    const managed = this.windows.get(webContentsId)
    return managed?.mode ?? null
  }

  /**
   * Close window by webContents.id
   */
  closeWindow(webContentsId: number): void {
    const managed = this.windows.get(webContentsId)
    if (managed && !managed.window.isDestroyed()) {
      managed.window.close()
    }
  }

  /**
   * Close window for a specific workspace
   */
  closeWindowForWorkspace(workspaceId: string): void {
    const window = this.getWindowByWorkspace(workspaceId)
    if (window && !window.isDestroyed()) {
      window.close()
    }
  }

  /**
   * Get all managed windows
   */
  getAllWindows(): ManagedWindow[] {
    return Array.from(this.windows.values()).filter(m => !m.window.isDestroyed())
  }

  /**
   * Focus existing window for workspace or create new one
   */
  focusOrCreateWindow(workspaceId: string): BrowserWindow {
    const existing = this.getWindowByWorkspace(workspaceId)
    if (existing) {
      if (existing.isMinimized()) {
        existing.restore()
      }
      existing.focus()
      return existing
    }
    return this.createWindow(workspaceId)
  }

  /**
   * Get list of workspace IDs that have open windows (for persistence)
   */
  getOpenWorkspaceIds(): string[] {
    return this.getAllWindows().map(m => m.workspaceId)
  }

  /**
   * Check if any windows are open
   */
  hasWindows(): boolean {
    return this.getAllWindows().length > 0
  }

  /**
   * Send IPC message to all windows
   */
  broadcastToAll(channel: string, ...args: unknown[]): void {
    for (const managed of this.getAllWindows()) {
      if (!managed.window.isDestroyed()) {
        managed.window.webContents.send(channel, ...args)
      }
    }
  }
}
