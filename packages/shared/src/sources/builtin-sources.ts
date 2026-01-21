/**
 * Built-in Sources
 *
 * System-level sources that are always available in every workspace.
 * These sources are not shown in the sources list UI but are available
 * for the agent to use.
 *
 * Currently includes:
 * - craft-agents-docs: Mintlify documentation MCP server for searching setup guides
 */

import type { LoadedSource, FolderSourceConfig } from './types.ts';

/**
 * Craft Agents documentation MCP source.
 *
 * This connects to the Mintlify MCP server that provides search over the
 * online documentation at agents.craft.do. The agent uses this to look up
 * source setup guides before creating or modifying sources.
 *
 * The Mintlify MCP server exposes a `search` tool that returns relevant
 * documentation pages based on the query.
 */
const DOCS_SOURCE_CONFIG: FolderSourceConfig = {
  id: 'builtin-craft-agents-docs',
  name: 'Craft Agents Docs',
  slug: 'craft-agents-docs',
  enabled: true,
  provider: 'mintlify',
  type: 'mcp',
  mcp: {
    transport: 'http',
    url: 'https://agents.craft.do/docs/mcp',
    authType: 'none',
  },
  // Mark as internal so it's not shown in the sources list UI
  // but still available for the agent to use
  tagline: 'Search Craft Agents documentation and source setup guides',
  icon: '📚',
  // Connection status - assume connected (public server, no auth needed)
  isAuthenticated: true,
  connectionStatus: 'connected',
};

/**
 * Get the built-in Craft Agents docs source.
 *
 * This source connects to the Mintlify MCP server at agents.craft.do/docs/mcp
 * and provides search functionality for the agent to look up setup guides
 * before creating or modifying sources.
 *
 * @param workspaceId - The workspace ID (used for source context)
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @returns LoadedSource for the docs MCP server
 */
export function getDocsSource(workspaceId: string, workspaceRootPath: string): LoadedSource {
  return {
    workspaceId,
    workspaceRootPath,
    folderPath: '', // Built-in sources don't have a filesystem path
    config: DOCS_SOURCE_CONFIG,
    guide: {
      raw: `# Craft Agents Documentation

Search the official Craft Agents documentation for setup guides, configuration reference, and troubleshooting help.

## Usage

Use the \`search\` tool to find relevant documentation:

\`\`\`
mcp__craft-agents-docs__search({ query: "github source setup guide" })
\`\`\`

## Available Content

- **Source Setup Guides**: Step-by-step instructions for GitHub, Linear, Slack, Gmail, and more
- **Configuration Reference**: Detailed config.json schemas and options
- **Authentication**: OAuth, bearer tokens, API keys
- **Troubleshooting**: Common issues and solutions
`,
    },
    isBuiltin: true, // Flag to identify built-in sources
  };
}

/**
 * Get all built-in sources for a workspace.
 *
 * Currently returns:
 * - craft-agents-docs: Documentation search via Mintlify MCP
 *
 * @param workspaceId - The workspace ID
 * @param workspaceRootPath - Absolute path to workspace root folder
 * @returns Array of built-in LoadedSource objects
 */
export function getBuiltinSources(workspaceId: string, workspaceRootPath: string): LoadedSource[] {
  return [getDocsSource(workspaceId, workspaceRootPath)];
}

/**
 * Check if a source slug is a built-in source.
 *
 * @param slug - Source slug to check
 * @returns true if this is a built-in source
 */
export function isBuiltinSource(slug: string): boolean {
  return slug === 'craft-agents-docs';
}
