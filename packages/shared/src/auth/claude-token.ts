import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes?: string[];
  };
}

export interface ClaudeOAuthCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

/**
 * Read Claude OAuth credentials from macOS Keychain
 */
function readFromKeychain(): ClaudeOAuthCredential | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    const result = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (result) {
      const credentials: ClaudeCredentials = JSON.parse(result);
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
        };
      }
    }
  } catch {
    // Keychain entry not found or parse error
  }
  return null;
}

/**
 * Read Claude OAuth credentials from credentials file (Linux/fallback)
 */
function readFromCredentialsFile(): ClaudeOAuthCredential | null {
  const credentialsPath = join(homedir(), '.claude', '.credentials.json');

  try {
    if (existsSync(credentialsPath)) {
      const content = readFileSync(credentialsPath, 'utf-8');
      const credentials: ClaudeCredentials = JSON.parse(content);
      if (credentials.claudeAiOauth) {
        return {
          accessToken: credentials.claudeAiOauth.accessToken,
          refreshToken: credentials.claudeAiOauth.refreshToken,
          expiresAt: credentials.claudeAiOauth.expiresAt,
          scopes: credentials.claudeAiOauth.scopes,
        };
      }
    }
  } catch {
    // File not found or parse error
  }
  return null;
}

/**
 * Get existing Claude OAuth credentials from keychain or credentials file
 */
export function getExistingClaudeCredentials(): ClaudeOAuthCredential | null {
  // Try keychain first (macOS)
  const keychainCreds = readFromKeychain();
  if (keychainCreds) {
    return keychainCreds;
  }

  // Fall back to credentials file
  return readFromCredentialsFile();
}

/**
 * Get existing Claude OAuth token from keychain or credentials file
 * @deprecated Use getExistingClaudeCredentials() to get full credentials with refresh token
 */
export function getExistingClaudeToken(): string | null {
  const creds = getExistingClaudeCredentials();
  return creds?.accessToken || null;
}

/**
 * Refresh Claude OAuth token using refresh token
 * Uses the Anthropic API token endpoint
 */
export async function refreshClaudeToken(refreshToken: string): Promise<{
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}> {
  const params = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: 'claude-desktop',
  });

  const response = await fetch('https://api.anthropic.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to refresh Claude token: ${error}`);
  }

  const data = await response.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
}

/**
 * Check if a token is expired or will expire soon (within 5 minutes)
 */
export function isTokenExpired(expiresAt?: number): boolean {
  if (!expiresAt) {
    // If no expiry, assume token is still valid
    return false;
  }
  // Consider expired if less than 5 minutes remaining
  const bufferMs = 5 * 60 * 1000;
  return Date.now() + bufferMs >= expiresAt;
}

/**
 * Check if Claude CLI is installed
 */
export function isClaudeCliInstalled(): boolean {
  try {
    execSync('which claude', { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Run `claude setup-token` interactively
 * Returns a promise that resolves when the process completes
 */
export function runClaudeSetupToken(
  onStatus: (message: string) => void
): Promise<{ success: boolean; token?: string; error?: string }> {
  return new Promise((resolve) => {
    onStatus('Starting Claude setup-token...');

    const child = spawn('claude', ['setup-token'], {
      stdio: 'inherit', // Allow interactive terminal
      shell: true,
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Wait a moment for the token to be written
        setTimeout(() => {
          const token = getExistingClaudeToken();
          if (token) {
            resolve({ success: true, token });
          } else {
            resolve({ success: false, error: 'Token not found after setup' });
          }
        }, 500);
      } else {
        resolve({ success: false, error: `Process exited with code ${code}` });
      }
    });
  });
}
