import { createServer, type Server } from 'http';
import { URL } from 'url';
import open from 'open';
import { randomBytes, createHash } from 'crypto';

export interface OAuthConfig {
  mcpBaseUrl: string; // e.g., http://localhost:3000/v1/links/abc123
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
}

export interface OAuthCallbacks {
  onStatus: (message: string) => void;
  onError: (error: string) => void;
}

const CALLBACK_PORT = 8914;
const CALLBACK_PATH = '/oauth/callback';
const CLIENT_NAME = 'Craft TUI Agent';

// ASCII Craft logo (exact copy from Header.tsx WelcomeBanner)
const CRAFT_LOGO = [
  '                                                      ',
  '                                                      ',
  '  ████████ █████████    ██████   ██████████ ██████████',
  '██████████ ██████████ ██████████ █████████  ██████████',
  '██████     ██████████ ██████████ ████████   ██████████',
  '██████████ ████████   ██████████ ███████      █████   ',
  '  ████████ ████  ████ ████  ████ █████        █████   ',
  '                                                      ',
  '                                                      ',
].join('\n');

/**
 * Generate a styled OAuth callback page matching TUI aesthetic
 */
function generateOAuthPage(options: {
  title: string;
  message: string;
  isSuccess: boolean;
  autoClose?: boolean;
  errorDetail?: string;
}): string {
  const { title, message, isSuccess, autoClose = false, errorDetail } = options;

  const countdownScript = autoClose ? `
    <script>
      let seconds = 3;
      const countdown = document.getElementById('seconds');
      const interval = setInterval(() => {
        seconds--;
        if (countdown) countdown.textContent = seconds;
        if (seconds <= 0) {
          clearInterval(interval);
          window.close();
        }
      }, 1000);
    </script>
  ` : '';

  const countdownHtml = autoClose
    ? `<p class="countdown">Closing in <span id="seconds">3</span>s...</p>`
    : '';

  const errorHtml = errorDetail
    ? `<p class="error-detail">${errorDetail}</p>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Craft - ${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace;
      background: #0d0d0d;
      color: #a0a0a0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .container { text-align: center; padding: 2rem; }
    .logo {
      color: #888;
      font-size: 8px;
      line-height: 1;
      white-space: pre;
      margin-bottom: 2rem;
      letter-spacing: -1px;
    }
    @media (min-width: 640px) { .logo { font-size: 12px; } }
    .title {
      font-size: 1.25rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
      color: ${isSuccess ? '#22c55e' : '#dc2626'};
    }
    .message { color: #666; margin-bottom: 0.5rem; }
    .error-detail { color: #dc2626; margin-bottom: 1rem; font-size: 0.875rem; }
    .countdown { color: #555; font-size: 0.875rem; margin-top: 1rem; }
  </style>
</head>
<body>
  <div class="container">
    <pre class="logo">${CRAFT_LOGO}</pre>
    <h1 class="title">${title}</h1>
    <p class="message">${message}</p>
    ${errorHtml}
    ${countdownHtml}
  </div>
  ${countdownScript}
</body>
</html>`;
}

// Generate PKCE code verifier and challenge
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

// Generate random state for CSRF protection
function generateState(): string {
  return randomBytes(16).toString('hex');
}

export class CraftOAuth {
  private config: OAuthConfig;
  private server: Server | null = null;
  private callbacks: OAuthCallbacks;

  constructor(config: OAuthConfig, callbacks: OAuthCallbacks) {
    this.config = config;
    this.callbacks = callbacks;
  }

  // Get OAuth server metadata
  private async getServerMetadata(): Promise<{
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint?: string;
  }> {
    const metadataUrl = `${this.config.mcpBaseUrl}/.well-known/oauth-authorization-server`;

    const response = await fetch(metadataUrl);
    if (!response.ok) {
      throw new Error(`Failed to get OAuth metadata: ${response.status}`);
    }

    return response.json() as Promise<{
      authorization_endpoint: string;
      token_endpoint: string;
      registration_endpoint?: string;
    }>;
  }

