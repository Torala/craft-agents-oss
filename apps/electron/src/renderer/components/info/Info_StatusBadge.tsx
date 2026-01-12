/**
 * Info_StatusBadge
 *
 * Colored status text indicator for permission states.
 */

import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const statusBadgeVariants = cva(
  'inline-flex items-center gap-1.5 text-xs font-medium',
  {
    variants: {
      status: {
        allowed: 'text-success',
        blocked: 'text-destructive',
        'requires-permission': 'text-info',
      },
    },
    defaultVariants: {
      status: 'allowed',
    },
  }
)

const defaultLabels: Record<string, string> = {
  allowed: 'Allowed',
  blocked: 'Blocked',
  'requires-permission': 'Requires Permission',
}

export interface Info_StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  /** Override the default label */
  label?: string
}

export function Info_StatusBadge({
  status,
  label,
  className,
  ...props
}: Info_StatusBadgeProps) {
  const displayLabel = label ?? defaultLabels[status ?? 'allowed']

  return (
    <span
      className={cn(statusBadgeVariants({ status }), className)}
      {...props}
    >
      {displayLabel}
    </span>
  )
}
