import React, { useState, useCallback, memo, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import { getCommandHint, getAgentHint, getTabCompletion, type HintData } from '../utils/filtering.ts';
import { TextInput } from './TextInput.tsx';

export interface InputProps {
  onSubmit: (input: string) => void;
  onPaste?: () => void;
  onRemoveAttachment?: () => void;
  onClearAttachments?: () => void;
  onPastedText?: (text: string) => void;
  disabled?: boolean;
  history?: string[];
  placeholder?: string;
  attachmentCount?: number;
  attachmentLabel?: string;
  /** Available sub-agent names for @mention autocomplete */
  availableAgents?: string[];
  /** Currently active agent name (for dynamic placeholder) */
  activeAgentName?: string;
  /** Terminal width in columns (for separator lines) */
  columns?: number;
}

// Memoized prompt character
const InputPrompt = memo<{ disabled: boolean }>(({ disabled }) => (
  <Text color={disabled ? 'gray' : 'blue'} bold>
    {disabled ? '◌' : '>'}{' '}
  </Text>
));


export const Input: React.FC<InputProps> = ({
  onSubmit,
  onPaste,
  onRemoveAttachment,
  onClearAttachments,
  onPastedText,
  disabled = false,
  history = [],
  placeholder,
  attachmentCount = 0,
  attachmentLabel,
  availableAgents = [],
  activeAgentName,
  columns = 80,
}) => {
  const [value, setValueRaw] = useState('');
  const [historyIndex, setHistoryIndex] = useState(-1);

  // Wrap setValue to reset history index when value is cleared
  const setValue = useCallback((newValue: string) => {
    setValueRaw(newValue);
    if (newValue === '') {
      setHistoryIndex(-1);
    }
  }, []);

  const handleSubmit = useCallback(
    (input: string) => {
      if (input.trim() && !disabled) {
        onSubmit(input.trim());
        setValue('');
        setHistoryIndex(-1);
      }
    },
    [onSubmit, disabled]
  );

  useInput(
    (input, key) => {
      if (disabled) return;

      // Handle Tab for auto-completion
      if (key.tab) {
        const completion = getTabCompletion(value, availableAgents);
        if (completion) {
          setValue(completion);
          setHistoryIndex(-1);
        }
        return;
      }

      // Handle up arrow for history (only if not using meta/shift modifiers)
      if (key.upArrow && !key.meta && !key.shift && history.length > 0) {
        const newIndex = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(newIndex);
        const histValue = history[history.length - 1 - newIndex] || '';
        setValue(histValue);
      }

      // Handle down arrow for history (only if not using meta/shift modifiers)
      if (key.downArrow && !key.meta && !key.shift && historyIndex > -1) {
        const newIndex = historyIndex - 1;
        setHistoryIndex(newIndex);
        if (newIndex < 0) {
          setValue('');
        } else {
          const histValue = history[history.length - 1 - newIndex] || '';
          setValue(histValue);
        }
      }

      // Handle Escape to clear input and attachments (when not processing - App handles interrupt)
      if (key.escape && !disabled) {
        if (value.length > 0) {
          setValue('');  // This also resets history index
        }
        if (onClearAttachments) {
          onClearAttachments();
        }
      }

      // Handle paste from clipboard
      // Ctrl+V (ASCII 22 / 0x16) - often intercepted by terminal
      // Ctrl+P (ASCII 16 / 0x10) - alternative that works in more terminals
      const charCode = input.charCodeAt(0);
      const isCtrlV = charCode === 22 || input === '\x16' || (key.ctrl && (input === 'v' || input === 'V'));
      const isCtrlP = charCode === 16 || input === '\x10' || (key.ctrl && (input === 'p' || input === 'P'));
      if (isCtrlV || isCtrlP) {
        if (onPaste) onPaste();
      }
    },
    { isActive: !disabled }
  );

  // Determine placeholder text - dynamic based on active agent
  const placeholderText = disabled
    ? 'Thinking...'
    : placeholder
      ? placeholder
      : activeAgentName
        ? `Message @${activeAgentName}...`
        : 'Message Craft...';

  // Memoize command/mention hint to avoid recalculation
  const hintData = useMemo((): HintData | null => {
    // @mention hints
    if (value.startsWith('@')) {
      return getAgentHint(value.slice(1), availableAgents);
    }
    // Slash command hints
    if (value.startsWith('/')) {
      return getCommandHint(value);
    }
    return null;
  }, [value, availableAgents]);

  // Check if we have any hint to show
  const hasHint = hintData && (hintData.selected || hintData.others.length > 0);

  // Border color based on state
  const borderColor = disabled ? 'gray' : 'blue';

  // Separator line width (account for parent paddingX={1} = 2 chars)
  const separatorWidth = Math.max(1, columns - 2);

  return (
    <Box flexDirection="column" width="100%">
      {!disabled && hasHint && (
        <Box justifyContent="space-between" paddingLeft={2} marginBottom={1}>
          <Box>
            {hintData.selected ? (
              // Show selected (highlighted) + description + others
              <Text>
                <Text color="blue" bold>{hintData.selected}</Text>
                {hintData.description && <Text dimColor>: {hintData.description}</Text>}
                {hintData.others.length > 0 && (
                  <Text dimColor>  {hintData.others.join('  ')}</Text>
                )}
              </Text>
            ) : (
              // No selection, just show options
              <Text dimColor>{hintData.others.join('  ')}</Text>
            )}
          </Box>
          <Box />
        </Box>
      )}
      {/* Top separator - exact terminal width */}
      <Text color={borderColor}>{'─'.repeat(separatorWidth)}</Text>
      {/* Input row - use justifyContent="space-between" to fill full width */}
      <Box justifyContent="space-between">
        <Box>
          <InputPrompt disabled={disabled} />
          {attachmentCount > 0 && (
            <Text color="cyan">
              [{attachmentLabel || (attachmentCount === 1 ? '1 file' : `${attachmentCount} files`)}]{' '}
            </Text>
          )}
          <TextInput
            value={value}
            onChange={setValue}
            onSubmit={handleSubmit}
            onBackspaceEmpty={onRemoveAttachment}
            onPastedText={onPastedText}
            placeholder={placeholderText}
            disabled={disabled}
            detectFilePaths
            multiline
          />
        </Box>
        <Box />
      </Box>
      {/* Bottom separator - exact terminal width */}
      <Text color={borderColor}>{'─'.repeat(separatorWidth)}</Text>
    </Box>
  );
};

/**
 * Multiline input hint component
 */
export const InputHint: React.FC<{ visible?: boolean }> = memo(({ visible = true }) => {
  if (!visible) return null;

  return (
    <Box justifyContent="space-between" paddingX={1} marginTop={1}>
      <Text dimColor>
        ←→ move | ⌥←→ word | ⌘←→ line | ⇧ select | ⇧↵ newline | ↑↓ history | Ctrl+C exit
      </Text>
      <Box />
    </Box>
  );
});
