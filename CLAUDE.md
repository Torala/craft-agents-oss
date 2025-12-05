# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Craft TUI Agent is a Claude Code-like terminal interface for managing Craft documents. It uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) to interact with Claude models and connects to a Craft MCP server for document operations.

## Commands

```bash
# Install dependencies
bun install

# Run the application
bun start                # or: bun run src/index.tsx

# Development with auto-reload
bun dev

# Type checking
bun run typecheck

# Install globally (creates 'craft' command)
bun link
```

## Architecture

### Entry Point & Setup Flow
- `src/index.tsx` - CLI entry point using meow for argument parsing. Renders either the Setup wizard or main App based on stored config.
- Configuration stored in `~/.craft-agent/config.json` via `src/config/storage.ts`
- User preferences (name, timezone, etc.) stored separately via `src/config/preferences.ts`

### Agent Layer
- `src/agent/craft-agent.ts` - Core agent class (`CraftAgent`) that:
  - Uses `@anthropic-ai/claude-agent-sdk` for Claude API calls via the `query()` function
  - Leverages SDK's built-in agentic loop (no manual tool call handling needed)
  - **Auto compaction**: SDK automatically compresses long conversations to manage context
  - Session management via `resume` option for conversation continuity
  - Handles OAuth token refresh for Craft MCP authentication
  - Converts SDK's `SDKMessage` events to `AgentEvent` for TUI compatibility
  - Configures Craft MCP server via SDK's `mcpServers` option with HTTP transport
  - Has a built-in `update_user_preferences` tool via PreToolUse hook

### MCP Integration
- MCP is now handled by the Claude Agent SDK directly
- `src/mcp/client.ts` - Legacy MCP client (no longer used by agent, kept for /tools command)
- `src/mcp/tools.ts` - Tool registry and help formatting for Craft MCP tools
- The SDK connects to the MCP server via `mcpServers: { craft: { type: 'http', url, headers } }`

### TUI Layer (Ink/React)
- `src/tui/App.tsx` - Main application component, handles slash commands (/help, /tools, /model, /web, /clear, etc.)
- `src/tui/components/` - UI components (Header, Messages, Input, ToolCall, Setup wizard, Spinner)
- `src/tui/hooks/useAgent.ts` - React hook that wraps CraftAgent, manages messages state, handles streaming updates with throttling
- `src/tui/hooks/useHistory.ts` - Command history for up/down arrow navigation
- `src/tui/utils/files.ts` - File attachment processing (images, PDFs, text files)
- `src/tui/utils/markdown.ts` - Markdown rendering for terminal using marked + marked-terminal

### System Prompt
- `src/prompts/system.ts` - Defines the Craft Assistant persona and capabilities, includes current date/time context and user preferences

## Key Patterns

### Streaming Architecture
The agent uses the Claude Agent SDK's streaming pattern:
1. `CraftAgent.chat()` calls `query()` from the SDK, which returns an async generator of `SDKMessage`
2. Messages are converted to `AgentEvent` objects for backward compatibility with the TUI
3. `useAgent` hook consumes events and updates React state with throttling (50ms) to reduce flickering
4. The SDK handles the agentic loop internally (tool calls, MCP communication, etc.)

### Auto Compaction
- The SDK automatically compacts conversation history when it grows too large
- Compaction events are surfaced as status messages in the TUI
- Session IDs are preserved to enable `resume` for conversation continuity

### OAuth Flow
- OAuth handled in `src/auth/oauth.ts` with automatic token refresh
- Tokens are passed to the SDK via `mcpServers.craft.headers`
- Supports both authenticated and public MCP servers (controlled by `isPublic` flag in config)

### Message Types
Messages have types: 'user', 'assistant', 'tool', 'error', 'status', 'system' - rendered differently in the TUI

## Tech Stack
- **Runtime**: Bun
- **TUI**: Ink (React for CLIs)
- **AI**: @anthropic-ai/claude-agent-sdk (Agent SDK with auto compaction, session management)
- **MCP**: Handled by Agent SDK via HTTP transport
