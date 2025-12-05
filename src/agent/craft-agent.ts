import { query, createSdkMcpServer, tool, type Query, type SDKMessage, type Options } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { getSystemPrompt } from '../prompts/system.ts';
import { isTokenExpired, updateOAuthTokens, loadStoredConfig } from '../config/storage.ts';
import { updatePreferences, loadPreferences, type UserPreferences } from '../config/preferences.ts';
import { CraftOAuth, getMcpBaseUrl } from '../auth/oauth.ts';
import type { FileAttachment } from '../tui/utils/files.ts';

export interface CraftAgentConfig {
  mcpUrl: string;
  mcpToken?: string;
  model?: string;
  enableWebSearch?: boolean;
  enableWebFetch?: boolean;
  enableCodeExecution?: boolean; // Not currently used with SDK - kept for interface compatibility
}

// Message types for streaming - kept for TUI compatibility
export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text_complete'; text: string }
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; result: string; isError: boolean; input?: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'complete'; usage?: { inputTokens: number; outputTokens: number } };

// Handle preferences update (extracted for use in MCP tool)
function handleUpdatePreferences(input: Record<string, unknown>): string {
  const updates: Partial<UserPreferences> = {};

  if (input.name && typeof input.name === 'string') {
    updates.name = input.name;
  }
  if (input.timezone && typeof input.timezone === 'string') {
    updates.timezone = input.timezone;
  }
  if (input.language && typeof input.language === 'string') {
    updates.language = input.language;
  }

  // Handle location fields
  if (input.city || input.region || input.country) {
    updates.location = {};
    if (input.city && typeof input.city === 'string') {
      updates.location.city = input.city;
    }
    if (input.region && typeof input.region === 'string') {
      updates.location.region = input.region;
    }
    if (input.country && typeof input.country === 'string') {
      updates.location.country = input.country;
    }
  }

  // Handle notes (append to existing)
  if (input.notes && typeof input.notes === 'string') {
    const current = loadPreferences();
    const existingNotes = current.notes || '';
    const newNote = input.notes;
    updates.notes = existingNotes
      ? `${existingNotes}\n- ${newNote}`
      : `- ${newNote}`;
  }

  // Check if anything was actually updated
  const fields = Object.keys(updates).filter(k => k !== 'location');
  if (updates.location) {
    fields.push(...Object.keys(updates.location).map(k => `location.${k}`));
  }

  if (fields.length === 0) {
    return 'No preferences were updated (no valid fields provided)';
  }

  updatePreferences(updates);
  return `Updated user preferences: ${fields.join(', ')}`;
}

// Create the preferences MCP server with the update_user_preferences tool
// Lazy-initialized singleton
let preferencesServerInstance: ReturnType<typeof createSdkMcpServer> | null = null;

function getPreferencesServer() {
  if (!preferencesServerInstance) {
    preferencesServerInstance = createSdkMcpServer({
      name: 'preferences',
      version: '1.0.0',
      tools: [
        tool(
          'update_user_preferences',
          `Update stored user preferences. Use this when you learn information about the user that would be helpful to remember for future conversations. This includes their name, timezone, location, preferred language, or any other relevant notes. Only update fields you have confirmed information about - don't guess.`,
          {
            name: z.string().optional().describe("The user's preferred name or how they'd like to be addressed"),
            timezone: z.string().optional().describe("The user's timezone in IANA format (e.g., 'America/New_York', 'Europe/London')"),
            city: z.string().optional().describe("The user's city"),
            region: z.string().optional().describe("The user's state/region/province"),
            country: z.string().optional().describe("The user's country"),
            language: z.string().optional().describe("The user's preferred language for responses"),
            notes: z.string().optional().describe('Additional notes about the user that would be helpful to remember (preferences, context, etc.). This appends to existing notes.'),
          },
          async (args) => {
            try {
              const result = handleUpdatePreferences(args);
              return {
                content: [{ type: 'text', text: result }],
              };
            } catch (error) {
              const message = error instanceof Error ? error.message : 'Unknown error';
              return {
                content: [{ type: 'text', text: `Failed to update preferences: ${message}` }],
                isError: true,
              };
            }
          }
        ),
      ],
    });
  }
  return preferencesServerInstance;
}

export class CraftAgent {
  private config: CraftAgentConfig;
  private currentQuery: Query | null = null;
  private sessionId: string | null = null;
  private webSearchEnabled: boolean;
  private webFetchEnabled: boolean;

