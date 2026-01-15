/**
 * Claude Code Session Import
 *
 * Discovers and converts Claude Code JSONL sessions to Craft Agent format.
 * The SDK stores sessions at ~/.claude/projects/{cwd-slugified}/{sessionId}.jsonl
 *
 * Import strategy:
 * 1. Convert messages to StoredMessage[] for UI display
 * 2. Preserve sdkSessionId + sdkCwd for SDK resume capability
 * 3. When user continues chat, SDK resumes from its files, we append to ours
 */

import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, openSync, readSync, fstatSync, closeSync } from 'fs';
import { readdir } from 'fs/promises';
import { join, basename } from 'path';
import { homedir } from 'os';
import type { StoredMessage, MessageRole, ToolStatus } from '@craft-agent/core/types';
import type { StoredSession, SessionTokenUsage } from './types.ts';
import { generateUniqueSessionId } from './slug-generator.ts';
import { writeSessionJsonl } from './jsonl.ts';
import { debug } from '../utils/debug.ts';

// ============================================================================
// Types for Claude Code JSONL format
// ============================================================================

/**
 * Content block types in Claude Code messages
 */
interface TextBlock {
  type: 'text';
  text: string;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: Array<{ type: 'text'; text: string }> | string;
}

interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

interface ImageBlock {
  type: 'image';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
}

interface DocumentBlock {
  type: 'document';
  source: {
    type: 'base64' | 'url';
    media_type?: string;
    data?: string;
    url?: string;
  };
  title?: string;
}

type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock | ImageBlock | DocumentBlock;

/**
 * Claude Code message structure (inside the 'message' field)
 */
