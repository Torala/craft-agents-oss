/**
 * Workspace Types
 *
 * Workspaces are the top-level organizational unit. Everything (sources, agents, sessions)
 * is scoped to a workspace.
 *
 * Directory structure:
 * ~/.craft-agent/workspaces/{slug}/
 *   ├── config.json      - Workspace settings
 *   ├── sources/         - Data sources (MCP, API, local)
 *   ├── agents/          - Agent definitions
 *   └── sessions/        - Conversation sessions
 */

import type { PermissionMode } from '../agent/mode-manager.ts';

/**
 * Credential storage strategy for workspace-scoped credentials (API keys, bearer tokens)
 * - 'local': Machine-bound encryption (default) - credentials stored in global encrypted file
 * - 'portable': Password-based encryption - credentials stored in workspace folder, syncable
 */
export type CredentialStrategy = 'local' | 'portable';

/**
 * Workspace configuration (stored in config.json)
 */
export interface WorkspaceConfig {
  id: string;
  name: string;
  slug: string; // Folder name (URL-safe)

  /**
   * Default settings for new sessions in this workspace
   */
  defaults?: {
    model?: string;
    enabledSourceSlugs?: string[]; // Sources to enable by default
    permissionMode?: PermissionMode; // Default permission mode ('safe', 'ask', 'allow-all')
    workingDirectory?: string;
    credentialStrategy?: CredentialStrategy; // How to store workspace credentials (default: 'local')
  };

  createdAt: number;
  updatedAt: number;
}

/**
 * Workspace creation input
 */
export interface CreateWorkspaceInput {
  name: string;
  defaults?: WorkspaceConfig['defaults'];
}

/**
 * Loaded workspace with resolved sources and agents
 */
export interface LoadedWorkspace {
  config: WorkspaceConfig;
  sourceSlugs: string[]; // Available source slugs (not fully loaded to save memory)
  agentSlugs: string[]; // Available agent slugs
  sessionCount: number; // Number of sessions
}

/**
 * Workspace summary for listing (lightweight)
 */
export interface WorkspaceSummary {
  slug: string;
  name: string;
  sourceCount: number;
  agentCount: number;
  sessionCount: number;
  createdAt: number;
  updatedAt: number;
}
