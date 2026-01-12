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

/**
 * Read Claude OAuth token from system credential store
 * Dispatches to platform-specific implementation
 */
function readFromKeychain(): string | null {
  if (process.platform === 'darwin') {
    return readFromMacOSKeychain();
  } else if (process.platform === 'win32') {
    return readFromWindowsCredentialManager();
  } else if (process.platform === 'linux') {
    return readFromLinuxSecretService();
  }
  return null;
}

/**
 * Read Claude OAuth token from macOS Keychain
 */
function readFromMacOSKeychain(): string | null {
  try {
    const result = execSync(
      'security find-generic-password -s "Claude Code-credentials" -w',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (result) {
      const credentials: ClaudeCredentials = JSON.parse(result);
      return credentials.claudeAiOauth?.accessToken || null;
    }
  } catch {
    // Keychain entry not found or parse error
  }
  return null;
}

/**
 * Read Claude OAuth token from Windows Credential Manager
 * Uses PowerShell to access the credential store
 */
function readFromWindowsCredentialManager(): string | null {
  try {
    // PowerShell script to read from Windows Credential Manager
    const psScript = `
      $cred = Get-StoredCredential -Target "Claude Code-credentials" -ErrorAction SilentlyContinue
      if ($cred) {
        $cred.GetNetworkCredential().Password
      } else {
        # Try using cmdkey approach as fallback
        $output = cmdkey /list:Claude* 2>&1
        if ($output -match "Claude Code") {
          # Need to use CredRead API via .NET
          Add-Type -AssemblyName System.Security
          try {
            $credPtr = [IntPtr]::Zero
            $result = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
              [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR(
                (New-Object System.Management.Automation.PSCredential("user",
                  (ConvertTo-SecureString "dummy" -AsPlainText -Force)
                ).Password
              )
            ))
          } catch {}
        }
      }
    `;

    // Simpler approach: read from the same credentials file location that Claude Code uses on Windows
    const credentialsPath = join(homedir(), '.claude', '.credentials.json');
    if (existsSync(credentialsPath)) {
      const content = readFileSync(credentialsPath, 'utf-8');
      const credentials: ClaudeCredentials = JSON.parse(content);
      return credentials.claudeAiOauth?.accessToken || null;
    }
  } catch {
    // Credential Manager read failed
  }
  return null;
}

/**
 * Read Claude OAuth token from Linux Secret Service (libsecret)
 * Uses secret-tool CLI which interfaces with GNOME Keyring or KDE Wallet
 */
function readFromLinuxSecretService(): string | null {
  try {
    // Try secret-tool (works with GNOME Keyring, KDE Wallet via libsecret)
    const result = execSync(
      'secret-tool lookup service "Claude Code" account "credentials" 2>/dev/null',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (result) {
      const credentials: ClaudeCredentials = JSON.parse(result);
      return credentials.claudeAiOauth?.accessToken || null;
    }
  } catch {
    // secret-tool not available or entry not found
  }

  // Fallback: try pass (password-store)
  try {
    const result = execSync(
      'pass show claude-code/credentials 2>/dev/null',
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();

    if (result) {
      const credentials: ClaudeCredentials = JSON.parse(result);
      return credentials.claudeAiOauth?.accessToken || null;
    }
  } catch {
    // pass not available or entry not found
  }

  return null;
}

/**
 * Read Claude OAuth token from credentials file (Linux/fallback)
 */
function readFromCredentialsFile(): string | null {
  const credentialsPath = join(homedir(), '.claude', '.credentials.json');

  try {
    if (existsSync(credentialsPath)) {
      const content = readFileSync(credentialsPath, 'utf-8');
      const credentials: ClaudeCredentials = JSON.parse(content);
      return credentials.claudeAiOauth?.accessToken || null;
    }
  } catch {
    // File not found or parse error
  }
  return null;
}

/**
 * Get existing Claude OAuth token from keychain or credentials file
 */
export function getExistingClaudeToken(): string | null {
  // Try keychain first (macOS)
  const keychainToken = readFromKeychain();
  if (keychainToken) {
    return keychainToken;
  }

  // Fall back to credentials file
  return readFromCredentialsFile();
}

/**
 * Check if Claude CLI is installed (cross-platform)
 */
export function isClaudeCliInstalled(): boolean {
  try {
    // Use 'where' on Windows, 'which' on Unix-like systems
    const command = process.platform === 'win32' ? 'where claude' : 'which claude';
    execSync(command, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
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
