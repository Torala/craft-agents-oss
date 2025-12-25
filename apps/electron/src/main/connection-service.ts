/**
 * ConnectionService - Builds MCP and API server configs from connections
 *
 * Similar to SubAgentManager but for user-defined connections.
 * Handles credential lookup and server config building.
 */

import { createApiServer } from '@craft-agent/shared/agents/api-tools'
import { createGmailServer } from '@craft-agent/shared/agents/gmail-tools'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { refreshGmailToken } from '@craft-agent/shared/auth'
import type { ApiConfig } from '@craft-agent/shared/agents/types'
import type { ConnectionConfig } from '../shared/types'

// Buffer time before expiration to refresh (5 minutes)
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

// Type for MCP server config (matches SDK expectations)
export type McpServerConfig = {
  type: 'http' | 'sse'
  url: string
  headers?: Record<string, string>
}

// Type for API server (in-process MCP server)
export type ApiServer = ReturnType<typeof createApiServer>

// Type for Gmail server (in-process MCP server)
export type GmailServer = ReturnType<typeof createGmailServer>

export class ConnectionService {
  /**
   * Build MCP server config from connection (with auth headers)
   */
  async buildMcpServerConfig(connection: ConnectionConfig): Promise<McpServerConfig> {
    if (connection.type !== 'mcp') {
      throw new Error(`Not an MCP connection: ${connection.name}`)
    }

    if (!connection.mcpUrl) {
      throw new Error(`MCP connection ${connection.name} missing URL`)
    }

    const config: McpServerConfig = {
      type: connection.mcpUrl.includes('/sse') ? 'sse' : 'http',
      url: connection.mcpUrl,
    }

    // Retrieve OAuth token from CredentialManager
    if (connection.isAuthenticated) {
      try {
        const manager = getCredentialManager()
        const creds = await manager.get({ type: 'connection_oauth', connectionId: connection.id })
        if (creds?.value) {
          config.headers = {
            Authorization: `Bearer ${creds.value}`,
          }
          console.log(`[ConnectionService] Added auth header for MCP connection: ${connection.name}`)
        } else {
          console.warn(`[ConnectionService] No stored token for authenticated connection: ${connection.name}`)
        }
      } catch (error) {
        console.error(`[ConnectionService] Failed to get credentials for ${connection.name}:`, error)
      }
    }

    return config
  }

  /**
   * Build API server from connection
   */
  buildApiServer(connection: ConnectionConfig): ApiServer {
    if (connection.type !== 'api') {
      throw new Error(`Not an API connection: ${connection.name}`)
    }

    if (!connection.apiUrl) {
      throw new Error(`API connection ${connection.name} missing URL`)
    }

    const apiConfig: ApiConfig = {
      name: connection.name,
      baseUrl: connection.apiUrl,
      auth: { type: 'bearer' },
      documentation: '', // User can add documentation later
    }

    // Use the stored bearer token
    const credential = connection.apiBearerToken || ''

    return createApiServer(apiConfig, credential)
  }

  /**
   * Build Gmail server from connection
   * Automatically refreshes expired tokens using the stored refresh token
   */
  async buildGmailServer(connection: ConnectionConfig): Promise<GmailServer | null> {
    if (connection.type !== 'gmail') {
      throw new Error(`Not a Gmail connection: ${connection.name}`)
    }

    // Retrieve OAuth token from CredentialManager
    try {
      const manager = getCredentialManager()
      const credentialId = { type: 'gmail_oauth' as const, connectionId: connection.id }
      const creds = await manager.get(credentialId)

      if (!creds?.value) {
        console.warn(`[ConnectionService] No stored token for Gmail connection: ${connection.name}`)
        return null
      }

      let accessToken = creds.value

      // Check if token is expired or about to expire
      // If expiresAt is missing but we have a refresh token, assume expired (legacy credentials)
      const now = Date.now()
      const isExpired = creds.expiresAt
        ? creds.expiresAt < now + TOKEN_REFRESH_BUFFER_MS
        : !!creds.refreshToken // No expiresAt but have refresh token = assume expired

      if (isExpired && creds.refreshToken) {
        console.log(`[ConnectionService] Refreshing expired Gmail token for: ${connection.name}`)
        try {
          const refreshResult = await refreshGmailToken(creds.refreshToken)
          accessToken = refreshResult.accessToken

          // Update stored credentials with new access token
          await manager.set(credentialId, {
            value: refreshResult.accessToken,
            refreshToken: creds.refreshToken, // Keep existing refresh token
            expiresAt: refreshResult.expiresAt,
          })
          console.log(`[ConnectionService] Gmail token refreshed successfully for: ${connection.name}`)
        } catch (refreshError) {
          console.error(`[ConnectionService] Failed to refresh Gmail token for ${connection.name}:`, refreshError)
          // If token is definitely expired, don't try with stale token - it will just 401
          if (creds.expiresAt && creds.expiresAt < now) {
            console.warn(`[ConnectionService] Cannot use expired Gmail token, refresh failed: ${connection.name}`)
            return null
          }
          // If no expiresAt (legacy), try anyway - might still work
        }
      } else if (isExpired && !creds.refreshToken) {
        console.warn(`[ConnectionService] Gmail token expired and no refresh token available: ${connection.name}`)
        return null
      }

      console.log(`[ConnectionService] Creating Gmail server for connection: ${connection.name}`)
      return createGmailServer(accessToken)
    } catch (error) {
      console.error(`[ConnectionService] Failed to get Gmail credentials for ${connection.name}:`, error)
      return null
    }
  }

  /**
   * Build all server configs for selected connections
   */
  async buildServerConfigs(connections: ConnectionConfig[]): Promise<{
    mcpServers: Record<string, McpServerConfig>
    apiServers: Record<string, ApiServer | GmailServer>
  }> {
    const mcpServers: Record<string, McpServerConfig> = {}
    const apiServers: Record<string, ApiServer | GmailServer> = {}

    for (const conn of connections) {
      if (!conn.enabled) continue

      try {
        if (conn.type === 'mcp') {
          mcpServers[conn.name] = await this.buildMcpServerConfig(conn)
        } else if (conn.type === 'api') {
          apiServers[`api_${conn.name}`] = this.buildApiServer(conn)
        } else if (conn.type === 'gmail') {
          const gmailServer = await this.buildGmailServer(conn)
          if (gmailServer) {
            apiServers[`gmail_${conn.id}`] = gmailServer
          }
        }
      } catch (error) {
        console.error(`[ConnectionService] Failed to build config for ${conn.name}:`, error)
        // Skip this connection but continue with others
      }
    }

    return { mcpServers, apiServers }
  }
}

// Singleton instance
let connectionServiceInstance: ConnectionService | null = null

export function getConnectionService(): ConnectionService {
  if (!connectionServiceInstance) {
    connectionServiceInstance = new ConnectionService()
  }
  return connectionServiceInstance
}
