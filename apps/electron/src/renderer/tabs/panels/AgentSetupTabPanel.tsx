/**
 * AgentSetupTabPanel
 *
 * Multi-step agent setup flow in a tab.
 * Uses useAgentState hook (agent-scoped) as the single source of truth.
 * Maintains local UI state for per-item auth tracking (mcpServerStatus, apiStatus).
 * Session is created only when user clicks "Start Chat".
 */

import * as React from 'react'
import { useState, useEffect, useCallback } from 'react'
import type { Tab, AgentSetupTab } from '../types'
import { useTabs } from '../useTabs'
import { useChatContext } from '../../context/ChatContext'
import { useAgentState } from '../../hooks/useAgentState'
import {
  AgentSetupWizard,
  type AgentSetupState,
  type AgentSetupStep,
} from '../../components/agent-setup'
import type { AgentStatus } from '../../../shared/types'

interface AgentSetupTabPanelProps {
  tab: Tab
}

// Local UI state types for per-item tracking
type McpServerAuthStatus = 'pending' | 'authenticating' | 'authenticated' | 'skipped' | 'bearer-input'
type ApiAuthStatus = 'pending' | 'configured' | 'skipped'

/**
 * Map agent status to wizard step
 */
function mapStatusToWizardStep(status: AgentStatus): AgentSetupStep {
  switch (status.status) {
    case 'idle':
    case 'extracting':
      return 'extracting'
    case 'needs_review':
      return 'review'
    case 'needs_mcp_auth':
      return 'mcp-auth'
    case 'needs_api_auth':
      return 'api-auth'
    case 'ready':
    case 'active':
      return 'ready'
    case 'error':
      return 'error'
    default:
      return 'extracting'
  }
}

