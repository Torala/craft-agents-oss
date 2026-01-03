/**
 * Documentation Utilities
 *
 * Provides access to built-in documentation that Claude can reference
 * when performing configuration tasks (sources, agents, permissions, etc.).
 *
 * Docs are stored at ~/.craft-agent/docs/ and copied on first run.
 */

import { join } from 'path';
import { homedir } from 'os';
import { existsSync, mkdirSync, writeFileSync, readdirSync } from 'fs';

const CONFIG_DIR = join(homedir(), '.craft-agent');
const DOCS_DIR = join(CONFIG_DIR, 'docs');

/**
 * Get the docs directory path
 */
export function getDocsDir(): string {
  return DOCS_DIR;
}

/**
 * Get path to a specific doc file
 */
export function getDocPath(filename: string): string {
  return join(DOCS_DIR, filename);
}

/**
 * Check if docs directory exists
 */
export function docsExist(): boolean {
  return existsSync(DOCS_DIR);
}

/**
 * List available doc files
 */
export function listDocs(): string[] {
  if (!existsSync(DOCS_DIR)) return [];
  return readdirSync(DOCS_DIR).filter(f => f.endsWith('.md'));
}

/**
 * Initialize docs directory with bundled documentation.
 * Called on first run to copy docs to user's config folder.
 */
export function initializeDocs(): void {
  if (!existsSync(DOCS_DIR)) {
    mkdirSync(DOCS_DIR, { recursive: true });
  }

  // Write bundled docs
  for (const [filename, content] of Object.entries(BUNDLED_DOCS)) {
    const docPath = join(DOCS_DIR, filename);
    if (!existsSync(docPath)) {
      writeFileSync(docPath, content, 'utf-8');
    }
  }
}

// ============================================================
// Bundled Documentation
// ============================================================

