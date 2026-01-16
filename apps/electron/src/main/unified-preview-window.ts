import { BrowserWindow, shell, nativeTheme } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { windowLog } from './logger'
import { join, basename } from 'path'
import { IPC_CHANNELS, type PreviewData, type MarkdownPreviewData } from '../shared/types'
import type { WindowManager } from './window-manager'

// Vite dev server URL for hot reload
const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

/**
 * Internal window data - stores preview data and markdown-specific state
 */
interface PreviewWindowData {
  window: BrowserWindow
  sessionId: string
  previewId: string
  data: PreviewData
  /** For markdown mode: resolved content */
  markdownContent?: string
  /** For markdown mode: original content for change detection */
  markdownOriginalContent?: string
}

/**
 * Get window title based on preview mode
 */
function getWindowTitle(data: PreviewData): string {
  switch (data.mode) {
    case 'markdown': {
      const md = data.markdown
      if (md.title) return md.title
      if ('filePath' in md) return basename(md.filePath)
      return 'Markdown Preview'
    }
    case 'view': {
      const modeLabel = data.view.toolType === 'read' ? 'Read' : 'Write'
      return `${modeLabel}: ${data.view.filePath}`
    }
    case 'diff':
      return `Diff: ${data.diff.filePath}`
    case 'multi-diff': {
      const count = data.multiDiff.changes.length
      return `Changes (${count} file${count !== 1 ? 's' : ''})`
    }
    case 'terminal': {
      const cmdPreview = data.terminal.command.length > 50
        ? data.terminal.command.substring(0, 47) + '...'
        : data.terminal.command
      return `Terminal: ${cmdPreview}`
    }
  }
}

/**
 * Get window dimensions based on preview mode
 */
function getWindowDimensions(data: PreviewData): { width: number; height: number; minWidth: number; minHeight: number } {
  switch (data.mode) {
    case 'markdown':
      return { width: 900, height: 700, minWidth: 600, minHeight: 400 }
    case 'view':
      return { width: 900, height: 700, minWidth: 600, minHeight: 400 }
    case 'diff':
      return { width: 1100, height: 800, minWidth: 800, minHeight: 500 }
    case 'multi-diff':
      return { width: 1200, height: 800, minWidth: 900, minHeight: 600 }
    case 'terminal':
      return { width: 900, height: 600, minWidth: 500, minHeight: 300 }
  }
}

/**
 * UnifiedPreviewWindowManager - Single manager for all preview windows
 *
 * Handles:
 * - 'markdown' mode: Markdown content with optional save
 * - 'view' mode: Read/Write tool results (syntax highlighted code)
 * - 'diff' mode: Single Edit tool result (diff view)
 * - 'multi-diff' mode: Multiple edits/writes with file sidebar
 * - 'terminal' mode: Bash/Grep/Glob tool output
 */
export class UnifiedPreviewWindowManager {
  private windows: Map<string, PreviewWindowData> = new Map()
  private windowManager: WindowManager | null = null

  /**
   * Set the window manager for broadcasting file save events
   */
  setWindowManager(windowManager: WindowManager): void {
    this.windowManager = windowManager
  }

  /**
   * Generate key for a preview window
   */
  private getKey(sessionId: string, previewId: string): string {
    return `${sessionId}:${previewId}`
  }

