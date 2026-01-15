/**
 * Utilities for parsing @mentions from chat messages
 *
 * Mention types:
 * - Skills:  @skill-slug
 * - Sources: @src:source-slug
 * - Folders: @dir:/path/to/folder
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
 * parseMentions('@commit @src:linear @dir:~/Projects/app', ['commit'], ['linear'])
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

  // Match source mentions: @src:slug
  const sourcePattern = /(?:^|\s)@src:([\w-]+)/g
  let match
  while ((match = sourcePattern.exec(text)) !== null) {
    const slug = match[1]
    if (availableSourceSlugs.includes(slug) && !result.sources.includes(slug)) {
      result.sources.push(slug)
    }
  }

  // Match folder mentions: @dir:/path or @dir:~/path
  const folderPattern = /(?:^|\s)@dir:(~?\/[^\s]+)/g
  while ((match = folderPattern.exec(text)) !== null) {
    const path = match[1]
    if (!result.folders.includes(path)) {
      result.folders.push(path)
    }
  }

  // Match skill mentions: @slug (must be after source/folder to avoid conflicts)
  // Skill mentions are bare @slug that don't have src: or dir: prefix
  const skillPattern = /(?:^|\s)@([\w-]+)(?!\s*:)/g
  while ((match = skillPattern.exec(text)) !== null) {
    const slug = match[1]
    // Skip if it's "src" or "dir" (prefixes)
    if (slug === 'src' || slug === 'dir') continue
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

  // Match source mentions: @src:slug
  const sourcePattern = /(?:^|\s)(@src:([\w-]+))/g
  let match
  while ((match = sourcePattern.exec(text)) !== null) {
    const slug = match[2]
    if (availableSourceSlugs.includes(slug)) {
      matches.push({
        type: 'source',
        id: slug,
        fullMatch: match[1],
        startIndex: match.index + (match[0].length - match[1].length),
      })
    }
  }

  // Match folder mentions: @dir:/path
  const folderPattern = /(?:^|\s)(@dir:(~?\/[^\s]+))/g
  while ((match = folderPattern.exec(text)) !== null) {
    const path = match[2]
    matches.push({
      type: 'folder',
      id: path,
      fullMatch: match[1],
      startIndex: match.index + (match[0].length - match[1].length),
    })
  }

  // Match skill mentions: @slug
  const skillPattern = /(?:^|\s)(@([\w-]+))(?!\s*:)/g
  while ((match = skillPattern.exec(text)) !== null) {
    const slug = match[2]
    if (slug === 'src' || slug === 'dir') continue
    if (availableSkillSlugs.includes(slug)) {
      matches.push({
        type: 'skill',
        id: slug,
        fullMatch: match[1],
        startIndex: match.index + (match[0].length - match[1].length),
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
      pattern = new RegExp(`(^|\\s)@src:${escapeRegExp(id)}(?=\\s|$)`, 'g')
      break
    case 'folder':
      pattern = new RegExp(`(^|\\s)@dir:${escapeRegExp(id)}(?=\\s|$)`, 'g')
      break
    case 'skill':
    default:
      pattern = new RegExp(`(^|\\s)@${escapeRegExp(id)}(?=\\s|$)`, 'g')
      break
  }

  return text
    .replace(pattern, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Strip all mentions from text
 *
 * @param text - The message text with mentions
 * @returns Text with all @mentions removed
 */
export function stripAllMentions(text: string): string {
  return text
    // Remove @src:slug
    .replace(/(?:^|\s)@src:[\w-]+/g, ' ')
    // Remove @dir:/path
    .replace(/(?:^|\s)@dir:~?\/[^\s]+/g, ' ')
    // Remove @slug (but not email-like patterns)
    .replace(/(?:^|\s)@[\w-]+(?=\s|$)/g, ' ')
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
 * Extract valid @skill mentions from message text (legacy API)
 *
 * @deprecated Use parseMentions() instead
 */
export function parseSkillMentions(text: string, availableSlugs: string[]): string[] {
  return parseMentions(text, availableSlugs, []).skills
}

/**
 * Remove @mentions from message text (legacy API)
 *
 * @deprecated Use stripAllMentions() instead
 */
export function stripSkillMentions(text: string): string {
  return text
    .replace(/(?:^|\s)@[\w-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

// ============================================================================
// Helpers
// ============================================================================

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