const SOURCES_MD = `# Sources Configuration Guide

This guide explains how to configure sources (MCP servers, APIs, local filesystems) in Craft Agent.

## Overview

Sources are stored as folders under:
- Workspace sources: \`~/.craft-agent/workspaces/{workspaceId}/sources/{sourceSlug}/\`
- Agent-scoped sources: \`~/.craft-agent/workspaces/{workspaceId}/agents/{agentSlug}/sources/{sourceSlug}/\`

Each source folder contains:
- \`config.json\` - Source configuration (required)
- \`guide.md\` - Usage documentation for Claude (optional)
- \`permissions.json\` - Custom permission rules for Explore mode (optional)
- \`icon.png\` or \`icon.svg\` - Source icon (optional)

## config.json Schema

\`\`\`json
{
  "id": "uuid",
  "name": "Human-readable name",
  "slug": "url-safe-identifier",
  "enabled": true,
  "provider": "provider-name",
  "type": "mcp" | "api" | "local",

  // For MCP sources:
  "mcp": {
    "url": "https://mcp.example.com",
    "authType": "oauth" | "bearer" | "none"
  },

  // For API sources:
  "api": {
    "baseUrl": "https://api.example.com",
    "authType": "bearer" | "header" | "query" | "basic" | "oauth" | "none",
    "headerName": "X-API-Key",      // For header auth
    "queryParam": "api_key",         // For query auth
    "authScheme": "Bearer"           // For bearer auth (default: "Bearer")
  },

  // For local sources:
  "local": {
    "path": "/path/to/folder"
  },

  // Status (updated by source_test):
  "isAuthenticated": true,
  "connectionStatus": "connected" | "needs_auth" | "failed" | "untested",
  "lastTestedAt": 1704067200000,

  // Icon handling:
  "iconUrl": "./icon.png",           // Relative path to cached icon
  "iconSourceUrl": "https://...",    // Original URL for re-fetching

  // Timestamps:
  "createdAt": 1704067200000,
  "updatedAt": 1704067200000
}
\`\`\`

## Source Types

### MCP Sources

Model Context Protocol servers provide tools via HTTP/SSE.

**OAuth authentication (recommended):**
\`\`\`json
{
  "type": "mcp",
  "provider": "linear",
  "mcp": {
    "url": "https://mcp.linear.app",
    "authType": "oauth"
  }
}
\`\`\`

After creating, use \`source_oauth_trigger\` to authenticate.

**Bearer token authentication:**
\`\`\`json
{
  "type": "mcp",
  "provider": "custom-mcp",
  "mcp": {
    "url": "https://my-mcp-server.com",
    "authType": "bearer"
  }
}
\`\`\`

After creating, use \`source_credential_prompt\` with mode "bearer".

**Public (no auth):**
\`\`\`json
{
  "type": "mcp",
  "provider": "public-mcp",
  "mcp": {
    "url": "https://public-mcp.example.com",
    "authType": "none"
  }
}
\`\`\`

### API Sources

REST APIs become flexible tools that Claude can call.

**Header authentication (X-API-Key style):**
\`\`\`json
{
  "type": "api",
  "provider": "exa",
  "api": {
    "baseUrl": "https://api.exa.ai",
    "authType": "header",
    "headerName": "x-api-key"
  }
}
\`\`\`

**Bearer token (Authorization header):**
\`\`\`json
{
  "type": "api",
  "provider": "openai",
  "api": {
    "baseUrl": "https://api.openai.com/v1",
    "authType": "bearer"
  }
}
\`\`\`

**Query parameter:**
\`\`\`json
{
  "type": "api",
  "provider": "weather",
  "api": {
    "baseUrl": "https://api.weather.com",
    "authType": "query",
    "queryParam": "apikey"
  }
}
\`\`\`

**Basic authentication:**
\`\`\`json
{
  "type": "api",
  "provider": "jira",
  "api": {
    "baseUrl": "https://your-domain.atlassian.net/rest/api/3",
    "authType": "basic"
  }
}
\`\`\`

### Local Sources

Filesystem access for local folders.

\`\`\`json
{
  "type": "local",
  "provider": "obsidian",
  "local": {
    "path": "/Users/me/Documents/ObsidianVault"
  }
}
\`\`\`

## guide.md Format

The guide.md file helps Claude understand how to use the source effectively.

\`\`\`markdown
# Source Name

Brief description of what this source provides.

## Scope

What data/functionality this source provides access to.

## Guidelines

- Best practices for using this source
- Rate limits or quotas to be aware of
- Common patterns and examples

## API Reference

For API sources, document the available endpoints:

### POST /search
Search for content.

**Parameters:**
- \`query\` (string, required): Search query
- \`limit\` (number, optional): Max results (default: 10)

**Example:**
\\\`\\\`\\\`json
{
  "query": "machine learning",
  "limit": 5
}
\\\`\\\`\\\`
\`\`\`

## permissions.json Format

Custom rules to extend Explore mode permissions for this source.

\`\`\`json
{
  "allowedMcpPatterns": [
    {
      "pattern": "^mcp__linear__list",
      "comment": "Allow listing resources in Explore mode"
    }
  ],
  "allowedApiEndpoints": [
    {
      "method": "GET",
      "path": "^/search",
      "comment": "Allow search endpoint in Explore mode"
    },
    {
      "method": "POST",
      "path": "^/v1/query$",
      "comment": "POST allowed for query-only endpoints"
    }
  ],
  "allowedBashPatterns": [
    {
      "pattern": "^ls\\\\s",
      "comment": "Allow ls commands"
    }
  ]
}
\`\`\`

## Icon Handling

Icons can be specified in several ways:

1. **Relative path:** \`"iconUrl": "./icon.png"\` - Already downloaded to source folder
2. **Direct URL:** \`"iconUrl": "https://example.com/logo.png"\` - Will be downloaded and cached
3. **Domain for favicon:** \`"iconUrl": "linear.app"\` - Fetches favicon from domain

When using URLs or domains, \`source_test\` will download and cache the icon locally.

## Common Providers

### Gmail
Provider: \`gmail\`, Type: \`api\`
Uses OAuth via \`source_gmail_oauth_trigger\`.

### Linear
Provider: \`linear\`, Type: \`mcp\`
URL: \`https://mcp.linear.app\`, OAuth auth.

### GitHub
Provider: \`github\`, Type: \`mcp\`
URL: \`https://mcp.github.com\`, OAuth auth.

### Exa (Search)
Provider: \`exa\`, Type: \`api\`
Base URL: \`https://api.exa.ai\`, header auth with \`x-api-key\`.

## Workflow

### Creating a Source

1. Create the source folder and config.json:
   \`\`\`bash
   mkdir -p ~/.craft-agent/workspaces/{ws}/sources/my-source
   \`\`\`

2. Write config.json with appropriate settings

3. Run \`source_test\` to validate and test connection

4. If auth is required, use:
   - \`source_oauth_trigger\` for MCP OAuth
   - \`source_gmail_oauth_trigger\` for Gmail
   - \`source_credential_prompt\` for API keys/tokens

### Testing a Source

Use \`source_test\` with the source slug:
- Validates config.json schema
- Tests connectivity
- Downloads icon if needed
- Updates connectionStatus

### Troubleshooting

**"needs_auth" status:**
- Source requires authentication
- Use appropriate auth trigger tool

**"failed" status:**
- Check \`connectionError\` in config.json
- Verify URL is correct
- Check network connectivity

**Icon not showing:**
- Ensure iconUrl is valid
- Run \`source_test\` to re-download
- Check file exists in source folder
`;

