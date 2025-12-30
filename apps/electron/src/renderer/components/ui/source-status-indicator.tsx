/**
 * SourceStatusIndicator - Shows connection status for sources
 *
 * A small colored dot that indicates the source's connection status:
 * - Green: Connected/tested successfully
 * - Yellow: Requires authentication
 * - Red: Failed to connect
 * - Gray: Untested
 *
 * Hovering shows a tooltip with the status description.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { SourceConnectionStatus } from '../../../shared/types'

export interface SourceStatusIndicatorProps {
  /** Connection status */
  status?: SourceConnectionStatus
  /** Error message (shown in tooltip if status is 'failed') */
  errorMessage?: string
  /** Size variant */
  size?: 'xs' | 'sm' | 'md'
  /** Additional className */
  className?: string
}

// Status configurations
const STATUS_CONFIG: Record<SourceConnectionStatus, {
  color: string
  pulseColor: string
  label: string
  description: string
}> = {
  connected: {
    color: 'bg-green-500',
    pulseColor: 'bg-green-400',
    label: 'Connected',
    description: 'Source is connected and working',
  },
  needs_auth: {
    color: 'bg-amber-500',
    pulseColor: 'bg-amber-400',
    label: 'Needs Authentication',
    description: 'Source requires authentication to connect',
  },
  failed: {
    color: 'bg-red-500',
    pulseColor: 'bg-red-400',
    label: 'Connection Failed',
    description: 'Failed to connect to source',
  },
  untested: {
    color: 'bg-gray-400',
    pulseColor: 'bg-gray-300',
    label: 'Not Tested',
    description: 'Connection has not been tested',
  },
}

// Size configurations
const SIZE_CONFIG: Record<'xs' | 'sm' | 'md', string> = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
}

export function SourceStatusIndicator({
  status = 'untested',
  errorMessage,
  size = 'sm',
  className,
}: SourceStatusIndicatorProps) {
  const config = STATUS_CONFIG[status]
  const sizeClass = SIZE_CONFIG[size]

  // Build tooltip description
  const tooltipDescription = status === 'failed' && errorMessage
    ? `${config.description}: ${errorMessage}`
    : config.description

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'relative inline-flex shrink-0',
            className
          )}
        >
          {/* Pulse animation for connected status */}
          {status === 'connected' && (
            <span
              className={cn(
                'absolute inline-flex rounded-full opacity-75 animate-ping',
                config.pulseColor,
                sizeClass
              )}
              style={{ animationDuration: '2s' }}
            />
          )}
          {/* Status dot */}
          <span
            className={cn(
              'relative inline-flex rounded-full',
              config.color,
              sizeClass
            )}
          />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">{config.label}</span>
          <span className="text-foreground/60">{tooltipDescription}</span>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/**
 * Derive connection status from source config
 * This is a convenience function to determine status from existing fields
 */
export function deriveConnectionStatus(source: {
  config: {
    isAuthenticated?: boolean
    connectionStatus?: SourceConnectionStatus
    type?: string
    mcp?: { authType?: string }
    api?: { authType?: string }
  }
}): SourceConnectionStatus {
  // If explicit status is set, use it
  if (source.config.connectionStatus) {
    return source.config.connectionStatus
  }

  // Derive from auth state
  const mcp = source.config.mcp
  const api = source.config.api
  const requiresAuth = (mcp?.authType && mcp.authType !== 'none') ||
                       (api?.authType && api.authType !== 'none')

  if (requiresAuth && !source.config.isAuthenticated) {
    return 'needs_auth'
  }

  if (source.config.isAuthenticated) {
    return 'connected'
  }

  // Local sources are always connected
  if (source.config.type === 'local') {
    return 'connected'
  }

  return 'untested'
}
