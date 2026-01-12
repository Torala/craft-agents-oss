/**
 * Info_Markdown
 *
 * Markdown content with consistent styling and heading detection.
 * Auto-adjusts top padding based on whether content starts with a heading.
 */

import * as React from 'react'
import { Markdown } from '@/components/markdown'
import { cn } from '@/lib/utils'

export interface Info_MarkdownProps {
  /** Markdown content */
  children: string
  /** Optional max height with scroll */
  maxHeight?: number
  /** Markdown rendering mode */
  mode?: 'minimal' | 'full'
  className?: string
}

export function Info_Markdown({
  children,
  maxHeight,
  mode = 'minimal',
  className,
}: Info_MarkdownProps) {
  // Detect if content starts with H1-H3 heading
  const startsWithHeading = children.trimStart().match(/^#{1,3}\s/)

  return (
    <div
      className={cn(
        'pl-[22px] pr-4 pb-3 text-sm',
        maxHeight && 'overflow-y-auto',
        startsWithHeading ? 'pt-0' : 'pt-1',
        className
      )}
      style={maxHeight ? { maxHeight } : undefined}
    >
      <Markdown mode={mode}>{children}</Markdown>
    </div>
  )
}