interface ClaudeCodeInnerMessage {
  role: 'user' | 'assistant';
  content: ContentBlock[] | string;
  model?: string;
  id?: string;
  stop_reason?: string | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

/**
 * Claude Code JSONL line structure
 */
interface ClaudeCodeLine {
  type: 'user' | 'assistant' | 'summary' | 'queue-operation';
  parentUuid?: string | null;
  isSidechain?: boolean;
  userType?: string;
  cwd?: string;
  sessionId: string;
  version?: string;
  gitBranch?: string;
  message?: ClaudeCodeInnerMessage;
  uuid: string;
  timestamp: string;
  // Queue operation fields
  operation?: string;
}

/**
 * Discovered Claude Code session info for selection UI
 */
export interface ClaudeCodeSessionInfo {
  /** Full path to the JSONL file */
  filePath: string;
  /** Original session ID (UUID) */
  sessionId: string;
  /** Decoded project path from directory name */
  projectPath: string;
  /** Project directory slug (the folder name) */
  projectSlug: string;
  /** Git branch if available */
  gitBranch?: string;
  /** Number of messages (excluding queue ops) */
  messageCount: number;
  /** First message timestamp */
  firstMessageAt: Date;
  /** Last message timestamp */
  lastMessageAt: Date;
  /** Preview of first user message */
  preview?: string;
  /** File size in bytes */
  fileSize: number;
}

/**
 * Result of importing a session
 */
export interface ImportResult {
  success: boolean;
  sessionId?: string;
  error?: string;
}

// ============================================================================
// Discovery
// ============================================================================

/**
 * Get the Claude Code projects directory path
 */
export function getClaudeProjectsPath(): string {
  return join(homedir(), '.claude', 'projects');
}

/**
 * Decode a project directory name back to a path
 * Directory format: -Users-name-path-to-project → /Users/name/path/to/project
 * Windows format: C-Users-name-path → C:\Users\name\path
 */
function decodeProjectPath(dirName: string): string {
  const parts = dirName.slice(1).split('-');

  // Check if Windows path (single letter drive like C, D, E)
  if (parts[0]?.length === 1 && /^[A-Za-z]$/.test(parts[0])) {
    return parts[0].toUpperCase() + ':\\' + parts.slice(1).join('\\');
  }

  // Unix path
  return '/' + parts.join('/');
}

// ============================================================================
// Fast File Reading (for discovery performance)
// ============================================================================

/**
 * Read first and last chunks of a file using low-level I/O
 * Returns first few lines and last line without reading entire file
 */
function getFirstAndLastLines(filePath: string): { firstLines: string[]; lastLine: string; fileSize: number } {
  const fd = openSync(filePath, 'r');
  const stats = fstatSync(fd);
  const fileSize = stats.size;

  if (fileSize === 0) {
    closeSync(fd);
    return { firstLines: [], lastLine: '', fileSize: 0 };
  }

  // Read first 8KB for first few lines (metadata is in early lines)
  const headSize = Math.min(8192, fileSize);
  const headBuffer = Buffer.alloc(headSize);
  readSync(fd, headBuffer, 0, headSize, 0);
  const firstLines = headBuffer.toString('utf-8').split('\n').slice(0, 10);

  // Read last 8KB for last line (most recent timestamp)
  const tailSize = Math.min(8192, fileSize);
  const tailBuffer = Buffer.alloc(tailSize);
  readSync(fd, tailBuffer, 0, tailSize, Math.max(0, fileSize - tailSize));
  const tailContent = tailBuffer.toString('utf-8');

  // Find the last complete line (avoid partial JSON at buffer start)
  const tailLines = tailContent.split('\n').filter(Boolean);
  const lastLine = tailLines[tailLines.length - 1] || '';

  closeSync(fd);
  return { firstLines, lastLine, fileSize };
}

/**
 * Fast session info extraction from first/last lines
 * Used for discovery - reads only ~16KB per file instead of entire file
 */
function getSessionInfoFast(
  filePath: string,
  projectPath: string,
  projectSlug: string
): ClaudeCodeSessionInfo | null {
  try {
    const { firstLines, lastLine, fileSize } = getFirstAndLastLines(filePath);

    if (firstLines.length === 0) return null;

    const sessionId = basename(filePath, '.jsonl');
    let firstMessageAt: Date | null = null;
    let lastMessageAt: Date | null = null;
    let preview: string | undefined;
    let gitBranch: string | undefined;

    // Parse first lines for metadata
    for (const line of firstLines) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as ClaudeCodeLine;

        // Skip queue operations
        if (parsed.type === 'queue-operation') continue;

        const timestamp = new Date(parsed.timestamp);

        // First message timestamp
        if (!firstMessageAt || timestamp < firstMessageAt) {
          firstMessageAt = timestamp;
        }

        // Git branch from first available
        if (!gitBranch && parsed.gitBranch) {
          gitBranch = parsed.gitBranch;
        }

        // Preview from first user message
        if (!preview && parsed.type === 'user' && parsed.message) {
          preview = extractPreviewFromContent(parsed.message.content);
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Parse last line for most recent timestamp
    if (lastLine.trim()) {
      try {
        const parsed = JSON.parse(lastLine) as ClaudeCodeLine;
        if (parsed.type !== 'queue-operation') {
          lastMessageAt = new Date(parsed.timestamp);
        }
      } catch {
        // If last line is malformed, try second-to-last from first chunk
      }
    }

    // Fallback: use firstMessageAt if we couldn't get lastMessageAt
    if (!lastMessageAt && firstMessageAt) {
      lastMessageAt = firstMessageAt;
    }

    if (!firstMessageAt || !lastMessageAt) {
      return null;
    }

    // Estimate message count from file size
    // Average Claude Code JSONL line is ~500 bytes
    const estimatedMessageCount = Math.max(1, Math.round(fileSize / 500));

    return {
      filePath,
      sessionId,
      projectPath,
      projectSlug,
      gitBranch,
      messageCount: estimatedMessageCount,
      firstMessageAt,
      lastMessageAt,
      preview,
      fileSize,
    };
  } catch (error) {
    debug('[claude-code-import] Failed to read session:', filePath, error);
    return null;
  }
}

/**
 * Discover all Claude Code sessions (async, parallel I/O)
 * Reads only first+last lines of each file for O(num_files) performance
 */
export async function discoverClaudeCodeSessions(): Promise<ClaudeCodeSessionInfo[]> {
  const projectsPath = getClaudeProjectsPath();

  if (!existsSync(projectsPath)) {
    debug('[claude-code-import] No Claude projects directory found');
    return [];
  }

  // Collect all file paths first (fast directory listing)
  const filesToProcess: Array<{ filePath: string; projectPath: string; projectSlug: string }> = [];

  try {
    const projectDirs = readdirSync(projectsPath, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);

    // Read all project directories in parallel
    const projectFilePromises = projectDirs.map(async (projectSlug) => {
      const projectDir = join(projectsPath, projectSlug);
      const projectPath = decodeProjectPath(projectSlug);

      try {
        const files = await readdir(projectDir);
        return files
          // Only main session files (UUID.jsonl), not subagent files (agent-*.jsonl)
          .filter(f => f.endsWith('.jsonl') && !f.startsWith('agent-'))
          .map(f => ({
            filePath: join(projectDir, f),
            projectPath,
            projectSlug,
          }));
      } catch {
        return [];
      }
    });

    const projectFiles = await Promise.all(projectFilePromises);
    for (const files of projectFiles) {
      filesToProcess.push(...files);
    }
  } catch (error) {
    debug('[claude-code-import] Failed to read projects directory:', error);
    return [];
  }

  // Process all files in parallel (fast I/O with first+last line reading)
  const results = await Promise.all(
    filesToProcess.map(({ filePath, projectPath, projectSlug }) =>
      // Wrap in Promise.resolve to handle sync function
      Promise.resolve(getSessionInfoFast(filePath, projectPath, projectSlug))
    )
  );

  // Filter out nulls and sort by last message date (newest first)
  const sessions = results.filter((s): s is ClaudeCodeSessionInfo => s !== null);
  sessions.sort((a, b) => b.lastMessageAt.getTime() - a.lastMessageAt.getTime());

  return sessions;
}

/**
 * Extract preview text from message content
 */
function extractPreviewFromContent(content: ContentBlock[] | string): string | undefined {
  if (typeof content === 'string') {
    return content.replace(/\n/g, ' ').substring(0, 150);
  }

  for (const block of content) {
    if (block.type === 'text') {
      return block.text.replace(/\n/g, ' ').substring(0, 150);
    }
  }

  return undefined;
}

// ============================================================================
// Conversion
// ============================================================================

/**
 * Convert a Claude Code session to Craft Agent format
 */
export function convertClaudeCodeSession(
  filePath: string,
  workspaceRootPath: string,
  existingIds: string[]
): StoredSession {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(Boolean);

  const messages: StoredMessage[] = [];
  const pendingTools = new Map<string, { name: string; input: Record<string, unknown>; messageIndex: number }>();
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let cacheReadTokens = 0;
  let cacheCreationTokens = 0;
  let firstTimestamp: number | null = null;
  let lastTimestamp: number | null = null;
  let sdkSessionId: string | null = null;
  let sdkCwd: string | null = null;
  let workingDirectory: string | null = null;

  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as ClaudeCodeLine;

      // Skip queue operations
      if (parsed.type === 'queue-operation') continue;

      const timestamp = new Date(parsed.timestamp).getTime();

      // Track timestamps
      if (firstTimestamp === null || timestamp < firstTimestamp) {
        firstTimestamp = timestamp;
      }
      if (lastTimestamp === null || timestamp > lastTimestamp) {
        lastTimestamp = timestamp;
      }

      // Capture session metadata from first real message
      if (!sdkSessionId && parsed.sessionId) {
        sdkSessionId = parsed.sessionId;
      }
      if (!sdkCwd && parsed.cwd) {
        sdkCwd = parsed.cwd;
        workingDirectory = parsed.cwd;
      }

      // Process message based on type
      if (parsed.type === 'user') {
        processUserMessage(parsed, timestamp, messages, pendingTools);
      } else if (parsed.type === 'assistant') {
        processAssistantMessage(parsed, timestamp, messages, pendingTools);

        // Track token usage from assistant messages
        if (parsed.message?.usage) {
          totalInputTokens += parsed.message.usage.input_tokens ?? 0;
          totalOutputTokens += parsed.message.usage.output_tokens ?? 0;
          cacheReadTokens += parsed.message.usage.cache_read_input_tokens ?? 0;
          cacheCreationTokens += parsed.message.usage.cache_creation_input_tokens ?? 0;
        }
      }
      // Skip 'summary' type messages
    } catch (error) {
      debug('[claude-code-import] Failed to parse line:', error);
    }
  }

