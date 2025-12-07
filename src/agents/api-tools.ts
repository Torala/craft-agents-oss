/**
 * Dynamic API Tool Factory
 *
 * Creates in-process MCP servers from API configurations.
 * Each API endpoint becomes a tool that Claude can use.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type { ApiConfig, ApiEndpoint } from './types.ts';
import { debug } from '../tui/utils/debug.ts';

/**
 * Create an in-process MCP server for an API configuration.
 * Each endpoint becomes a tool with flexible parameters.
 *
 * @param config - API configuration with endpoints
 * @param apiKey - API key for authentication (empty string if no auth needed)
 * @returns SDK MCP server that can be passed to query()
 */
export function createApiServer(
  config: ApiConfig,
  apiKey: string
): ReturnType<typeof createSdkMcpServer> {
  debug(`[api-tools] Creating server for ${config.name} with ${config.endpoints.length} endpoints`);

  const tools = config.endpoints.map(endpoint => {
    // Build tool description including example params if available
    let description = endpoint.description;
    if (endpoint.exampleParams && Object.keys(endpoint.exampleParams).length > 0) {
      description += `\n\nExample parameters:\n${JSON.stringify(endpoint.exampleParams, null, 2)}`;
    }

    const toolName = `${config.name}_${endpoint.name}`;
    debug(`[api-tools] Creating tool: ${toolName}`);

    return tool(
      toolName,
      description,
      // Use a flexible object schema that accepts any properties
      // Claude will figure out what to pass based on the description/examples
      {
        params: z.record(z.string(), z.unknown()).optional().describe('Request parameters as key-value pairs (see description for expected fields)'),
      },
      async (args: { params?: Record<string, unknown> }) => {
        // Extract params from the args wrapper
        const requestParams = args.params;
        try {
          const url = buildUrl(config, endpoint, requestParams, apiKey);
          const headers = buildHeaders(config, apiKey);

          debug(`[api-tools] ${endpoint.method} ${url}`);

          const fetchOptions: RequestInit = {
            method: endpoint.method,
            headers,
          };

          // Add body for non-GET requests
          if (endpoint.method !== 'GET' && requestParams && Object.keys(requestParams).length > 0) {
            fetchOptions.body = JSON.stringify(requestParams);
          }

          const response = await fetch(url, fetchOptions);
          const text = await response.text();

          // Check for error responses
          if (!response.ok) {
            debug(`[api-tools] API error ${response.status}: ${text.substring(0, 200)}`);
            return {
              content: [{
                type: 'text' as const,
                text: `API Error ${response.status}: ${text}`,
              }],
              isError: true,
            };
          }

          debug(`[api-tools] Success, response length: ${text.length}`);
          return { content: [{ type: 'text' as const, text }] };
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Unknown error';
          debug(`[api-tools] Request failed: ${message}`);
          return {
            content: [{ type: 'text' as const, text: `Request failed: ${message}` }],
            isError: true,
          };
        }
      }
    );
  });

  return createSdkMcpServer({
    name: `api_${config.name}`,
    version: '1.0.0',
    tools,
  });
}

/**
 * Build the full URL for an API request
 */
function buildUrl(
  config: ApiConfig,
  endpoint: ApiEndpoint,
  args: Record<string, unknown> | undefined,
  apiKey: string
): string {
  let url = `${config.baseUrl}${endpoint.path}`;

  // Handle query param auth
  if (config.auth?.type === 'query' && config.auth.queryParam && apiKey) {
    const separator = url.includes('?') ? '&' : '?';
    url += `${separator}${config.auth.queryParam}=${encodeURIComponent(apiKey)}`;
  }

  // Handle GET params in query string
  if (endpoint.method === 'GET' && args && Object.keys(args).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(args)) {
      if (value !== undefined && value !== null) {
        // Handle arrays and objects
        if (typeof value === 'object') {
          params.append(key, JSON.stringify(value));
        } else {
          params.append(key, String(value));
        }
      }
    }
    const queryString = params.toString();
    if (queryString) {
      const separator = url.includes('?') ? '&' : '?';
      url += `${separator}${queryString}`;
    }
  }

  return url;
}

/**
 * Build headers for an API request
 */
function buildHeaders(config: ApiConfig, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (!apiKey) {
    return headers;
  }

  if (config.auth?.type === 'header') {
    headers[config.auth.headerName || 'x-api-key'] = apiKey;
  } else if (config.auth?.type === 'bearer') {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  // Query type is handled in buildUrl

  return headers;
}
