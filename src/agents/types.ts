/**
 * Sub-agent type definitions
 *
 * Sub-agents are specialized AI personas defined by Craft documents.
 * Users @mention agents to activate them, and agents can self-modify
 * their instructions via the von Neumann architecture pattern.
 */

/**
 * Metadata for a sub-agent stored in local cache
 */
export interface SubAgentMetadata {
  /** Unique identifier (derived from document ID) */
  id: string;
  /** Short name for @mention (e.g., "writer", "coder") */
  name: string;
  /** Craft document ID containing the agent definition */
  documentId: string;
  /** Workspace this agent belongs to */
  workspaceId: string;
  /** When the agent was first discovered */
  createdAt: number;
}

/**
 * Parsed content from a sub-agent document
 *
 * Document structure:
 * - Agent Name (document title)
 *   ├── Instructions (subpage - contains behavior + learnings)
 *   └── MCP Servers (optional - configs in code blocks)
 */
export interface SubAgentDefinition {
  /** Agent name (from document title) */
  name: string;
  /** Content of Instructions subpage */
  instructions: string;
  /** Block ID of Instructions subpage (for self-modification, optional with AI extraction) */
  instructionsBlockId?: string;
  /** MCP server configs parsed from code blocks */
  mcpServers?: McpServerConfig[];
  /** REST API configs extracted from curl examples or documentation */
  apis?: ApiConfig[];
  /** Info messages from extraction (warnings, notices, etc.) */
  info?: string[];
  /** Full raw content for reference */
  rawContent: string;
  /** When this was parsed */
  parsedAt: number;
}

/**
 * MCP server configuration parsed from agent document
 */
export interface McpServerConfig {
  /** Server identifier */
  name: string;
  /** MCP server URL */
  url: string;
  /** If true, needs OAuth authentication */
  requiresAuth?: boolean;
  /** Static bearer token (alternative to OAuth) */
  bearerToken?: string;
  /** Optional description */
  description?: string;
  /** Tools available on this server (populated after connection) */
  tools?: string[];
}

/**
 * REST API configuration extracted from agent document
 * APIs are converted to in-process MCP servers at runtime
 */
export interface ApiConfig {
  /** API identifier - becomes tool prefix (e.g., "exa" → "exa_search") */
  name: string;
  /** Base URL for API requests */
  baseUrl: string;
  /** Authentication configuration */
  auth?: {
    type: 'header' | 'bearer' | 'query';
    /** Header name for type='header' (e.g., "x-api-key") */
    headerName?: string;
    /** Query param name for type='query' (e.g., "api_key") */
    queryParam?: string;
  };
  /** Discovered endpoints */
  endpoints: ApiEndpoint[];
  /** Human-readable description */
  description?: string;
}

/**
 * API endpoint configuration - becomes an MCP tool
 */
export interface ApiEndpoint {
  /** Endpoint name - becomes tool suffix (e.g., "search" → "exa_search") */
  name: string;
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  /** Path relative to baseUrl (e.g., "/search") */
  path: string;
  /**
   * Rich tool description that helps Claude use this endpoint effectively.
   * Should include:
   * - What the endpoint does
   * - When to use it (use cases)
   * - Key parameters with valid values
   * - Constraints (rate limits, max values)
   * - Related endpoints
   */
  description: string;
  /** Example parameters extracted from curl/docs - appended to description */
  exampleParams?: Record<string, unknown>;
}

/**
 * Stored credentials for agent MCP servers
 */
export interface AgentMcpCredentials {
  /** Agent this belongs to */
  agentId: string;
  /** Credentials keyed by server name */
  servers: Record<
    string,
    {
      accessToken: string;
      refreshToken?: string;
      expiresAt?: number;
      clientId?: string;  // Needed for token refresh
    }
  >;
}

/**
 * Current active agent state
 */
export interface ActiveAgentState {
  /** Whether main agent or sub-agent is active */
  type: 'main' | 'sub-agent';
  /** Sub-agent ID if type is 'sub-agent' */
  agentId?: string;
  /** When the agent was activated */
  activatedAt?: number;
}

/**
 * Cached sub-agent with metadata and optional definition
 */
export interface CachedSubAgent {
  metadata: SubAgentMetadata;
  /** Definition is null if not yet fetched */
  definition: SubAgentDefinition | null;
  /** Unix timestamp when cache expires */
  cacheExpiry: number;
}

/**
 * Agent registry stored per workspace
 */
export interface AgentRegistry {
  /** All discovered agents */
  agents: SubAgentMetadata[];
  /** ID of the "Agents" folder in Craft */
  agentsFolderId?: string;
  /** When the registry was last refreshed */
  lastRefreshed: number;
}
