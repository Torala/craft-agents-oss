import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { addWorkspace, type Workspace, type OAuthCredentials } from '../../config/storage.ts';
import { CraftOAuth, getMcpBaseUrl } from '../../auth/oauth.ts';
import { getCredentialManager } from '../../credentials/index.ts';
import { TextInput } from './TextInput.tsx';

type AddStep = 'name' | 'url' | 'checking-auth' | 'no-oauth-options' | 'oauth-auth' | 'bearer-token' | 'complete' | 'error';

export interface WorkspaceAddProps {
  onComplete: (workspace: Workspace) => void;
  onCancel: () => void;
}

export const WorkspaceAdd: React.FC<WorkspaceAddProps> = ({ onComplete, onCancel }) => {
  const [step, setStep] = useState<AddStep>('name');
  const [name, setName] = useState('');
  const [mcpUrl, setMcpUrl] = useState('');
  const [oauthStatus, setOauthStatus] = useState('');
  const [oauthResult, setOauthResult] = useState<OAuthCredentials | null>(null);
  const [isPublicServer, setIsPublicServer] = useState(false);
  const [bearerToken, setBearerToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [oauthClient, setOauthClient] = useState<CraftOAuth | null>(null);

  // Handle Ctrl+C and Escape for steps without TextInput
  // (name, url, bearer-token steps use TextInput.onCancel)
  useInput((input, key) => {
    const textInputSteps = ['name', 'url', 'bearer-token'];
    if (textInputSteps.includes(step)) return;

    if ((key.ctrl && input === 'c') || key.escape) {
      // Cancel OAuth flow if in progress
      if (oauthClient) {
        oauthClient.cancel();
        setOauthClient(null);
      }
      onCancel();
    }
  });

  const handleName = useCallback((value: string) => {
    if (!value.trim()) return;
    setName(value.trim());
    setStep('url');
  }, []);

  const handleMcpUrl = useCallback((value: string) => {
    if (!value.trim()) return;

    // Basic URL validation
    try {
      new URL(value.trim());
      setMcpUrl(value.trim());
      setStep('checking-auth');
    } catch {
      setError('Please enter a valid URL');
    }
  }, []);

  // Check if OAuth is required when entering checking-auth step
  useEffect(() => {
    if (step !== 'checking-auth' || !mcpUrl) return;

    const mcpBaseUrl = getMcpBaseUrl(mcpUrl);
    const oauth = new CraftOAuth(
      { mcpBaseUrl },
      {
        onStatus: (message) => setOauthStatus(message),
        onError: () => {},
      }
    );

    setOauthStatus('Checking server authentication requirements...');

    oauth.checkAuthRequired()
      .then((authRequired) => {
        if (authRequired) {
          setIsPublicServer(false);
          setStep('oauth-auth');
        } else {
          // No OAuth detected - offer bearer token or public options
          setStep('no-oauth-options');
        }
      })
      .catch(() => {
        // Can't detect OAuth - offer alternatives
        setStep('no-oauth-options');
      });
  }, [step, mcpUrl]);

  // Start OAuth flow when entering oauth-auth step
  useEffect(() => {
    if (step !== 'oauth-auth' || !mcpUrl) return;

    const mcpBaseUrl = getMcpBaseUrl(mcpUrl);
    const oauth = new CraftOAuth(
      { mcpBaseUrl },
      {
        onStatus: (message) => setOauthStatus(message),
        onError: (errorMsg) => {
          setError(errorMsg);
          setStep('error');
        },
      }
    );

    setOauthClient(oauth);

    oauth.authenticate()
      .then(({ tokens, clientId }) => {
        const oauthCreds: OAuthCredentials = {
          accessToken: tokens.accessToken,
          refreshToken: tokens.refreshToken,
          expiresAt: tokens.expiresAt,
          clientId,
          tokenType: tokens.tokenType,
        };
        setOauthResult(oauthCreds);
        setOauthClient(null);
        // Save workspace with OAuth credentials
        saveWorkspace(oauthCreds, false);
      })
      .catch((err) => {
        // OAuth failed - offer bearer token as alternative
        setOauthStatus(err instanceof Error ? err.message : 'OAuth authentication failed');
        setOauthClient(null);
        setStep('no-oauth-options');
      });

    return () => {
      oauth.cancel();
    };
  }, [step, mcpUrl]);

  const saveWorkspace = useCallback(async (oauth: OAuthCredentials | null, isPublic: boolean, token?: string) => {
    try {
      // First create the workspace to get its ID
      const workspace = addWorkspace({
        name,
        mcpUrl,
        isPublic,
      });

      // Save credentials to keychain
      const manager = getCredentialManager();

      if (oauth) {
        await manager.setWorkspaceOAuth(workspace.id, {
          accessToken: oauth.accessToken,
          refreshToken: oauth.refreshToken,
          expiresAt: oauth.expiresAt,
          clientId: oauth.clientId,
          tokenType: oauth.tokenType,
        });
      } else if (token) {
        await manager.setWorkspaceBearer(workspace.id, token);
      }

      setStep('complete');

      // Give user a moment to see success message
      setTimeout(() => {
        onComplete(workspace);
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add workspace');
      setStep('error');
    }
  }, [name, mcpUrl, onComplete]);

  const handleNoOAuthSelect = useCallback((method: 'bearer' | 'public') => {
    if (method === 'bearer') {
      setStep('bearer-token');
    } else {
      setIsPublicServer(true);
      saveWorkspace(null, true);
    }
  }, [saveWorkspace]);

  const handleBearerToken = useCallback((token: string) => {
    if (!token.trim()) return;
    saveWorkspace(null, false, token.trim());
  }, [saveWorkspace]);

  const handleRetry = useCallback(() => {
    setError(null);
    setOauthResult(null);
    setIsPublicServer(false);
    setStep('url');
  }, []);

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>Add New Workspace</Text>
        <Text dimColor> - Step {getStepNumber(step)} of 3</Text>
      </Box>

      {/* Step content */}
      {step === 'name' && (
        <NameStep
          value={name}
          onChange={setName}
          onSubmit={handleName}
          onCancel={onCancel}
        />
      )}

      {step === 'url' && (
        <UrlStep
          value={mcpUrl}
          onChange={setMcpUrl}
          onSubmit={handleMcpUrl}
          onCancel={onCancel}
          error={error}
        />
      )}

      {step === 'checking-auth' && (
        <Box flexDirection="column">
          <Text>Checking server...</Text>
          <Box marginY={1}>
            <Text color="cyan">|</Text>
            <Text> {oauthStatus || 'Connecting...'}</Text>
          </Box>
        </Box>
      )}

      {step === 'no-oauth-options' && (
        <NoOAuthOptionsStep onSelect={handleNoOAuthSelect} message={oauthStatus} />
      )}

      {step === 'bearer-token' && (
        <BearerTokenStep
          value={bearerToken}
          onChange={setBearerToken}
          onSubmit={handleBearerToken}
          onCancel={onCancel}
        />
      )}

      {step === 'oauth-auth' && (
        <Box flexDirection="column">
          <Text bold>OAuth Authorization</Text>
          <Box marginY={1}>
            <Text dimColor>
              A browser window will open for you to authorize access.
            </Text>
          </Box>
          <Box marginY={1}>
            <Text color="cyan">|</Text>
            <Text> {oauthStatus}</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Complete the authorization in your browser.</Text>
          </Box>
        </Box>
      )}

      {step === 'complete' && (
        <Box flexDirection="column">
          <Text color="green" bold>Workspace added: {name}</Text>
        </Box>
      )}

      {step === 'error' && (
        <ErrorStep
          error={error}
          onRetry={handleRetry}
        />
      )}

      {/* Footer */}
      <Box marginTop={1}>
        <Text dimColor>Press Esc to cancel</Text>
      </Box>
    </Box>
  );
};

function getStepNumber(step: AddStep): number {
  switch (step) {
    case 'name': return 1;
    case 'url': return 2;
    case 'checking-auth':
    case 'no-oauth-options':
    case 'oauth-auth':
    case 'bearer-token':
    case 'complete':
    case 'error':
      return 3;
  }
}

// Sub-components

interface NameStepProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const NameStep: React.FC<NameStepProps> = ({ value, onChange, onSubmit, onCancel }) => {
  return (
    <Box flexDirection="column">
      <Text>Give this workspace a friendly name:</Text>
      <Box marginY={1}>
        <Text dimColor>e.g., "Work Projects", "Personal Notes"</Text>
      </Box>
      <Box>
        <Text color="green">&gt; </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
          placeholder="My Workspace"
        />
      </Box>
    </Box>
  );
};

interface UrlStepProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
  error: string | null;
}

const UrlStep: React.FC<UrlStepProps> = ({ value, onChange, onSubmit, onCancel, error }) => {
  return (
    <Box flexDirection="column">
      <Text>Enter the Craft MCP server URL:</Text>
      {error && (
        <Box marginY={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text color="green">&gt; </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
          placeholder="https://mcp.craft.do/links/YOUR_LINK_ID"
        />
      </Box>
    </Box>
  );
};

interface ErrorStepProps {
  error: string | null;
  onRetry: () => void;
}

const ErrorStep: React.FC<ErrorStepProps> = ({ error, onRetry }) => {
  useInput((input, key) => {
    if (key.return) {
      onRetry();
    }
  });

  return (
    <Box flexDirection="column">
      <Text color="red" bold>Failed to add workspace</Text>
      <Text color="red">{error}</Text>
      <Box marginTop={1}>
        <Text dimColor>Press Enter to retry</Text>
      </Box>
    </Box>
  );
};

// No OAuth options - shown when OAuth is not detected or fails
interface NoOAuthOptionsStepProps {
  onSelect: (method: 'bearer' | 'public') => void;
  message?: string;
}

const NoOAuthOptionsStep: React.FC<NoOAuthOptionsStepProps> = ({ onSelect, message }) => {
  const [selected, setSelected] = useState(0);
  const options = [
    { label: 'Enter Bearer Token', value: 'bearer' as const },
    { label: 'No authentication (public server)', value: 'public' as const },
  ];

  useInput((_, key) => {
    if (key.upArrow) {
      setSelected(s => Math.max(0, s - 1));
    } else if (key.downArrow) {
      setSelected(s => Math.min(options.length - 1, s + 1));
    } else if (key.return) {
      const option = options[selected];
      if (option) onSelect(option.value);
    }
  });

  return (
    <Box flexDirection="column">
      <Text bold>Choose Authentication Method</Text>
      {message && (
        <Box marginY={1}>
          <Text dimColor>{message}</Text>
        </Box>
      )}
      <Box marginY={1} flexDirection="column">
        {options.map((opt, i) => (
          <Text key={opt.value}>
            <Text color={i === selected ? 'green' : undefined}>
              {i === selected ? '> ' : '  '}{opt.label}
            </Text>
          </Text>
        ))}
      </Box>
      <Text dimColor>Use arrow keys to select, Enter to confirm</Text>
    </Box>
  );
};

// Bearer token input step
interface BearerTokenStepProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

const BearerTokenStep: React.FC<BearerTokenStepProps> = ({ value, onChange, onSubmit, onCancel }) => {
  return (
    <Box flexDirection="column">
      <Text>Enter your bearer token:</Text>
      <Box marginY={1}>
        <Text dimColor>The token will be sent as: Authorization: Bearer {'<token>'}</Text>
      </Box>
      <Box>
        <Text color="green">&gt; </Text>
        <TextInput
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          onCancel={onCancel}
          placeholder="Paste your bearer token..."
          mask="•"
          maskReveal={{ last: 4 }}
        />
      </Box>
    </Box>
  );
};
