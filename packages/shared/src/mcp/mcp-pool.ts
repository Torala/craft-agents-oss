/**
 * Centralized MCP Client Pool
 *
 * Owns all MCP source connections in the main Electron process.
 * All backends (Claude, Codex, Copilot, Pi) receive proxy tool definitions
 * and route tool calls through this pool instead of managing MCP connections
 * themselves.
 *
 * Benefits:
 * - One MCP code path for all backends
 * - Shared clients across sessions (e.g., same Linear connection)
 * - No credential cache files — main process has direct access
 * - Runtime source switching without session restart
 */

import { CraftMcpClient, type McpClientConfig, type PoolClient } from './client.ts';
import { ApiSourcePoolClient } from './api-source-pool-client.ts';
import type { SdkMcpServerConfig } from '../agent/backend/types.ts';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { isLocalMcpEnabled } from '../workspaces/storage.ts';
import { guardLargeResult } from '../utils/large-response.ts';

/**
 * Proxy tool definition — the format passed to backends for registration.
 * Uses mcp__{slug}__{toolName} naming convention.
 */
export interface ProxyToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/**
 * Result of an MCP tool call, matching the subprocess protocol format.
 */
export interface McpToolResult {
  content: string;
  isError: boolean;
}

/**
 * Convert SdkMcpServerConfig (used by backend types) to CraftMcpClient config.
 */
function sdkConfigToClientConfig(config: SdkMcpServerConfig): McpClientConfig | null {
  if (config.type === 'http' || config.type === 'sse') {
    return {
      transport: 'http',
      url: config.url,
      headers: config.headers,
    };
  }
  if (config.type === 'stdio') {
    return {
      transport: 'stdio',
      command: config.command,
      args: config.args,
      env: config.env,
    };
  }
  return null;
}

export class McpClientPool {
  /** Active MCP clients keyed by source slug */
  private clients = new Map<string, PoolClient>();

  /** Slugs managed by syncApiServers (vs sync). Prevents sync() from disconnecting API sources. */
  private apiManagedSlugs = new Set<string>();

  /** Cached tool lists keyed by source slug */
  private toolCache = new Map<string, Tool[]>();

  /** Proxy tool name → source slug mapping (e.g., "mcp__linear__createIssue" → "linear") */
  private toolToSlug = new Map<string, string>();

  /** Proxy tool name → original MCP tool name (e.g., "mcp__linear__createIssue" → "createIssue") */
  private toolToOriginal = new Map<string, string>();

  /** One-time blocks: proxy tool name → error reason. Consumed on first callTool() hit. */
  private oneTimeBlocks = new Map<string, string>();

  /** Optional debug logger */
  private debugFn: ((msg: string) => void) | undefined;

  /** Workspace root path for local MCP filtering */
  private workspaceRootPath?: string;

  /** Session storage path for saving large responses */
  private sessionPath?: string;

  /** Summarize callback for large response handling */
  private summarizeCallback?: (prompt: string) => Promise<string | null>;

  /** Called after sync() connects/disconnects sources, so clients can be notified */
  onToolsChanged?: () => void;

  constructor(options?: { debug?: (msg: string) => void; workspaceRootPath?: string; sessionPath?: string }) {
    this.debugFn = options?.debug;
    this.workspaceRootPath = options?.workspaceRootPath;
    this.sessionPath = options?.sessionPath;
  }

  /**
   * Set the summarize callback for large response handling.
   * Typically called after agent creation: pool.setSummarizeCallback(agent.getSummarizeCallback())
   */
  setSummarizeCallback(fn: (prompt: string) => Promise<string | null>): void {
    this.summarizeCallback = fn;
  }

  private debug(msg: string): void {
    this.debugFn?.(`[McpClientPool] ${msg}`);
  }

  // ============================================================
  // Connection Lifecycle
  // ============================================================

  /**
   * Connect to an MCP source server and cache its tools.
   * If already connected, this is a no-op.
   */
  async connect(slug: string, config: SdkMcpServerConfig): Promise<void> {
    // Already connected
    if (this.clients.has(slug)) {
      return;
    }

    const clientConfig = sdkConfigToClientConfig(config);
    if (!clientConfig) {
      this.debug(`Unknown MCP server type for ${slug}: ${(config as { type: string }).type}`);
      return;
    }

    const client = new CraftMcpClient(clientConfig);
    await client.connect();
    this.clients.set(slug, client);
    this.debug(`Connected MCP client for source: ${slug}`);

    // Cache tools
    const tools = await client.listTools();
    this.toolCache.set(slug, tools);
    this.debug(`Source ${slug}: ${tools.length} tools available`);

    // Update tool mappings
    for (const tool of tools) {
      const proxyName = `mcp__${slug}__${tool.name}`;
      this.toolToSlug.set(proxyName, slug);
      this.toolToOriginal.set(proxyName, tool.name);
    }
  }