  /**
   * Open or focus an existing preview window
   */
  async openPreview(data: PreviewData): Promise<BrowserWindow> {
    const { sessionId, previewId } = data
    const key = this.getKey(sessionId, previewId)

    // If window exists and is not destroyed, focus it
    const existing = this.windows.get(key)
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) {
        existing.window.restore()
      }
      existing.window.focus()
      // Update data if changed
      existing.data = data
      return existing.window
    }

    // For markdown mode, resolve content if needed
    let markdownContent: string | undefined
    let markdownOriginalContent: string | undefined
    if (data.mode === 'markdown') {
      const md = data.markdown
      if ('content' in md) {
        markdownContent = md.content
      } else {
        try {
          markdownContent = await readFile(md.filePath, 'utf-8')
        } catch (err) {
          windowLog.error(`[UnifiedPreviewWindowManager] Failed to read file: ${md.filePath}`, err)
          markdownContent = `Error reading file: ${err instanceof Error ? err.message : String(err)}`
        }
      }
      markdownOriginalContent = markdownContent
    }

    const title = getWindowTitle(data)
    const dimensions = getWindowDimensions(data)

    // Note: Don't set backgroundColor here - the HTML/CSS handles it based on the user's
    // saved theme preference (read from localStorage in preview.html inline script).
    // Using nativeTheme.shouldUseDarkColors would use system preference, not user preference.
    // We use show: false + ready-to-show to avoid any white flash before content renders.
    const window = new BrowserWindow({
      ...dimensions,
      title,
      show: false, // Don't show until content is ready (prevents white flash)
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 18, y: 18 },
      vibrancy: 'under-window',
      visualEffectState: 'active',
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    })

    // Show window only after first paint is ready (prevents white flash)
    window.once('ready-to-show', () => {
      window.show()
    })

    // Open external links in default browser
    window.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // Store window data BEFORE loading URL
    this.windows.set(key, {
      window,
      sessionId,
      previewId,
      data,
      markdownContent,
      markdownOriginalContent,
    })

    // Load the unified preview renderer
    // Pass resolvedTheme from the main window to ensure the preview uses the same theme
    // as the user's app preference, not re-evaluating system preference when mode='system'
    const query: Record<string, string> = { sessionId, previewId }
    if (data.resolvedTheme) {
      query.theme = data.resolvedTheme
    }

    if (VITE_DEV_SERVER_URL) {
      const params = new URLSearchParams(query).toString()
      window.loadURL(`${VITE_DEV_SERVER_URL}/preview.html?${params}`)
    } else {
      window.loadFile(join(__dirname, 'renderer/preview.html'), { query })
    }

    // Listen for system theme changes
    const themeHandler = () => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        window.webContents.send(IPC_CHANNELS.SYSTEM_THEME_CHANGED, nativeTheme.shouldUseDarkColors)
      }
    }
    nativeTheme.on('updated', themeHandler)

    // Clean up when window is closed
    window.on('closed', () => {
      nativeTheme.removeListener('updated', themeHandler)
      this.windows.delete(key)
      windowLog.info(`[UnifiedPreviewWindowManager] Preview window closed for ${key} (mode: ${data.mode})`)
    })

    windowLog.info(`[UnifiedPreviewWindowManager] Created preview window for ${key} (mode: ${data.mode})`)
    return window
  }

  /**
   * Get data for a preview window (called from renderer on mount)
   * For markdown mode, includes resolved content
   */
  getData(sessionId: string, previewId: string): PreviewData | null {
    const key = this.getKey(sessionId, previewId)
    const windowData = this.windows.get(key)
    return windowData?.data ?? null
  }

  /**
   * Get markdown content for markdown previews
   */
  getMarkdownContent(sessionId: string, previewId: string): string | null {
    const key = this.getKey(sessionId, previewId)
    const windowData = this.windows.get(key)
    return windowData?.markdownContent ?? null
  }

  /**
   * Save content to file (only works for markdown readWrite mode)
   */
  async save(sessionId: string, previewId: string, content: string): Promise<void> {
    const key = this.getKey(sessionId, previewId)
    const windowData = this.windows.get(key)
    if (!windowData) {
      throw new Error('Preview window not found')
    }

    if (windowData.data.mode !== 'markdown') {
      throw new Error('Save is only supported for markdown mode')
    }

    const md = windowData.data.markdown as MarkdownPreviewData
    if (md.mode !== 'readWrite') {
      throw new Error('Cannot save in read-only mode')
    }

    const filePath = md.filePath
    await writeFile(filePath, content, 'utf-8')

    // Update stored content
    windowData.markdownContent = content
    windowData.markdownOriginalContent = content

    windowLog.info(`[UnifiedPreviewWindowManager] Saved content to ${filePath}`)

    // Broadcast file saved event to all workspace windows
    if (this.windowManager) {
      this.windowManager.broadcastToAll(IPC_CHANNELS.PREVIEW_FILE_SAVED, { filePath })
    }
  }

  /**
   * Read a file's content (for "full file" view in multi-diff mode)
   */
  async readFileForPreview(filePath: string): Promise<string | null> {
    try {
      const content = await readFile(filePath, 'utf-8')
      return content
    } catch (err) {
      windowLog.warn(`[UnifiedPreviewWindowManager] Failed to read file ${filePath}:`, err)
      return null
    }
  }

  /**
   * Close all preview windows for a session
   */
  closeWindowsForSession(sessionId: string): void {
    for (const [, data] of this.windows) {
      if (data.sessionId === sessionId && !data.window.isDestroyed()) {
        data.window.close()
      }
    }
  }

  /**
   * Close all preview windows
   */
  closeAll(): void {
    for (const [, data] of this.windows) {
      if (!data.window.isDestroyed()) {
        data.window.close()
      }
    }
  }

  /**
   * Get all preview windows
   */
  getAllWindows(): PreviewWindowData[] {
    return Array.from(this.windows.values()).filter((d) => !d.window.isDestroyed())
  }
}