const AGENTS_MD = `# Agents Configuration Guide

This guide explains how to configure agents in Craft Agent.

## Overview

Agents are stored at:
\`~/.craft-agent/workspaces/{workspaceId}/agents/{agentSlug}/\`

Each agent folder contains:
- \`config.json\` - Agent configuration (required)
- \`instructions.md\` - Agent instructions/system prompt (required)
- \`theme.json\` - Agent-specific theme overrides (optional)
- \`sources/\` - Agent-scoped sources (optional)

## config.json Schema

\`\`\`json
{
  "name": "Research Assistant",
  "slug": "research-assistant",
  "enabled": true,
  "useSources": ["exa", "web-archive"],
  "source": {
    "type": "local"
  },
  "createdAt": 1704067200000,
  "updatedAt": 1704067200000
}
\`\`\`

### Fields

- **name** (string, required): Display name
- **slug** (string, required): URL-safe identifier
- **enabled** (boolean): Whether agent is active (default: true)
- **useSources** (string[]): Workspace source slugs to attach
- **source**: Origin tracking for synced agents

## instructions.md

The instructions file contains the agent's system prompt in markdown:

\`\`\`markdown
# Research Assistant

You are a research assistant specialized in deep research tasks.

## Capabilities

- Search the web using Exa
- Access archived web pages
- Synthesize information from multiple sources

## Guidelines

- Always cite sources
- Prefer recent information
- Cross-reference claims across sources
\`\`\`

## Agent-Scoped Sources

Agents can have their own sources at:
\`~/.craft-agent/workspaces/{ws}/agents/{agent}/sources/{source}/\`

These sources are only available when the agent is active.

## Source Attachment

Agents can use workspace sources via \`useSources\`:

\`\`\`json
{
  "useSources": ["exa", "linear", "github"]
}
\`\`\`

These sources are loaded when the agent activates.

## Theme Customization

Agents can override the UI theme:

\`\`\`json
{
  "accent": "#6366f1"
}
\`\`\`

## Workflow

### Creating an Agent

1. Create the agent folder:
   \`\`\`bash
   mkdir -p ~/.craft-agent/workspaces/{ws}/agents/my-agent
   \`\`\`

2. Write config.json:
   \`\`\`json
   {
     "name": "My Agent",
     "slug": "my-agent",
     "enabled": true
   }
   \`\`\`

3. Write instructions.md with the agent's behavior

4. Optionally add agent-scoped sources

### Activating an Agent

Use \`@agent-name\` in a message or \`--agent\` CLI flag.
`;

