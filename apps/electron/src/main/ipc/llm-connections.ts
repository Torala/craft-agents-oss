import { ipcMain, shell } from 'electron'
import { IPC_CHANNELS, type LlmConnectionSetup } from '../../shared/types'
import { getLlmConnections, getLlmConnection, addLlmConnection, updateLlmConnection, deleteLlmConnection, getDefaultLlmConnection, setDefaultLlmConnection, touchLlmConnection, isCompatProvider, isAnthropicProvider, getDefaultModelsForConnection, getDefaultModelForConnection, type LlmConnection, type LlmConnectionWithStatus } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import {
  resolveSetupTestConnectionHint,
  testBackendConnection,
  validateStoredBackendConnection,
} from '@craft-agent/shared/agent/backend'
import { getModelRefreshService } from '../model-fetchers'
import { parseTestConnectionError, createBuiltInConnection, validateModelList, piAuthProviderDisplayName } from '../connection-setup-logic'
import { ipcLog } from '../logger'
import { getWorkspaceOrThrow, buildBackendHostRuntimeContext } from './utils'
import type { IpcContext } from './types'

// Local OAuth state
let copilotOAuthAbort: AbortController | null = null

export const HANDLED_CHANNELS = [
  IPC_CHANNELS.llmConnections.LIST,
  IPC_CHANNELS.llmConnections.LIST_WITH_STATUS,
  IPC_CHANNELS.llmConnections.GET,
  IPC_CHANNELS.llmConnections.GET_API_KEY,
  IPC_CHANNELS.llmConnections.SAVE,
  IPC_CHANNELS.llmConnections.DELETE,
  IPC_CHANNELS.llmConnections.TEST,
  IPC_CHANNELS.llmConnections.SET_DEFAULT,
  IPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT,
  IPC_CHANNELS.llmConnections.REFRESH_MODELS,
  IPC_CHANNELS.chatgpt.START_OAUTH,
  IPC_CHANNELS.chatgpt.CANCEL_OAUTH,
  IPC_CHANNELS.chatgpt.GET_AUTH_STATUS,
  IPC_CHANNELS.chatgpt.LOGOUT,
  IPC_CHANNELS.copilot.START_OAUTH,
  IPC_CHANNELS.copilot.CANCEL_OAUTH,
  IPC_CHANNELS.copilot.GET_AUTH_STATUS,
  IPC_CHANNELS.copilot.LOGOUT,
  IPC_CHANNELS.settings.SETUP_LLM_CONNECTION,
  IPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP,
  IPC_CHANNELS.pi.GET_API_KEY_PROVIDERS,
  IPC_CHANNELS.pi.GET_PROVIDER_BASE_URL,
  IPC_CHANNELS.pi.GET_PROVIDER_MODELS,
] as const

