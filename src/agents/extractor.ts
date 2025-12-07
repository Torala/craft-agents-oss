/**
 * Agentic agent definition extractor
 *
 * Uses Claude Agent SDK to agentically fetch and extract agent instructions
 * from Craft documents. Claude uses MCP tools to read the document and
 * intelligently extracts the relevant content.
 */

import { query, type Options } from '@anthropic-ai/claude-agent-sdk';
import type { McpServerConfig } from './types.ts';
import { debug } from '../tui/utils/debug.ts';

export interface ExtractionResult {
  instructions: string;
  instructionsBlockId?: string;
  mcpServers?: McpServerConfig[];
  info?: string[];  // Info messages for users (warnings, notices, etc.)
}

/**
 * Extract agent definition using agentic approach
 *
 * Claude will:
 * 1. Use Craft MCP tools to read the document
 * 2. Navigate the document structure as needed
 * 3. Extract and return structured JSON
 */
export async function extractAgentDefinition(
  documentId: string,
  agentName: string,
  model: string,
  mcpUrl: string,
  mcpToken?: string,
): Promise<ExtractionResult> {
  debug('[extractor] Starting agentic extraction for agent:', agentName, 'documentId:', documentId);

  try {
    // Configure Craft MCP server for the agent query
    const mcpServers: Options['mcpServers'] = {
      craft: {
        type: 'http',
        url: mcpUrl,
        ...(mcpToken ? { headers: { Authorization: `Bearer ${mcpToken}` } } : {}),
      },
    };

    // System prompt for the extractor agent
    const systemPrompt = `You are an agent definition extractor. You ONLY output JSON, never explanations.

Your task:
1. Use mcp__craft__blocks_get to read Craft documents
2. Extract agent instructions from the content
3. Return ONLY a JSON object - no text before or after

CRITICAL: Your final message must be ONLY valid JSON. No "Perfect!", no explanations, no markdown.
Just the raw JSON object starting with { and ending with }.`;

    const prompt = `Extract agent definition from Craft document ID "${documentId}" (agent: "${agentName}").

1. First, use mcp__craft__blocks_get with documentId="${documentId}" and depth=3 to read the document
2. Find the Instructions section/subpage and note its block ID
3. Extract ALL instruction content EXACTLY as written
4. Look for MCP server configurations

IMPORTANT: Keep the original instructions as intact as possible. Only make minimal, logical changes:
- Prepend the agent identity context (document ID)
- Fix obvious formatting issues
- Do NOT rephrase, summarize, or restructure the content
- Preserve the exact wording, structure, and formatting from the original

MCP Server Handling:
- Look for MCP server configurations in code blocks (YAML, JSON, or plain URLs)
- ONLY include servers with HTTP/HTTPS URLs in the mcpServers array
- UNSUPPORTED server types (do NOT include in mcpServers):
  * npx commands (e.g., "npx -y @modelcontextprotocol/server-filesystem")
  * command/args configs (e.g., { "command": "npx", "args": [...] })
  * stdio transports
  * Any server config without an http:// or https:// URL

INFO MESSAGES - VERY IMPORTANT:
Use the "info" array to communicate important information to the user. You MUST add info messages for:
- Unsupported MCP servers: "MCP server '[name]' uses npx/stdio which is not supported. Only HTTP/HTTPS servers work."
- Missing or empty Instructions section: "No Instructions section found in document."
- Malformed or unparseable MCP configs: "Could not parse MCP server config in code block."
- Any other issues or warnings the user should know about during agent setup

Prepend this context line, then include the EXACT original content:
"You are the ${agentName} agent. Your definition is stored in Craft document ${documentId}."

Return ONLY valid JSON:
{
  "instructions": "You are the ${agentName} agent. Your definition is stored in Craft document ${documentId}.\\n\\n[EXACT instruction content from document]",
  "instructionsBlockId": "block-id-of-instructions-section-or-null",
  "mcpServers": [{ "name": "myserver", "url": "https://example.com/mcp", "requiresAuth": false }],
  "info": ["MCP server 'filesystem' uses npx/stdio transport which is not supported yet. Only HTTP/HTTPS MCP servers work in this environment."]
}

Rules:
- mcpServers: Empty array [] if no HTTP/HTTPS MCP servers found
- info: Empty array [] if nothing to report. MUST contain messages for any issues, warnings, or important information the user should know.
- instructions: Empty string "" if document is empty or not found`;

    const options: Options = {
      model: model || 'claude-sonnet-4-20250514',
      systemPrompt,
      mcpServers,
      maxTurns: 10, // Allow multiple tool calls if needed
      // Use Claude Code toolset for full capabilities
      tools: { type: 'preset', preset: 'claude_code' },
      // Allow all tools without permission prompts
      permissionMode: 'acceptEdits',
      canUseTool: async (_toolName, input) => {
        return { behavior: 'allow' as const, updatedInput: input as Record<string, unknown> };
      },
      // Structured output guarantees valid JSON matching schema
      outputFormat: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            instructions: {
              type: 'string',
              description: 'The complete agent instructions, prepended with agent identity context',
            },
            instructionsBlockId: {
              type: 'string',
              description: 'Block ID of the instructions section for self-modification',
            },
            mcpServers: {
              type: 'array',
              description: 'MCP server configurations found in the document',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  url: { type: 'string' },
                  requiresAuth: { type: 'boolean' },
                },
              },
            },
            info: {
              type: 'array',
              description: 'User-facing info messages about the extraction (warnings, notices, etc.)',
              items: { type: 'string' },
            },
          },
          required: ['instructions'],
        },
      },
    };

    debug('[extractor] Running agentic query with MCP URL:', mcpUrl);

    // Run agentic query - Claude will use MCP tools to read the document
    let result: ExtractionResult | null = null;

    for await (const message of query({ prompt, options })) {
      // Log tool usage for debugging
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if (block.type === 'tool_use') {
            debug('[extractor] Tool call:', block.name, JSON.stringify(block.input));
          }
        }
      }

      // Log result message details
      if (message.type === 'result') {
        debug('[extractor] Result message subtype:', message.subtype);
        debug('[extractor] Result message has structured_output:', 'structured_output' in message);
        if (message.subtype === 'success') {
          debug('[extractor] Success result:', message.result);
          debug('[extractor] structured_output:', message.structured_output);
        } else {
          debug('[extractor] Error result, errors:', (message as any).errors);
        }
      }

      // Access structured output from result message
      if (message.type === 'result' && message.subtype === 'success') {
        if (message.structured_output) {
          // SDK parsed it for us
          debug('[extractor] Got structured_output from SDK');
          result = message.structured_output as ExtractionResult;
        } else if (message.result) {
          // Fallback: parse the result text (SDK may not populate structured_output with claude_code preset)
          debug('[extractor] Falling back to parsing result text');
          try {
            let jsonText = message.result.trim();
            // Handle markdown code blocks
            if (jsonText.startsWith('```')) {
              const openMatch = jsonText.match(/^```(?:json)?\s*\n?/);
              if (openMatch) {
                const contentStart = openMatch[0].length;
                const lastFenceIndex = jsonText.lastIndexOf('\n```');
                const endFenceIndex = jsonText.endsWith('```') ? jsonText.length - 3 : lastFenceIndex + 1;
                if (endFenceIndex > contentStart) {
                  jsonText = jsonText.slice(contentStart, endFenceIndex).trim();
                }
              }
            }
            result = JSON.parse(jsonText) as ExtractionResult;
            debug('[extractor] Parsed result text successfully');
          } catch (parseError) {
            debug('[extractor] Failed to parse result text:', parseError);
          }
        }
      }
    }

    if (!result) {
      debug('[extractor] No structured output received');
      return { instructions: '', mcpServers: [] };
    }

    debug(
      '[extractor] Extracted',
      result.instructions?.length || 0,
      'chars of instructions,',
      result.mcpServers?.length || 0,
      'MCP servers',
    );

    return {
      instructions: result.instructions || '',
      instructionsBlockId: result.instructionsBlockId || undefined,
      mcpServers: result.mcpServers || [],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    debug('[extractor] Agentic extraction failed:', errorMessage);
    debug('[extractor] Error stack:', error instanceof Error ? error.stack : 'no stack');
    return {
      instructions: '',
      mcpServers: [],
    };
  }
}
