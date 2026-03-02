import { app, ipcMain, nativeTheme, shell, dialog, BrowserWindow } from 'electron'
import { resolve } from 'path'
import { join } from 'path'
import { homedir } from 'os'
import { execSync } from 'child_process'
import { IPC_CHANNELS } from '../../shared/types'
import { getGitBashPath, setGitBashPath, clearGitBashPath } from '@craft-agent/shared/config'
import { isUsableGitBashPath, validateGitBashPath } from '../git-bash'
import { ipcLog } from '../logger'
import { validateFilePath } from './files'
import type { IpcContext } from './types'

export const HANDLED_CHANNELS = [
  IPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE,
  IPC_CHANNELS.system.HOME_DIR,
  IPC_CHANNELS.system.IS_DEBUG_MODE,
  IPC_CHANNELS.debug.LOG,
  IPC_CHANNELS.update.CHECK,
  IPC_CHANNELS.update.GET_INFO,
  IPC_CHANNELS.update.INSTALL,
  IPC_CHANNELS.update.DISMISS,
  IPC_CHANNELS.update.GET_DISMISSED,
  IPC_CHANNELS.shell.OPEN_URL,
  IPC_CHANNELS.shell.OPEN_FILE,
  IPC_CHANNELS.shell.SHOW_IN_FOLDER,
  IPC_CHANNELS.releaseNotes.GET,
  IPC_CHANNELS.releaseNotes.GET_LATEST_VERSION,
  IPC_CHANNELS.git.GET_BRANCH,
  IPC_CHANNELS.gitbash.CHECK,
  IPC_CHANNELS.gitbash.BROWSE,
  IPC_CHANNELS.gitbash.SET_PATH,
  IPC_CHANNELS.badge.REFRESH,
  IPC_CHANNELS.badge.SET_ICON,
  IPC_CHANNELS.window.GET_FOCUS_STATE,
  IPC_CHANNELS.notification.SHOW,
  IPC_CHANNELS.notification.GET_ENABLED,
  IPC_CHANNELS.notification.SET_ENABLED,
  IPC_CHANNELS.menu.QUIT,
  IPC_CHANNELS.menu.NEW_WINDOW,
  IPC_CHANNELS.menu.MINIMIZE,
  IPC_CHANNELS.menu.MAXIMIZE,
  IPC_CHANNELS.menu.ZOOM_IN,
  IPC_CHANNELS.menu.ZOOM_OUT,
  IPC_CHANNELS.menu.ZOOM_RESET,
  IPC_CHANNELS.menu.TOGGLE_DEV_TOOLS,
  IPC_CHANNELS.menu.UNDO,
  IPC_CHANNELS.menu.REDO,
  IPC_CHANNELS.menu.CUT,
  IPC_CHANNELS.menu.COPY,
  IPC_CHANNELS.menu.PASTE,
  IPC_CHANNELS.menu.SELECT_ALL,
] as const

