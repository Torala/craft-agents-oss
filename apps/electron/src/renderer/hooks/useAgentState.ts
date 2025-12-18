/**
 * useAgentState - React hook for agent activation state management (Electron)
 *
 * Agent-scoped: One state per (workspaceId, agentId) pair.
 * This is the single source of truth for agent activation state.
 *
 * Usage:
 * ```tsx
 * const agentState = useAgentState(workspaceId, agentId);
 *
 * // Check status
 * if (agentState.isNeedsMcpAuth) {
 *   return <McpAuth servers={agentState.pendingMcpServers} ... />;
 * }
 *
 * // Trigger activation
 * await agentState.activate();
 * ```
 */

import { useState, useEffect, useCallback } from 'react'
import type {
  AgentStatus,
  AgentActivateOptions,
} from '../../shared/types'
import type {
  SubAgentDefinition,
  McpServerConfig,
  ApiConfig,
  Concern,
} from '@craft-agent/shared/agents'

export interface UseAgentStateResult {
  // Current status (discriminated union)
  status: AgentStatus

  // Convenience booleans for status checking
  isIdle: boolean
  isExtracting: boolean
  isNeedsReview: boolean
  isNeedsMcpAuth: boolean
  isNeedsApiAuth: boolean
  isReady: boolean
  isActive: boolean
  isError: boolean

  // Current data (derived from status, type-safe)
  activeDefinition: SubAgentDefinition | null
  agentId: string | null
  agentName: string | null
  extractionMessage: string | null
  errorMessage: string | null

  // Pending auth/review data (derived from status)
  pendingConcerns: Concern[] | null
  pendingMcpServers: McpServerConfig[] | null
  pendingApis: ApiConfig[] | null

  // Actions (no agentId param needed - it's in the hook signature)
  activate: (options?: AgentActivateOptions) => Promise<AgentStatus>
  continueAfterReview: (answers: Record<string, string>) => Promise<AgentStatus>
  skipReview: () => Promise<AgentStatus>
  continueAfterMcpAuth: () => Promise<AgentStatus>
  continueAfterApiAuth: () => Promise<AgentStatus>
  deactivate: () => void
  reload: () => Promise<AgentStatus>
  reset: () => Promise<void>
  markActive: () => void

  // Loading state for async operations
  isLoading: boolean
}

/**
 * Hook for managing agent activation state.
 * Agent-scoped: keyed by (workspaceId, agentId).
 *
 * @param workspaceId - The workspace ID (or null if not selected)
 * @param agentId - The agent ID (or null if not selected)
 */
