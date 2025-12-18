/**
 * ChatTabPanel
 *
 * Wraps the ChatDisplay component for use in the tab system.
 * Gets session data from ChatContext and agent status from main process.
 */

import * as React from 'react'
import { AlertCircle, Bot, Loader2 } from 'lucide-react'
import { ChatDisplay } from '@/components/chat/ChatDisplay'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/loading-indicator'
import { useChatContext, usePendingPermission } from '@/context/ChatContext'
import { useAgentState } from '../../hooks/useAgentState'
import type { Tab, ChatTab } from '../types'
import { useTabs } from '../useTabs'

interface ChatTabPanelProps {
  tab: Tab
}

export default function ChatTabPanel({ tab }: ChatTabPanelProps) {
  const chatTab = tab as ChatTab
  const {
    sessions,
    currentModel,
    onSendMessage,
    onOpenFile,
    onOpenUrl,
    onModelChange,
    onRespondToPermission,
    textareaRef,
  } = useChatContext()

  const { closeTab } = useTabs()

  // Find the session for this tab
  const session = sessions.find((s) => s.id === chatTab.sessionId) || null

  // Get agent status from main process (source of truth)
  // Agent-scoped: keyed by (workspaceId, agentId), not sessionId
  const agentState = useAgentState(chatTab.workspaceId, chatTab.agentId || null)

  // Get pending permission for this session
  const pendingPermission = usePendingPermission(chatTab.sessionId)

  // Handle missing session (deleted while tab was open)
  if (!session) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <AlertCircle className="h-10 w-10" />
        <p className="text-sm">This session no longer exists</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => closeTab(chatTab.id)}
        >
          Close Tab
        </Button>
      </div>
    )
  }

  // Show agent loading state (extracting definition)
  // This shows when the first message triggers agent activation
  if (agentState.isExtracting && session.agentId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <div className="flex items-center gap-2">
          <Spinner className="text-lg" />
          <Bot className="h-6 w-6" />
        </div>
        <p className="text-sm">{agentState.extractionMessage || 'Loading agent...'}</p>
        <p className="text-xs text-muted-foreground/60">{agentState.agentName || session.agentName}</p>
      </div>
    )
  }

  // Show agent error state
  if (agentState.isError && session.agentId) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-4">
        <div className="flex items-center gap-2 text-destructive">
          <AlertCircle className="h-6 w-6" />
          <Bot className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium">Agent activation failed</p>
        <p className="text-xs text-center max-w-md">{agentState.errorMessage}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => agentState.reload()}
        >
          Retry
        </Button>
      </div>
    )
  }

  // Show auth required state
  if ((agentState.isNeedsMcpAuth || agentState.isNeedsApiAuth) && session.agentId) {
    const authType = agentState.isNeedsMcpAuth ? 'MCP server' : 'API'
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground p-4">
        <div className="flex items-center gap-2 text-amber-500">
          <AlertCircle className="h-6 w-6" />
          <Bot className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium">Authentication required</p>
        <p className="text-xs text-center max-w-md">
          This agent requires {authType} authentication. Please configure credentials in the agent settings.
        </p>
      </div>
    )
  }

  // Handle file opens - optionally open in tab instead of external app
  const handleOpenFile = React.useCallback(
    (path: string) => {
      // For now, open in external app (can be changed to openFileTab later)
      onOpenFile(path)
    },
    [onOpenFile]
  )

  // Handle URL opens - optionally open in tab instead of external browser
  const handleOpenUrl = React.useCallback(
    (url: string) => {
      // For now, open in external browser (can be changed to openBrowserTab later)
      onOpenUrl(url)
    },
    [onOpenUrl]
  )

  return (
    <ChatDisplay
      session={session}
      onSendMessage={(message, attachments) => {
        if (session) {
          onSendMessage(session.id, message, attachments)
        }
      }}
      onOpenFile={handleOpenFile}
      onOpenUrl={handleOpenUrl}
      currentModel={currentModel}
      onModelChange={onModelChange}
      textareaRef={textareaRef}
      pendingPermission={pendingPermission}
      onRespondToPermission={onRespondToPermission}
    />
  )
}
