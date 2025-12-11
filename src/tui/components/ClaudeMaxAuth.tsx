import React, { useState, useCallback, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import { TextInput } from './TextInput.tsx';
import { execSync } from 'child_process';

export interface ClaudeMaxAuthProps {
  onSubmit: (token: string) => void;
  onCancel: () => void;
}

/**
 * Try to detect existing Claude OAuth token from Claude CLI keychain.
 * Claude CLI stores tokens in macOS Keychain with service "claude.ai".
 * Returns null if not found or on non-macOS platforms.
 */
function detectClaudeToken(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }

  try {
    // Claude CLI stores OAuth token in keychain with service "claude.ai"
    const result = execSync(
      'security find-generic-password -s "claude.ai" -a "oauth_token" -w 2>/dev/null',
      { encoding: 'utf-8', timeout: 5000 }
    );
    const token = result.trim();
    return token || null;
  } catch {
    // Token not found or security command failed
    return null;
  }
}

type ViewMode = 'loading' | 'detected' | 'manual';

export const ClaudeMaxAuth: React.FC<ClaudeMaxAuthProps> = ({
  onSubmit,
  onCancel,
}) => {
  const [mode, setMode] = useState<ViewMode>('loading');
  const [detectedToken, setDetectedToken] = useState<string | null>(null);
  const [manualValue, setManualValue] = useState('');
  const [selectedOption, setSelectedOption] = useState(0);

  // Try to detect existing token on mount
  useEffect(() => {
    const token = detectClaudeToken();
    if (token) {
      setDetectedToken(token);
      setMode('detected');
    } else {
      setMode('manual');
    }
  }, []);

  const handleManualSubmit = useCallback((input: string) => {
    const trimmed = input.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  }, [onSubmit]);

  // Handle keyboard navigation in detected mode
  useInput((input, key) => {
    if (mode !== 'detected') return;

    if (key.upArrow || key.downArrow) {
      setSelectedOption(prev => (prev === 0 ? 1 : 0));
    } else if (key.return) {
      if (selectedOption === 0 && detectedToken) {
        // Use detected token
        onSubmit(detectedToken);
      } else {
        // Switch to manual entry
        setMode('manual');
      }
    } else if (key.escape) {
      onCancel();
    }
  });

  if (mode === 'loading') {
    return (
      <Box flexDirection="column" paddingX={1}>
        <Text dimColor>Checking for existing Claude token...</Text>
      </Box>
    );
  }

  if (mode === 'detected') {
    const maskedToken = detectedToken
      ? `${detectedToken.substring(0, 8)}...${detectedToken.substring(detectedToken.length - 4)}`
      : '';

    return (
      <Box flexDirection="column" paddingX={1}>
        <Box marginBottom={1}>
          <Text bold>Claude Max Authentication</Text>
        </Box>

        <Text>Found existing Claude CLI token:</Text>
        <Text dimColor>{maskedToken}</Text>

        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text
              color={selectedOption === 0 ? 'blue' : undefined}
              bold={selectedOption === 0}
              inverse={selectedOption === 0}
            >
              {' '}Use this token{' '}
            </Text>
          </Box>
          <Box>
            <Text
              color={selectedOption === 1 ? 'blue' : undefined}
              bold={selectedOption === 1}
              inverse={selectedOption === 1}
            >
              {' '}Enter different token{' '}
            </Text>
          </Box>
        </Box>

        <Box marginTop={1}>
          <Text dimColor>
            ↑↓ select | Enter confirm | Esc cancel
          </Text>
        </Box>
      </Box>
    );
  }

  // Manual entry mode
  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Claude Max Authentication</Text>
      </Box>

      <Text dimColor>Enter your Claude Max OAuth token.</Text>
      <Text dimColor>Get this from claude.ai → Settings → Developer.</Text>

      <Box marginTop={1}>
        <Text>Token: </Text>
        <TextInput
          value={manualValue}
          onChange={setManualValue}
          onSubmit={handleManualSubmit}
          onCancel={onCancel}
          placeholder="sk-ant-..."
          mask="•"
          maskReveal={{ last: 4 }}
        />
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          Enter confirm | Esc cancel | ←→ navigate | Ctrl+U clear
        </Text>
      </Box>
    </Box>
  );
};
