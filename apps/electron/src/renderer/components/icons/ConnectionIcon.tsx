/**
 * ConnectionIcon
 *
 * Displays the provider logo for an LLM connection.
 * Falls back to the first letter of the connection name if no icon is available.
 *
 * Used in:
 * - AI Settings (connections list)
 * - FreeFormInput (model display)
 * - Session List (connection badge)
 * - New Session (model selector group names)
 */

import { getProviderIcon } from '@/lib/provider-icons'
import type { LlmConnectionWithStatus } from '../../../shared/types'

interface ConnectionIconProps {
  /** The connection to display an icon for */
  connection: Pick<LlmConnectionWithStatus, 'name' | 'providerType' | 'baseUrl'> & { type?: string }
  /** Size in pixels (default: 16) */
  size?: number
  /** Additional CSS classes */
  className?: string
}

export function ConnectionIcon({ connection, size = 16, className = '' }: ConnectionIconProps) {
  const providerIcon = getProviderIcon(
    connection.providerType || connection.type || '',
    connection.baseUrl
  )

  if (providerIcon) {
    return (
      <img
        src={providerIcon}
        alt=""
        width={size}
        height={size}
        className={`rounded-[3px] flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
      />
    )
  }

  // Fallback: first letter of connection name
  const fontSize = Math.max(8, Math.round(size * 0.6))

  return (
    <div
      className={`rounded-[3px] bg-foreground/10 flex items-center justify-center flex-shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <span
        className="font-medium text-foreground/50"
        style={{ fontSize }}
      >
        {connection.name?.charAt(0).toUpperCase() || '?'}
      </span>
    </div>
  )
}
