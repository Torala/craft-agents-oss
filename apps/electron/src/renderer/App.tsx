import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { Session, Workspace, SessionEvent, Message, SubAgentMetadata, FileAttachment, StoredAttachment, PermissionRequest, SetupNeeds } from '../shared/types'
import { generateMessageId } from '../shared/types'
import { Chat } from '@/components/chat/Chat'
import { OnboardingWizard, ReauthScreen } from '@/components/onboarding'
import { AddWorkspaceFlow } from '@/components/AddWorkspaceFlow'
import { TooltipProvider } from '@/components/ui/tooltip'
import { FocusProvider } from '@/context/FocusContext'
import { useGlobalShortcuts } from '@/hooks/keyboard'
import { useOnboarding } from '@/hooks/useOnboarding'
import { useDeepLinkNavigation } from '@/hooks/useDeepLinkNavigation'
import { useTabs } from '@/tabs'
import { Spinner } from '@/components/ui/loading-indicator'
import { DEFAULT_MODEL } from '@config/models'

type AppState = 'loading' | 'onboarding' | 'reauth' | 'ready' | 'adding-workspace'

export default function App() {
  // App state: loading -> check auth -> onboarding or ready
  const [appState, setAppState] = useState<AppState>('loading')
  const [setupNeeds, setSetupNeeds] = useState<SetupNeeds | null>(null)

  const [sessions, setSessions] = useState<Session[]>([])
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [agents, setAgents] = useState<SubAgentMetadata[]>([])
  const [isLoadingAgents, setIsLoadingAgents] = useState(false)
  // Window's workspace ID - fixed for this window (multi-window architecture)
  const [windowWorkspaceId, setWindowWorkspaceId] = useState<string | null>(null)
  // Window mode - 'add-workspace' opens the wizard in a new window
  const [windowMode, setWindowMode] = useState<string | null>(null)
  const [currentModel, setCurrentModel] = useState(DEFAULT_MODEL)
  const [menuNewChatTrigger, setMenuNewChatTrigger] = useState(0)
  // Permission requests per session (queue to handle multiple concurrent requests)
  const [pendingPermissions, setPendingPermissions] = useState<Map<string, PermissionRequest[]>>(new Map())
  // Advanced options
  const [ultrathinkEnabled, setUltrathinkEnabled] = useState(false)
  const [skipPermissions, setSkipPermissions] = useState(false)

  // Queue for tool_result events that arrive before their tool_start (out-of-order handling)
  // Using ref to avoid stale closure issues in the useEffect event handler
  const orphanedToolResultsRef = useRef<Map<string, { result: string; toolName: string; turnId?: string }>>(new Map())
  // Ref for skipPermissions to access current value in event handlers without re-registering
  const skipPermissionsRef = useRef(skipPermissions)
  // Keep ref in sync with state
  useEffect(() => {
    skipPermissionsRef.current = skipPermissions
  }, [skipPermissions])

  // Handle onboarding completion
  const handleOnboardingComplete = useCallback(() => {
    // Reload workspaces after onboarding
    window.electronAPI.getWorkspaces().then((ws) => {
      setWorkspaces(ws)
      if (ws.length > 0) {
        // Open the new workspace's window (this will focus/create it)
        // and the current onboarding window will be replaced
        window.electronAPI.openWorkspace(ws[0].id)
      }
    })
    setAppState('ready')
    window.electronAPI.getSessions().then(setSessions)
  }, [])

  // Onboarding hook
  const onboarding = useOnboarding({
    onComplete: handleOnboardingComplete,
    initialSetupNeeds: setupNeeds || undefined,
  })

  // Add workspace completion handler
  const handleAddWorkspaceComplete = useCallback(() => {
    // Reload workspaces after adding
    window.electronAPI.getWorkspaces().then((ws) => {
      setWorkspaces(ws)
      if (ws.length > 0) {
        // Get the newly added workspace (last one in list)
        const newWorkspace = ws[ws.length - 1]
        // If this was an add-workspace window, transition to the new workspace
        // by opening it (which will update this window's workspace)
        window.electronAPI.openWorkspace(newWorkspace.id)
      }
    })
    // Note: Don't setAppState('ready') here - the window will be reloaded by openWorkspace
  }, [])

  // Add workspace cancel handler
  const handleAddWorkspaceCancel = useCallback(() => {
    // If this was an add-workspace window, close it
    if (windowMode === 'add-workspace') {
      window.electronAPI.closeWindow()
    } else {
      // Fallback for in-app flow (shouldn't happen anymore)
      setAppState('ready')
    }
  }, [windowMode])

  // Reauth login handler - re-authenticate with Craft when session expired
  const handleReauthLogin = useCallback(async () => {
    const result = await window.electronAPI.startCraftOAuth()
    if (result.success) {
      // Re-check setup needs after successful login
      const needs = await window.electronAPI.getSetupNeeds()
      if (needs.isFullyConfigured) {
        setAppState('ready')
      } else {
        // Still needs more setup (shouldn't happen normally, but handle gracefully)
        setSetupNeeds(needs)
        setAppState('onboarding')
      }
    } else {
      throw new Error(result.error || 'Login failed')
    }
  }, [])

  // Reauth logout handler - clear everything and start fresh
  const handleReauthLogout = useCallback(async () => {
    const confirmed = await window.electronAPI.showLogoutConfirmation()
    if (confirmed) {
      await window.electronAPI.logout()
      // Reset to full onboarding
      setSetupNeeds(null)
      setAppState('onboarding')
    }
  }, [])

  // Check auth state and get window's workspace ID on mount
  useEffect(() => {
    const initialize = async () => {
      try {
        // Get this window's workspace ID (passed via URL query param from main process)
        const wsId = await window.electronAPI.getWindowWorkspace()
        setWindowWorkspaceId(wsId)

        // Get window mode (e.g., 'add-workspace' for wizard window)
        const mode = await window.electronAPI.getWindowMode()
        setWindowMode(mode)

        // If this is an add-workspace window, show the wizard directly
        if (mode === 'add-workspace') {
          // Load workspaces for duplicate name validation
          const ws = await window.electronAPI.getWorkspaces()
          setWorkspaces(ws)
          setAppState('adding-workspace')
          return
        }

        const needs = await window.electronAPI.getSetupNeeds()
        setSetupNeeds(needs)

        if (needs.isFullyConfigured) {
          setAppState('ready')
        } else if (needs.needsReauth) {
          // Session expired - show simple re-login screen (preserves conversations)
          setAppState('reauth')
        } else {
          // New user or needs full setup - show full onboarding
          setAppState('onboarding')
        }
      } catch (error) {
        console.error('Failed to check auth state:', error)
        // If check fails, show onboarding to be safe
        setAppState('onboarding')
      }
    }

    initialize()
  }, [])

  // Tab system
  const { openSettingsTab, openShortcutsTab, openPreferencesTab, closeChatTabBySession } = useTabs()

  // Global shortcut: Cmd+/ to show keyboard shortcuts
  useGlobalShortcuts({
    shortcuts: [
      {
        key: '/',
        cmd: true,
        action: openShortcutsTab,
      },
    ],
  })

  // Load workspaces, sessions, and model when app is ready
  useEffect(() => {
    if (appState !== 'ready') return

    window.electronAPI.getWorkspaces().then(setWorkspaces)
    window.electronAPI.getSessions().then(setSessions)
    // Load stored model preference
    window.electronAPI.getModel().then((storedModel) => {
      if (storedModel) {
        setCurrentModel(storedModel)
      }
    })
  }, [appState])

  // Load agents when window's workspace is set
  useEffect(() => {
    if (windowWorkspaceId) {
      setIsLoadingAgents(true)
      window.electronAPI.getAgents(windowWorkspaceId)
        .then(setAgents)
        .finally(() => setIsLoadingAgents(false))
    } else {
      setAgents([])
      setIsLoadingAgents(false)
    }
  }, [windowWorkspaceId])

  // Listen for session events
  useEffect(() => {
    const cleanup = window.electronAPI.onSessionEvent((event: SessionEvent) => {
      // Handle permission requests separately (outside session state)
      // Use a queue to handle multiple concurrent permission requests
      if (event.type === 'permission_request') {
        // Auto-approve if skipPermissions is enabled
        if (skipPermissionsRef.current) {
          console.log('[App] Skip permissions enabled - auto-approving:', event.request.command)
          window.electronAPI.respondToPermission(event.sessionId, event.request.requestId, true, false)
          return
        }
        setPendingPermissions(prev => {
          const next = new Map(prev)
          const existingQueue = next.get(event.sessionId) || []
          next.set(event.sessionId, [...existingQueue, event.request])
          return next
        })
        return
      }

      // Handle complete event - clear any pending permission for the session
      if (event.type === 'complete') {
        setPendingPermissions(prev => {
          if (prev.has(event.sessionId)) {
            const next = new Map(prev)
            next.delete(event.sessionId)
            return next
          }
          return prev
        })
      }

      setSessions(prev => {
        return prev.map(session => {
          if (session.id !== event.sessionId) return session

          switch (event.type) {
            case 'text_delta': {
              const lastMsg = session.messages[session.messages.length - 1]

              // Append to existing streaming assistant if same turnId or no turnId
              if (lastMsg?.role === 'assistant' && lastMsg.isStreaming &&
                  (!event.turnId || lastMsg.turnId === event.turnId)) {
                return {
                  ...session,
                  messages: [
                    ...session.messages.slice(0, -1),
                    { ...lastMsg, content: lastMsg.content + event.delta }
                  ]
                }
              }

              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'assistant' as const,
                    content: event.delta,
                    timestamp: Date.now(),
                    isStreaming: true,
                    isPending: true,  // Don't know if intermediate yet - wait for text_complete
                    turnId: event.turnId
                  }
                ]
              }
            }

            case 'text_complete': {
              const msgs = session.messages
              // Find assistant message by turnId (not by position, since tools may be inserted after)
              const assistantIndex = event.turnId
                ? msgs.findIndex(m => m.role === 'assistant' && m.turnId === event.turnId)
                : msgs.findLastIndex(m => m.role === 'assistant' && m.isStreaming)

              if (assistantIndex !== -1) {
                const assistantMsg = msgs[assistantIndex]
                return {
                  ...session,
                  // Set isProcessing false immediately to prevent brief "Thinking..." flash
                  // If more tools run after this, tool_start will set it back to true
                  isProcessing: false,
                  messages: [
                    ...msgs.slice(0, assistantIndex),
                    { ...assistantMsg, content: event.text, isStreaming: false, isPending: false, isIntermediate: event.isIntermediate, turnId: event.turnId },
                    ...msgs.slice(assistantIndex + 1)
                  ]
                }
              }
              return session
            }

            case 'tool_start': {
              // Check if a message with this toolUseId already exists
              // SDK sends two events per tool: first from stream_event (empty input),
              // second from assistant message (complete input)
              const existingIndex = session.messages.findIndex(m => m.toolUseId === event.toolUseId)
              if (existingIndex !== -1) {
                // Update existing message with complete input (second event has full input)
                return {
                  ...session,
                  isProcessing: true, // Ensure processing state is set (tools may run after text_complete)
                  messages: session.messages.map((m, i) =>
                    i === existingIndex
                      ? { ...m, toolInput: event.toolInput }
                      : m
                  )
                }
              }

              // Check if we have a queued result for this tool (out-of-order case)
              // This handles tool_result arriving before tool_start
              const queuedResult = orphanedToolResultsRef.current.get(event.toolUseId)
              if (queuedResult) {
                orphanedToolResultsRef.current.delete(event.toolUseId)
                console.log(`[App] Applying queued tool_result for ${event.toolUseId} (${event.toolName})`)

                // Create message AND apply result in one update
                return {
                  ...session,
                  isProcessing: true,
                  messages: [
                    ...session.messages,
                    {
                      id: generateMessageId(),
                      role: 'tool' as const,
                      content: queuedResult.result,
                      timestamp: Date.now(),
                      toolName: event.toolName,
                      toolUseId: event.toolUseId,
                      toolInput: event.toolInput,
                      toolResult: queuedResult.result,
                      toolStatus: 'completed',  // Already complete!
                      turnId: event.turnId
                    }
                  ]
                }
              }

              // Normal case - create new pending tool message
              return {
                ...session,
                isProcessing: true, // Ensure processing state is set (tools may run after text_complete)
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'tool' as const,
                    content: `Running ${event.toolName}...`,
                    timestamp: Date.now(),
                    toolName: event.toolName,
                    toolUseId: event.toolUseId,
                    toolInput: event.toolInput,
                    turnId: event.turnId
                  }
                ]
              }
            }

            case 'tool_result': {
              const toolMsgs = session.messages
              const matchingTool = toolMsgs.find(m => m.toolUseId === event.toolUseId)

              if (matchingTool) {
                // Normal case - message exists, update it
                return {
                  ...session,
                  messages: toolMsgs.map(m =>
                    m.toolUseId === event.toolUseId
                      ? { ...m, content: event.result, toolResult: event.result, toolStatus: 'completed' }
                      : m
                  )
                }
              }

              // Message doesn't exist yet - queue the result for when tool_start arrives
              // This handles out-of-order events (result before start)
              orphanedToolResultsRef.current.set(event.toolUseId, {
                result: event.result,
                toolName: event.toolName,
                turnId: event.turnId
              })
              console.warn(`[App] tool_result arrived before tool_start for ${event.toolUseId} (${event.toolName}) - queued`)

              return session  // No change yet - will be applied when tool_start arrives
            }

            case 'error':
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'error' as const,
                    content: event.error,
                    timestamp: Date.now()
                  }
                ]
              }

            case 'typed_error':
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'error' as const,
                    content: event.error.title
                      ? `${event.error.title}: ${event.error.message}`
                      : event.error.message,
                    timestamp: Date.now(),
                    // Include error details for collapsible display
                    errorCode: event.error.code,
                    errorTitle: event.error.title,
                    errorDetails: event.error.details,
                    errorOriginal: event.error.originalError,
                    errorCanRetry: event.error.canRetry,
                  }
                ]
              }

            case 'status':
              return {
                ...session,
                messages: [
                  ...session.messages,
                  {
                    id: generateMessageId(),
                    role: 'status' as const,
                    content: event.message,
                    timestamp: Date.now()
                  }
                ]
              }

            case 'complete':
              // Clear any orphaned tool results (memory cleanup)
              // If any orphans exist, it indicates a bug - tool_start never arrived for some results
              if (orphanedToolResultsRef.current.size > 0) {
                console.warn(`[App] Session complete but ${orphanedToolResultsRef.current.size} orphaned tool results exist:`,
                  Array.from(orphanedToolResultsRef.current.keys()))
                orphanedToolResultsRef.current.clear()
              }
              return { ...session, isProcessing: false }

            case 'interrupted':
              return {
                ...session,
                isProcessing: false,
                messages: [
                  ...session.messages,
                  // Use message from main process (already persisted)
                  event.message as Message
                ]
              }

            case 'title_generated':
              return { ...session, name: event.title }

            default:
              return session
          }
        })
      })
    })

    return cleanup
  }, [])

  // Listen for menu bar events
  useEffect(() => {
    const unsubNewChat = window.electronAPI.onMenuNewChat(() => {
      setMenuNewChatTrigger(n => n + 1)
    })
    const unsubSettings = window.electronAPI.onMenuOpenSettings(() => {
      handleOpenSettings()
    })
    const unsubShortcuts = window.electronAPI.onMenuKeyboardShortcuts(() => {
      openShortcutsTab()
    })
    const unsubHelp = window.electronAPI.onMenuOpenHelp(() => {
      // Open help documentation URL
      window.electronAPI.openUrl('https://craft.do/help')
    })

    return () => {
      unsubNewChat()
      unsubSettings()
      unsubShortcuts()
      unsubHelp()
    }
  }, [openShortcutsTab])

  const handleCreateSession = useCallback(async (workspaceId: string, agentId?: string): Promise<Session> => {
    // Find agent if provided - prefer displayName for human-readable title
    const agent = agentId ? agents.find(a => a.id === agentId) : undefined
    const agentName = agent?.displayName || agent?.name
    // Pass agentName to main process so it's stored in the session
    const session = await window.electronAPI.createSession(workspaceId, agentId, agentName)
    setSessions(prev => [session, ...prev])
    return session
  }, [agents])

  // Deep link navigation - handles craftagents:// URLs
  // Must be after handleCreateSession is defined
  useDeepLinkNavigation({
    workspaceId: windowWorkspaceId,
    onCreateSession: handleCreateSession,
    isReady: appState === 'ready',
  })

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    // Close the tab first to prevent race conditions where the tab
    // tries to render while the session is being deleted
    closeChatTabBySession(sessionId)
    await window.electronAPI.deleteSession(sessionId)
    setSessions(prev => prev.filter(s => s.id !== sessionId))
  }, [closeChatTabBySession])

  const handleArchiveSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.archiveSession(sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isArchived: true } : s
    ))
  }, [])

  const handleUnarchiveSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.unarchiveSession(sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isArchived: false } : s
    ))
  }, [])

  const handleFlagSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.flagSession(sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isFlagged: true } : s
    ))
  }, [])

  const handleUnflagSession = useCallback(async (sessionId: string) => {
    await window.electronAPI.unflagSession(sessionId)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, isFlagged: false } : s
    ))
  }, [])

  const handleRenameSession = useCallback(async (sessionId: string, name: string) => {
    await window.electronAPI.renameSession(sessionId, name)
    // Update state immediately (don't rely on event timing)
    setSessions(prev => prev.map(s =>
      s.id === sessionId ? { ...s, name } : s
    ))
  }, [])

  const handleSendMessage = useCallback(async (sessionId: string, message: string, attachments?: FileAttachment[]) => {
    try {
      // Step 1: Store attachments and get persistent metadata
      let storedAttachments: StoredAttachment[] | undefined
      let processedAttachments: FileAttachment[] | undefined

      if (attachments?.length) {
        // Store each attachment to disk (generates thumbnails, converts Office→markdown)
        // Use allSettled so one failure doesn't kill all attachments
        const storeResults = await Promise.allSettled(
          attachments.map(a => window.electronAPI.storeAttachment(sessionId, a))
        )

        // Filter successful stores, warn about failures
        storedAttachments = []
        const successfulAttachments: FileAttachment[] = []
        storeResults.forEach((result, i) => {
          if (result.status === 'fulfilled') {
            storedAttachments!.push(result.value)
            successfulAttachments.push(attachments[i])
          } else {
            console.warn(`Failed to store attachment "${attachments[i].name}":`, result.reason)
          }
        })

        // Notify user about failed attachments
        const failedCount = storeResults.filter(r => r.status === 'rejected').length
        if (failedCount > 0) {
          console.warn(`${failedCount} attachment(s) failed to store`)
          // Add warning message to session so user knows some attachments weren't included
          const failedNames = attachments
            .filter((_, i) => storeResults[i].status === 'rejected')
            .map(a => a.name)
            .join(', ')
          setSessions(prev => prev.map(s =>
            s.id === sessionId
              ? {
                  ...s,
                  messages: [...s.messages, {
                    id: generateMessageId(),
                    role: 'warning' as const,
                    content: `⚠️ ${failedCount} attachment(s) could not be stored and will not be sent: ${failedNames}`,
                    timestamp: Date.now()
                  }]
                }
              : s
          ))
        }

        // Step 2: Create processed attachments for Claude
        // - Office files: Convert to text with markdown content
        // - Others: Use original FileAttachment
        processedAttachments = await Promise.all(
          successfulAttachments.map(async (att, i) => {
            const stored = storedAttachments?.[i]
            if (!stored) {
              console.error(`Missing stored attachment at index ${i}`)
              return att // Fall back to original
            }
            if (att.type === 'office' && stored.markdownPath) {
              // Read the converted markdown and send as text
              const markdown = await window.electronAPI.readFile(stored.markdownPath)
              return {
                ...att,
                type: 'text' as const,
                text: markdown,
                base64: undefined, // Don't send binary
              }
            }
            return att
          })
        )
      }

      // Step 3: Create user message with StoredAttachments (for UI display)
      const userMessage: Message = {
        id: generateMessageId(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
        attachments: storedAttachments,
      }

      setSessions(prev => prev.map(s =>
        s.id === sessionId
          ? { ...s, messages: [...s.messages, userMessage], isProcessing: true, lastMessageAt: Date.now() }
          : s
      ))

      // Step 4: Send to Claude with processed attachments + stored attachments for persistence
      await window.electronAPI.sendMessage(sessionId, message, processedAttachments, storedAttachments, {
        ultrathinkEnabled,
      })

      // Auto-disable ultrathink after sending (single-shot activation)
      if (ultrathinkEnabled) {
        setUltrathinkEnabled(false)
      }
    } catch (error) {
      console.error('Failed to send message:', error)
      setSessions(prev => prev.map(s =>
        s.id === sessionId
          ? {
              ...s,
              isProcessing: false,
              messages: [
                ...s.messages,
                {
                  id: generateMessageId(),
                  role: 'error' as const,
                  content: `Failed to send message: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  timestamp: Date.now()
                }
              ]
            }
          : s
      ))
    }
  }, [ultrathinkEnabled])

  const handleRefreshAgents = useCallback(async () => {
    if (windowWorkspaceId) {
      setIsLoadingAgents(true)
      try {
        const refreshedAgents = await window.electronAPI.refreshAgents(windowWorkspaceId)
        setAgents(refreshedAgents)
      } finally {
        setIsLoadingAgents(false)
      }
    }
  }, [windowWorkspaceId])

  const handleModelChange = useCallback((model: string) => {
    setCurrentModel(model)
    // Persist to config so it's remembered across launches
    window.electronAPI.setModel(model)
  }, [])

  const handleUltrathinkChange = useCallback((enabled: boolean) => {
    setUltrathinkEnabled(enabled)
  }, [])

  const handleSkipPermissionsChange = useCallback((enabled: boolean) => {
    setSkipPermissions(enabled)
  }, [])

  const handleRespondToPermission = useCallback(async (sessionId: string, requestId: string, allowed: boolean, alwaysAllow: boolean) => {
    // Send response to main process
    const success = await window.electronAPI.respondToPermission(sessionId, requestId, allowed, alwaysAllow)

    if (success) {
      // Remove only the first permission from the queue (the one we just responded to)
      setPendingPermissions(prev => {
        const next = new Map(prev)
        const queue = next.get(sessionId) || []
        const remainingQueue = queue.slice(1) // Remove first item
        if (remainingQueue.length === 0) {
          next.delete(sessionId)
        } else {
          next.set(sessionId, remainingQueue)
        }
        return next
      })
    } else {
      // Response failed (agent/session gone) - clear the permission anyway
      // to avoid UI being stuck with stale permission
      console.error('Permission response failed - agent may be gone')
      setPendingPermissions(prev => {
        const next = new Map(prev)
        const queue = next.get(sessionId) || []
        const remainingQueue = queue.slice(1)
        if (remainingQueue.length === 0) {
          next.delete(sessionId)
        } else {
          next.set(sessionId, remainingQueue)
        }
        return next
      })
    }
  }, [])

  const handleOpenFile = useCallback(async (path: string) => {
    try {
      await window.electronAPI.openFile(path)
    } catch (error) {
      console.error('Failed to open file:', error)
    }
  }, [])

  const handleOpenUrl = useCallback(async (url: string) => {
    try {
      await window.electronAPI.openUrl(url)
    } catch (error) {
      console.error('Failed to open URL:', error)
    }
  }, [])

  const handleOpenSettings = useCallback(() => {
    openSettingsTab()
  }, [openSettingsTab])

  const handleOpenKeyboardShortcuts = useCallback(() => {
    openShortcutsTab()
  }, [openShortcutsTab])

  const handleOpenStoredUserPreferences = useCallback(() => {
    openPreferencesTab()
  }, [openPreferencesTab])

  const handleLogout = useCallback(async () => {
    try {
      // Show native confirmation dialog
      const confirmed = await window.electronAPI.showLogoutConfirmation()
      if (!confirmed) return

      await window.electronAPI.logout()
      // Reset all state
      setSessions([])
      setWorkspaces([])
      setAgents([])
      setWindowWorkspaceId(null)
      // Reset setupNeeds to force fresh onboarding start
      setSetupNeeds({
        needsCraftAuth: true,
        needsReauth: false,
        needsBillingConfig: true,
        needsCredentials: true,
        isFullyConfigured: false,
      })
      // Reset onboarding hook state
      onboarding.reset()
      setAppState('onboarding')
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }, [onboarding])

  // Start add workspace flow (opens in new window)
  const handleAddWorkspace = useCallback(() => {
    window.electronAPI.openAddWorkspaceWindow()
  }, [])

  // Handle workspace selection - opens workspace in its own window (multi-window architecture)
  const handleSelectWorkspace = useCallback((workspaceId: string) => {
    // If selecting current workspace, do nothing
    if (workspaceId === windowWorkspaceId) return
    // Open (or focus) the window for the selected workspace
    window.electronAPI.openWorkspace(workspaceId)
  }, [windowWorkspaceId])

  // Handle cancel during onboarding
  const handleOnboardingCancel = useCallback(() => {
    onboarding.handleCancel()
  }, [onboarding])

  // Loading state
  if (appState === 'loading') {
    return (
      <div className="h-full flex items-center justify-center bg-background text-foreground">
        <div className="flex flex-col items-center gap-4">
          <Spinner className="text-2xl text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  // Reauth state - session expired, need to re-login
  if (appState === 'reauth') {
    return (
      <ReauthScreen
        onLogin={handleReauthLogin}
        onLogout={handleReauthLogout}
      />
    )
  }

  // Onboarding state
  if (appState === 'onboarding') {
    return (
      <OnboardingWizard
        state={onboarding.state}
        spaceCategories={onboarding.spaceCategories}
        isLoadingSpaces={onboarding.isLoadingSpaces}
        onCancel={handleOnboardingCancel}
        onContinue={onboarding.handleContinue}
        onBack={onboarding.handleBack}
        onLogin={onboarding.handleLogin}
        onOpenLoginManually={onboarding.handleOpenLoginManually}
        onRetryLogin={onboarding.handleRetryLogin}
        onSelectSpace={onboarding.handleSelectSpace}
        onSelectBillingMethod={onboarding.handleSelectBillingMethod}
        onSubmitCredential={onboarding.handleSubmitCredential}
        onStartOAuth={onboarding.handleStartOAuth}
        onFinish={onboarding.handleFinish}
        existingClaudeToken={onboarding.existingClaudeToken}
        isClaudeCliInstalled={onboarding.isClaudeCliInstalled}
        onUseExistingClaudeToken={onboarding.handleUseExistingClaudeToken}
      />
    )
  }

  // Add workspace state (separate from onboarding)
  // Render AddWorkspaceFlow only when visible so the hook mounts/unmounts properly
  if (appState === 'adding-workspace') {
    return (
      <AddWorkspaceFlow
        onComplete={handleAddWorkspaceComplete}
        onCancel={handleAddWorkspaceCancel}
        existingWorkspaceNames={workspaces.map(w => w.name)}
      />
    )
  }

  // Ready state - main app
  return (
    <FocusProvider>
      <TooltipProvider>
        <div className="h-full text-foreground">
          <Chat
            workspaces={workspaces}
            sessions={sessions}
            agents={agents}
            isLoadingAgents={isLoadingAgents}
            activeWorkspaceId={windowWorkspaceId}
            defaultLayout={[20, 32, 48]}
            currentModel={currentModel}
            menuNewChatTrigger={menuNewChatTrigger}
            onModelChange={handleModelChange}
            onSelectWorkspace={handleSelectWorkspace}
            onCreateSession={handleCreateSession}
            onDeleteSession={handleDeleteSession}
            onArchiveSession={handleArchiveSession}
            onUnarchiveSession={handleUnarchiveSession}
            onFlagSession={handleFlagSession}
            onUnflagSession={handleUnflagSession}
            onRenameSession={handleRenameSession}
            onSendMessage={handleSendMessage}
            onOpenFile={handleOpenFile}
            onOpenUrl={handleOpenUrl}
            onOpenSettings={handleOpenSettings}
            onOpenKeyboardShortcuts={handleOpenKeyboardShortcuts}
            onOpenStoredUserPreferences={handleOpenStoredUserPreferences}
            onRefreshAgents={handleRefreshAgents}
            onLogout={handleLogout}
            onAddWorkspace={handleAddWorkspace}
            pendingPermissions={pendingPermissions}
            onRespondToPermission={handleRespondToPermission}
            // Advanced options
            ultrathinkEnabled={ultrathinkEnabled}
            onUltrathinkChange={handleUltrathinkChange}
            skipPermissions={skipPermissions}
            onSkipPermissionsChange={handleSkipPermissionsChange}
          />
        </div>
      </TooltipProvider>
    </FocusProvider>
  )
}