  // Generate new session ID
  const newSessionId = generateUniqueSessionId(existingIds);
  const now = Date.now();

  // Build token usage
  const tokenUsage: SessionTokenUsage = {
    inputTokens: totalInputTokens,
    outputTokens: totalOutputTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
    contextTokens: 0, // Not tracked in Claude Code format
    costUsd: 0, // Would need model pricing to calculate
    cacheReadTokens: cacheReadTokens > 0 ? cacheReadTokens : undefined,
    cacheCreationTokens: cacheCreationTokens > 0 ? cacheCreationTokens : undefined,
  };

  return {
    id: newSessionId,
    sdkSessionId: sdkSessionId ?? undefined,
    workspaceRootPath,
    createdAt: firstTimestamp ?? now,
    lastUsedAt: lastTimestamp ?? now,
    workingDirectory: workingDirectory ?? undefined,
    sdkCwd: sdkCwd ?? undefined,
    messages,
    tokenUsage,
  };
}

/**
 * Process a user message (may contain tool results)
 */
function processUserMessage(
  line: ClaudeCodeLine,
  timestamp: number,
  messages: StoredMessage[],
  pendingTools: Map<string, { name: string; input: Record<string, unknown>; messageIndex: number }>
): void {
  if (!line.message) return;

  const content = line.message.content;

  if (typeof content === 'string') {
    // Simple text message
    messages.push({
      id: `msg-${line.uuid}`,
      type: 'user',
      content,
      timestamp,
    });
    return;
  }

  // Process content blocks
  for (const block of content) {
    if (block.type === 'text') {
      messages.push({
        id: `msg-${line.uuid}-text`,
        type: 'user',
        content: block.text,
        timestamp,
      });
    } else if (block.type === 'tool_result') {
      // Find the pending tool and update it
      const pending = pendingTools.get(block.tool_use_id);
      if (pending) {
        const toolMessage = messages[pending.messageIndex];
        if (toolMessage) {
          // Extract result text
          let resultText: string;
          if (typeof block.content === 'string') {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = block.content
              .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
              .map(c => c.text)
              .join('\n');
          } else {
            resultText = '';
          }

          toolMessage.toolResult = resultText;
          toolMessage.toolStatus = 'completed';
        }
        pendingTools.delete(block.tool_use_id);
      }
    }
  }
}