export function registerLlmConnectionsHandlers({ sessionManager, windowManager }: IpcContext): void {
  // Unified handler for LLM connection setup
  ipcMain.handle(IPC_CHANNELS.settings.SETUP_LLM_CONNECTION, async (_event, setup: LlmConnectionSetup): Promise<{ success: boolean; error?: string }> => {
    try {
      const manager = getCredentialManager()

      // Ensure connection exists in config
      let connection = getLlmConnection(setup.slug)
      let isNewConnection = false
      if (!connection) {
        // Create connection with appropriate defaults based on slug
        connection = createBuiltInConnection(setup.slug, setup.baseUrl)
        isNewConnection = true
      }

      const updates: Partial<LlmConnection> = {}
      const hasCustomEndpoint = !!setup.baseUrl
      if (setup.baseUrl !== undefined) {
        updates.baseUrl = setup.baseUrl ?? undefined

        // Only mutate providerType for API key connections (not OAuth connections)
        if (isAnthropicProvider(connection.providerType) && connection.authType !== 'oauth') {
          const pt = hasCustomEndpoint ? 'anthropic_compat' as const : 'anthropic' as const
          updates.providerType = pt
          updates.authType = hasCustomEndpoint ? 'api_key_with_endpoint' : 'api_key'
          if (!hasCustomEndpoint) {
            updates.models = getDefaultModelsForConnection(pt)
            updates.defaultModel = getDefaultModelForConnection(pt)
          }
        }

        // Pi API key flow: store baseUrl on the connection (Pi SDK doesn't use it yet,
        // but it's persisted for future backend support)

      }

      if (setup.defaultModel !== undefined) {
        updates.defaultModel = setup.defaultModel ?? undefined
      }
      if (setup.models !== undefined) {
        updates.models = setup.models ?? undefined
      }
      // Pi API key flow: set piAuthProvider from setup data (e.g. 'anthropic', 'google', 'openai')
      if (setup.piAuthProvider) {
        updates.piAuthProvider = setup.piAuthProvider
        // Update connection name to show the actual provider (e.g. "Craft Agents Backend (Google AI Studio)")
        const providerName = piAuthProviderDisplayName(setup.piAuthProvider)
        if (providerName) {
          updates.name = `Craft Agents Backend (${providerName})`
        }
        // Only set default models when using standard Pi provider AND user didn't pick explicit models
        if (!hasCustomEndpoint && !setup.models?.length) {
          updates.models = getDefaultModelsForConnection('pi', setup.piAuthProvider)
          updates.defaultModel = getDefaultModelForConnection('pi', setup.piAuthProvider)
        }
      }

      const pendingConnection: LlmConnection = {
        ...connection,
        ...updates,
      }

      if (updates.models && updates.models.length > 0) {
        const validation = validateModelList(updates.models, pendingConnection.defaultModel)
        if (!validation.valid) {
          return { success: false, error: validation.error }
        }
        if (validation.resolvedDefaultModel) {
          pendingConnection.defaultModel = validation.resolvedDefaultModel
          updates.defaultModel = validation.resolvedDefaultModel
        }
      }

      if (isCompatProvider(pendingConnection.providerType) && !pendingConnection.defaultModel) {
        return { success: false, error: 'Default model is required for compatible endpoints.' }
      }

      if (isNewConnection) {
        addLlmConnection(pendingConnection)
        ipcLog.info(`Created LLM connection: ${setup.slug}`)
      } else if (Object.keys(updates).length > 0) {
        updateLlmConnection(setup.slug, updates)
        ipcLog.info(`Updated LLM connection settings: ${setup.slug}`)
      }

      // Store credential if provided
      if (setup.credential) {
        const authType = pendingConnection.authType
        if (authType === 'oauth') {
          await manager.setLlmOAuth(setup.slug, { accessToken: setup.credential })
          ipcLog.info('Saved OAuth access token to LLM connection')
        } else {
          await manager.setLlmApiKey(setup.slug, setup.credential)
          ipcLog.info('Saved API key to LLM connection')
        }
      }

      // Set as default only if no default exists yet (first connection)
      if (!getDefaultLlmConnection()) {
        setDefaultLlmConnection(setup.slug)
        ipcLog.info(`Set default LLM connection: ${setup.slug}`)
      }

      // Fetch available models (non-blocking — validation will also trigger refresh)
      // Skip when user explicitly provided models (tier selection) to avoid overwriting their choices
      if (!setup.models?.length) {
        getModelRefreshService().refreshNow(setup.slug).catch(err => {
          ipcLog.warn(`Model refresh after setup failed for ${setup.slug}: ${err instanceof Error ? err.message : err}`)
        })
      }

      // Reinitialize auth with the newly-created connection's slug
      // (not the default, which may be a different connection)
      const authSlug = getDefaultLlmConnection() || setup.slug
      await sessionManager.reinitializeAuth(authSlug)
      ipcLog.info('Reinitialized auth after LLM connection setup')

      return { success: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error('Failed to setup LLM connection:', message)
      return { success: false, error: message }
    }
  })

  // Unified connection test — uses the agent factory to spawn a real agent subprocess
  // and validate credentials via runMiniCompletion(). Same code path as actual chat.
  ipcMain.handle(IPC_CHANNELS.settings.TEST_LLM_CONNECTION_SETUP, async (_event, params: import('../../shared/types').TestLlmConnectionParams): Promise<import('../../shared/types').TestLlmConnectionResult> => {
    const { provider, apiKey, baseUrl, model, piAuthProvider } = params
    const trimmedKey = apiKey?.trim()

    if (!trimmedKey) {
      return { success: false, error: 'API key is required' }
    }

    ipcLog.info(`[testLlmConnectionSetup] Testing: provider=${provider}${piAuthProvider ? ` piAuth=${piAuthProvider}` : ''}${baseUrl ? ` baseUrl=${baseUrl}` : ''}`)

    try {
      const testModel = model || getDefaultModelForConnection(provider, piAuthProvider)
      const result = await testBackendConnection({
        provider,
        apiKey: trimmedKey,
        model: testModel,
        baseUrl,
        timeoutMs: 20000,
        hostRuntime: buildBackendHostRuntimeContext(),
        connection: resolveSetupTestConnectionHint({ provider, baseUrl, piAuthProvider }),
      })

      if (!result.success) {
        return { success: false, error: parseTestConnectionError(result.error || 'Unknown error') }
      }
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      ipcLog.info(`[testLlmConnectionSetup] Error: ${msg.slice(0, 500)}`)
      return { success: false, error: parseTestConnectionError(msg) }
    }
  })

  // ============================================================
  // Pi Provider Discovery (main process only — Pi SDK can't run in renderer)
  // ============================================================

  ipcMain.handle(IPC_CHANNELS.pi.GET_API_KEY_PROVIDERS, async () => {
    const { getPiApiKeyProviders } = await import('@craft-agent/shared/config')
    return getPiApiKeyProviders()
  })

  ipcMain.handle(IPC_CHANNELS.pi.GET_PROVIDER_BASE_URL, async (_event, provider: string) => {
    const { getPiProviderBaseUrl } = await import('@craft-agent/shared/config')
    return getPiProviderBaseUrl(provider)
  })

  ipcMain.handle(IPC_CHANNELS.pi.GET_PROVIDER_MODELS, async (_event, provider: string) => {
    const { getModels } = await import('@mariozechner/pi-ai')
    try {
      const models = getModels(provider as Parameters<typeof getModels>[0])
      const sorted = [...models].sort((a, b) => b.cost.output - a.cost.output || b.cost.input - a.cost.input)
      return {
        models: sorted.map(m => ({
          id: m.id,
          name: m.name,
          costInput: m.cost.input,
          costOutput: m.cost.output,
          contextWindow: m.contextWindow,
          reasoning: m.reasoning,
        })),
        totalCount: models.length,
      }
    } catch {
      return { models: [], totalCount: 0 }
    }
  })

  // ============================================================
  // LLM Connections (provider configurations)
  // ============================================================

  // List all LLM connections (includes built-in and custom)
  ipcMain.handle(IPC_CHANNELS.llmConnections.LIST, async (): Promise<LlmConnection[]> => {
    return getLlmConnections()
  })

  // List all LLM connections with authentication status
  ipcMain.handle(IPC_CHANNELS.llmConnections.LIST_WITH_STATUS, async (): Promise<LlmConnectionWithStatus[]> => {
    const connections = getLlmConnections()
    const credentialManager = getCredentialManager()
    const defaultSlug = getDefaultLlmConnection()

    return Promise.all(connections.map(async (conn): Promise<LlmConnectionWithStatus> => {
      // Check if credentials exist for this connection
      const hasCredentials = await credentialManager.hasLlmCredentials(conn.slug, conn.authType)
      return {
        ...conn,
        isAuthenticated: conn.authType === 'none' || hasCredentials,
        isDefault: conn.slug === defaultSlug,
      }
    }))
  })

  // Get a specific LLM connection by slug
  ipcMain.handle(IPC_CHANNELS.llmConnections.GET, async (_event, slug: string): Promise<LlmConnection | null> => {
    return getLlmConnection(slug)
  })

  // Get stored API key for an LLM connection (for edit pre-fill)
  ipcMain.handle(IPC_CHANNELS.llmConnections.GET_API_KEY, async (_event, slug: string): Promise<string | null> => {
    const manager = getCredentialManager()
    return manager.getLlmApiKey(slug)
  })

  // Save (create or update) an LLM connection
  // If connection.slug exists and is found, updates it; otherwise creates new
  ipcMain.handle(IPC_CHANNELS.llmConnections.SAVE, async (_event, connection: LlmConnection): Promise<{ success: boolean; error?: string }> => {
    try {
      // Check if this is an update or create
      const existing = getLlmConnection(connection.slug)
      if (existing) {
        // Update existing connection (can't change slug)
        const { slug: _slug, ...updates } = connection
        const success = updateLlmConnection(connection.slug, updates)
        if (!success) {
          return { success: false, error: 'Failed to update connection' }
        }
      } else {
        // Create new connection
        const success = addLlmConnection(connection)
        if (!success) {
          return { success: false, error: 'Connection with this slug already exists' }
        }
      }
      ipcLog.info(`LLM connection saved: ${connection.slug}`)
      // Reinitialize auth if the saved connection is the current default
      // (updates env vars and summarization model override)
      const defaultSlug = getDefaultLlmConnection()
      if (defaultSlug === connection.slug) {
        await sessionManager.reinitializeAuth()
      }
      return { success: true }
    } catch (error) {
      ipcLog.error('Failed to save LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Delete an LLM connection (at least one connection must remain)
  ipcMain.handle(IPC_CHANNELS.llmConnections.DELETE, async (_event, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const connection = getLlmConnection(slug)
      if (!connection) {
        return { success: false, error: 'Connection not found' }
      }
      // deleteLlmConnection handles the "at least one must remain" check
      const success = deleteLlmConnection(slug)
      if (success) {
        // Stop any periodic model refresh timer for this connection
        getModelRefreshService().stopConnection(slug)
        // Also delete associated credentials
        const credentialManager = getCredentialManager()
        await credentialManager.deleteLlmCredentials(slug)
        ipcLog.info(`LLM connection deleted: ${slug}`)
      }
      return { success }
    } catch (error) {
      ipcLog.error('Failed to delete LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Test an LLM connection (validate credentials and connectivity with actual API call)
  ipcMain.handle(IPC_CHANNELS.llmConnections.TEST, async (_event, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const result = await validateStoredBackendConnection({
        slug,
        hostRuntime: buildBackendHostRuntimeContext(),
      })

      if (!result.success) {
        return { success: false, error: result.error }
      }

      touchLlmConnection(slug)

      if (result.shouldRefreshModels) {
        getModelRefreshService().refreshNow(slug).catch(err => {
          ipcLog.warn(`Model refresh failed during validation: ${err instanceof Error ? err.message : err}`)
        })
      }

      ipcLog.info(`LLM connection validated: ${slug}`)
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      ipcLog.info(`[LLM_CONNECTION_TEST] Error for ${slug}: ${msg.slice(0, 500)}`)
      const { parseValidationError } = await import('@craft-agent/shared/config')
      return { success: false, error: parseValidationError(msg) }
    }
  })

  // Set global default LLM connection
  ipcMain.handle(IPC_CHANNELS.llmConnections.SET_DEFAULT, async (_event, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const success = setDefaultLlmConnection(slug)
      if (success) {
        ipcLog.info(`Global default LLM connection set to: ${slug}`)
        // Reinitialize auth so env vars and summarization model override match the new default
        await sessionManager.reinitializeAuth()
      }
      return { success, error: success ? undefined : 'Connection not found' }
    } catch (error) {
      ipcLog.error('Failed to set default LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Set workspace default LLM connection
  ipcMain.handle(IPC_CHANNELS.llmConnections.SET_WORKSPACE_DEFAULT, async (_event, workspaceId: string, slug: string | null): Promise<{ success: boolean; error?: string }> => {
    try {
      const workspace = getWorkspaceOrThrow(workspaceId)

      // Validate connection exists if setting (not clearing)
      if (slug) {
        const connection = getLlmConnection(slug)
        if (!connection) {
          return { success: false, error: 'Connection not found' }
        }
      }

      const { loadWorkspaceConfig, saveWorkspaceConfig } = await import('@craft-agent/shared/workspaces')
      const config = loadWorkspaceConfig(workspace.rootPath)
      if (!config) {
        return { success: false, error: 'Failed to load workspace config' }
      }

      // Update workspace defaults
      config.defaults = config.defaults || {}
      if (slug) {
        config.defaults.defaultLlmConnection = slug
      } else {
        delete config.defaults.defaultLlmConnection
      }

      saveWorkspaceConfig(workspace.rootPath, config)
      ipcLog.info(`Workspace ${workspaceId} default LLM connection set to: ${slug}`)
      return { success: true }
    } catch (error) {
      ipcLog.error('Failed to set workspace default LLM connection:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
    }
  })

  // Refresh available models for a connection (dynamic model discovery)
  ipcMain.handle(IPC_CHANNELS.llmConnections.REFRESH_MODELS, async (_event, slug: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const connection = getLlmConnection(slug)
      if (!connection) {
        return { success: false, error: 'Connection not found' }
      }

      await getModelRefreshService().refreshNow(slug)
      return { success: true }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error'
      ipcLog.error(`Failed to refresh models for ${slug}: ${msg}`)
      return { success: false, error: msg }
    }
  })

  // ============================================================
  // ChatGPT OAuth (for Codex chatgptAuthTokens mode)
  // ============================================================

  // Start ChatGPT OAuth flow
  // Opens browser for authentication, waits for callback, exchanges code for tokens
  ipcMain.handle(IPC_CHANNELS.chatgpt.START_OAUTH, async (_event, connectionSlug: string): Promise<{
    success: boolean
    error?: string
  }> => {
    try {
      const { startChatGptOAuth, exchangeChatGptCode } = await import('@craft-agent/shared/auth')
      const credentialManager = getCredentialManager()

      ipcLog.info(`Starting ChatGPT OAuth flow for connection: ${connectionSlug}`)

      // Start OAuth and wait for authorization code
      const code = await startChatGptOAuth((status) => {
        ipcLog.info(`[ChatGPT OAuth] ${status}`)
      })

      // Exchange code for tokens
      const tokens = await exchangeChatGptCode(code, (status) => {
        ipcLog.info(`[ChatGPT OAuth] ${status}`)
      })

      // Store both tokens properly in credential manager
      // OpenAI OIDC returns both: idToken (JWT for identity) and accessToken (for API access)
      await credentialManager.setLlmOAuth(connectionSlug, {
        accessToken: tokens.accessToken,  // Store actual accessToken
        idToken: tokens.idToken,           // Store idToken separately
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      })

      ipcLog.info('ChatGPT OAuth completed successfully')
      return { success: true }
    } catch (error) {
      ipcLog.error('ChatGPT OAuth failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth authentication failed',
      }
    }
  })

  // Cancel ongoing ChatGPT OAuth flow
  ipcMain.handle(IPC_CHANNELS.chatgpt.CANCEL_OAUTH, async (): Promise<{ success: boolean }> => {
    try {
      const { cancelChatGptOAuth } = await import('@craft-agent/shared/auth')
      cancelChatGptOAuth()
      ipcLog.info('ChatGPT OAuth cancelled')
      return { success: true }
    } catch (error) {
      ipcLog.error('Failed to cancel ChatGPT OAuth:', error)
      return { success: false }
    }
  })

  // Get ChatGPT authentication status
  ipcMain.handle(IPC_CHANNELS.chatgpt.GET_AUTH_STATUS, async (_event, connectionSlug: string): Promise<{
    authenticated: boolean
    expiresAt?: number
    hasRefreshToken?: boolean
  }> => {
    try {
      const credentialManager = getCredentialManager()
      const creds = await credentialManager.getLlmOAuth(connectionSlug)

      if (!creds) {
        return { authenticated: false }
      }

      // Check if expired (with 5-minute buffer)
      const isExpired = creds.expiresAt && Date.now() > creds.expiresAt - 5 * 60 * 1000

      return {
        authenticated: !isExpired || !!creds.refreshToken, // Can refresh if has refresh token
        expiresAt: creds.expiresAt,
        hasRefreshToken: !!creds.refreshToken,
      }
    } catch (error) {
      ipcLog.error('Failed to get ChatGPT auth status:', error)
      return { authenticated: false }
    }
  })

  // Logout from ChatGPT (clear stored tokens)
  ipcMain.handle(IPC_CHANNELS.chatgpt.LOGOUT, async (_event, connectionSlug: string): Promise<{ success: boolean }> => {
    try {
      const credentialManager = getCredentialManager()
      await credentialManager.deleteLlmCredentials(connectionSlug)
      ipcLog.info('ChatGPT credentials cleared')
      return { success: true }
    } catch (error) {
      ipcLog.error('Failed to clear ChatGPT credentials:', error)
      return { success: false }
    }
  })

  // ============================================================
  // GitHub Copilot OAuth
  // ============================================================

  // Start GitHub Copilot OAuth flow (device flow via Pi SDK)
  ipcMain.handle(IPC_CHANNELS.copilot.START_OAUTH, async (event, connectionSlug: string): Promise<{
    success: boolean
    error?: string
  }> => {
    try {
      const { loginGitHubCopilot } = await import('@mariozechner/pi-ai')
      const credentialManager = getCredentialManager()

      // Cancel any previous in-flight flow
      copilotOAuthAbort?.abort()
      copilotOAuthAbort = new AbortController()

      ipcLog.info(`Starting GitHub Copilot OAuth device flow for connection: ${connectionSlug}`)

      // Use Pi SDK's login flow — this handles the device code flow AND
      // the critical Copilot token exchange that determines the correct
      // API endpoint for the user's subscription tier (individual/business/enterprise).
      const credentials = await loginGitHubCopilot({
        onAuth: (url, instructions) => {
          // Extract user code from instructions (format: "Enter code: XXXX-YYYY")
          const codeMatch = instructions?.match(/:\s*(\S+)/)
          const userCode = codeMatch?.[1] ?? ''
          ipcLog.info(`[GitHub OAuth] Device code: ${userCode}`)
          event.sender.send(IPC_CHANNELS.copilot.DEVICE_CODE, {
            userCode,
            verificationUri: url,
          })
          // Open GitHub device code page in default browser
          shell.openExternal(url).catch(err => {
            ipcLog.warn(`Failed to open browser for GitHub OAuth: ${err}`)
          })
        },
        onPrompt: async () => {
          // Pi SDK asks for GitHub Enterprise domain — return empty for github.com
          return ''
        },
        onProgress: (message) => {
          ipcLog.info(`[GitHub OAuth] ${message}`)
        },
        signal: copilotOAuthAbort.signal,
      })

      copilotOAuthAbort = null

      // Store the full OAuth credential:
      // - accessToken = Copilot API token (contains proxy-ep for correct endpoint)
      // - refreshToken = GitHub access token (used to refresh the Copilot token)
      // - expiresAt = Copilot token expiry (short-lived, ~1 hour)
      await credentialManager.setLlmOAuth(connectionSlug, {
        accessToken: credentials.access,
        refreshToken: credentials.refresh,
        expiresAt: credentials.expires,
      })

      ipcLog.info('GitHub Copilot OAuth completed successfully')
      return { success: true }
    } catch (error) {
      copilotOAuthAbort = null
      ipcLog.error('GitHub Copilot OAuth failed:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'OAuth authentication failed',
      }
    }
  })

  // Cancel ongoing GitHub OAuth flow
  ipcMain.handle(IPC_CHANNELS.copilot.CANCEL_OAUTH, async (): Promise<{ success: boolean }> => {
    if (copilotOAuthAbort) {
      copilotOAuthAbort.abort()
      copilotOAuthAbort = null
      ipcLog.info('GitHub Copilot OAuth cancelled')
    }
    return { success: true }
  })

  // Get GitHub Copilot authentication status
  ipcMain.handle(IPC_CHANNELS.copilot.GET_AUTH_STATUS, async (_event, connectionSlug: string): Promise<{
    authenticated: boolean
  }> => {
    try {
      const credentialManager = getCredentialManager()
      const creds = await credentialManager.getLlmOAuth(connectionSlug)

      return {
        authenticated: !!creds?.accessToken,
      }
    } catch (error) {
      ipcLog.error('Failed to get GitHub auth status:', error)
      return { authenticated: false }
    }
  })

  // Logout from Copilot (clear stored tokens)
  ipcMain.handle(IPC_CHANNELS.copilot.LOGOUT, async (_event, connectionSlug: string): Promise<{ success: boolean }> => {
    try {
      const credentialManager = getCredentialManager()
      await credentialManager.deleteLlmCredentials(connectionSlug)
      ipcLog.info('Copilot credentials cleared')
      return { success: true }
    } catch (error) {
      ipcLog.error('Failed to clear Copilot credentials:', error)
      return { success: false }
    }
  })
}