export default function AgentSetupTabPanel({ tab }: AgentSetupTabPanelProps) {
  const setupTab = tab as AgentSetupTab
  const { workspaceId, agentId, agentName } = setupTab

  // Primary state from main process (single source of truth)
  const agentState = useAgentState(workspaceId, agentId)

  // Local UI state for per-item tracking
  const [mcpServerStatus, setMcpServerStatus] = useState<Record<string, McpServerAuthStatus>>({})
  const [apiStatus, setApiStatus] = useState<Record<string, ApiAuthStatus>>({})

  const { openChatTab, closeTab } = useTabs()
  const { onCreateSession } = useChatContext()

  // Auto-activate on mount when idle
  useEffect(() => {
    if (agentState.isIdle) {
      agentState.activate()
    }
  }, [agentState.isIdle, agentState.activate])

  // Initialize per-item status when agent status changes
  useEffect(() => {
    if (agentState.status.status === 'needs_mcp_auth' && agentState.pendingMcpServers) {
      const initialStatus: Record<string, McpServerAuthStatus> = {}
      for (const server of agentState.pendingMcpServers) {
        if (!(server.name in mcpServerStatus)) {
          initialStatus[server.name] = 'pending'
        }
      }
      if (Object.keys(initialStatus).length > 0) {
        setMcpServerStatus(prev => ({ ...prev, ...initialStatus }))
      }
    }
  }, [agentState.status.status, agentState.pendingMcpServers, mcpServerStatus])

  useEffect(() => {
    if (agentState.status.status === 'needs_api_auth' && agentState.pendingApis) {
      const initialStatus: Record<string, ApiAuthStatus> = {}
      for (const api of agentState.pendingApis) {
        if (!(api.name in apiStatus)) {
          initialStatus[api.name] = 'pending'
        }
      }
      if (Object.keys(initialStatus).length > 0) {
        setApiStatus(prev => ({ ...prev, ...initialStatus }))
      }
    }
  }, [agentState.status.status, agentState.pendingApis, apiStatus])

  // MCP OAuth handler
  const handleStartMcpOAuth = useCallback(async (serverName: string) => {
    const server = agentState.pendingMcpServers?.find(s => s.name === serverName)
    if (!server) return

    setMcpServerStatus(prev => ({ ...prev, [serverName]: 'authenticating' }))

    try {
      const result = await window.electronAPI.startMcpOAuth(workspaceId, agentId, server.url, serverName)
      if (result.success) {
        setMcpServerStatus(prev => ({ ...prev, [serverName]: 'authenticated' }))
      } else {
        // Fall back to bearer input on failure
        setMcpServerStatus(prev => ({ ...prev, [serverName]: 'bearer-input' }))
        console.warn('[AgentSetupTabPanel] OAuth failed, falling back to bearer:', result.error)
      }
    } catch (error) {
      console.error('[AgentSetupTabPanel] OAuth error:', error)
      setMcpServerStatus(prev => ({ ...prev, [serverName]: 'bearer-input' }))
    }
  }, [workspaceId, agentId, agentState.pendingMcpServers])

  // MCP Bearer token handler
  const handleSubmitMcpBearer = useCallback(async (serverName: string, token: string) => {
    try {
      await window.electronAPI.saveMcpBearer(workspaceId, agentId, serverName, token)
      setMcpServerStatus(prev => ({ ...prev, [serverName]: 'authenticated' }))
    } catch (error) {
      console.error('[AgentSetupTabPanel] Bearer save error:', error)
    }
  }, [workspaceId, agentId])

  // Skip MCP server
  const handleSkipMcpServer = useCallback((serverName: string) => {
    setMcpServerStatus(prev => ({ ...prev, [serverName]: 'skipped' }))
  }, [])

  // Complete MCP auth - notify main process to continue
  const handleMcpAuthComplete = useCallback(async () => {
    await agentState.continueAfterMcpAuth()
  }, [agentState])

  // API credentials handler
  const handleSubmitApiCredentials = useCallback(async (
    apiName: string,
    credentials: string | { username: string; password: string }
  ) => {
    try {
      const credString = typeof credentials === 'string' ? credentials : JSON.stringify(credentials)
      await window.electronAPI.saveApiCredentials(workspaceId, agentId, apiName, credString)
      setApiStatus(prev => ({ ...prev, [apiName]: 'configured' }))
    } catch (error) {
      console.error('[AgentSetupTabPanel] API credentials save error:', error)
    }
  }, [workspaceId, agentId])

  // Skip API
  const handleSkipApi = useCallback((apiName: string) => {
    setApiStatus(prev => ({ ...prev, [apiName]: 'skipped' }))
  }, [])

  // Complete API auth - notify main process to continue
  const handleApiAuthComplete = useCallback(async () => {
    await agentState.continueAfterApiAuth()
  }, [agentState])

  // Review submission handler
  const handleSubmitReview = useCallback(async (answers: Record<number, string>) => {
    // Convert numeric keys to string keys for the API
    const stringAnswers: Record<string, string> = {}
    for (const [key, value] of Object.entries(answers)) {
      stringAnswers[String(key)] = value
    }
    await agentState.continueAfterReview(stringAnswers)
  }, [agentState])

  // Retry handler
  const handleRetry = useCallback(async () => {
    // Reset local state
    setMcpServerStatus({})
    setApiStatus({})
    // Re-activate
    await agentState.activate()
  }, [agentState])

  // Handle "Start Chat" - create session and switch to chat tab
  const handleStartChat = useCallback(async () => {
    try {
      // Mark agent as active in main process
      agentState.markActive()
      // Use context's onCreateSession which updates the sessions state
      const session = await onCreateSession(workspaceId, agentId)
      // Open chat tab with the new session
      openChatTab(
        session.id,
        workspaceId,
        session.name || agentState.agentName || agentName,
        agentId
      )
      // Close setup tab
      closeTab(tab.id)
    } catch (error) {
      console.error('[AgentSetupTabPanel] Error creating session:', error)
    }
  }, [agentState, workspaceId, agentId, agentName, onCreateSession, openChatTab, closeTab, tab.id])

  // Handle close/cancel
  const handleClose = useCallback(() => {
    closeTab(tab.id)
  }, [closeTab, tab.id])

  // Build wizard state from agent state
  // For mcpServers and apis, prefer definition when available (ready state),
  // otherwise use pending lists (auth steps)
  const wizardState: AgentSetupState = {
    step: mapStatusToWizardStep(agentState.status),
    agentId,
    agentName: agentState.agentName || agentName,
    extractionMessage: agentState.extractionMessage || undefined,
    concerns: agentState.pendingConcerns || [],
    mcpServers: agentState.activeDefinition?.mcpServers || agentState.pendingMcpServers || [],
    mcpServerStatus,
    apis: agentState.activeDefinition?.apis || agentState.pendingApis || [],
    apiStatus,
    capabilities: agentState.activeDefinition?.capabilities || [],
    errorMessage: agentState.errorMessage || undefined,
    isLoading: agentState.isLoading,
  }

  return (
    <div className="h-full overflow-hidden">
      <AgentSetupWizard
        state={wizardState}
        onCancel={handleClose}
        onBack={handleClose}
        onSubmitReview={handleSubmitReview}
        onStartMcpOAuth={handleStartMcpOAuth}
        onSubmitMcpBearer={handleSubmitMcpBearer}
        onSkipMcpServer={handleSkipMcpServer}
        onMcpAuthComplete={handleMcpAuthComplete}
        onSubmitApiCredentials={handleSubmitApiCredentials}
        onSkipApi={handleSkipApi}
        onApiAuthComplete={handleApiAuthComplete}
        onActivate={handleStartChat}
        onRetry={handleRetry}
        onStartChat={handleStartChat}
        onClose={handleClose}
        className="h-full"
      />
    </div>
  )
}
