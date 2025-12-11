import React, { useEffect, useState, useRef } from 'react';
import { Box, Text, useInput } from 'ink';
import crypto from 'crypto';
import open from 'open';
import { createCallbackServer } from '../../../auth/callback-server';
import { CraftApi } from '../../../clients/craftApi';
import { AnimatedSpinner } from '../Spinner';

export interface CraftProfile {
  userId: string;
  firstName: string;
  lastName: string;
  spaces: Array<{ id: string; name: string }>;
  teams: Array<{ id: string; isPrivate: boolean; role: string; name: string }>;
}

export interface CraftCallbackStepProps {
  onComplete: (params: { token: string; profile: CraftProfile }) => void;
  onBack: () => void;
}

function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = crypto.randomBytes(32)
    .toString('base64url');

  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return { codeVerifier, codeChallenge };
}

function generateState(): string {
  return crypto.randomBytes(16).toString('base64url');
}

const callback = async () => {
  const callbackServer = await createCallbackServer();
  const { codeVerifier, codeChallenge } = generatePKCE();
  const callbackUrl = `${callbackServer.url}/callback`;
  const state = generateState();

  const platform = 'chaps';
  const domain = 'docs.craft.do';
  const url = `http://${domain}/login?platform=${encodeURIComponent(platform)}&code_challenge=${encodeURIComponent(codeChallenge)}&state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(callbackUrl)}`;
  return { url, callbackUrl, callbackServer, codeVerifier, state };
};

type AuthStatus = 'initializing' | 'ready' | 'waiting' | 'error';

export const CraftCallbackStep: React.FC<CraftCallbackStepProps> = ({ onComplete, onBack }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthStatus>('initializing');
  const [error, setError] = useState<string | null>(null);
  const callbackDataRef = useRef<{
    callbackUrl: string;
    callbackServer: Awaited<ReturnType<typeof createCallbackServer>>;
    state: string;
    codeVerifier: string;
  } | null>(null);

  // Open browser with the auth URL
  const openBrowser = async () => {
    if (!url) return;
    setStatus('waiting');
    try {
      await open(url);
    } catch (err) {
      // Browser open failed, but user can still copy URL manually
    }
  };

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }
    // Press Enter or 'o' to open browser
    if ((key.return || input === 'o') && url && status === 'ready') {
      openBrowser();
    }
  });

  // Initialize the callback server and URL
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { url, callbackUrl, callbackServer, state, codeVerifier } = await callback();
        if (cancelled) return;
        
        callbackDataRef.current = { callbackUrl, callbackServer, state, codeVerifier };
        setUrl(url);
        setStatus('ready');

        // Wait for callback
        const payload = await callbackServer.promise;
        if (cancelled) return;

        const callbackState = payload.query.state;
        const callbackCode = payload.query.code;
        
        if (callbackState !== state) {
          setError('State mismatch - possible security issue');
          setStatus('error');
          return;
        }
        if (!callbackCode) {
          setError('No authorization code received');
          setStatus('error');
          return;
        }
        
        const craftApi = new CraftApi('https://api.craft.do');
        const token = await craftApi.exchangeCodeForToken({ code: callbackCode, redirectUri: callbackUrl, codeVerifier });

        // Fetch profile to get spaces and teams for categorization
        const profile = await craftApi.getProfile(token);
        onComplete({ token, profile });
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Authentication failed');
        setStatus('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [onComplete]);

  return (
    <Box flexDirection="column">
      {/* Status-based content */}
      {status === 'initializing' && (
        <Box marginY={1} justifyContent="center">
          <AnimatedSpinner />
          <Text> Setting up authorization...</Text>
        </Box>
      )}

      {status === 'ready' && (
        <Box flexDirection="column" alignItems="center">
          <Text>Press <Text bold color="cyan">Enter</Text> to open your browser and sign in.</Text>
          <Box marginTop={1}>
            <Text dimColor>You'll be redirected back automatically.</Text>
          </Box>
        </Box>
      )}

      {status === 'waiting' && (
        <Box flexDirection="column" alignItems="center">
          <Box>
            <AnimatedSpinner />
            <Text> Waiting for authorization...</Text>
          </Box>
          <Box marginTop={1}>
            <Text dimColor>Complete sign-in in your browser.</Text>
          </Box>
        </Box>
      )}

      {status === 'error' && (
        <Box flexDirection="column" alignItems="center">
          <Text color="red">✗ {error}</Text>
          <Box marginTop={1}>
            <Text dimColor>Press Esc to go back and try again.</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};
