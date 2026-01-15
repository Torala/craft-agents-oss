/**
 * Unified Icon Cache
 *
 * Shared cache for source and skill icons.
 * Used by SourceAvatar, SkillAvatar, and RichTextInput.
 *
 * Icons are stored as data URLs for consistent usage across:
 * - React components (img src)
 * - HTML string generation (inline badges)
 */

// ============================================================================
// Types
// ============================================================================

interface SourceConfig {
  slug: string
  name: string
  type: string
  iconUrl?: string
  provider?: string
  mcp?: {
    url?: string
  }
  api?: {
    baseUrl?: string
  }
}

interface SkillConfig {
  slug: string
  iconPath?: string
}

// ============================================================================
// Caches
// ============================================================================

/**
 * Cache for source icons
 * Key: `{workspaceId}:{slug}` or `{slug}` for logo URLs
 * Value: data URL or favicon URL
 */
export const sourceIconCache = new Map<string, string>()

/**
 * Cache for resolved logo URLs (from service URL resolution)
 * Key: `{serviceUrl}:{provider}`
 * Value: logo URL or null (if not found)
 */
export const logoUrlCache = new Map<string, string | null>()

/**
 * Cache for skill icons
 * Key: `{workspaceId}:{slug}`
 * Value: data URL
 */
export const skillIconCache = new Map<string, string>()

// ============================================================================
// Cache Management
// ============================================================================

/**
 * Clear all icon caches
 */
export function clearIconCaches(): void {
  sourceIconCache.clear()
  logoUrlCache.clear()
  skillIconCache.clear()
}

/**
 * Clear source icon caches only
 */
export function clearSourceIconCaches(): void {
  sourceIconCache.clear()
  logoUrlCache.clear()
}

/**
 * Clear skill icon caches only
 */
export function clearSkillIconCaches(): void {
  skillIconCache.clear()
}

// ============================================================================
// Source Icon Loading
// ============================================================================

/**
 * Load a source icon into the cache.
 * For local icons (./path), loads via IPC.
 * For remote sources, resolves favicon URL.
 *
 * @returns Promise resolving to the icon URL (data URL or favicon URL)
 */
export async function loadSourceIcon(
  source: { config: SourceConfig; workspaceId: string },
): Promise<string | null> {
  const { config, workspaceId } = source
  const cacheKey = `${workspaceId}:${config.slug}`

  // Check cache first
  const cached = sourceIconCache.get(cacheKey)
  if (cached) return cached

  // Check if iconUrl is a local path
  const iconUrl = config.iconUrl
  if (iconUrl?.startsWith('./')) {
    // Local icon - load via IPC
    const iconFilename = iconUrl.slice(2) // Remove './'
    const relativePath = `sources/${config.slug}/${iconFilename}`

    try {
      const result = await window.electronAPI.readWorkspaceImage(workspaceId, relativePath)
      // For SVG, convert to data URL
      let url = result
      if (relativePath.endsWith('.svg')) {
        url = `data:image/svg+xml;base64,${btoa(result)}`
      }
      sourceIconCache.set(cacheKey, url)
      return url
    } catch (error) {
      console.error(`[IconCache] Failed to load source icon ${relativePath}:`, error)
      return null
    }
  }

  // Remote source - resolve favicon URL
  const serviceUrl = deriveServiceUrl(config)
  if (!serviceUrl) return null

  // Use slug for favicon resolution - it's more specific than generic provider names
  const provider = config.slug ?? config.provider
  const logoCacheKey = `${serviceUrl}:${provider ?? ''}`

  // Check logo URL cache
  const cachedLogoUrl = logoUrlCache.get(logoCacheKey)
  if (cachedLogoUrl !== undefined) {
    if (cachedLogoUrl) {
      sourceIconCache.set(cacheKey, cachedLogoUrl)
    }
    return cachedLogoUrl
  }

  try {
    const logoUrl = await window.electronAPI.getLogoUrl(serviceUrl, provider)
    logoUrlCache.set(logoCacheKey, logoUrl)
    if (logoUrl) {
      sourceIconCache.set(cacheKey, logoUrl)
    }
    return logoUrl
  } catch (error) {
    console.error(`[IconCache] Failed to resolve logo URL:`, error)
    logoUrlCache.set(logoCacheKey, null)
    return null
  }
}

/**
 * Get a source icon synchronously from cache.
 * Returns null if not cached (use loadSourceIcon to populate).
 */
export function getSourceIconSync(workspaceId: string, slug: string): string | null {
  const cacheKey = `${workspaceId}:${slug}`
  return sourceIconCache.get(cacheKey) ?? null
}

// ============================================================================
// Skill Icon Loading
// ============================================================================

/**
 * Load a skill icon into the cache.
 *
 * @returns Promise resolving to the icon data URL
 */
export async function loadSkillIcon(
  skill: SkillConfig,
  workspaceId: string,
): Promise<string | null> {
  const iconPath = skill.iconPath
  if (!iconPath) return null

  const cacheKey = `${workspaceId}:${skill.slug}`

  // Check cache first
  const cached = skillIconCache.get(cacheKey)
  if (cached) return cached

  // Extract relative path from absolute icon path
  // iconPath is absolute, we need to get the skills/slug/icon.ext part
  const skillsMatch = iconPath.match(/skills\/([^/]+)\/(.+)$/)
  if (!skillsMatch) return null

  const relativePath = `skills/${skillsMatch[1]}/${skillsMatch[2]}`

  try {
    const result = await window.electronAPI.readWorkspaceImage(workspaceId, relativePath)
    // For SVG, convert to data URL
    let url = result
    if (relativePath.endsWith('.svg')) {
      url = `data:image/svg+xml;base64,${btoa(result)}`
    }
    skillIconCache.set(cacheKey, url)
    return url
  } catch (error) {
    console.error(`[IconCache] Failed to load skill icon ${relativePath}:`, error)
    return null
  }
}

/**
 * Get a skill icon synchronously from cache.
 * Returns null if not cached (use loadSkillIcon to populate).
 */
export function getSkillIconSync(workspaceId: string, slug: string): string | null {
  const cacheKey = `${workspaceId}:${slug}`
  return skillIconCache.get(cacheKey) ?? null
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Derive service URL from source config (for favicon resolution)
 */
function deriveServiceUrl(config: SourceConfig): string | null {
  // MCP sources - use mcp.url
  if (config.type === 'mcp' && config.mcp?.url) {
    return config.mcp.url
  }

  // API sources - use api.baseUrl
  if (config.type === 'api' && config.api?.baseUrl) {
    return config.api.baseUrl
  }

  return null
}