const PERMISSIONS_MD = `# Permissions Configuration Guide

This guide explains how to configure custom permission rules for Explore mode.

## Overview

Explore mode is a read-only mode that blocks potentially destructive operations.
Custom permission rules let you allow specific operations that would otherwise be blocked.

Permission files are located at:
- Workspace: \`~/.craft-agent/workspaces/{slug}/permissions.json\`
- Source: \`~/.craft-agent/workspaces/{slug}/sources/{source}/permissions.json\`
- Agent: \`~/.craft-agent/workspaces/{slug}/agents/{agent}/permissions.json\`

## permissions.json Schema

\`\`\`json
{
  "allowedMcpPatterns": [
    {
      "pattern": "^mcp__linear__list",
      "comment": "Allow listing resources"
    }
  ],
  "allowedApiEndpoints": [
    {
      "method": "GET",
      "path": "^/api/",
      "comment": "Allow GET requests to /api/*"
    }
  ],
  "allowedBashPatterns": [
    {
      "pattern": "^ls\\\\s",
      "comment": "Allow ls commands"
    }
  ],
  "blockedTools": [
    "dangerous_tool"
  ],
  "allowedWritePaths": [
    "/tmp/**",
    "~/.craft-agent/**"
  ]
}
\`\`\`

## Rule Types

### allowedMcpPatterns

Regex patterns for MCP tool names to allow in Explore mode.

\`\`\`json
{
  "allowedMcpPatterns": [
    { "pattern": "^mcp__linear__list", "comment": "List operations" },
    { "pattern": "^mcp__linear__get", "comment": "Get operations" },
    { "pattern": "^mcp__notion__search", "comment": "Search only" }
  ]
}
\`\`\`

### allowedApiEndpoints

Fine-grained rules for API source requests.

\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*", "comment": "All GET requests" },
    { "method": "POST", "path": "^/search", "comment": "Search POST" },
    { "method": "POST", "path": "^/v1/query$", "comment": "Query endpoint" }
  ]
}
\`\`\`

### allowedBashPatterns

Regex patterns for bash commands to allow.

\`\`\`json
{
  "allowedBashPatterns": [
    { "pattern": "^ls\\\\s", "comment": "ls commands" },
    { "pattern": "^git\\\\s+status", "comment": "git status" },
    { "pattern": "^pwd$", "comment": "pwd command" }
  ]
}
\`\`\`

### blockedTools

Additional tools to block (rarely needed).

\`\`\`json
{
  "blockedTools": ["risky_tool_name"]
}
\`\`\`

### allowedWritePaths

Glob patterns for directories where writes are allowed.

\`\`\`json
{
  "allowedWritePaths": [
    "/tmp/**",
    "~/.craft-agent/**",
    "/path/to/project/output/**"
  ]
}
\`\`\`

## Default Behavior in Explore Mode

**Blocked by default:**
- Bash commands (except patterns in allowedBashPatterns)
- Write, Edit, MultiEdit tools
- MCP tools with write semantics
- API POST/PUT/DELETE requests

**Allowed by default:**
- Read, Glob, Grep
- WebFetch, WebSearch
- TodoWrite, AskUserQuestion
- MCP tools with read semantics (list, get, search)

## Cascading Rules

Rules cascade from workspace → source → agent:
1. Workspace rules apply globally
2. Source rules extend workspace rules for that source
3. Agent rules extend both for that agent's session

Rules are additive - they can only allow more operations, not restrict further.

## Best Practices

1. **Be specific with patterns** - Use anchors (^, $) to avoid over-matching
2. **Add comments** - Explain why each rule exists
3. **Test patterns** - Verify regex matches expected tool names
4. **Minimal permissions** - Only allow what's needed

## Examples

### Read-only Linear access:
\`\`\`json
{
  "allowedMcpPatterns": [
    { "pattern": "^mcp__linear__(list|get|search)", "comment": "Read operations" }
  ]
}
\`\`\`

### Search-only API:
\`\`\`json
{
  "allowedApiEndpoints": [
    { "method": "GET", "path": ".*" },
    { "method": "POST", "path": "^/search" }
  ]
}
\`\`\`

### Safe git commands:
\`\`\`json
{
  "allowedBashPatterns": [
    { "pattern": "^git\\\\s+(status|log|diff|branch)", "comment": "Read-only git" }
  ]
}
\`\`\`
`;

/**
 * Map of bundled documentation files
 */
const BUNDLED_DOCS: Record<string, string> = {
  'sources.md': SOURCES_MD,
  'agents.md': AGENTS_MD,
  'permissions.md': PERMISSIONS_MD,
};

export { BUNDLED_DOCS };