  /**
   * Connect to an in-process MCP server (API source) via in-memory transport.
   * Stores the client in the same `clients` map as remote MCP clients.
   */
  async connectInProcess(slug: string, mcpServer: McpServer): Promise<void> {
    if (this.clients.has(slug)) return;

    const client = new ApiSourcePoolClient(mcpServer);
    await client.connect();
    this.clients.set(slug, client);
    this.debug(`Connected in-process client for API source: ${slug}`);

    // Cache tools (same flow as remote connect)
    const tools = await client.listTools();
    this.toolCache.set(slug, tools);
    this.debug(`API source ${slug}: ${tools.length} tools available`);

    // Update tool mappings
    for (const tool of tools) {
      const proxyName = `mcp__${slug}__${tool.name}`;
      this.toolToSlug.set(proxyName, slug);
      this.toolToOriginal.set(proxyName, tool.name);
    }
  }

  /**
   * Disconnect a source and remove its tools from the pool.
   */
  async disconnect(slug: string): Promise<void> {
    const client = this.clients.get(slug);
    if (client) {
      await client.close().catch(() => {});
      this.clients.delete(slug);
    }

    // Remove tool mappings for this slug
    const tools = this.toolCache.get(slug) || [];
    for (const tool of tools) {
      const proxyName = `mcp__${slug}__${tool.name}`;
      this.toolToSlug.delete(proxyName);
      this.toolToOriginal.delete(proxyName);
    }
    this.toolCache.delete(slug);
    this.debug(`Disconnected MCP client for source: ${slug}`);
  }

  /**
   * Disconnect all sources and clear all state.
   */
  async disconnectAll(): Promise<void> {
    const closePromises = Array.from(this.clients.values()).map(c => c.close().catch(() => {}));
    await Promise.all(closePromises);
    this.clients.clear();
    this.toolCache.clear();
    this.toolToSlug.clear();
    this.toolToOriginal.clear();
    this.apiManagedSlugs.clear();
    this.debug('Disconnected all MCP clients');
  }

  // ============================================================
  // Sync: Reconcile active sources
  // ============================================================

  /**
   * Sync the pool to match a desired set of sources.
   * Connects new sources, disconnects removed ones, keeps existing ones.
   *
   * @param desired - Map of slug → config for desired active sources
   * @returns List of slugs that failed to connect
   */
  async sync(desired: Record<string, SdkMcpServerConfig>): Promise<string[]> {
    // Filter out stdio sources when local MCP is disabled for this workspace.
    const localEnabled = !this.workspaceRootPath || isLocalMcpEnabled(this.workspaceRootPath);
    const filtered: Record<string, SdkMcpServerConfig> = {};
    for (const [slug, config] of Object.entries(desired)) {
      if (config.type === 'stdio' && !localEnabled) {
        this.debug(`Filtering out stdio source "${slug}" (local MCP disabled)`);
        continue;
      }
      filtered[slug] = config;
    }

    const desiredSlugs = new Set(Object.keys(filtered));
    const currentSlugs = new Set(this.clients.keys());
    const failures: string[] = [];

    // Disconnect removed sources (including newly-filtered ones), but skip API-managed slugs
    for (const slug of currentSlugs) {
      if (!desiredSlugs.has(slug) && !this.apiManagedSlugs.has(slug)) {
        await this.disconnect(slug);
      }
    }

    // Connect new sources
    for (const [slug, config] of Object.entries(filtered)) {
      if (!currentSlugs.has(slug)) {
        try {
          await this.connect(slug, config);
        } catch (err) {
          this.debug(`Failed to connect MCP source ${slug}: ${err instanceof Error ? err.message : String(err)}`);
          failures.push(slug);
        }
      }
    }

    this.onToolsChanged?.();

    return failures;
  }

  /**
   * Sync in-process API servers to match a desired set.
   * Connects new API sources, disconnects removed ones.
   *
   * @param desired - Map of slug → McpSdkServerConfigWithInstance
   * @returns List of slugs that failed to connect
   */
  async syncApiServers(desired: Record<string, unknown>): Promise<string[]> {
    const failures: string[] = [];

    // Extract McpServer instances from SDK config objects
    const apiSlugs = new Map<string, McpServer>();
    for (const [slug, config] of Object.entries(desired)) {
      const cfg = config as { type?: string; instance?: McpServer };
      if (cfg?.type === 'sdk' && cfg.instance) {
        apiSlugs.set(slug, cfg.instance);
      }
    }

    const desiredSlugs = new Set(apiSlugs.keys());

    // Disconnect API sources that are no longer desired
    for (const slug of this.apiManagedSlugs) {
      if (!desiredSlugs.has(slug)) {
        await this.disconnect(slug);
        this.apiManagedSlugs.delete(slug);
      }
    }

    // Connect new API sources
    let connected = 0;
    for (const [slug, server] of apiSlugs) {
      if (!this.clients.has(slug)) {
        try {
          await this.connectInProcess(slug, server);
          this.apiManagedSlugs.add(slug);
          connected++;
        } catch (err) {
          this.debug(`Failed to connect API source ${slug}: ${err instanceof Error ? err.message : String(err)}`);
          failures.push(slug);
        }
      }
    }

    if (connected > 0) {
      this.onToolsChanged?.();
    }

    return failures;
  }

