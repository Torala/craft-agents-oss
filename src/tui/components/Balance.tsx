import React, { useState, useEffect } from 'react';
import { Box, Text, useInput } from 'ink';
import open from 'open';
import { getAiCreditTopUpUrl } from '../../auth/balance.ts';
import type { AuthType } from '../../config/storage.ts';

const AUTH_TYPE_LABELS: Record<AuthType, string> = {
  'craft_credits': 'Craft Credits',
  'api_key': 'Anthropic API Key',
  'oauth_token': 'Claude Max Subscription',
};

export interface BalanceProps {
  authType: AuthType;
  onClose: () => void;
}

type BalanceState =
  | { type: 'loading' }
  | { type: 'ready'; url: string }
  | { type: 'error'; message: string };

export const Balance: React.FC<BalanceProps> = ({ authType, onClose }) => {
  const isCraftCredits = authType === 'craft_credits';
  const [state, setState] = useState<BalanceState>(
    isCraftCredits ? { type: 'loading' } : { type: 'ready', url: '' }
  );

  useEffect(() => {
    if (!isCraftCredits) return;

    const fetchUrl = async () => {
      try {
        const url = await getAiCreditTopUpUrl();
        if (!url) {
          setState({
            type: 'error',
            message: 'Could not determine team ID. Please try again later.',
          });
          return;
        }
        setState({ type: 'ready', url });
      } catch (err) {
        setState({
          type: 'error',
          message: err instanceof Error ? err.message : 'Failed to get balance URL',
        });
      }
    };
    fetchUrl();
  }, [isCraftCredits]);

  const openUrl = async (url: string) => {
    await open(url);
    onClose();
  };

  useInput((input, key) => {
    if (key.escape || key.return) {
      if (isCraftCredits && state.type === 'ready' && state.url && (key.return || input.toLowerCase() === 'o')) {
        void openUrl(state.url);
      } else {
        onClose();
      }
      return;
    }

    if (isCraftCredits && state.type === 'ready' && input.toLowerCase() === 'o') {
      void openUrl(state.url);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>AI Credits</Text>
      </Box>

      <Box flexDirection="column">
        <Text>
          Current billing: <Text color="cyan" bold>{AUTH_TYPE_LABELS[authType]}</Text>
        </Text>
      </Box>

      {isCraftCredits && (
        <>
          {state.type === 'loading' && (
            <Box marginTop={1}>
              <Text dimColor>Loading top-up link...</Text>
            </Box>
          )}

          {state.type === 'ready' && state.url && (
            <Box marginTop={1} flexDirection="column">
              <Text dimColor>
                Press <Text bold color="white">o</Text> or <Text bold color="white">Enter</Text> to view credits & top up in browser
              </Text>
            </Box>
          )}

          {state.type === 'error' && (
            <Box marginTop={1}>
              <Text color="red">{state.message}</Text>
            </Box>
          )}
        </>
      )}

      <Box marginTop={1}>
        <Text dimColor>
          To change your billing method, use <Text color="white">/settings</Text>
        </Text>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>
          {isCraftCredits && state.type === 'ready' && state.url
            ? 'Press Esc to close'
            : 'Press Enter or Esc to close'
          }
        </Text>
      </Box>
    </Box>
  );
};
