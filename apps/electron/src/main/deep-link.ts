/**
 * Deep Link Handler
 *
 * Parses craftagents:// URLs and routes to appropriate actions.
 *
 * URL Format:
 *   craftagents://workspace/{workspaceId}/tab/{tabType}[/{id}][?params]
 *   craftagents://workspace/{workspaceId}/action/{actionName}[?params]
 *
 * Examples:
 *   craftagents://workspace/ws123/tab/chat/session456
 *   craftagents://workspace/ws123/tab/agent-info/my-agent
 *   craftagents://workspace/ws123/tab/settings
 *   craftagents://workspace/ws123/tab/file?path=/path/to/file.txt
 *   craftagents://workspace/ws123/action/new-chat?agentId=my-agent
 */

import type { BrowserWindow } from 'electron'
import type { WindowManager } from './window-manager'
import { IPC_CHANNELS } from '../shared/types'

export interface DeepLinkTarget {
  workspaceId: string
  tabType?: string
  tabParams?: Record<string, string>
  action?: string
  actionParams?: Record<string, string>
}

export interface DeepLinkResult {
  success: boolean
  error?: string
  windowId?: number
}

/**
 * Navigation payload sent to renderer via IPC
 */
export interface DeepLinkNavigation {
  tabType?: string
  tabParams?: Record<string, string>
  action?: string
  actionParams?: Record<string, string>
}

/**
 * Parse a deep link URL into structured target
 */
export function parseDeepLink(url: string): DeepLinkTarget | null {
  try {
    const parsed = new URL(url)

    if (parsed.protocol !== 'craftagents:') {
      return null
    }

    // For custom protocols, the hostname contains the first path segment
    // e.g., craftagents://workspace/ws123 → hostname='workspace', pathname='/ws123'
    const host = parsed.hostname
    const pathParts = parsed.pathname.split('/').filter(Boolean)

    // craftagents://workspace/{workspaceId}/...
    if (host === 'workspace') {
      const workspaceId = pathParts[0]
      if (!workspaceId) return null

      const result: DeepLinkTarget = { workspaceId }

      // Parse /tab/{tabType}/...
      if (pathParts[1] === 'tab') {
        result.tabType = pathParts[2]
        result.tabParams = {}

        // Handle path-based params (e.g., /tab/chat/{sessionId})
        if (pathParts[3]) {
          result.tabParams.id = pathParts[3]
        }

        // Handle query params (e.g., ?path=...&url=...)
        parsed.searchParams.forEach((value, key) => {
          result.tabParams![key] = value
        })
      }

      // Parse /action/{actionName}/...
      if (pathParts[1] === 'action') {
        result.action = pathParts[2]
        result.actionParams = {}
        parsed.searchParams.forEach((value, key) => {
          result.actionParams![key] = value
        })
      }

      return result
    }

    // craftagents://auth-callback?... (OAuth callbacks - return null to let existing handler process)
    if (host === 'auth-callback') {
      return null
    }

    return null
  } catch (error) {
    console.error('[DeepLink] Failed to parse URL:', url, error)
    return null
  }
}

/**
 * Generate a deep link URL from components
 */
export function generateDeepLinkUrl(
  workspaceId: string,
  tabType: string,
  params?: Record<string, string>
): string {
  let url = `craftagents://workspace/${workspaceId}/tab/${tabType}`

  // For simple tab types with an ID, append to path
  if (params?.id && !params.path && !params.url) {
    url += `/${params.id}`
    // Remove id from params so it's not duplicated in query string
    const { id: _id, ...remainingParams } = params
    params = Object.keys(remainingParams).length > 0 ? remainingParams : undefined
  }

  // Add remaining params as query string
  if (params && Object.keys(params).length > 0) {
    const searchParams = new URLSearchParams(params)
    url += `?${searchParams.toString()}`
  }

  return url
}

/**
 * Wait for window's renderer to signal ready
 */
function waitForWindowReady(window: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    if (window.webContents.isLoading()) {
      window.webContents.once('did-finish-load', () => {
        // Small delay to ensure React has mounted
        setTimeout(resolve, 100)
      })
    } else {
      resolve()
    }
  })
}

/**
 * Handle a deep link by navigating to the target
 */
export async function handleDeepLink(
  url: string,
  windowManager: WindowManager
): Promise<DeepLinkResult> {
  const target = parseDeepLink(url)

  if (!target) {
    // Return success for null targets (like auth-callback) - they're handled elsewhere
    if (url.includes('auth-callback')) {
      return { success: true }
    }
    return { success: false, error: 'Invalid deep link URL' }
  }

  console.log('[DeepLink] Handling:', target)

  // 1. Focus or create window for workspace
  const window = windowManager.focusOrCreateWindow(target.workspaceId)

  // 2. Wait for window to be ready (renderer loaded)
  await waitForWindowReady(window)

  // 3. Send navigation command to renderer
  if (target.tabType || target.action) {
    const navigation: DeepLinkNavigation = {
      tabType: target.tabType,
      tabParams: target.tabParams,
      action: target.action,
      actionParams: target.actionParams,
    }
    window.webContents.send(IPC_CHANNELS.DEEP_LINK_NAVIGATE, navigation)
  }

  return { success: true, windowId: window.webContents.id }
}