  // Register OAuth client dynamically
  private async registerClient(registrationEndpoint: string): Promise<{
    client_id: string;
    client_secret?: string;
  }> {
    const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

    const response = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: CLIENT_NAME,
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none', // Public client
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to register OAuth client: ${error}`);
    }

    return response.json() as Promise<{
      client_id: string;
      client_secret?: string;
    }>;
  }

  // Exchange authorization code for tokens
  private async exchangeCodeForTokens(
    tokenEndpoint: string,
    code: string,
    codeVerifier: string,
    clientId: string
  ): Promise<OAuthTokens> {
    const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;

    const params = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    });

    const response = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to exchange code for tokens: ${error}`);
    }

    const data = await response.json() as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
    };

    return {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type || 'Bearer',
    };
  }

  // Refresh access token
  async refreshAccessToken(
    refreshToken: string,
    clientId: string
  ): Promise<OAuthTokens> {
    const metadata = await this.getServerMetadata();

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });

    const response = await fetch(metadata.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh token');
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
      tokenType: data.token_type || 'Bearer',
    };
  }

  // Check if the MCP server requires OAuth
  async checkAuthRequired(): Promise<boolean> {
    const metadataUrl = `${this.config.mcpBaseUrl}/.well-known/oauth-authorization-server`;
    this.callbacks.onStatus('Checking if authentication is required...');

    try {
      const response = await fetch(metadataUrl);
      if (response.ok) {
        this.callbacks.onStatus('OAuth required - server has OAuth metadata');
        return true;
      }
      // 404 or other error means no OAuth
      this.callbacks.onStatus('No OAuth metadata found - server may be public');
      return false;
    } catch (error) {
      this.callbacks.onStatus('Could not reach OAuth metadata - assuming public');
      return false;
    }
  }

  // Start the OAuth flow
  async authenticate(): Promise<{ tokens: OAuthTokens; clientId: string }> {
    this.callbacks.onStatus('Fetching OAuth server configuration...');

    // Get server metadata
    let metadata;
    try {
      metadata = await this.getServerMetadata();
      this.callbacks.onStatus(`Found OAuth endpoints at ${this.config.mcpBaseUrl}`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      this.callbacks.onStatus(`Failed to get OAuth metadata: ${msg}`);
      throw error;
    }

    // Register client if endpoint available
    let clientId: string;
    if (metadata.registration_endpoint) {
      this.callbacks.onStatus(`Registering client at ${metadata.registration_endpoint}...`);
      try {
        const client = await this.registerClient(metadata.registration_endpoint);
        clientId = client.client_id;
        this.callbacks.onStatus(`Registered as client: ${clientId}`);
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        this.callbacks.onStatus(`Client registration failed: ${msg}`);
        throw error;
      }
    } else {
      // Use a default client ID for public clients
      clientId = 'craft-tui-agent';
      this.callbacks.onStatus(`Using default client ID: ${clientId}`);
    }

    // Generate PKCE and state
    const pkce = generatePKCE();
    const state = generateState();
    const redirectUri = `http://localhost:${CALLBACK_PORT}${CALLBACK_PATH}`;
    this.callbacks.onStatus('Generated PKCE challenge and state');

    // Build authorization URL
    const authUrl = new URL(metadata.authorization_endpoint);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', clientId);
    authUrl.searchParams.set('redirect_uri', redirectUri);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', pkce.challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    // Start local server to receive callback
    this.callbacks.onStatus(`Starting callback server on port ${CALLBACK_PORT}...`);
    const codePromise = this.startCallbackServer(state);

    // Open browser for authorization
    this.callbacks.onStatus('Opening browser for authorization...');
    await open(authUrl.toString());

    // Wait for the authorization code
    this.callbacks.onStatus('Waiting for you to authorize in browser...');
    const authCode = await codePromise;
    this.callbacks.onStatus('Authorization code received!');

    // Exchange code for tokens
    this.callbacks.onStatus('Exchanging authorization code for tokens...');
    const tokens = await this.exchangeCodeForTokens(
      metadata.token_endpoint,
      authCode,
      pkce.verifier,
      clientId
    );
    this.callbacks.onStatus('Tokens received successfully!');

    return { tokens, clientId };
  }

  // Start local HTTP server to receive OAuth callback
  private startCallbackServer(expectedState: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.stopServer();
        reject(new Error('OAuth timeout - no callback received'));
      }, 300000); // 5 minute timeout

      this.server = createServer((req, res) => {
        const url = new URL(req.url || '/', `http://localhost:${CALLBACK_PORT}`);

        if (url.pathname === CALLBACK_PATH) {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const error = url.searchParams.get('error');

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(generateOAuthPage({
              title: 'Authorization Failed',
              message: 'You can close this window.',
              isSuccess: false,
              errorDetail: error,
            }));
            clearTimeout(timeout);
            this.stopServer();
            reject(new Error(`OAuth error: ${error}`));
            return;
          }

          if (state !== expectedState) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(generateOAuthPage({
              title: 'Security Error',
              message: 'State mismatch - possible CSRF attack.',
              isSuccess: false,
            }));
            clearTimeout(timeout);
            this.stopServer();
            reject(new Error('OAuth state mismatch'));
            return;
          }

          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html' });
            res.end(generateOAuthPage({
              title: 'Authorization Failed',
              message: 'No authorization code received.',
              isSuccess: false,
            }));
            clearTimeout(timeout);
            this.stopServer();
            reject(new Error('No authorization code'));
            return;
          }

          // Success!
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(generateOAuthPage({
            title: 'Authorization Successful',
            message: 'You can close this window and return to the terminal.',
            isSuccess: true,
            autoClose: true,
          }));

          clearTimeout(timeout);
          this.stopServer();
          resolve(code);
        } else {
          res.writeHead(404);
          res.end('Not found');
        }
      });

      this.server.listen(CALLBACK_PORT, () => {
        // Server started
      });

      this.server.on('error', (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to start callback server: ${err.message}`));
      });
    });
  }

  private stopServer(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  // Cancel the OAuth flow
  cancel(): void {
    this.stopServer();
  }
}

// Helper to extract the base MCP URL from a full MCP URL
export function getMcpBaseUrl(mcpUrl: string): string {
  // Remove /mcp or /sse suffix if present
  return mcpUrl.replace(/\/(mcp|sse)\/?$/, '');
}
