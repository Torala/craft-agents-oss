import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { saveApiKeyCredentialAsync } from '../../agents/cache.ts';
import type { ApiConfig } from '../../agents/types.ts';
import { debug } from '../utils/debug.ts';
import { TextInput } from './TextInput.tsx';

export interface ApiAuthProps {
  apis: ApiConfig[];
  workspaceId: string;
  agentId: string;
  onComplete: (success: boolean) => void;
  onCancel: () => void;
}

export const ApiAuth: React.FC<ApiAuthProps> = ({
  apis,
  workspaceId,
  agentId,
  onComplete,
  onCancel,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [apiKey, setApiKey] = useState('');
  const [completedApis, setCompletedApis] = useState<string[]>([]);

  debug('[ApiAuth] Mounted with', apis.length, 'APIs:', apis.map(a => a.name));

  const currentApi = apis[currentIndex];

  // Handle API key submission
  const handleSubmit = useCallback(async (key: string) => {
    if (!key.trim()) return;

    const api = apis[currentIndex];
    if (!api) return;

    debug('[ApiAuth] Saving API key for', api.name);

    // Save the API key to keychain
    await saveApiKeyCredentialAsync(workspaceId, agentId, api.name, key.trim());

    setCompletedApis(prev => [...prev, api.name]);

    // Move to next API or complete
    const nextIndex = currentIndex + 1;
    if (nextIndex < apis.length) {
      setCurrentIndex(nextIndex);
      setApiKey('');
    } else {
      debug('[ApiAuth] All APIs configured, completing');
      onComplete(true);
    }
  }, [apis, currentIndex, workspaceId, agentId, onComplete]);

  // Build helpful auth hint
  const getAuthHint = (api: ApiConfig): string => {
    if (!api.auth) return '';
    switch (api.auth.type) {
      case 'header':
        return `(${api.auth.headerName || 'x-api-key'} header)`;
      case 'bearer':
        return '(Bearer token)';
      case 'query':
        return `(?${api.auth.queryParam} param)`;
      default:
        return '';
    }
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold>API Key Required</Text>
        {apis.length > 1 && (
          <Text dimColor> - {currentIndex + 1} of {apis.length}</Text>
        )}
      </Box>

      {/* API list */}
      <Box flexDirection="column" marginBottom={1}>
        {apis.map((api, i) => (
          <Box key={api.name}>
            <Text>
              {completedApis.includes(api.name) ? (
                <Text color="green">✓ </Text>
              ) : i === currentIndex ? (
                <Text color="cyan">→ </Text>
              ) : (
                <Text dimColor>○ </Text>
              )}
              <Text dimColor={i > currentIndex && !completedApis.includes(api.name)}>
                {api.name}
              </Text>
              {api.description && i === currentIndex && (
                <Text dimColor> - {api.description}</Text>
              )}
            </Text>
          </Box>
        ))}
      </Box>

      {/* Input prompt */}
      {currentApi && (
        <Box marginY={1} flexDirection="column">
          <Text>
            Enter API key for <Text bold color="cyan">{currentApi.name}</Text>
            {currentApi.auth && <Text dimColor> {getAuthHint(currentApi)}</Text>}
          </Text>
          <Box marginTop={1}>
            <Text color="green">&gt; </Text>
            <TextInput
              value={apiKey}
              onChange={setApiKey}
              onSubmit={handleSubmit}
              onCancel={onCancel}
              placeholder="Paste your API key..."
              mask="•"
              maskReveal={{ last: 4 }}
            />
          </Box>
        </Box>
      )}

      {/* Instructions */}
      <Box marginTop={1}>
        <Text dimColor>Press Enter to continue, Esc to skip</Text>
      </Box>
    </Box>
  );
};
