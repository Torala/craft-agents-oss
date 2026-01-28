/**
 * Session Content Search Service
 *
 * Uses ripgrep to search session content (JSONL files).
 * Returns matches with session IDs and context snippets.
 */

import { spawn } from 'child_process';
import { join, dirname, basename } from 'path';
import { platform, arch } from 'os';
import { app } from 'electron';
import { existsSync } from 'fs';
import { ipcLog } from './logger';

/**
 * Search result for a single match
 */
export interface SearchMatch {
  /** Session ID (extracted from file path) */
  sessionId: string;
  /** Line number in the JSONL file */
  lineNumber: number;
  /** The matched text snippet with context */
  snippet: string;
  /** The raw matched text (without context) */
  matchText: string;
}

/**
 * Aggregated search results for a session
 */
export interface SessionSearchResult {
  sessionId: string;
  /** Number of matches found in this session */
  matchCount: number;
  /** First few matches with context */
  matches: SearchMatch[];
}

/**
 * Options for session search
 */
export interface SearchOptions {
  /** Maximum time to wait for search (ms). Default: 5000 */
  timeout?: number;
  /** Maximum matches per session. Default: 3 */
  maxMatchesPerSession?: number;
  /** Maximum total sessions to return. Default: 50 */
  maxSessions?: number;
  /** Case insensitive search. Default: true */
  ignoreCase?: boolean;
}

/**
 * Get the path to the ripgrep binary.
 * In development, uses the SDK's vendor folder.
 * In packaged app, uses the bundled binary.
 */
