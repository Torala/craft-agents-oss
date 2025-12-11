import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import type { CraftProfile } from './CraftCallbackStep';

// ============================================
// Space Selector Component
// ============================================

export interface CraftSpaceSelectorProps {
  profile: CraftProfile;
  onSelect: (spaceId: string, spaceName: string) => void;
  onBack: () => void;
}

interface Space {
  id: string;
  name: string;
}

interface SpaceCategory {
  title: string;
  spaces: Space[];
}

const MAX_OTHER_SPACES = 5;

export const CraftSpaceSelector: React.FC<CraftSpaceSelectorProps> = ({ profile, onSelect, onBack }) => {
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [showAllOther, setShowAllOther] = useState(false);

  // Categorize spaces based on profile data
  const categorizedSpaces = useMemo(() => {
    const { userId, teams, spaces } = profile;
    const categories: SpaceCategory[] = [];

    // Get IDs of private teams (user's own spaces)
    const privateTeamIds = new Set(
      teams.filter(t => t.isPrivate).map(t => t.id)
    );

    const recommended: Space[] = [];
    const yourSpaces: Space[] = [];
    const otherSpaces: Space[] = [];

    for (const space of spaces) {
      // Personal space = space.id matches userId
      if (space.id === userId) {
        recommended.push(space);
      } else if (privateTeamIds.has(space.id)) {
        // Any space from a private team goes to "Your Spaces"
        yourSpaces.push(space);
      } else {
        otherSpaces.push(space);
      }
    }

    if (recommended.length > 0) {
      categories.push({ title: 'Recommended', spaces: recommended });
    }
    if (yourSpaces.length > 0) {
      categories.push({
        title: 'Your Spaces',
        spaces: yourSpaces.sort((a, b) => a.name.localeCompare(b.name))
      });
    }
    if (otherSpaces.length > 0) {
      categories.push({
        title: 'Other Spaces',
        spaces: otherSpaces.sort((a, b) => a.name.localeCompare(b.name))
      });
    }

    return categories;
  }, [profile]);

  // Flatten visible spaces for navigation (respecting show more)
  const visibleSpaces = useMemo(() => {
    const result: { space: Space; categoryTitle: string; isShowMore?: boolean }[] = [];

    for (const category of categorizedSpaces) {
      const isOther = category.title === 'Other Spaces';
      const spacesToShow = (isOther && !showAllOther)
        ? category.spaces.slice(0, MAX_OTHER_SPACES)
        : category.spaces;

      for (const space of spacesToShow) {
        result.push({ space, categoryTitle: category.title });
      }

      // Add "Show more" option if needed
      if (isOther && category.spaces.length > MAX_OTHER_SPACES && !showAllOther) {
        result.push({
          space: { id: '__show_more__', name: `Show ${category.spaces.length - MAX_OTHER_SPACES} more...` },
          categoryTitle: category.title,
          isShowMore: true
        });
      }
    }

    return result;
  }, [categorizedSpaces, showAllOther]);

  // Handle keyboard input
  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }

    if (visibleSpaces.length === 0) return;

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < visibleSpaces.length - 1 ? prev + 1 : prev));
    } else if (key.return) {
      const selected = visibleSpaces[selectedIndex];
      if (selected) {
        if (selected.isShowMore) {
          // Expand the list
          setShowAllOther(true);
        } else {
          onSelect(selected.space.id, selected.space.name);
        }
      }
    }
  });

  let currentIndex = 0;

  return (
    <Box flexDirection="column">
      <Text dimColor>Choose the workspace to connect:</Text>
      <Box marginTop={1} />

      {categorizedSpaces.map((category) => {
        const isOther = category.title === 'Other Spaces';
        const spacesToShow = (isOther && !showAllOther)
          ? category.spaces.slice(0, MAX_OTHER_SPACES)
          : category.spaces;

        return (
          <Box key={category.title} flexDirection="column" marginBottom={1}>
            <Text dimColor>{category.title}</Text>
            {spacesToShow.map((space) => {
              const itemIndex = currentIndex++;
              const isSelected = selectedIndex === itemIndex;
              return (
                <Box key={space.id}>
                  <Text color={isSelected ? 'cyan' : undefined}>
                    {isSelected ? '› ' : '  '}
                  </Text>
                  <Text color={isSelected ? 'cyan' : 'white'} bold={isSelected}>
                    {space.name}
                  </Text>
                </Box>
              );
            })}
            {/* Show more option */}
            {isOther && category.spaces.length > MAX_OTHER_SPACES && !showAllOther && (() => {
              const showMoreIndex = currentIndex++;
              const isSelected = selectedIndex === showMoreIndex;
              return (
                <Box>
                  <Text color={isSelected ? 'cyan' : 'gray'}>
                    {isSelected ? '› ' : '  '}
                  </Text>
                  <Text color={isSelected ? 'cyan' : 'gray'} italic>
                    +{category.spaces.length - MAX_OTHER_SPACES} more...
                  </Text>
                </Box>
              );
            })()}
          </Box>
        );
      })}

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate • ↵ select • Esc back</Text>
      </Box>
    </Box>
  );
};

// ============================================
// MCP Link Selector Component
// ============================================

export interface McpLink {
  name: string;
  linkId: string;
  mcpUrl: string;
}

export interface McpLinkSelectorProps {
  spaceName: string;
  mcpLinks: McpLink[];
  onSelect: (mcpUrl: string) => void;
  onCreateNew: () => void;
  onBack: () => void;
}

export const McpLinkSelector: React.FC<McpLinkSelectorProps> = ({
  spaceName,
  mcpLinks,
  onSelect,
  onCreateNew,
  onBack,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const totalOptions = mcpLinks.length + 1; // +1 for "Create new" option

  useInput((input, key) => {
    if (key.escape) {
      onBack();
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : prev));
    } else if (key.downArrow) {
      setSelectedIndex((prev) => (prev < totalOptions - 1 ? prev + 1 : prev));
    } else if (key.return) {
      if (selectedIndex < mcpLinks.length) {
        const link = mcpLinks[selectedIndex];
        if (link) {
          onSelect(link.mcpUrl);
        }
      } else {
        onCreateNew();
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Text dimColor>
        Existing connections for <Text color="cyan">{spaceName}</Text>:
      </Text>

      <Box flexDirection="column" marginY={1}>
        {/* Existing MCP links */}
        {mcpLinks.map((link, index) => (
          <Box key={link.linkId}>
            <Text color={selectedIndex === index ? 'cyan' : undefined}>
              {selectedIndex === index ? '› ' : '  '}
            </Text>
            <Text color={selectedIndex === index ? 'cyan' : 'white'} bold={selectedIndex === index}>
              {link.name}
            </Text>
            <Text dimColor> (existing)</Text>
          </Box>
        ))}
        {/* Create new option */}
        <Box>
          <Text color={selectedIndex === mcpLinks.length ? 'cyan' : 'gray'}>
            {selectedIndex === mcpLinks.length ? '› ' : '  '}
          </Text>
          <Text color={selectedIndex === mcpLinks.length ? 'cyan' : 'gray'}>
            + Create new connection
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>↑↓ navigate • ↵ select • Esc back</Text>
      </Box>
    </Box>
  );
};