/**
 * Process an assistant message (may contain text and tool uses)
 */
function processAssistantMessage(
  line: ClaudeCodeLine,
  timestamp: number,
  messages: StoredMessage[],
  pendingTools: Map<string, { name: string; input: Record<string, unknown>; messageIndex: number }>
): void {
  if (!line.message) return;

  const content = line.message.content;

  if (typeof content === 'string') {
    // Simple text response
    messages.push({
      id: `msg-${line.uuid}`,
      type: 'assistant',
      content,
      timestamp,
    });
    return;
  }

  // Process content blocks
  let textContent = '';
  let thinkingContent = '';

  for (const block of content) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'thinking') {
      // Store thinking separately from main text
      thinkingContent += block.thinking;
    } else if (block.type === 'image' || block.type === 'document') {
      // Skip image/document blocks - we don't store binary data in sessions
      // These would need separate attachment handling if needed
      debug('[claude-code-import] Skipping', block.type, 'block (attachments not supported)');
    } else if (block.type === 'tool_use') {
      // First, emit any accumulated text
      if (textContent.trim()) {
        messages.push({
          id: `msg-${line.uuid}-text`,
          type: 'assistant',
          content: textContent,
          timestamp,
          isIntermediate: true, // Text before tool use is intermediate
        });
        textContent = '';
      }

      // Extract intent and displayName from input
      const toolInput = block.input as Record<string, unknown>;
      const intent = toolInput._intent as string | undefined;
      const displayName = toolInput._displayName as string | undefined;

      // Create tool message
      const toolMessage: StoredMessage = {
        id: `msg-${block.id}`,
        type: 'tool',
        content: '', // Will be populated with result
        timestamp,
        toolName: block.name,
        toolUseId: block.id,
        toolInput: block.input,
        toolStatus: 'pending' as ToolStatus,
        toolIntent: intent,
        toolDisplayName: displayName,
      };

      const messageIndex = messages.length;
      messages.push(toolMessage);

      // Track for result matching
      pendingTools.set(block.id, {
        name: block.name,
        input: block.input,
        messageIndex,
      });
    }
  }

  // Emit any remaining text
  // Note: Thinking content is currently not persisted separately as StoredMessage
  // doesn't have a thinking field. For now, we just include the final text.
  // Thinking from extended thinking sessions is discarded during import.
  if (textContent.trim()) {
    messages.push({
      id: `msg-${line.uuid}-final`,
      type: 'assistant',
      content: textContent,
      timestamp,
    });
  }
  // Note: Thinking-only messages are skipped as they don't have visible content
}

// ============================================================================
// Import
// ============================================================================

/**
 * Import a Claude Code session into a workspace
 */
export function importClaudeCodeSession(
  filePath: string,
  workspaceRootPath: string,
  existingIds: string[]
): ImportResult {
  try {
    // Convert the session
    const session = convertClaudeCodeSession(filePath, workspaceRootPath, existingIds);

    // Create session directory
    const sessionDir = join(workspaceRootPath, 'sessions', session.id);
    mkdirSync(sessionDir, { recursive: true });

    // Also create plans directory
    mkdirSync(join(sessionDir, 'plans'), { recursive: true });

    // Write the session
    const sessionFile = join(sessionDir, 'session.jsonl');
    writeSessionJsonl(sessionFile, session);

    debug('[claude-code-import] Imported session:', session.id, 'from:', filePath);

    return {
      success: true,
      sessionId: session.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    debug('[claude-code-import] Import failed:', message);
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Import multiple Claude Code sessions
 */
export function importClaudeCodeSessions(
  filePaths: string[],
  workspaceRootPath: string,
  existingIds: string[]
): { results: ImportResult[]; successCount: number; failCount: number } {
  const results: ImportResult[] = [];
  const currentIds = [...existingIds];
  let successCount = 0;
  let failCount = 0;

  for (const filePath of filePaths) {
    const result = importClaudeCodeSession(filePath, workspaceRootPath, currentIds);
    results.push(result);

    if (result.success && result.sessionId) {
      currentIds.push(result.sessionId);
      successCount++;
    } else {
      failCount++;
    }
  }

  return { results, successCount, failCount };
}