function getRipgrepPath(): string {
  const platformKey = platform();
  const archKey = arch();

  // Map Node.js arch to ripgrep folder names
  let platformFolder: string;
  if (platformKey === 'darwin') {
    platformFolder = archKey === 'arm64' ? 'arm64-darwin' : 'x64-darwin';
  } else if (platformKey === 'win32') {
    platformFolder = 'x64-win32';
  } else {
    // Linux
    platformFolder = archKey === 'arm64' ? 'arm64-linux' : 'x64-linux';
  }

  const binaryName = platformKey === 'win32' ? 'rg.exe' : 'rg';

  // In packaged app, use bundled SDK
  if (app.isPackaged) {
    const appPath = app.getAppPath();
    return join(appPath, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', platformFolder, binaryName);
  }

  // In development, find the SDK in node_modules
  // Walk up from this file to find the project root
  let searchPath = __dirname;
  for (let i = 0; i < 10; i++) {
    const candidate = join(searchPath, 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', platformFolder, binaryName);
    if (existsSync(candidate)) {
      return candidate;
    }
    searchPath = dirname(searchPath);
  }

  // Fallback: try process.cwd() based path
  return join(process.cwd(), 'node_modules', '@anthropic-ai', 'claude-agent-sdk', 'vendor', 'ripgrep', platformFolder, binaryName);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract text content from a JSONL line (user, assistant, or system message).
 * Returns the text content that should be searchable, or null if not a searchable message.
 *
 * This matches what ChatDisplay searches, ensuring consistency between
 * session list search results and navigable matches in ChatDisplay.
 *
 * Included:
 * - User messages: text content
 * - Assistant messages: text blocks only (NOT tool_use inputs)
 * - System messages: text content
 *
 * Excluded:
 * - Intermediate messages (isIntermediate: true) - not shown as final response
 * - tool_use, tool_result messages - tool outputs not searchable in ChatDisplay
 */
function extractSearchableTextContent(rawLine: string): string | null {
  try {
    const parsed = JSON.parse(rawLine);
    const messageType = parsed.type;

    // Skip intermediate messages - ChatDisplay only shows final responses
    if (parsed.isIntermediate) {
      return null;
    }

    if (messageType === 'user') {
      // User messages - extract text content
      const content = parsed.content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        // Extract only text blocks
        return content
          .filter((block: { type?: string }) => block.type === 'text')
          .map((block: { text?: string }) => block.text || '')
          .join('\n');
      }
      return null;
    }

    if (messageType === 'assistant') {
      // Assistant messages - extract only text blocks, skip tool_use
      const content = parsed.content;
      if (typeof content === 'string') {
        return content;
      }
      if (Array.isArray(content)) {
        // Extract only text blocks, NOT tool_use
        return content
          .filter((block: { type?: string }) => block.type === 'text')
          .map((block: { text?: string }) => block.text || '')
          .join('\n');
      }
      return null;
    }

    if (messageType === 'system') {
      // System messages - extract text content (ChatDisplay searches these too)
      const content = parsed.content;
      if (typeof content === 'string') {
        return content;
      }
      return null;
    }

    // Not a user, assistant, or system message (tool_result, tool_use, etc.)
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if query appears in the searchable text content of a message.
 * Only matches text in user messages and assistant text blocks (not tool inputs).
 */
function matchesInTextContent(rawLine: string, query: string, ignoreCase: boolean): boolean {
  const textContent = extractSearchableTextContent(rawLine);
  if (!textContent) return false;

  const searchText = ignoreCase ? textContent.toLowerCase() : textContent;
  const searchQuery = ignoreCase ? query.toLowerCase() : query;

  return searchText.includes(searchQuery);
}

/**
 * Extract a clean snippet from a JSONL line match.
 * Shows only the line containing the match for cleaner display.
 */
function extractSnippet(rawLine: string, matchText: string, maxLength = 150): string {
  try {
    // Try to parse as JSON and extract meaningful content
    const parsed = JSON.parse(rawLine);

    // Look for content in common message fields
    const content =
      parsed.content ||
      parsed.text ||
      parsed.message ||
      (parsed.data && parsed.data.content) ||
      rawLine;

    // If content is an array (Claude message format), extract text
    let textContent: string;
    if (Array.isArray(content)) {
      textContent = content
        .filter((block: { type?: string; text?: string }) => block.type === 'text' && block.text)
        .map((block: { text: string }) => block.text)
        .join('\n');
    } else if (typeof content === 'string') {
      textContent = content;
    } else {
      textContent = JSON.stringify(content);
    }

    // Split into lines and find the line containing the match
    const lines = textContent.split('\n');
    const lowerMatch = matchText.toLowerCase();

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue; // Skip empty lines

      if (trimmedLine.toLowerCase().includes(lowerMatch)) {
        // Found the matching line - truncate if too long
        if (trimmedLine.length > maxLength) {
          // Find match position within line and center around it
          const matchPos = trimmedLine.toLowerCase().indexOf(lowerMatch);
          const halfLength = Math.floor(maxLength / 2);
          const start = Math.max(0, matchPos - halfLength);
          const end = Math.min(trimmedLine.length, start + maxLength);

          let snippet = trimmedLine.slice(start, end);
          if (start > 0) snippet = '...' + snippet;
          if (end < trimmedLine.length) snippet = snippet + '...';
          return snippet;
        }
        return trimmedLine;
      }
    }

    // Fallback: return first non-empty line truncated
    const firstLine = lines.find(l => l.trim())?.trim() || textContent.trim();
    if (firstLine.length > maxLength) {
      return firstLine.slice(0, maxLength) + '...';
    }
    return firstLine;
  } catch {
    // If JSON parsing fails, just truncate the raw line
    const cleaned = rawLine.replace(/\n/g, ' ').trim();
    if (cleaned.length > maxLength) {
      return cleaned.slice(0, maxLength) + '...';
    }
    return cleaned;
  }
}

/**
 * Search session content using ripgrep.
 *
 * @param query - Search query (plain text, will be escaped)
 * @param sessionsDir - Path to the sessions directory
 * @param options - Search options
 * @returns Promise resolving to array of session search results
 */
export async function searchSessions(
  query: string,
  sessionsDir: string,
  options: SearchOptions = {}
): Promise<SessionSearchResult[]> {
  const {
    timeout = 5000,
    maxMatchesPerSession = 3,
    maxSessions = 50,
    ignoreCase = true,
  } = options;

  if (!query.trim()) {
    return [];
  }

  const rgPath = getRipgrepPath();
  ipcLog.debug('[search] Ripgrep path:', rgPath);
  if (!existsSync(rgPath)) {
    ipcLog.error('[search] ripgrep binary not found:', rgPath);
    return [];
  }

  ipcLog.debug('[search] Sessions directory:', sessionsDir);
  if (!existsSync(sessionsDir)) {
    ipcLog.warn('[search] Sessions directory not found:', sessionsDir);
    return [];
  }

  return new Promise((resolve) => {
    const results = new Map<string, SessionSearchResult>();
    let buffer = '';

    // Build ripgrep arguments
    const args = [
      '--json',           // JSON output format (NDJSON)
      '--max-count', '10', // Limit matches per file to prevent huge results
      '-g', '**/session.jsonl', // Only search session.jsonl files
    ];

    if (ignoreCase) {
      args.push('-i');
    }

    // Use literal string matching (escape regex)
    args.push('-F');
    args.push(query);
    args.push(sessionsDir);

    const rg = spawn(rgPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout,
    });

    // Set up timeout
    const timeoutHandle = setTimeout(() => {
      rg.kill('SIGTERM');
      ipcLog.warn('[search] Search timed out after', timeout, 'ms');
    }, timeout);

    rg.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();

      // Process complete lines
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;

        try {
          const result = JSON.parse(line);

          // We only care about 'match' type results
          if (result.type !== 'match') continue;

          const data = result.data;
          const filePath = data.path?.text;
          if (!filePath) continue;

          // Extract session ID from path: .../sessions/{sessionId}/session.jsonl
          const pathParts = filePath.split(/[/\\]/);
          const jsonlIndex = pathParts.findIndex((p: string) => p === 'session.jsonl');
          if (jsonlIndex < 1) continue;

          const sessionId = pathParts[jsonlIndex - 1];
          if (!sessionId) continue;

          // Skip header line (line 1)
          const lineNumber = data.line_number;
          if (lineNumber === 1) continue;

          // Get the raw line content
          const rawLine = data.lines?.text || '';

          // Only match if query appears in actual text content (not tool inputs)
          if (!matchesInTextContent(rawLine, query, ignoreCase)) continue;

          // Get or create session result
          let sessionResult = results.get(sessionId);
          if (!sessionResult) {
            if (results.size >= maxSessions) continue; // Hit session limit
            sessionResult = {
              sessionId,
              matchCount: 0,
              matches: [],
            };
            results.set(sessionId, sessionResult);
          }

          sessionResult.matchCount++;

          // Only store limited matches per session
          if (sessionResult.matches.length < maxMatchesPerSession) {
            const matchText = data.submatches?.[0]?.match?.text || query;

            sessionResult.matches.push({
              sessionId,
              lineNumber,
              snippet: extractSnippet(rawLine, matchText),
              matchText,
            });
          }
        } catch (e) {
          // Skip malformed JSON lines
          ipcLog.debug('[search] Failed to parse ripgrep output:', e);
        }
      }
    });

    rg.stderr.on('data', (data: Buffer) => {
      ipcLog.warn('[search] ripgrep stderr:', data.toString());
    });

    // Log the command being executed
    ipcLog.debug('[search] Running ripgrep:', rgPath, args.join(' '));

    rg.on('close', (code) => {
      clearTimeout(timeoutHandle);

      if (code !== 0 && code !== 1) {
        // Exit code 1 means no matches found (not an error)
        ipcLog.debug('[search] ripgrep exited with code:', code);
      }

      // Convert map to array, sorted by match count (descending)
      const resultArray = Array.from(results.values());
      resultArray.sort((a, b) => b.matchCount - a.matchCount);

      resolve(resultArray);
    });

    rg.on('error', (error) => {
      clearTimeout(timeoutHandle);
      ipcLog.error('[search] ripgrep error:', error);
      resolve([]);
    });
  });
}
