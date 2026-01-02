/**
 * Source Types
 *
 * Sources are external data connections (MCP servers, APIs, local filesystems).
 * They replace the old "connections" concept with a more flexible, folder-based architecture.
 *
 * File structure (workspace-scoped):
 * ~/.craft-agent/workspaces/{workspaceId}/sources/{sourceSlug}/
 *   ├── config.json   - Source settings
 *   └── guide.md      - Usage guidelines + cached data (in YAML frontmatter)
 *
 * Agent-scoped sources:
 * ~/.craft-agent/workspaces/{workspaceId}/agents/{agentSlug}/sources/{sourceSlug}/
 */

/**
 * Source types - how we connect to the source
 */
export type SourceType = 'mcp' | 'api' | 'local';

/**
 * MCP authentication types
 */
export type McpAuthType = 'oauth' | 'bearer' | 'none';

/**
 * API authentication types
 */
export type ApiAuthType = 'bearer' | 'header' | 'query' | 'basic' | 'oauth' | 'none';

/**
 * Known providers for special handling (OAuth flows, icons, etc.)
 * These have well-known OAuth endpoints or special behavior.
 */
export type KnownProvider =
  | 'google' // Google APIs (Gmail, etc.) - uses Google OAuth
  | 'linear' // Linear - standard MCP OAuth
  | 'github' // GitHub - standard MCP OAuth
  | 'notion' // Notion - standard MCP OAuth
  | 'slack' // Slack - standard MCP OAuth
  | 'exa'; // Exa search API

/**
 * MCP-specific configuration
 */
export interface McpSourceConfig {
  url: string;
  authType: McpAuthType;
  clientId?: string; // For OAuth - stored in config (not secret)
}

/**
 * API-specific configuration
 */
export interface ApiSourceConfig {
  baseUrl: string;
  authType: ApiAuthType;
  headerName?: string; // For 'header' auth (e.g., "X-API-Key")
  queryParam?: string; // For 'query' auth (e.g., "api_key")
  authScheme?: string; // For 'bearer' auth (default: "Bearer", could be "Token")
}

/**
 * Local filesystem/app configuration
 */
export interface LocalSourceConfig {
  path: string;
  format?: string; // Optional hint: 'filesystem' | 'obsidian' | 'git' | 'sqlite' | etc.
}

/**
 * Source connection status
 */
export type SourceConnectionStatus = 'connected' | 'needs_auth' | 'failed' | 'untested';

/**
 * Main source configuration (stored in config.json)
 */
export interface FolderSourceConfig {
  id: string;
  name: string;
  slug: string;
  enabled: boolean;

  // Provider is a freeform label (e.g., "linear", "todoist", "my-custom-api")
  provider: string;

  // Connection type determines which config block is used
  type: SourceType;

  // Type-specific configuration (exactly one should be present)
  mcp?: McpSourceConfig;
  api?: ApiSourceConfig;
  local?: LocalSourceConfig;

  // Icon: relative path to cached icon (e.g., "./icon.png")
  iconUrl?: string;

  // Original URL the icon was downloaded from (for re-fetching if needed)
  iconSourceUrl?: string;

  // Short description for agent context (e.g., "Issue tracking, bugs, tasks, sprints")
  // If not set, extracted from guide.md first paragraph
  tagline?: string;

  // Status tracking
  isAuthenticated?: boolean;
  connectionStatus?: SourceConnectionStatus;
  connectionError?: string; // Error message if status is 'failed'
  lastTestedAt?: number;

  // Metadata
  createdAt: number;
  updatedAt: number;
}

/**
 * Parsed guide.md content with embedded cache
 */
export interface SourceGuide {
  // Full raw markdown
  raw: string;

  // Parsed sections (extracted via regex/parsing)
  scope?: string;
  guidelines?: string;
  context?: string;
  apiNotes?: string;

  // Embedded cache data (from YAML frontmatter)
  cache?: Record<string, unknown>;
}

/**
 * Fully loaded source with all files
 */
export interface LoadedSource {
  config: FolderSourceConfig;
  guide: SourceGuide | null;

  /** Absolute path to source folder (for resolving relative icon paths) */
  folderPath: string;

  /**
   * Workspace this source belongs to.
   * Used for credential lookups: source_oauth::{workspaceId}::{sourceSlug}
   */
  workspaceId: string;

  /**
   * If set, this source is agent-scoped.
   * Path: workspaces/{workspaceId}/agents/{agentSlug}/sources/{slug}/
   * Credentials: agent_source_oauth::{workspaceId}::{agentSlug}::{sourceSlug}
   */
  agentSlug?: string;
}

/**
 * Source creation input (without auto-generated fields)
 */
export interface CreateSourceInput {
  name: string;
  provider: string;
  type: SourceType;
  mcp?: McpSourceConfig;
  api?: ApiSourceConfig;
  local?: LocalSourceConfig;
  iconUrl?: string;
  enabled?: boolean;
}
