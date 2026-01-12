/**
 * Info_Section
 *
 * Section container with uppercase header and optional actions.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface Info_SectionProps {
  /** Section title (displayed uppercase) */
  title: string
  /** Optional right-aligned header actions */
  actions?: React.ReactNode
  /** Section content */
  children: React.ReactNode
  className?: string
}

export function Info_Section({
  title,
  actions,
  children,
  className,
}: Info_SectionProps) {
  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </h3>
        {actions}
      </div>
      <div className="bg-background shadow-minimal rounded-[8px] overflow-hidden">
        {children}
      </div>
    </div>
  )
}