export function registerSystemHandlers({ sessionManager, windowManager }: IpcContext): void {
  // Get system theme preference (dark = true, light = false)
  ipcMain.handle(IPC_CHANNELS.theme.GET_SYSTEM_PREFERENCE, () => {
    return nativeTheme.shouldUseDarkColors
  })

  // Get user's home directory
  ipcMain.handle(IPC_CHANNELS.system.HOME_DIR, () => {
    return homedir()
  })

  // Check if running in debug mode (from source)
  ipcMain.handle(IPC_CHANNELS.system.IS_DEBUG_MODE, () => {
    return !app.isPackaged
  })

  // Release notes
  ipcMain.handle(IPC_CHANNELS.releaseNotes.GET, () => {
    const { getCombinedReleaseNotes } = require('@craft-agent/shared/release-notes') as typeof import('@craft-agent/shared/release-notes')
    return getCombinedReleaseNotes()
  })

  ipcMain.handle(IPC_CHANNELS.releaseNotes.GET_LATEST_VERSION, () => {
    const { getLatestReleaseVersion } = require('@craft-agent/shared/release-notes') as typeof import('@craft-agent/shared/release-notes')
    return getLatestReleaseVersion()
  })

  // Get git branch for a directory (returns null if not a git repo or git unavailable)
  ipcMain.handle(IPC_CHANNELS.git.GET_BRANCH, (_event, dirPath: string) => {
    try {
      const branch = execSync('git rev-parse --abbrev-ref HEAD', {
        cwd: dirPath,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],  // Suppress stderr output
        timeout: 5000,  // 5 second timeout
      }).trim()
      return branch || null
    } catch {
      // Not a git repo, git not installed, or other error
      return null
    }
  })

  // Git Bash detection and configuration (Windows only)
  ipcMain.handle(IPC_CHANNELS.gitbash.CHECK, async () => {
    const platform = process.platform as 'win32' | 'darwin' | 'linux'

    // Non-Windows platforms don't need Git Bash
    if (platform !== 'win32') {
      return { found: true, path: null, platform }
    }

    // Check common Git Bash installation paths
    const commonPaths = [
      'C:\\Program Files\\Git\\bin\\bash.exe',
      'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
      join(process.env.LOCALAPPDATA || '', 'Programs', 'Git', 'bin', 'bash.exe'),
      join(process.env.PROGRAMFILES || '', 'Git', 'bin', 'bash.exe'),
    ]

    // Check if we have a persisted path from a previous session
    const persistedPath = getGitBashPath()
    if (persistedPath) {
      if (await isUsableGitBashPath(persistedPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = persistedPath.trim()
        return { found: true, path: persistedPath, platform }
      } else {
        // Persisted path no longer valid, clear stale config and fall through to detection
        clearGitBashPath()
      }
    }

    for (const bashPath of commonPaths) {
      if (await isUsableGitBashPath(bashPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = bashPath
        setGitBashPath(bashPath)
        return { found: true, path: bashPath, platform }
      }
    }

    // Try to find via 'where' command
    try {
      const result = execSync('where bash', {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 5000,
      }).trim()
      const firstPath = result.split('\n')[0]?.trim()
      if (firstPath && firstPath.toLowerCase().includes('git') && await isUsableGitBashPath(firstPath)) {
        process.env.CLAUDE_CODE_GIT_BASH_PATH = firstPath
        setGitBashPath(firstPath)
        return { found: true, path: firstPath, platform }
      }
    } catch {
      // where command failed
    }

    delete process.env.CLAUDE_CODE_GIT_BASH_PATH
    return { found: false, path: null, platform }
  })

  ipcMain.handle(IPC_CHANNELS.gitbash.BROWSE, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return null

    const result = await dialog.showOpenDialog(win, {
      title: 'Select bash.exe',
      filters: [{ name: 'Executable', extensions: ['exe'] }],
      properties: ['openFile'],
      defaultPath: 'C:\\Program Files\\Git\\bin',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  ipcMain.handle(IPC_CHANNELS.gitbash.SET_PATH, async (_event, bashPath: string) => {
    const validation = await validateGitBashPath(bashPath)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    // Persist to config and set env var so SDK subprocess can find Git Bash
    setGitBashPath(validation.path)
    process.env.CLAUDE_CODE_GIT_BASH_PATH = validation.path
    return { success: true }
  })

  // Debug logging from renderer -> main log file (fire-and-forget, no response)
  ipcMain.on(IPC_CHANNELS.debug.LOG, (_event, ...args: unknown[]) => {
    ipcLog.info('[renderer]', ...args)
  })

  // Auto-update handlers
  // Manual check from UI - don't auto-download (user might be on metered connection)
  ipcMain.handle(IPC_CHANNELS.update.CHECK, async () => {
    const { checkForUpdates } = await import('../auto-update')
    return checkForUpdates({ autoDownload: false })
  })

  ipcMain.handle(IPC_CHANNELS.update.GET_INFO, async () => {
    const { getUpdateInfo } = await import('../auto-update')
    return getUpdateInfo()
  })

  ipcMain.handle(IPC_CHANNELS.update.INSTALL, async () => {
    const { installUpdate } = await import('../auto-update')
    return installUpdate()
  })

  // Dismiss update for this version (persists across restarts)
  ipcMain.handle(IPC_CHANNELS.update.DISMISS, async (_event, version: string) => {
    const { setDismissedUpdateVersion } = await import('@craft-agent/shared/config')
    setDismissedUpdateVersion(version)
  })

  // Get dismissed version
  ipcMain.handle(IPC_CHANNELS.update.GET_DISMISSED, async () => {
    const { getDismissedUpdateVersion } = await import('@craft-agent/shared/config')
    return getDismissedUpdateVersion()
  })

  // Shell operations - open URL in external browser (or handle craftagents:// internally)
  ipcMain.handle(IPC_CHANNELS.shell.OPEN_URL, async (_event, url: string) => {
    ipcLog.info('[OPEN_URL] Received request:', url)
    try {
      // Validate URL format
      const parsed = new URL(url)

      // Handle craftagents:// URLs internally via deep link handler
      // This ensures ?window= params work correctly for "Open in New Window"
      if (parsed.protocol === 'craftagents:') {
        ipcLog.info('[OPEN_URL] Handling as deep link')
        const { handleDeepLink } = await import('../deep-link')
        const result = await handleDeepLink(url, windowManager)
        ipcLog.info('[OPEN_URL] Deep link result:', result)
        return
      }

      // External URLs - open in default browser
      if (!['http:', 'https:', 'mailto:', 'craftdocs:'].includes(parsed.protocol)) {
        throw new Error('Only http, https, mailto, craftdocs URLs are allowed')
      }
      await shell.openExternal(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('openUrl error:', message)
      throw new Error(`Failed to open URL: ${message}`)
    }
  })

  // Shell operations - open file in default application
  ipcMain.handle(IPC_CHANNELS.shell.OPEN_FILE, async (_event, path: string) => {
    try {
      // Resolve relative paths to absolute before validation
      const absolutePath = resolve(path)
      // Validate path is within allowed directories
      const safePath = await validateFilePath(absolutePath)
      // openPath opens file with default application (e.g., VS Code for .ts files)
      const result = await shell.openPath(safePath)
      if (result) {
        // openPath returns empty string on success, error message on failure
        throw new Error(result)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('openFile error:', message)
      throw new Error(`Failed to open file: ${message}`)
    }
  })

  // Shell operations - show file in folder (opens Finder/Explorer with file selected)
  ipcMain.handle(IPC_CHANNELS.shell.SHOW_IN_FOLDER, async (_event, path: string) => {
    try {
      // Resolve relative paths to absolute before validation
      const absolutePath = resolve(path)
      // Validate path is within allowed directories
      const safePath = await validateFilePath(absolutePath)
      shell.showItemInFolder(safePath)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('showInFolder error:', message)
      throw new Error(`Failed to show in folder: ${message}`)
    }
  })

  // Menu actions from renderer (for unified Craft menu)
  ipcMain.handle(IPC_CHANNELS.menu.QUIT, () => {
    app.quit()
  })

  // New Window: create a new window for the current workspace
  ipcMain.handle(IPC_CHANNELS.menu.NEW_WINDOW, (event) => {
    const workspaceId = windowManager.getWorkspaceForWindow(event.sender.id)
    if (workspaceId) {
      windowManager.createWindow({ workspaceId })
    }
  })

  ipcMain.handle(IPC_CHANNELS.menu.MINIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })

  ipcMain.handle(IPC_CHANNELS.menu.MAXIMIZE, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })

  ipcMain.handle(IPC_CHANNELS.menu.ZOOM_IN, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const currentZoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.min(currentZoom + 0.1, 3.0))
    }
  })

  ipcMain.handle(IPC_CHANNELS.menu.ZOOM_OUT, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      const currentZoom = win.webContents.getZoomFactor()
      win.webContents.setZoomFactor(Math.max(currentZoom - 0.1, 0.5))
    }
  })

  ipcMain.handle(IPC_CHANNELS.menu.ZOOM_RESET, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.setZoomFactor(1.0)
  })

  ipcMain.handle(IPC_CHANNELS.menu.TOGGLE_DEV_TOOLS, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.webContents.toggleDevTools()
  })

  ipcMain.handle(IPC_CHANNELS.menu.UNDO, (event) => {
    event.sender.undo()
  })

  ipcMain.handle(IPC_CHANNELS.menu.REDO, (event) => {
    event.sender.redo()
  })

  ipcMain.handle(IPC_CHANNELS.menu.CUT, (event) => {
    event.sender.cut()
  })

  ipcMain.handle(IPC_CHANNELS.menu.COPY, (event) => {
    event.sender.copy()
  })

  ipcMain.handle(IPC_CHANNELS.menu.PASTE, (event) => {
    event.sender.paste()
  })

  ipcMain.handle(IPC_CHANNELS.menu.SELECT_ALL, (event) => {
    event.sender.selectAll()
  })

  // Notifications
  ipcMain.handle(IPC_CHANNELS.notification.SHOW, async (_event, title: string, body: string, workspaceId: string, sessionId: string) => {
    const { showNotification } = await import('../notifications')
    showNotification(title, body, workspaceId, sessionId)
  })

  ipcMain.handle(IPC_CHANNELS.notification.GET_ENABLED, async () => {
    const { getNotificationsEnabled } = await import('@craft-agent/shared/config/storage')
    return getNotificationsEnabled()
  })

  ipcMain.handle(IPC_CHANNELS.notification.SET_ENABLED, async (_event, enabled: boolean) => {
    const { setNotificationsEnabled } = await import('@craft-agent/shared/config/storage')
    setNotificationsEnabled(enabled)

    // If enabling, trigger a notification to request macOS permission
    if (enabled) {
      const { showNotification } = await import('../notifications')
      showNotification('Notifications enabled', 'You will be notified when tasks complete.', '', '')
    }
  })

  // Badge and window focus
  ipcMain.handle(IPC_CHANNELS.badge.REFRESH, async () => {
    try {
      await sessionManager.waitForInit()
    } catch { /* continue */ }
    sessionManager.refreshBadge()
  })

  ipcMain.handle(IPC_CHANNELS.badge.SET_ICON, async (_event, dataUrl: string) => {
    const { setDockIconWithBadge } = await import('../notifications')
    setDockIconWithBadge(dataUrl)
  })

  ipcMain.handle(IPC_CHANNELS.window.GET_FOCUS_STATE, () => {
    const { isAnyWindowFocused } = require('../notifications')
    return isAnyWindowFocused()
  })
}