export function useAgentState(workspaceId: string | null, agentId: string | null): UseAgentStateResult {
  const [status, setStatus] = useState<AgentStatus>({ status: 'idle' })
  const [isLoading, setIsLoading] = useState(false)

  // Subscribe to agent status changes from main process
  useEffect(() => {
    if (!workspaceId || !agentId) {
      setStatus({ status: 'idle' })
      return
    }

    // Get initial status
    window.electronAPI.getAgentStatus(workspaceId, agentId).then(setStatus).catch(console.error)

    // Listen for status updates via AGENT_STATUS_CHANGED broadcast
    const cleanup = window.electronAPI.onAgentStatusChanged((ws, agent, newStatus) => {
      if (ws === workspaceId && agent === agentId) {
        setStatus(newStatus)
      }
    })

    return cleanup
  }, [workspaceId, agentId])

  // Derive convenience booleans from status
  const isIdle = status.status === 'idle'
  const isExtracting = status.status === 'extracting'
  const isNeedsReview = status.status === 'needs_review'
  const isNeedsMcpAuth = status.status === 'needs_mcp_auth'
  const isNeedsApiAuth = status.status === 'needs_api_auth'
  const isReady = status.status === 'ready'
  const isActive = status.status === 'active'
  const isError = status.status === 'error'

  // Derive data from status (type-safe based on discriminated union)
  const activeDefinition =
    status.status === 'ready' || status.status === 'active' ? status.definition : null

  const derivedAgentId = 'agentId' in status ? status.agentId : null
  const derivedAgentName = 'agentName' in status ? status.agentName : null

  const extractionMessage = status.status === 'extracting' ? status.message : null
  const errorMessage = status.status === 'error' ? status.error : null

  const pendingConcerns = status.status === 'needs_review' ? status.concerns : null
  const pendingMcpServers = status.status === 'needs_mcp_auth' ? status.servers : null
  const pendingApis = status.status === 'needs_api_auth' ? status.apis : null

  // Actions - now use (workspaceId, agentId) from hook params
  const activate = useCallback(
    async (options?: AgentActivateOptions): Promise<AgentStatus> => {
      if (!workspaceId || !agentId) {
        return { status: 'idle' }
      }
      setIsLoading(true)
      try {
        const result = await window.electronAPI.activateAgent(workspaceId, agentId, options)
        setStatus(result)
        return result
      } finally {
        setIsLoading(false)
      }
    },
    [workspaceId, agentId]
  )

  const continueAfterReview = useCallback(
    async (answers: Record<string, string>): Promise<AgentStatus> => {
      if (!workspaceId || !agentId) {
        return status
      }
      setIsLoading(true)
      try {
        const result = await window.electronAPI.continueAfterReview(workspaceId, agentId, answers)
        setStatus(result)
        return result
      } finally {
        setIsLoading(false)
      }
    },
    [workspaceId, agentId, status]
  )

  const skipReview = useCallback(async (): Promise<AgentStatus> => {
    return continueAfterReview({})
  }, [continueAfterReview])

  const continueAfterMcpAuth = useCallback(async (): Promise<AgentStatus> => {
    if (!workspaceId || !agentId) {
      return status
    }
    setIsLoading(true)
    try {
      const result = await window.electronAPI.continueAfterMcpAuth(workspaceId, agentId)
      setStatus(result)
      return result
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, agentId, status])

  const continueAfterApiAuth = useCallback(async (): Promise<AgentStatus> => {
    if (!workspaceId || !agentId) {
      return status
    }
    setIsLoading(true)
    try {
      const result = await window.electronAPI.continueAfterApiAuth(workspaceId, agentId)
      setStatus(result)
      return result
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, agentId, status])

  const deactivate = useCallback((): void => {
    if (!workspaceId || !agentId) {
      return
    }
    window.electronAPI.deactivateAgent(workspaceId, agentId)
    setStatus({ status: 'idle' })
  }, [workspaceId, agentId])

  const reload = useCallback(async (): Promise<AgentStatus> => {
    if (!workspaceId || !agentId) {
      return status
    }
    setIsLoading(true)
    try {
      const result = await window.electronAPI.reloadAgentState(workspaceId, agentId)
      setStatus(result)
      return result
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId, agentId, status])

  const reset = useCallback(async (): Promise<void> => {
    if (!workspaceId || !agentId) {
      return
    }
    await window.electronAPI.resetAgentState(workspaceId, agentId)
    setStatus({ status: 'idle' })
  }, [workspaceId, agentId])

  const markActive = useCallback((): void => {
    if (!workspaceId || !agentId) {
      return
    }
    window.electronAPI.markAgentActive(workspaceId, agentId)
  }, [workspaceId, agentId])

  return {
    status,
    isIdle,
    isExtracting,
    isNeedsReview,
    isNeedsMcpAuth,
    isNeedsApiAuth,
    isReady,
    isActive,
    isError,
    activeDefinition,
    agentId: derivedAgentId,
    agentName: derivedAgentName,
    extractionMessage,
    errorMessage,
    pendingConcerns,
    pendingMcpServers,
    pendingApis,
    activate,
    continueAfterReview,
    skipReview,
    continueAfterMcpAuth,
    continueAfterApiAuth,
    deactivate,
    reload,
    reset,
    markActive,
    isLoading,
  }
}
