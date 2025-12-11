import React from 'react';
import { Box, Text, useInput } from 'ink';
import { COMMANDS, SUBCOMMANDS, CATEGORY_ORDER, getCommandsByCategory, type CommandCategory } from '../utils/filtering.ts';

// Static content that isn't command-based
const STATIC_CONTENT: Partial<Record<CommandCategory | 'Chat', string[]>> = {
  'Chat': [
    'Just type your message and press Enter to chat.',
    'Use @agentname to activate a sub-agent (e.g., @writer).',
  ],
  'Attaching Files': [
    'Drag & drop   Drag file into terminal window',
    'Type path     Include /path/to/file in your message',
  ],
};

interface HelpPanelProps {
  onClose: () => void;
}

export const HelpPanel: React.FC<HelpPanelProps> = ({ onClose }) => {
  useInput((input, key) => {
    if (key.escape || key.return || input === 'q') {
      onClose();
    }
  });

  const commandsByCategory = getCommandsByCategory();

  return (
    <Box flexDirection="column" paddingX={1}>
      {/* Title */}
      <Text bold color="blue">Craft Agent - Help</Text>

      {/* Chat section (static, always first) */}
      <Box marginTop={1}>
        <Text bold color="blue">Chat</Text>
      </Box>
      {STATIC_CONTENT['Chat']?.map((line, i) => (
        <Text key={`chat-${i}`} dimColor>  {line}</Text>
      ))}

      {/* Dynamic command sections based on CATEGORY_ORDER */}
      {CATEGORY_ORDER.map(category => {
        const commands = commandsByCategory.get(category);
        if (!commands?.length) return null;

        // Get subcommands for this category's commands (if any)
        const subcommandEntries = commands
          .filter(cmd => SUBCOMMANDS[cmd.command])
          .flatMap(cmd =>
            Object.entries(SUBCOMMANDS[cmd.command]!).map(([sub, desc]) => ({
              command: `${cmd.command} ${sub}`,
              description: desc,
            }))
          );

        return (
          <React.Fragment key={category}>
            <Box marginTop={1}>
              <Text bold color="blue">{category}</Text>
            </Box>
            {/* Main commands */}
            {commands.map(cmd => (
              <Text key={cmd.command}>
                {'  '}<Text color="cyan">{cmd.command.padEnd(16)}</Text>
                <Text dimColor>{cmd.description}</Text>
              </Text>
            ))}
            {/* Subcommands (indented further) */}
            {subcommandEntries.map(sub => (
              <Text key={sub.command}>
                {'  '}<Text color="cyan">{sub.command.padEnd(16)}</Text>
                <Text dimColor>{sub.description}</Text>
              </Text>
            ))}
            {/* Static content for this category (e.g., file attachment tips) */}
            {STATIC_CONTENT[category]?.map((line, i) => (
              <Text key={`${category}-static-${i}`}>
                {'  '}<Text dimColor>{line}</Text>
              </Text>
            ))}
          </React.Fragment>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>Press Esc, Enter, or q to close</Text>
      </Box>
    </Box>
  );
};
