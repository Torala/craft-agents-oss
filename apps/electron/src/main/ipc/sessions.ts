import { ipcMain, shell, BrowserWindow } from 'electron'
import { readFile, writeFile, stat } from 'fs/promises'
import { join } from 'path'
import { IPC_CHANNELS, type FileAttachment, type StoredAttachment, type SendMessageOptions } from '../../shared/types'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { perf } from '@craft-agent/shared/utils'
import { isValidThinkingLevel } from '@craft-agent/shared/agent/thinking-levels'
import { ipcLog, searchLog } from '../logger'
import type { IpcContext } from './types'

// Session file watcher state - only one session watched at a time
let sessionFileWatcher: import('fs').FSWatcher | null = null
let watchedSessionId: string | null = null
let fileChangeDebounceTimer: ReturnType<typeof setTimeout> | null = null

// Recursive directory scanner for session files
// Filters out internal files (session.jsonl) and hidden files (. prefix)
// Returns only non-empty directories
async function scanSessionDirectory(dirPath: string): Promise<import('../../shared/types').SessionFile[]> {
  const { readdir, stat } = await import('fs/promises')
  const entries = await readdir(dirPath, { withFileTypes: true })
  const files: import('../../shared/types').SessionFile[] = []

  for (const entry of entries) {
    // Skip internal and hidden files
    if (entry.name === 'session.jsonl' || entry.name.startsWith('.')) continue

    const fullPath = join(dirPath, entry.name)

    if (entry.isDirectory()) {
      // Recursively scan subdirectory
      const children = await scanSessionDirectory(fullPath)
      // Only include non-empty directories
      if (children.length > 0) {
        files.push({
          name: entry.name,
          path: fullPath,
          type: 'directory',
          children,
        })
      }
    } else {
      const stats = await stat(fullPath)
      files.push({
        name: entry.name,
        path: fullPath,
        type: 'file',
        size: stats.size,
      })
    }
  }

  // Sort: directories first, then alphabetically
  return files.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

export const HANDLED_CHANNELS = [
  IPC_CHANNELS.sessions.GET,
  IPC_CHANNELS.sessions.GET_UNREAD_SUMMARY,
  IPC_CHANNELS.sessions.MARK_ALL_READ,
  IPC_CHANNELS.sessions.CREATE,
  IPC_CHANNELS.sessions.DELETE,
  IPC_CHANNELS.sessions.GET_MESSAGES,
  IPC_CHANNELS.sessions.SEND_MESSAGE,
  IPC_CHANNELS.sessions.CANCEL,
  IPC_CHANNELS.sessions.KILL_SHELL,
  IPC_CHANNELS.tasks.GET_OUTPUT,
  IPC_CHANNELS.sessions.RESPOND_TO_PERMISSION,
  IPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL,
  IPC_CHANNELS.sessions.COMMAND,
  IPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION,
  IPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE,
  IPC_CHANNELS.sessions.SEARCH_CONTENT,
  IPC_CHANNELS.sessions.GET_FILES,
  IPC_CHANNELS.sessions.GET_NOTES,
  IPC_CHANNELS.sessions.SET_NOTES,
  IPC_CHANNELS.sessions.WATCH_FILES,
  IPC_CHANNELS.sessions.UNWATCH_FILES,
] as const

export function registerSessionsHandlers({ sessionManager, windowManager }: IpcContext): void {
  // Get all sessions for the calling window's workspace
  // Waits for initialization to complete so sessions are never returned empty during startup
  ipcMain.handle(IPC_CHANNELS.sessions.GET, async (event) => {
    try {
      await sessionManager.waitForInit()
    } catch (error) {
      ipcLog.error('GET_SESSIONS continuing after initialization failure:', error)
    }
    const end = perf.start('ipc.getSessions')
    const workspaceId = windowManager.getWorkspaceForWindow(event.sender.id)
    const sessions = sessionManager.getSessions(workspaceId ?? undefined)
    end()
    return sessions
  })

  // Get unread summary across all workspaces
  ipcMain.handle(IPC_CHANNELS.sessions.GET_UNREAD_SUMMARY, async () => {
    try {
      await sessionManager.waitForInit()
    } catch (error) {
      ipcLog.error('GET_UNREAD_SUMMARY continuing after initialization failure:', error)
    }
    return sessionManager.getUnreadSummary()
  })

  ipcMain.handle(IPC_CHANNELS.sessions.MARK_ALL_READ, async (_event, workspaceId: string) => {
    return sessionManager.markAllSessionsRead(workspaceId)
  })

  // Get a single session with messages (for lazy loading)
  ipcMain.handle(IPC_CHANNELS.sessions.GET_MESSAGES, async (_event, sessionId: string) => {
    const end = perf.start('ipc.getSessionMessages')
    const session = await sessionManager.getSession(sessionId)
    end()
    return session
  })

  // Create a new session
  ipcMain.handle(IPC_CHANNELS.sessions.CREATE, async (_event, workspaceId: string, options?: import('../../shared/types').CreateSessionOptions) => {
    const end = perf.start('ipc.createSession', { workspaceId })
    const session = sessionManager.createSession(workspaceId, options)
    end()
    return session
  })

  // Delete a session
  ipcMain.handle(IPC_CHANNELS.sessions.DELETE, async (_event, sessionId: string) => {
    return sessionManager.deleteSession(sessionId)
  })

  // Send a message to a session (with optional file attachments)
  // Note: We intentionally don't await here - the response is streamed via events.
  // The IPC handler returns immediately, and results come through SESSION_EVENT channel.
  // attachments: FileAttachment[] for Claude (has content), storedAttachments: StoredAttachment[] for persistence (has thumbnailBase64)
  ipcMain.handle(IPC_CHANNELS.sessions.SEND_MESSAGE, async (event, sessionId: string, message: string, attachments?: FileAttachment[], storedAttachments?: StoredAttachment[], options?: SendMessageOptions) => {
    // Capture the workspace from the calling window for error routing
    const callingWorkspaceId = windowManager.getWorkspaceForWindow(event.sender.id)

    // Start processing in background, errors are sent via event stream
    sessionManager.sendMessage(sessionId, message, attachments, storedAttachments, options).catch(err => {
      ipcLog.error('Error in sendMessage:', err)
      // Send error to renderer so user sees it (route to correct window)
      const window = callingWorkspaceId
        ? windowManager.getWindowByWorkspace(callingWorkspaceId)
        : BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
      // Check mainFrame - it becomes null when render frame is disposed
      if (window && !window.isDestroyed() && !window.webContents.isDestroyed() && window.webContents.mainFrame) {
        window.webContents.send(IPC_CHANNELS.sessions.EVENT, {
          type: 'error',
          sessionId,
          error: err instanceof Error ? err.message : 'Unknown error'
        })
        // Also send complete event to clear processing state
        window.webContents.send(IPC_CHANNELS.sessions.EVENT, {
          type: 'complete',
          sessionId
        })
      }
    })
    // Return immediately - streaming results come via SESSION_EVENT
    return { started: true }
  })

  // Cancel processing
  ipcMain.handle(IPC_CHANNELS.sessions.CANCEL, async (_event, sessionId: string, silent?: boolean) => {
    return sessionManager.cancelProcessing(sessionId, silent)
  })

  // Kill background shell
  ipcMain.handle(IPC_CHANNELS.sessions.KILL_SHELL, async (_event, sessionId: string, shellId: string) => {
    return sessionManager.killShell(sessionId, shellId)
  })

  // Get background task output
  ipcMain.handle(IPC_CHANNELS.tasks.GET_OUTPUT, async (_event, taskId: string) => {
    try {
      const output = await sessionManager.getTaskOutput(taskId)
      return output
    } catch (err) {
      ipcLog.error('Failed to get task output:', err)
      throw err
    }
  })

  // Respond to a permission request (bash command approval)
  // Returns true if the response was delivered, false if agent/session is gone
  ipcMain.handle(IPC_CHANNELS.sessions.RESPOND_TO_PERMISSION, async (_event, sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    return sessionManager.respondToPermission(sessionId, requestId, allowed, alwaysAllow)
  })

  // Respond to a credential request (secure auth input)
  // Returns true if the response was delivered, false if agent/session is gone
  ipcMain.handle(IPC_CHANNELS.sessions.RESPOND_TO_CREDENTIAL, async (_event, sessionId: string, requestId: string, response: import('../../shared/types').CredentialResponse) => {
    return sessionManager.respondToCredential(sessionId, requestId, response)
  })

  // ==========================================================================
  // Consolidated Command Handlers
  // ==========================================================================

  // Session commands - consolidated handler for session operations
  ipcMain.handle(IPC_CHANNELS.sessions.COMMAND, async (
    _event,
    sessionId: string,
    command: import('../../shared/types').SessionCommand
  ) => {
    switch (command.type) {
      case 'flag':
        return sessionManager.flagSession(sessionId)
      case 'unflag':
        return sessionManager.unflagSession(sessionId)
      case 'archive':
        return sessionManager.archiveSession(sessionId)
      case 'unarchive':
        return sessionManager.unarchiveSession(sessionId)
      case 'rename':
        return sessionManager.renameSession(sessionId, command.name)
      case 'setSessionStatus':
        return sessionManager.setSessionStatus(sessionId, command.state)
      case 'markRead':
        return sessionManager.markSessionRead(sessionId)
      case 'markUnread':
        return sessionManager.markSessionUnread(sessionId)
      case 'setActiveViewing':
        // Track which session user is actively viewing (for unread state machine)
        return sessionManager.setActiveViewingSession(sessionId, command.workspaceId)
      case 'setPermissionMode':
        return sessionManager.setSessionPermissionMode(sessionId, command.mode)
      case 'setThinkingLevel':
        // Validate thinking level before passing to session manager
        if (!isValidThinkingLevel(command.level)) {
          throw new Error(`Invalid thinking level: ${command.level}. Valid values: 'off', 'think', 'max'`)
        }
        return sessionManager.setSessionThinkingLevel(sessionId, command.level)
      case 'updateWorkingDirectory':
        return sessionManager.updateWorkingDirectory(sessionId, command.dir)
      case 'setSources':
        return sessionManager.setSessionSources(sessionId, command.sourceSlugs)
      case 'setLabels':
        return sessionManager.setSessionLabels(sessionId, command.labels)
      case 'showInFinder': {
        const sessionPath = sessionManager.getSessionPath(sessionId)
        if (sessionPath) {
          shell.showItemInFolder(sessionPath)
        }
        return
      }
      case 'copyPath': {
        // Return the session folder path for copying to clipboard
        const sessionPath = sessionManager.getSessionPath(sessionId)
        return sessionPath ? { success: true, path: sessionPath } : { success: false }
      }
      case 'shareToViewer':
        return sessionManager.shareToViewer(sessionId)
      case 'updateShare':
        return sessionManager.updateShare(sessionId)
      case 'revokeShare':
        return sessionManager.revokeShare(sessionId)
      case 'startOAuth':
        return sessionManager.startSessionOAuth(sessionId, command.requestId)
      case 'refreshTitle':
        ipcLog.info(`IPC: refreshTitle received for session ${sessionId}`)
        return sessionManager.refreshTitle(sessionId)
      // Connection selection (locked after first message)
      case 'setConnection':
        ipcLog.info(`IPC: setConnection received for session ${sessionId}, connection: ${command.connectionSlug}`)
        return sessionManager.setSessionConnection(sessionId, command.connectionSlug)
      // Pending plan execution (Accept & Compact flow)
      case 'setPendingPlanExecution':
        return sessionManager.setPendingPlanExecution(sessionId, command.planPath)
      case 'markCompactionComplete':
        return sessionManager.markCompactionComplete(sessionId)
      case 'clearPendingPlanExecution':
        return sessionManager.clearPendingPlanExecution(sessionId)
      default: {
        const _exhaustive: never = command
        throw new Error(`Unknown session command: ${JSON.stringify(command)}`)
      }
    }
  })

  // Get pending plan execution state (for reload recovery)
  ipcMain.handle(IPC_CHANNELS.sessions.GET_PENDING_PLAN_EXECUTION, async (
    _event,
    sessionId: string
  ) => {
    return sessionManager.getPendingPlanExecution(sessionId)
  })

  // Get authoritative permission mode diagnostics for renderer reconciliation
  ipcMain.handle(IPC_CHANNELS.sessions.GET_PERMISSION_MODE_STATE, async (
    _event,
    sessionId: string
  ) => {
    return sessionManager.getSessionPermissionModeState(sessionId)
  })

  // ============================================================
  // Session Content Search
  // ============================================================

  // Search session content using ripgrep
  ipcMain.handle(IPC_CHANNELS.sessions.SEARCH_CONTENT, async (_event, workspaceId: string, query: string, searchId?: string) => {
    const id = searchId || Date.now().toString(36)
    searchLog.info('ipc:request', { searchId: id, query })

    const workspace = getWorkspaceByNameOrId(workspaceId)
    if (!workspace) {
      ipcLog.warn('SEARCH_SESSIONS: Workspace not found:', workspaceId)
      return []
    }

    const { searchSessions } = await import('../search')
    const { getWorkspaceSessionsPath } = await import('@craft-agent/shared/workspaces')

    const sessionsDir = getWorkspaceSessionsPath(workspace.rootPath)
    ipcLog.debug(`SEARCH_SESSIONS: Searching "${query}" in ${sessionsDir}`)

    const results = await searchSessions(query, sessionsDir, {
      timeout: 5000,
      maxMatchesPerSession: 3,
      maxSessions: 50,
      searchId: id,
    })

    // Filter out hidden sessions (e.g., mini edit sessions)
    const allSessions = await sessionManager.getSessions()
    const hiddenSessionIds = new Set(
      allSessions.filter(s => s.hidden).map(s => s.id)
    )
    const filteredResults = results.filter(r => !hiddenSessionIds.has(r.sessionId))

    searchLog.info('ipc:response', { searchId: id, resultCount: filteredResults.length, totalFound: results.length })
    return filteredResults
  })

  // ============================================================
  // Session Info Panel (files, notes, file watching)
  // ============================================================

  // Get files in session directory (recursive tree structure)
  ipcMain.handle(IPC_CHANNELS.sessions.GET_FILES, async (_event, sessionId: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return []

    try {
      return await scanSessionDirectory(sessionPath)
    } catch (error) {
      ipcLog.error('Failed to get session files:', error)
      return []
    }
  })

  // Start watching a session directory for file changes
  ipcMain.handle(IPC_CHANNELS.sessions.WATCH_FILES, async (_event, sessionId: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return

    // Close existing watcher if watching a different session
    if (sessionFileWatcher) {
      sessionFileWatcher.close()
      sessionFileWatcher = null
    }
    if (fileChangeDebounceTimer) {
      clearTimeout(fileChangeDebounceTimer)
      fileChangeDebounceTimer = null
    }

    watchedSessionId = sessionId

    try {
      const { watch } = await import('fs')
      sessionFileWatcher = watch(sessionPath, { recursive: true }, (eventType, filename) => {
        // Ignore internal files and hidden files
        if (filename && (filename.includes('session.jsonl') || filename.startsWith('.'))) {
          return
        }

        // Debounce: wait 100ms before notifying to batch rapid changes
        if (fileChangeDebounceTimer) {
          clearTimeout(fileChangeDebounceTimer)
        }
        fileChangeDebounceTimer = setTimeout(() => {
          // Notify all windows that session files changed
          const { BrowserWindow } = require('electron')
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC_CHANNELS.sessions.FILES_CHANGED, watchedSessionId)
          }
        }, 100)
      })
    } catch (error) {
      ipcLog.error('Failed to start session file watcher:', error)
    }
  })

  // Stop watching session files
  ipcMain.handle(IPC_CHANNELS.sessions.UNWATCH_FILES, async () => {
    if (sessionFileWatcher) {
      sessionFileWatcher.close()
      sessionFileWatcher = null
    }
    if (fileChangeDebounceTimer) {
      clearTimeout(fileChangeDebounceTimer)
      fileChangeDebounceTimer = null
    }
    if (watchedSessionId) {
      watchedSessionId = null
    }
  })

  // Get session notes (reads notes.md from session directory)
  ipcMain.handle(IPC_CHANNELS.sessions.GET_NOTES, async (_event, sessionId: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) return ''

    try {
      const notesPath = join(sessionPath, 'notes.md')
      const content = await readFile(notesPath, 'utf-8')
      return content
    } catch {
      // File doesn't exist yet - return empty string
      return ''
    }
  })

  // Set session notes (writes to notes.md in session directory)
  ipcMain.handle(IPC_CHANNELS.sessions.SET_NOTES, async (_event, sessionId: string, content: string) => {
    const sessionPath = sessionManager.getSessionPath(sessionId)
    if (!sessionPath) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    try {
      const notesPath = join(sessionPath, 'notes.md')
      await writeFile(notesPath, content, 'utf-8')
    } catch (error) {
      ipcLog.error('Failed to save session notes:', error)
      throw error
    }
  })
}
