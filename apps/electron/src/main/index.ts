import { app, BrowserWindow } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { SessionManager } from './sessions'
import { registerIpcHandlers } from './ipc'
import { createApplicationMenu } from './menu'
import { WindowManager } from './window-manager'
import { loadWindowState, saveWindowState } from './window-state'
import { getWorkspaces } from '@craft-agent/shared/config'

// Custom URL scheme for deeplinks (e.g., craftagents://auth-complete)
const DEEPLINK_SCHEME = 'craftagents'

let windowManager: WindowManager | null = null
let sessionManager: SessionManager | null = null

// Register as default protocol client for craftagents:// URLs
// This must be done before app.whenReady() on some platforms
if (process.defaultApp) {
  // Development mode: need to pass the app path
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(DEEPLINK_SCHEME, process.execPath, [process.argv[1]])
  }
} else {
  // Production mode
  app.setAsDefaultProtocolClient(DEEPLINK_SCHEME)
}

// Handle deeplink on macOS (when app is already running)
app.on('open-url', (event, url) => {
  event.preventDefault()
  console.log('[Main] Received deeplink:', url)

  // Focus any window or create one if none exist
  if (windowManager) {
    const windows = windowManager.getAllWindows()
    if (windows.length > 0) {
      const win = windows[0].window
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  }
})

// Handle deeplink on Windows/Linux (single instance check)
const gotTheLock = app.requestSingleInstanceLock()
if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine, _workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    // On Windows/Linux, the deeplink is in commandLine
    const url = commandLine.find(arg => arg.startsWith(`${DEEPLINK_SCHEME}://`))
    if (url) {
      console.log('[Main] Received deeplink from second instance:', url)
    }

    // Focus any window or create one if none exist
    if (windowManager) {
      const windows = windowManager.getAllWindows()
      if (windows.length > 0) {
        const win = windows[0].window
        if (win.isMinimized()) win.restore()
        win.focus()
      }
    }
  })
}

// Helper to create initial windows on startup
async function createInitialWindows(): Promise<void> {
  if (!windowManager) return

  // Load saved window state
  const savedState = loadWindowState()
  const workspaces = getWorkspaces()

  if (workspaces.length === 0) {
    // No workspaces configured - create window without workspace (will show onboarding)
    windowManager.createWindow('')
    return
  }

  if (savedState?.openWorkspaceIds.length) {
    // Restore windows from saved state
    // Filter to only workspaces that still exist
    const validWorkspaceIds = savedState.openWorkspaceIds.filter(
      wsId => workspaces.some(ws => ws.id === wsId)
    )

    if (validWorkspaceIds.length > 0) {
      for (const wsId of validWorkspaceIds) {
        windowManager.createWindow(wsId)
      }
      console.log(`[Main] Restored ${validWorkspaceIds.length} window(s) from saved state`)
      return
    }
  }

  // Default: open window for first workspace
  windowManager.createWindow(workspaces[0].id)
  console.log(`[Main] Created window for first workspace: ${workspaces[0].name}`)
}

app.whenReady().then(async () => {
  app.setName('Craft Agents')

  // Create the application menu
  createApplicationMenu()

  // Set dock icon on macOS (required for dev mode, bundled apps use Info.plist)
  if (process.platform === 'darwin' && app.dock) {
    const dockIconPath = join(__dirname, '../resources/icon.png')
    if (existsSync(dockIconPath)) {
      app.dock.setIcon(dockIconPath)
    }
  }

  try {
    // Initialize window manager
    windowManager = new WindowManager()

    // Initialize session manager
    sessionManager = new SessionManager()
    sessionManager.setWindowManager(windowManager)

    // Register IPC handlers (must happen before window creation)
    registerIpcHandlers(sessionManager, windowManager)

    // Create initial windows (restores from saved state or opens first workspace)
    await createInitialWindows()

    // Initialize auth (must happen after window creation for error reporting)
    await sessionManager.initialize()

    console.log('[Main] App initialized successfully')
  } catch (error) {
    console.error('[Main] Failed to initialize app:', error)
    // Continue anyway - the app will show errors in the UI
  }

  // macOS: Re-create window when dock icon is clicked
  app.on('activate', () => {
    if (!windowManager?.hasWindows()) {
      // Open first workspace or last focused
      const workspaces = getWorkspaces()
      if (workspaces.length > 0 && windowManager) {
        const savedState = loadWindowState()
        const wsId = savedState?.lastFocusedWorkspaceId || workspaces[0].id
        // Verify workspace still exists
        if (workspaces.some(ws => ws.id === wsId)) {
          windowManager.createWindow(wsId)
        } else {
          windowManager.createWindow(workspaces[0].id)
        }
      }
    }
  })
})

app.on('window-all-closed', () => {
  // On macOS, apps typically stay active until explicitly quit
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Save window state before quitting
app.on('before-quit', () => {
  if (windowManager) {
    const openWorkspaceIds = windowManager.getOpenWorkspaceIds()
    // Get the focused window's workspace as last focused
    const focusedWindow = BrowserWindow.getFocusedWindow()
    let lastFocusedWorkspaceId: string | undefined
    if (focusedWindow) {
      lastFocusedWorkspaceId = windowManager.getWorkspaceForWindow(focusedWindow.webContents.id) ?? undefined
    }

    saveWindowState({
      openWorkspaceIds,
      lastFocusedWorkspaceId,
    })
    console.log('[Main] Saved window state:', openWorkspaceIds.length, 'workspaces')
  }
})

// Handle uncaught exceptions to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('[Main] Uncaught exception:', error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main] Unhandled rejection at:', promise, 'reason:', reason)
})
