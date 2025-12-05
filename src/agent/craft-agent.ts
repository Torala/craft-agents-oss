import Anthropic from '@anthropic-ai/sdk';
import { getSystemPrompt } from '../prompts/system.ts';
import { isTokenExpired, updateOAuthTokens, loadStoredConfig } from '../config/storage.ts';
import { updatePreferences, loadPreferences, type UserPreferences } from '../config/preferences.ts';
import { CraftOAuth, getMcpBaseUrl } from '../auth/oauth.ts';
import { CraftMcpClient, mcpToolsToAnthropicTools } from '../mcp/client.ts';
import type { FileAttachment } from '../tui/utils/files.ts';

// Built-in tool for updating user preferences
const UPDATE_PREFERENCES_TOOL: Anthropic.Tool = {
  name: 'update_user_preferences',
  description: `Update stored user preferences. Use this when you learn information about the user that would be helpful to remember for future conversations. This includes their name, timezone, location, preferred language, or any other relevant notes. Only update fields you have confirmed information about - don't guess.`,
  input_schema: {
    type: 'object' as const,
    properties: {
      name: {
        type: 'string',
        description: "The user's preferred name or how they'd like to be addressed",
      },
      timezone: {
        type: 'string',
        description: "The user's timezone in IANA format (e.g., 'America/New_York', 'Europe/London')",
      },
      city: {
        type: 'string',
        description: "The user's city",
      },
      region: {
        type: 'string',
        description: "The user's state/region/province",
      },
      country: {
        type: 'string',
        description: "The user's country",
      },
      language: {
        type: 'string',
        description: "The user's preferred language for responses",
      },
      notes: {
        type: 'string',
        description: 'Additional notes about the user that would be helpful to remember (preferences, context, etc.). This appends to existing notes.',
      },
    },
  },
};

export interface CraftAgentConfig {
  mcpUrl: string;
  mcpToken?: string;
  model?: string;
  enableWebSearch?: boolean;
  enableWebFetch?: boolean;
  enableCodeExecution?: boolean;
}

// Message types for streaming
export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'text_delta'; text: string }
  | { type: 'text_complete'; text: string }
  | { type: 'tool_start'; toolName: string; toolUseId: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; result: string; isError: boolean; input?: Record<string, unknown> }
  | { type: 'error'; message: string }
  | { type: 'complete'; usage?: { inputTokens: number; outputTokens: number } };

export class CraftAgent {
  private config: CraftAgentConfig;
  private anthropic: Anthropic;
  private mcpClient: CraftMcpClient | null = null;
  private tools: Anthropic.Tool[] = [];
  private abortController: AbortController | null = null;
  private conversationHistory: Anthropic.MessageParam[] = [];
  private webSearchEnabled: boolean;
  private webFetchEnabled: boolean;
  private codeExecutionEnabled: boolean;

