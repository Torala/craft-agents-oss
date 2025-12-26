# CLAUDE.md - TUI Application

This file provides guidance to Claude Code when working with the TUI (Terminal User Interface) application.

**Important:** Keep this file and `README.md` up-to-date whenever functionality changes. After making changes to this package, update the documentation to reflect the current state.

## Overview

The TUI app is the primary terminal interface for Craft Agent. It provides an interactive CLI experience similar to Claude Code, with streaming responses, tool visualization, and multi-workspace support.

**Important:** This app imports business logic from the `@craft-agent/shared` package. Only UI components, hooks, and utilities specific to the terminal interface live here.

## Directory Structure

```
apps/tui/
├── src/
│   ├── index.tsx          # CLI entry point, argument parsing, routing
│   ├── App.tsx             # Root component, global state provider
│   ├── components/         # React (Ink) UI components
│   │   ├── Setup.tsx       # First-run configuration wizard
│   │   ├── Header.tsx      # Status bar (model, workspace, tokens)
│   │   ├── Input.tsx       # Main chat input with history
│   │   ├── Messages.tsx    # Message display with streaming
│   │   ├── ToolCall.tsx    # Tool execution visualization
│   │   ├── TextInput.tsx   # Shared text input (cursor, selection)
│   │   ├── ModelSelector.tsx
│   │   ├── WorkspaceSelector.tsx
│   │   ├── WorkspaceAdd.tsx
│   │   └── ...
│   ├── context/
│   │   └── GlobalContext.tsx  # Model, workspace, session state
│   ├── hooks/
│   │   ├── core/
│   │   │   ├── useAgent.ts      # Agent state, streaming, tokens
│   │   │   ├── useElapsedTime.ts
│   │   │   └── useResize.ts     # Terminal resize handling
│   │   ├── input/
│   │   │   ├── useHistory.ts    # Command history
│   │   │   ├── useCommands.ts   # Slash command handling
│   │   │   └── useMentionHandler.ts  # @agent mentions
│   │   └── modals/
│   │       ├── useModalState.ts
│   │       ├── useWorkspaceHandlers.ts
│   │       └── useSettingsHandlers.ts
│   ├── keyboard/
│   │   └── mappings.ts    # Keyboard shortcut detection
│   └── utils/
│       ├── filtering.ts   # Command hints, tab completion
│       ├── markdown.ts    # Markdown rendering with Shiki
│       ├── terminalProgress.ts
│       └── toolStatus.ts
├── package.json
└── tsconfig.json
```

## Key Patterns

### Import Strategy

The TUI app uses workspace package imports for shared logic:

```typescript
// Imports from @craft-agent/shared
import { loadStoredConfig } from '@craft-agent/shared/config';
import { CraftAgent } from '@craft-agent/shared/agent';
import { debug } from '@craft-agent/shared/utils';

// Local imports (TUI-specific)
import { useAgent } from './hooks/core/useAgent.ts';
import { renderMarkdown } from './utils/markdown.ts';
```

### Session-Based Architecture

The app uses session-based isolation where each session maps 1:1 with a CraftAgent instance:

```
App (Global: model, workspace)
└── SessionContainer key={session.id}
    └── All session-scoped state
        • messages, tokenUsage, streamingText
        • pendingPermission, pendingQuestion
        • CraftAgent instance
```

When `session.id` changes, React unmounts/remounts SessionContainer, ensuring complete state isolation.

### Streaming Updates

The `useAgent` hook throttles streaming updates to 50ms to prevent flickering:

```typescript
// In useAgent.ts
const throttledSetStreamingText = useMemo(
  () => throttle((text: string) => setStreamingText(text), 50),
  []
);
```

## Commands

```bash
# From monorepo root
bun run start                    # Run TUI
bun run dev                      # Run with auto-reload
bun run apps/tui/src/index.tsx   # Run directly

# CLI flags
--debug          # Enable debug logging to /tmp/craft-debug.log
--workspace, -w  # Select workspace by name/ID/URL
--model, -m      # Override model selection
--new            # Start new session
--session <id>   # Resume specific session
--print, -p      # Non-interactive print mode
```

## Debugging

```bash
# Terminal 1: Run with debug logging
bun start --debug

# Terminal 2: Watch logs
tail -f /tmp/craft-debug.log
```

Use `debug()` from `@craft-agent/shared/utils` to add log entries.

## Dependencies

- **Workspace packages:** `@craft-agent/core`, `@craft-agent/shared`
- **UI:** Ink 5.x (React for CLIs)
- **Styling:** chalk for colors
- **Markdown:** marked + marked-terminal + Shiki

## Relationship to Shared Package

| This App (`apps/tui/src/`) | `@craft-agent/shared` |
|---------------------------|------------------------|
| UI components (Ink/React) | Agent logic (`agent/`) |
| Terminal-specific hooks   | Storage (`config/`) |
| Keyboard handling         | Auth (`auth/`) |
| Markdown rendering        | MCP client (`mcp/`) |
|                           | Credentials (`credentials/`) |
|                           | Sub-agents (`agents/`) |
|                           | Debug utilities (`utils/`) |
|                           | Headless mode (`headless/`) |
