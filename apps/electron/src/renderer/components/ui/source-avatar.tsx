/**
 * SourceAvatar - Avatar component for sources
 *
 * Provides consistent styling for source icons.
 * Uses CrossfadeAvatar internally for smooth image loading with fallback support.
 *
 * Size variants:
 * - xs: 14x14 (inline)
 * - sm: 16x16 (dropdowns, sidebar)
 * - md: 20x20 (auth steps)
 * - lg: 24x24 (info panels)
 */

import * as React from 'react'
import { CrossfadeAvatar } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { Globe, Folder, Plug } from 'lucide-react'
import { McpIcon } from '@/components/icons/McpIcon'
import { getLogoUrl } from '@craft-agent/shared/utils/logo'
import type { LoadedSource } from '../../../shared/types'
import type { SourceType } from '@craft-agent/shared/sources'

export type SourceAvatarSize = 'xs' | 'sm' | 'md' | 'lg'

interface SourceAvatarProps {
  /** Source to display */
  source: LoadedSource
  /** Size variant */
  size?: SourceAvatarSize
  /** Additional className overrides */
  className?: string
}

// Size configurations
const SIZE_CONFIG: Record<SourceAvatarSize, { container: string; icon: string }> = {
  xs: { container: 'h-3.5 w-3.5', icon: 'h-2 w-2' },
  sm: { container: 'h-4 w-4', icon: 'h-2 w-2' },
  md: { container: 'h-5 w-5', icon: 'h-2.5 w-2.5' },
  lg: { container: 'h-6 w-6', icon: 'h-3.5 w-3.5' },
}

// Fallback icons by source type
const FALLBACK_ICONS: Record<SourceType, React.ComponentType<{ className?: string }>> = {
  mcp: McpIcon,
  api: Globe,
  local: Folder,
}

/**
 * Get the service URL for a source (for logo derivation)
 */
function getSourceServiceUrl(source: LoadedSource): string | null {
  const { config } = source
  if (config.mcp?.url) return config.mcp.url
  if (config.api?.baseUrl) return config.api.baseUrl
  if (config.local?.websiteUrl) return config.local.websiteUrl
  return null
}

export function SourceAvatar({
  source,
  size = 'md',
  className,
}: SourceAvatarProps) {
  // Resolve logo URL from source's service URL, or use custom icon if available
  const serviceUrl = getSourceServiceUrl(source)
  const logoUrl = source.iconPath ?? (serviceUrl ? getLogoUrl(serviceUrl) : null)

  const sizeConfig = SIZE_CONFIG[size]
  const FallbackIcon = FALLBACK_ICONS[source.config.type] ?? Plug

  return (
    <CrossfadeAvatar
      src={logoUrl}
      alt={source.config.name}
      className={cn(
        sizeConfig.container,
        'rounded-[4px] ring-1 ring-border/30 shrink-0',
        className
      )}
      fallbackClassName="bg-muted"
      fallback={<FallbackIcon className={cn(sizeConfig.icon, 'text-muted-foreground')} />}
    />
  )
}