  constructor(config: CraftAgentConfig) {
    this.config = config;
    this.webSearchEnabled = config.enableWebSearch ?? true;
    this.webFetchEnabled = config.enableWebFetch ?? true;
  }

  private async getToken(): Promise<string | null> {
    if (this.config.mcpToken) {
      return this.config.mcpToken;
    }

    const storedConfig = loadStoredConfig();
    if (!storedConfig) {
      throw new Error('No configuration found. Please run setup.');
    }

    if (storedConfig.isPublic) {
      return null;
    }

    if (!storedConfig.oauth) {
      throw new Error('No OAuth credentials found. Please run setup.');
    }

    if (isTokenExpired(storedConfig) && storedConfig.oauth.refreshToken) {
      try {
        const oauth = new CraftOAuth(
          { mcpBaseUrl: getMcpBaseUrl(storedConfig.craftMcpUrl) },
          { onStatus: () => {}, onError: () => {} }
        );

        const newTokens = await oauth.refreshAccessToken(
          storedConfig.oauth.refreshToken,
          storedConfig.oauth.clientId
        );

        updateOAuthTokens(
          newTokens.accessToken,
          newTokens.refreshToken,
          newTokens.expiresAt
        );

        return newTokens.accessToken;
      } catch {
        return storedConfig.oauth.accessToken;
      }
    }

    return storedConfig.oauth.accessToken;
  }

