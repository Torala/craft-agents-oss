/**
 * useDeepLinkNavigation Hook
 *
 * Listens for deep link navigation events from main process
 * and navigates to the appropriate tab.
 *
 * Deep links are sent via IPC when:
 * - App is launched with a craftagents:// URL
 * - User clicks a craftagents:// link while app is running
 */

import { useCallback, useEffect, useRef } from 'react'
import { useTabs } from '@/tabs'
import type { DeepLinkNavigation, Session } from '../../shared/types'

interface UseDeepLinkNavigationOptions {
  /** Current workspace ID (from window context) */
  workspaceId: string | null
  /** Session creation handler */
  onCreateSession: (workspaceId: string, agentId?: string) => Promise<Session>
  /** Whether the app is ready to navigate (sessions loaded, etc.) */
  isReady?: boolean
}

/**
 * Hook that listens for deep link navigation events and navigates to tabs
 *
 * Uses existing tab system which handles deduplication automatically
 * via openTabAtom (if tab with same ID exists, it's activated instead of created)
 */
export function useDeepLinkNavigation({
  workspaceId,
  onCreateSession,
  isReady = true,
}: UseDeepLinkNavigationOptions) {
  const {
    openChatTab,
    openSettingsTab,
    openShortcutsTab,
    openPreferencesTab,
    openAgentInfoTab,
    openFileTab,
    openBrowserTab,
  } = useTabs()

  // Queue navigation if not ready yet
  const pendingNavigationRef = useRef<DeepLinkNavigation | null>(null)

  // Process navigation - memoized to satisfy exhaustive-deps
  const handleNavigate = useCallback(async (nav: DeepLinkNavigation) => {
    if (!workspaceId) {
      console.warn('[DeepLink] Cannot navigate: no workspace ID')
      return
    }

    console.log('[DeepLink] Navigating:', nav)

    // Handle tab navigation
    if (nav.tabType) {
      switch (nav.tabType) {
        case 'chat':
          if (nav.tabParams?.id) {
            // Open existing chat session
            // Tab system will deduplicate if already open
            openChatTab(nav.tabParams.id, workspaceId, 'Chat')
          }
          break

        case 'settings':
          openSettingsTab()
          break

        case 'shortcuts':
          openShortcutsTab()
          break

        case 'preferences':
          openPreferencesTab()
          break

        case 'agent-info':
          if (nav.tabParams?.id) {
            // Agent name will be updated by the tab panel
            openAgentInfoTab(nav.tabParams.id, workspaceId, 'Agent')
          }
          break

        case 'file':
          if (nav.tabParams?.path) {
            openFileTab(nav.tabParams.path)
          }
          break

        case 'browser':
          if (nav.tabParams?.url) {
            openBrowserTab(nav.tabParams.url)
          }
          break

        default:
          console.warn('[DeepLink] Unknown tab type:', nav.tabType)
      }
    }

    // Handle actions
    if (nav.action) {
      switch (nav.action) {
        case 'new-chat': {
          const session = await onCreateSession(
            workspaceId,
            nav.actionParams?.agentId
          )
          openChatTab(
            session.id,
            workspaceId,
            session.name || 'New Chat',
            nav.actionParams?.agentId
          )
          break
        }

        default:
          console.warn('[DeepLink] Unknown action:', nav.action)
      }
    }
  }, [
    workspaceId,
    openChatTab,
    openSettingsTab,
    openShortcutsTab,
    openPreferencesTab,
    openAgentInfoTab,
    openFileTab,
    openBrowserTab,
    onCreateSession,
  ])

  // Process pending navigation when ready
  useEffect(() => {
    if (isReady && pendingNavigationRef.current) {
      const pending = pendingNavigationRef.current
      pendingNavigationRef.current = null
      handleNavigate(pending)
    }
  }, [isReady, handleNavigate])

  // Listen for deep link navigation events from main process
  useEffect(() => {
    if (!workspaceId) return

    const cleanup = window.electronAPI.onDeepLinkNavigate((nav) => {
      if (isReady) {
        handleNavigate(nav)
      } else {
        // Queue for later
        pendingNavigationRef.current = nav
      }
    })

    return cleanup
  }, [workspaceId, isReady, handleNavigate])
}
