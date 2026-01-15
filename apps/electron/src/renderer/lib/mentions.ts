/**
 * Utilities for parsing [bracket] mentions from chat messages
 *
 * Mention types:
 * - Skills:  [skill:slug]
 * - Sources: [source:slug]
 * - Folders: [dir:/path] or [dir:~/path]
 *
 * Bracket syntax allows mentions anywhere in text without word boundaries.
 */

import type { MentionItemType } from '@/components/ui/mention-menu'

// ============================================================================
// Types
// ============================================================================

export interface ParsedMentions {
  /** Skill slugs mentioned via @skill-slug */
  skills: string[]
  /** Source slugs mentioned via @src:slug */
  sources: string[]
  /** Folder paths mentioned via @dir:/path */
  folders: string[]
}

export interface MentionMatch {
  type: MentionItemType
  id: string
  /** Full match text including @ prefix */
  fullMatch: string
  /** Start index in the original text */
  startIndex: number
}

// ============================================================================
// Parsing Functions
// ============================================================================

/**
 * Parse all mentions from message text
 *
 * @param text - The message text to parse
 * @param availableSkillSlugs - Valid skill slugs to match against
 * @param availableSourceSlugs - Valid source slugs to match against
 * @returns Parsed mentions by type
 *
 * @example
 * parseMentions('[skill:commit] [source:linear] [dir:~/Projects/app]', ['commit'], ['linear'])
 * // Returns: { skills: ['commit'], sources: ['linear'], folders: ['~/Projects/app'] }
 */
export function parseMentions(
  text: string,
  availableSkillSlugs: string[],
  availableSourceSlugs: string[]
): ParsedMentions {
  const result: ParsedMentions = {
    skills: [],
    sources: [],
    folders: [],
  }

  // Match source mentions: [source:slug]
  const sourcePattern = /\[source:([\w-]+)\]/g
  let match
  while ((match = sourcePattern.exec(text)) !== null) {
    const slug = match[1]
    if (availableSourceSlugs.includes(slug) && !result.sources.includes(slug)) {
      result.sources.push(slug)
    }
  }

  // Match folder mentions: [dir:/path] or [dir:~/path]
  // Only absolute paths (/) and home-relative paths (~/) are valid
  const folderPattern = /\[dir:(~?\/[^\]]+)\]/g
  while ((match = folderPattern.exec(text)) !== null) {
    const path = match[1]
    if (!result.folders.includes(path)) {
      result.folders.push(path)
    }
  }

  // Match skill mentions: [skill:slug]
  const skillPattern = /\[skill:([\w-]+)\]/g
  while ((match = skillPattern.exec(text)) !== null) {
    const slug = match[1]
    if (availableSkillSlugs.includes(slug) && !result.skills.includes(slug)) {
      result.skills.push(slug)
    }
  }

  return result
}

/**
 * Find all mention matches in text with their positions
 *
 * @param text - The message text to search
 * @param availableSkillSlugs - Valid skill slugs
 * @param availableSourceSlugs - Valid source slugs
 * @returns Array of mention matches with positions
 */
export function findMentionMatches(
  text: string,
  availableSkillSlugs: string[],
  availableSourceSlugs: string[]
): MentionMatch[] {
  const matches: MentionMatch[] = []

  // Match source mentions: [source:slug]
  const sourcePattern = /(\[source:([\w-]+)\])/g
  let match
  while ((match = sourcePattern.exec(text)) !== null) {
    const slug = match[2]
    if (availableSourceSlugs.includes(slug)) {
      matches.push({
        type: 'source',
        id: slug,
        fullMatch: match[1],
        startIndex: match.index,
      })
    }
  }

  // Match folder mentions: [dir:/path] or [dir:~/path]
  const folderPattern = /(\[dir:(~?\/[^\]]+)\])/g
  while ((match = folderPattern.exec(text)) !== null) {
    const path = match[2]
    matches.push({
      type: 'folder',
      id: path,
      fullMatch: match[1],
      startIndex: match.index,
    })
  }

  // Match skill mentions: [skill:slug]
  const skillPattern = /(\[skill:([\w-]+)\])/g
  while ((match = skillPattern.exec(text)) !== null) {
    const slug = match[2]
    if (availableSkillSlugs.includes(slug)) {
      matches.push({
        type: 'skill',
        id: slug,
        fullMatch: match[1],
        startIndex: match.index,
      })
    }
  }

  // Sort by position
  return matches.sort((a, b) => a.startIndex - b.startIndex)
}

/**
 * Remove a specific mention from text
 *
 * @param text - The message text
 * @param type - Type of mention to remove
 * @param id - ID of the mention (slug or path)
 * @returns Text with the mention removed
 */
export function removeMention(text: string, type: MentionItemType, id: string): string {
  let pattern: RegExp

  switch (type) {
    case 'source':
      pattern = new RegExp(`\\[source:${escapeRegExp(id)}\\]`, 'g')
      break
    case 'folder':
      pattern = new RegExp(`\\[dir:${escapeRegExp(id)}\\]`, 'g')
      break
    case 'skill':
    default:
      pattern = new RegExp(`\\[skill:${escapeRegExp(id)}\\]`, 'g')
      break
  }

  return text
    .replace(pattern, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip all mentions from text
 *
 * @param text - The message text with mentions
 * @returns Text with all [bracket] mentions removed
 */
export function stripAllMentions(text: string): string {
  return text
    // Remove [source:slug]
    .replace(/\[source:[\w-]+\]/g, '')
    // Remove [dir:/path] or [dir:~/path]
    .replace(/\[dir:~?\/[^\]]+\]/g, '')
    // Remove [skill:slug]
    .replace(/\[skill:[\w-]+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Check if text contains any valid mentions
 */
export function hasMentions(
  text: string,
  availableSkillSlugs: string[],
  availableSourceSlugs: string[]
): boolean {
  const mentions = parseMentions(text, availableSkillSlugs, availableSourceSlugs)
  return mentions.skills.length > 0 ||
         mentions.sources.length > 0 ||
         mentions.folders.length > 0
}

// ============================================================================
// Legacy compatibility - parseSkillMentions
// ============================================================================

/**
 * Extract valid [skill:...] mentions from message text (legacy API)
 *
 * @deprecated Use parseMentions() instead
 */
export function parseSkillMentions(text: string, availableSlugs: string[]): string[] {
  return parseMentions(text, availableSlugs, []).skills
}

/**
 * Remove [bracket] mentions from message text (legacy API)
 *
 * @deprecated Use stripAllMentions() instead
 */
export function stripSkillMentions(text: string): string {
  return stripAllMentions(text)
}

// ============================================================================
// Helpers
// ============================================================================

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