  async *chat(userMessage: string, attachments?: FileAttachment[]): AsyncGenerator<AgentEvent> {
    try {
      yield { type: 'status', message: 'Connecting to Craft...' };

      // Get fresh token for MCP
      const token = await this.getToken();

      // Build MCP URL - ensure it ends with /mcp
      let mcpUrl = this.config.mcpUrl;
      // Remove trailing slash to avoid double slashes
      mcpUrl = mcpUrl.replace(/\/+$/, '');
      if (!mcpUrl.endsWith('/mcp')) {
        mcpUrl = mcpUrl.replace(/\/sse$/, '/mcp');
        if (!mcpUrl.endsWith('/mcp')) {
          mcpUrl = mcpUrl + '/mcp';
        }
      }

      // Build prompt with attachments
      const { prompt, unsupportedAttachments } = this.buildPromptWithAttachments(userMessage, attachments);

      // Warn about unsupported attachments
      if (unsupportedAttachments.length > 0) {
        yield {
          type: 'status',
          message: `Note: ${unsupportedAttachments.join(', ')} cannot be processed (images/PDFs not yet supported in SDK mode)`
        };
      }

      // Validate we have something to send
      if (!prompt.trim()) {
        yield { type: 'error', message: 'Cannot send empty message' };
        yield { type: 'complete' };
        return;
      }

      // Build disallowed tools list based on what's disabled
      // This is more explicit than allowedTools - we disable what we don't want
      const disallowedTools: string[] = [];
      if (!this.webSearchEnabled) disallowedTools.push('WebSearch');
      if (!this.webFetchEnabled) disallowedTools.push('WebFetch');

      // Configure SDK options
      const options: Options = {
        model: this.config.model || 'claude-sonnet-4-5-20250929',
        systemPrompt: getSystemPrompt(),
        cwd: process.cwd(),
        includePartialMessages: true,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        // Continue from previous session if we have one (enables conversation history & auto compaction)
        // If resume fails (invalid session), SDK should start fresh
        ...(this.sessionId ? { resume: this.sessionId } : {}),
        mcpServers: {
          craft: {
            type: 'http',
            url: mcpUrl,
            ...(token ? { headers: { Authorization: `Bearer ${token}` } } : {}),
          },
          // Add preferences server as an in-process MCP server (lazy-initialized)
          preferences: getPreferencesServer(),
        },
        // Disable Claude Code's built-in file tools - we only want MCP tools + web tools
        tools: [],
        // Explicitly disallow tools that are disabled rather than using allowedTools
        disallowedTools: disallowedTools.length > 0 ? disallowedTools : undefined,
      };

      // Create the query
      this.currentQuery = query({ prompt, options });

      // Track tool uses for mapping results and preventing duplicates
      const pendingToolUses = new Map<string, { name: string; input: Record<string, unknown> }>();
      const emittedToolStarts = new Set<string>();

      // Process SDK messages and convert to AgentEvents
      let receivedComplete = false;
      try {
        for await (const message of this.currentQuery) {
          // Capture session ID for conversation continuity
          if ('session_id' in message && message.session_id) {
            this.sessionId = message.session_id;
          }

          const events = this.convertSDKMessage(message, pendingToolUses, emittedToolStarts);
          for (const event of events) {
            if (event.type === 'complete') {
              receivedComplete = true;
            }
            yield event;
          }
        }

        // Defensive: emit complete if SDK didn't send result message
        if (!receivedComplete) {
          yield { type: 'complete' };
        }
      } catch (sdkError) {
        // If resume failed due to invalid session, clear it and let user retry
        // Check for specific session-related error patterns from the SDK
        const isSessionError = this.sessionId && sdkError instanceof Error && (
          sdkError.message.toLowerCase().includes('invalid session') ||
          sdkError.message.toLowerCase().includes('session not found') ||
          sdkError.message.toLowerCase().includes('session expired') ||
          sdkError.message.toLowerCase().includes('failed to resume')
        );

        if (isSessionError) {
          this.sessionId = null;
          yield { type: 'error', message: 'Session expired. Please try again.' };
          yield { type: 'complete' }; // Emit complete so TUI exits processing state
        } else {
          throw sdkError;
        }
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', message: errorMessage };
      // Emit complete even on error so TUI knows we're done
      yield { type: 'complete' };
    } finally {
      this.currentQuery = null;
    }
  }

  private buildPromptWithAttachments(
    text: string,
    attachments?: FileAttachment[]
  ): { prompt: string; unsupportedAttachments: string[] } {
    if (!attachments || attachments.length === 0) {
      return { prompt: text, unsupportedAttachments: [] };
    }

    const parts: string[] = [];
    const unsupportedAttachments: string[] = [];

    for (const attachment of attachments) {
      if (attachment.type === 'text' && attachment.text) {
        // Text files can be embedded in the prompt
        parts.push(`[File: ${attachment.name}]\n\`\`\`\n${attachment.text}\n\`\`\``);
      } else if (attachment.type === 'image') {
        // Images are not supported in string prompts - track for warning
        unsupportedAttachments.push(attachment.name);
      } else if (attachment.type === 'pdf') {
        // PDFs are not supported in string prompts - track for warning
        unsupportedAttachments.push(attachment.name);
      }
    }

    if (text) {
      parts.push(text);
    }

    return {
      prompt: parts.join('\n\n'),
      unsupportedAttachments
    };
  }

  private convertSDKMessage(
    message: SDKMessage,
    pendingToolUses: Map<string, { name: string; input: Record<string, unknown> }>,
    emittedToolStarts: Set<string>
  ): AgentEvent[] {
    const events: AgentEvent[] = [];

    switch (message.type) {
      case 'assistant': {
        // Full assistant message with content blocks
        const content = message.message.content;
        let textContent = '';

        for (const block of content) {
          if (block.type === 'text') {
            textContent += block.text;
          } else if (block.type === 'tool_use') {
            // Only emit if not already emitted via stream_event
            if (!emittedToolStarts.has(block.id)) {
              emittedToolStarts.add(block.id);
              pendingToolUses.set(block.id, {
                name: block.name,
                input: block.input as Record<string, unknown>,
              });
              events.push({
                type: 'tool_start',
                toolName: block.name,
                toolUseId: block.id,
                input: block.input as Record<string, unknown>,
              });
            } else {
              // Update input if we have more complete data now
              const existing = pendingToolUses.get(block.id);
              if (existing && Object.keys(existing.input).length === 0) {
                pendingToolUses.set(block.id, {
                  name: block.name,
                  input: block.input as Record<string, unknown>,
                });
              }
            }
          }
        }

        if (textContent) {
          events.push({ type: 'text_complete', text: textContent });
        }
        break;
      }

      case 'stream_event': {
        // Streaming partial message
        const event = message.event;
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          events.push({ type: 'text_delta', text: event.delta.text });
        } else if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
          const toolBlock = event.content_block;
          // Only emit if not already emitted
          if (!emittedToolStarts.has(toolBlock.id)) {
            emittedToolStarts.add(toolBlock.id);
            pendingToolUses.set(toolBlock.id, {
              name: toolBlock.name,
              input: {},
            });
            events.push({
              type: 'tool_start',
              toolName: toolBlock.name,
              toolUseId: toolBlock.id,
              input: {},
            });
          }
        }
        break;
      }

      case 'user': {
        // Skip replayed messages when resuming a session - they're historical
        if ('isReplay' in message && message.isReplay) {
          break;
        }

        // User message (including tool results)
        if (message.tool_use_result !== undefined && message.parent_tool_use_id) {
          const toolUse = pendingToolUses.get(message.parent_tool_use_id);

          // Safely stringify result, handling circular references
          let resultStr: string;
          if (typeof message.tool_use_result === 'string') {
            resultStr = message.tool_use_result;
          } else {
            try {
              resultStr = JSON.stringify(message.tool_use_result, null, 2);
            } catch {
              resultStr = '[Result could not be displayed]';
            }
          }

          // Check if result indicates an error
          const isError = this.isToolResultError(message.tool_use_result);

          events.push({
            type: 'tool_result',
            toolUseId: message.parent_tool_use_id,
            result: resultStr,
            isError,
            input: toolUse?.input,
          });

          pendingToolUses.delete(message.parent_tool_use_id);
        }
        break;
      }

      case 'tool_progress': {
        // Tool is in progress - we already emitted tool_start
        break;
      }

      case 'result': {
        // Final result - always emit complete with usage if available
        if (message.subtype === 'success') {
          events.push({
            type: 'complete',
            usage: {
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
            },
          });
        } else {
          // Error result - emit error then complete with whatever usage we have
          const errorMsg = 'errors' in message ? message.errors.join(', ') : 'Query failed';
          events.push({ type: 'error', message: errorMsg });
          events.push({
            type: 'complete',
            usage: {
              inputTokens: message.usage.input_tokens,
              outputTokens: message.usage.output_tokens,
            },
          });
        }
        break;
      }

      case 'system': {
        // System messages (init, compaction, status)
        if (message.subtype === 'compact_boundary') {
          events.push({
            type: 'status',
            message: `Compacted conversation (was ${message.compact_metadata.pre_tokens} tokens)`,
          });
        } else if (message.subtype === 'status' && message.status === 'compacting') {
          events.push({ type: 'status', message: 'Compacting conversation...' });
        }
        break;
      }

      case 'auth_status': {
        if (message.error) {
          events.push({ type: 'error', message: `Auth error: ${message.error}` });
        }
        break;
      }

      default: {
        // Unhandled message types (hook_response, init, etc.) are silently ignored
        // This is intentional - we only surface messages relevant to the TUI
        break;
      }
    }

