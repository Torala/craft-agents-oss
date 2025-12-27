/**
 * Source Types
 *
 * Sources are external data connections (MCP servers, APIs, local filesystems).
 * They replace the old "connections" concept with a more flexible, folder-based architecture.
 *
 * File structure (workspace-scoped):
 * ~/.craft-agent/workspaces/{workspaceSlug}/sources/{sourceSlug}/
 *   ├── config.json   - Connection settings
 *   ├── guide.md      - Usage guidelines + cached data (in YAML frontmatter)
 *   └── icon.png      - Optional custom icon
 *
 * Agent-scoped sources:
 * ~/.craft-agent/workspaces/{workspaceSlug}/agents/{agentSlug}/sources/{sourceSlug}/
 */

/**
 * Source connection types - how we connect to the source
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
  | 'craft' // Craft MCP - uses Craft OAuth flow
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
  websiteUrl?: string; // Website URL for favicon (e.g., "https://obsidian.md" for Obsidian vaults)
}

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

  // Status tracking
  isAuthenticated?: boolean;
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
  iconPath: string | null;

  /**
   * Workspace this source belongs to.
   * Used for credential lookups: source_oauth::{workspaceSlug}::{sourceSlug}
   */
  workspaceSlug: string;

  /**
   * If set, this source is agent-scoped.
   * Path: workspaces/{workspaceSlug}/agents/{agentSlug}/sources/{slug}/
   * Credentials: agent_source_oauth::{workspaceSlug}::{agentSlug}::{sourceSlug}
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
  enabled?: boolean;
}
