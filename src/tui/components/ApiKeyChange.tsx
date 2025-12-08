import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { TextInput } from './TextInput.tsx';

export interface ApiKeyChangeProps {
  onSubmit: (newApiKey: string) => void;
  onCancel: () => void;
}

export const ApiKeyChange: React.FC<ApiKeyChangeProps> = ({
  onSubmit,
  onCancel,
}) => {
  const [value, setValue] = useState('');

  const handleSubmit = useCallback((input: string) => {
    const trimmed = input.trim();
    if (trimmed) {
      onSubmit(trimmed);
    }
  }, [onSubmit]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Change API Key</Text>
      </Box>

      <Box>
        <Text>New API key: </Text>
        <TextInput
          value={value}
          onChange={setValue}
          onSubmit={handleSubmit}
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