    return events;
  }

  /**
   * Check if a tool result indicates an error
   */
  private isToolResultError(result: unknown): boolean {
    if (result === null || result === undefined) {
      return false;
    }

    // Check for common error patterns in the result
    if (typeof result === 'object') {
      const obj = result as Record<string, unknown>;
      // MCP error format
      if (obj.isError === true) return true;
      if (obj.error !== undefined) return true;
      // Content array with error type
      if (Array.isArray(obj.content)) {
        for (const item of obj.content) {
          if (typeof item === 'object' && item !== null) {
            const contentItem = item as Record<string, unknown>;
            if (contentItem.type === 'error') return true;
          }
        }
      }
    }

    // Check string results for error indicators
    if (typeof result === 'string') {
      const lower = result.toLowerCase();
      if (lower.startsWith('error:') || lower.startsWith('failed:')) {
        return true;
      }
    }

    return false;
  }

  clearHistory(): void {
    // Clear session to start fresh conversation
    this.sessionId = null;
  }

  interrupt(): void {
    if (this.currentQuery) {
      this.currentQuery.interrupt();
      this.currentQuery = null;
    }
  }

  getModel(): string {
    return this.config.model || 'claude-sonnet-4-5-20250929';
  }

  setModel(model: string): void {
    this.config.model = model;
    // Note: Model change takes effect on the next query
  }

  isWebSearchEnabled(): boolean {
    return this.webSearchEnabled;
  }

  setWebSearchEnabled(enabled: boolean): void {
    this.webSearchEnabled = enabled;
  }

  isWebFetchEnabled(): boolean {
    return this.webFetchEnabled;
  }

  setWebFetchEnabled(enabled: boolean): void {
    this.webFetchEnabled = enabled;
  }

  // Code execution is not directly supported in SDK mode
  // These methods are kept for interface compatibility with the TUI
  isCodeExecutionEnabled(): boolean {
    return false; // SDK handles this differently
  }

  setCodeExecutionEnabled(_enabled: boolean): void {
    // No-op in SDK mode - code execution is handled by the SDK internally
  }

  async close(): Promise<void> {
    this.interrupt();
  }
}