  constructor(config: CraftAgentConfig) {
    this.config = config;
    this.anthropic = new Anthropic();
    this.webSearchEnabled = config.enableWebSearch ?? true;
    this.webFetchEnabled = config.enableWebFetch ?? true;
    this.codeExecutionEnabled = config.enableCodeExecution ?? true;
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

  private async ensureMcpConnection(): Promise<void> {
    if (this.mcpClient) return;

    const token = await this.getToken();

    // Build MCP URL - ensure it ends with /mcp
    let mcpUrl = this.config.mcpUrl;
    if (!mcpUrl.endsWith('/mcp')) {
      mcpUrl = mcpUrl.replace(/\/sse$/, '/mcp');
      if (!mcpUrl.endsWith('/mcp')) {
        mcpUrl = mcpUrl + '/mcp';
      }
    }

    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    this.mcpClient = new CraftMcpClient({ url: mcpUrl, headers });
    await this.mcpClient.connect();

    // Get tools from MCP server
    const mcpTools = await this.mcpClient.listTools();
    this.tools = mcpToolsToAnthropicTools(mcpTools) as Anthropic.Tool[];

    // Add built-in Claude tools
    if (this.webSearchEnabled) {
      this.tools.push({
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: 10,
      } as unknown as Anthropic.Tool);
    }

    if (this.webFetchEnabled) {
      this.tools.push({
        type: 'web_fetch_20250910',
        name: 'web_fetch',
        max_uses: 10,
      } as unknown as Anthropic.Tool);
    }

    if (this.codeExecutionEnabled) {
      this.tools.push({
        type: 'code_execution_20250825',
        name: 'code_execution',
      } as unknown as Anthropic.Tool);
    }

    // Add preferences tool (always available)
    this.tools.push(UPDATE_PREFERENCES_TOOL);
  }

  async *chat(userMessage: string, attachments?: FileAttachment[]): AsyncGenerator<AgentEvent> {
    this.abortController = new AbortController();

    try {
      // Connect to MCP server and get tools
      yield { type: 'status', message: 'Processing...' };
      await this.ensureMcpConnection();

      // Build message content with attachments
      const content = this.buildMessageContent(userMessage, attachments);

      // Add user message to history
      this.conversationHistory.push({
        role: 'user',
        content,
      });

      // Run conversation loop (handles tool calls)
      yield* this.runConversation();

    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      yield { type: 'error', message };
    }
  }

  private async *runConversation(): AsyncGenerator<AgentEvent> {
    let continueLoop = true;

    while (continueLoop) {
      // Check abort at start of each loop iteration
      if (this.abortController?.signal.aborted) {
        return;
      }

      continueLoop = false;

      // Create streaming message
      // Collect beta headers for enabled features
      const betas: string[] = [];
      if (this.codeExecutionEnabled) {
        betas.push('code-execution-2025-08-25');
      }
      if (this.webFetchEnabled) {
        betas.push('web-fetch-2025-09-10');
      }

      const streamParams = {
        model: this.config.model || 'claude-sonnet-4-5-20250929',
        max_tokens: 16384,
        system: getSystemPrompt(),
        tools: this.tools,
        messages: this.conversationHistory,
      };

      const stream = betas.length > 0
        ? this.anthropic.beta.messages.stream({
            ...streamParams,
            betas,
          })
        : this.anthropic.messages.stream(streamParams);

      let fullText = '';
      const toolUses: Array<{ id: string; name: string; input: Record<string, unknown> }> = [];

      // Process stream events
      for await (const event of stream) {
        if (this.abortController?.signal.aborted) {
          stream.abort();
          return;
        }

        if (event.type === 'content_block_start') {
          if (event.content_block.type === 'tool_use') {
            yield {
              type: 'tool_start',
              toolName: event.content_block.name,
              toolUseId: event.content_block.id,
              input: {},
            };
            toolUses.push({
              id: event.content_block.id,
              name: event.content_block.name,
              input: {},
            });
          }
        } else if (event.type === 'content_block_delta') {
          if (event.delta.type === 'text_delta') {
            fullText += event.delta.text;
            yield { type: 'text_delta', text: event.delta.text };
          } else if (event.delta.type === 'input_json_delta') {
            // Accumulate tool input JSON
            const currentTool = toolUses[toolUses.length - 1];
            if (currentTool) {
              // We'll parse the full input at the end
            }
          }
        }
      }

      // Check abort before getting final message
      if (this.abortController?.signal.aborted) {
        return;
      }

      // Get final message
      const finalMessage = await stream.finalMessage();

      // Check abort after getting final message
      if (this.abortController?.signal.aborted) {
        return;
      }

      // Emit text complete if we have text
      if (fullText) {
        yield { type: 'text_complete', text: fullText };
      }

      // Check for tool use (handle both regular and beta API response types)
      const contentBlocks = finalMessage.content as Array<{ type: string; id?: string; name?: string; input?: unknown }>;
      const toolUseBlocks = contentBlocks.filter(
        (block) => block.type === 'tool_use'
      );

      if (toolUseBlocks.length > 0) {
        // Add assistant message with tool use to history
        this.conversationHistory.push({
          role: 'assistant',
          content: finalMessage.content as Anthropic.ContentBlockParam[],
        });

        // Execute tools and get results
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          // Check abort before each tool execution
          if (this.abortController?.signal.aborted) {
            return;
          }

          const toolId = toolUse.id!;
          const toolName = toolUse.name!;
          const toolInput = toolUse.input as Record<string, unknown>;

          // Note: tool_start was already yielded during streaming, so we just execute here
          try {
            let result: unknown;

            // Handle built-in preferences tool locally
            if (toolName === 'update_user_preferences') {
              result = this.handleUpdatePreferences(toolInput);
            } else {
              // Call MCP tool
              result = await this.mcpClient!.callTool(toolName, toolInput);
            }

            const resultText = typeof result === 'string'
              ? result
              : JSON.stringify(result, null, 2);

            yield {
              type: 'tool_result',
              toolUseId: toolId,
              result: resultText,
              isError: false,
              input: toolInput,
            };

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolId,
              content: resultText,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Tool execution failed';

            yield {
              type: 'tool_result',
              toolUseId: toolId,
              result: errorMessage,
              isError: true,
              input: toolInput,
            };

            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolId,
              content: errorMessage,
              is_error: true,
            });
          }
        }

        // Check abort before adding results to history
        if (this.abortController?.signal.aborted) {
          return;
        }

        // Add tool results to history
        this.conversationHistory.push({
          role: 'user',
          content: toolResults,
        });

        // Continue loop to get Claude's response to tool results
        continueLoop = true;
      } else {
        // No tool use - add final assistant message to history
        if (fullText) {
          this.conversationHistory.push({
            role: 'assistant',
            content: fullText,
          });
        }

        // Emit completion
        yield {
          type: 'complete',
          usage: {
            inputTokens: finalMessage.usage.input_tokens,
            outputTokens: finalMessage.usage.output_tokens,
          },
        };
      }
    }
  }

  clearHistory(): void {
    this.conversationHistory = [];
  }

  /**
   * Build message content with optional file attachments
   */
  private buildMessageContent(
    text: string,
    attachments?: FileAttachment[]
  ): string | Anthropic.ContentBlockParam[] {
    if (!attachments || attachments.length === 0) {
      return text;
    }

    const content: Anthropic.ContentBlockParam[] = [];

    // Add file attachments first
    for (const attachment of attachments) {
      if (attachment.type === 'image' && attachment.base64) {
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: attachment.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: attachment.base64,
          },
        });
      } else if (attachment.type === 'pdf' && attachment.base64) {
        // PDFs are sent as documents
        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: attachment.base64,
          },
        } as Anthropic.ContentBlockParam);
      } else if (attachment.type === 'text' && attachment.text) {
        // Text files are included as text with file context
        content.push({
          type: 'text',
          text: `[File: ${attachment.name}]\n\`\`\`\n${attachment.text}\n\`\`\``,
        });
      }
    }

    // Add the user's text message
    if (text) {
      content.push({
        type: 'text',
        text,
      });
    }

    return content;
  }

  private handleUpdatePreferences(input: Record<string, unknown>): string {
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

    const updated = updatePreferences(updates);
    const fields = Object.keys(updates).filter(k => k !== 'location');
    if (updates.location) {
      fields.push(...Object.keys(updates.location).map(k => `location.${k}`));
    }

    return `Updated user preferences: ${fields.join(', ')}`;
  }

  interrupt(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  getModel(): string {
    return this.config.model || 'claude-sonnet-4-5-20250929';
  }

  setModel(model: string): void {
    this.config.model = model;
  }

  isWebSearchEnabled(): boolean {
    return this.webSearchEnabled;
  }

  setWebSearchEnabled(enabled: boolean): void {
    this.webSearchEnabled = enabled;
    // Reset tools to rebuild with new settings
    this.tools = [];
    this.mcpClient = null;
  }

  isWebFetchEnabled(): boolean {
    return this.webFetchEnabled;
  }

  setWebFetchEnabled(enabled: boolean): void {
    this.webFetchEnabled = enabled;
    // Reset tools to rebuild with new settings
    this.tools = [];
    this.mcpClient = null;
  }

  isCodeExecutionEnabled(): boolean {
    return this.codeExecutionEnabled;
  }

  setCodeExecutionEnabled(enabled: boolean): void {
    this.codeExecutionEnabled = enabled;
    // Reset tools to rebuild with new settings
    this.tools = [];
    this.mcpClient = null;
  }

  async close(): Promise<void> {
    if (this.mcpClient) {
      await this.mcpClient.close();
      this.mcpClient = null;
    }
  }
}
