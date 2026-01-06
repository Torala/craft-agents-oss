/**
 * Craft Agent Session Viewer
 *
 * A minimal web app for viewing Craft Agent session transcripts.
 * Users can upload session JSON files and view them in a clean, read-only interface.
 */

import { useState, useCallback, useEffect } from 'react'
import type { StoredSession } from '@craft-agent/core'
import { ChatView, CodeOverlay, type PlatformActions, type ActivityItem } from '@craft-agent/ui'
import { SessionUpload } from './components/SessionUpload'
import { Header } from './components/Header'

export function App() {
  const [session, setSession] = useState<StoredSession | null>(null)
  const [isDark, setIsDark] = useState(() => {
    // Check system preference on mount
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })

  // Apply dark mode class to html element
  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  const handleSessionLoad = useCallback((loadedSession: StoredSession) => {
    setSession(loadedSession)
  }, [])

  const handleClear = useCallback(() => {
    setSession(null)
  }, [])

  const toggleTheme = useCallback(() => {
    setIsDark(prev => !prev)
  }, [])

  // State for code overlay
  const [overlayActivity, setOverlayActivity] = useState<ActivityItem | null>(null)

  // Handle activity click - show in overlay
  const handleActivityClick = useCallback((activity: ActivityItem) => {
    setOverlayActivity(activity)
  }, [])

  const handleCloseOverlay = useCallback(() => {
    setOverlayActivity(null)
  }, [])

  // Get overlay content from activity
  const getOverlayContent = (activity: ActivityItem): string => {
    // For activities with content (tool results), show that
    if (activity.content) {
      return activity.content
    }
    // For tool calls, show the input as JSON
    if (activity.toolInput) {
      return JSON.stringify(activity.toolInput, null, 2)
    }
    return ''
  }

  // Get overlay title from activity
  const getOverlayTitle = (activity: ActivityItem): string => {
    const toolName = activity.displayName || activity.toolName || 'Activity'
    // If it's a file operation, try to get the file path
    if (activity.toolInput) {
      const input = activity.toolInput as Record<string, unknown>
      if (input.file_path && typeof input.file_path === 'string') {
        return input.file_path
      }
      if (input.path && typeof input.path === 'string') {
        return input.path
      }
    }
    return toolName
  }

  // Platform actions for the viewer (limited functionality)
  const platformActions: PlatformActions = {
    onOpenUrl: (url) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    },
    onCopyToClipboard: async (text) => {
      await navigator.clipboard.writeText(text)
    },
  }

  return (
    <div className="h-full flex flex-col bg-background text-foreground">
      <Header
        hasSession={!!session}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onClear={handleClear}
      />

      {session ? (
        <ChatView
          session={session}
          mode="readonly"
          platformActions={platformActions}
          defaultExpanded={true}
          className="flex-1 min-h-0"
          onActivityClick={handleActivityClick}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center p-8">
          <SessionUpload onSessionLoad={handleSessionLoad} />
        </div>
      )}

      {/* Code overlay for viewing activity details */}
      <CodeOverlay
        isOpen={!!overlayActivity}
        onClose={handleCloseOverlay}
        content={overlayActivity ? getOverlayContent(overlayActivity) : ''}
        title={overlayActivity ? getOverlayTitle(overlayActivity) : ''}
      />
    </div>
  )
}