  // ============================================================
  // Tool Discovery
  // ============================================================

  /**
   * Get cached tools for a source. Returns empty array if not connected.
   */
  getTools(slug: string): Tool[] {
    return this.toolCache.get(slug) || [];
  }

  /**
   * Get all connected source slugs.
   */
  getConnectedSlugs(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Check if a source is connected.
   */
  isConnected(slug: string): boolean {
    return this.clients.has(slug);
  }

  /**
   * Generate proxy tool definitions for all connected sources (or a subset).
   * These are passed to backends for tool registration.
   */
  getProxyToolDefs(slugs?: string[]): ProxyToolDef[] {
    const targetSlugs = slugs || Array.from(this.toolCache.keys());
    const defs: ProxyToolDef[] = [];

    for (const slug of targetSlugs) {
      const tools = this.toolCache.get(slug) || [];
      for (const tool of tools) {
        defs.push({
          name: `mcp__${slug}__${tool.name}`,
          description: tool.description || `Tool from ${slug}`,
          inputSchema: (tool.inputSchema as Record<string, unknown>) || { type: 'object', properties: {} },
        });
      }
    }

    return defs;
  }

  // ============================================================
  // One-Time Blocks (prerequisite enforcement for Copilot)
  // ============================================================

  /**
   * Set a one-time block on a proxy tool. The next `callTool()` for this tool
   * returns the reason as an error and clears the block. This allows the SDK
   * to keep the tool registered (avoiding permanent removal) while still
   * delivering the prerequisite error message to the model.
   */
  setOneTimeBlock(proxyName: string, reason: string): void {
    this.oneTimeBlocks.set(proxyName, reason);
    this.debug(`Set one-time block on ${proxyName}`);
  }

  // ============================================================
  // Tool Execution
  // ============================================================

  /**
   * Execute an MCP tool by its proxy name (mcp__{slug}__{toolName}).
   * Returns a result matching the subprocess protocol format.
   */
  async callTool(proxyName: string, args: Record<string, unknown>): Promise<McpToolResult> {
    // Check for one-time block (prerequisite enforcement)
    const blockReason = this.oneTimeBlocks.get(proxyName);
    if (blockReason) {
      this.oneTimeBlocks.delete(proxyName);
      this.debug(`One-time block fired for ${proxyName}`);
      return { content: blockReason, isError: true };
    }

    const slug = this.toolToSlug.get(proxyName);
    if (!slug) {
      return {
        content: `Unknown MCP proxy tool: ${proxyName}`,
        isError: true,
      };
    }

    const originalName = this.toolToOriginal.get(proxyName);
    if (!originalName) {
      return {
        content: `Unknown MCP tool mapping: ${proxyName}`,
        isError: true,
      };
    }

    const client = this.clients.get(slug);
    if (!client) {
      return {
        content: `MCP client for source "${slug}" is not connected.`,
        isError: true,
      };
    }

    try {
      const result = await client.callTool(originalName, args) as {
        content?: Array<{ type: string; text?: string }>;
        isError?: boolean;
      };

      // Extract text from MCP result
      const textParts = (result.content || [])
        .filter((c: { type: string }) => c.type === 'text')
        .map((c: { text?: string }) => c.text || '');
      const text = textParts.join('\n') || JSON.stringify(result);

      // Handle large results — save + summarize before returning
      if (!result.isError && this.sessionPath) {
        const guarded = await guardLargeResult(text, {
          sessionPath: this.sessionPath,
          toolName: proxyName,
          input: args,
          summarize: this.summarizeCallback,
        });
        if (guarded) {
          return { content: guarded, isError: false };
        }
      }

      return {
        content: text,
        isError: !!result.isError,
      };
    } catch (err) {
      return {
        content: `MCP tool "${originalName}" (source: ${slug}) failed: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      };
    }
  }

  /**
   * Resolve a proxy tool name to its source slug.
   * Returns undefined if the tool is not from an MCP source.
   */
  resolveSourceSlug(proxyName: string): string | undefined {
    return this.toolToSlug.get(proxyName);
  }

  /**
   * Check if a tool name is an MCP proxy tool managed by this pool.
   */
  isProxyTool(toolName: string): boolean {
    return this.toolToSlug.has(toolName);
  }
}
