/**
 * Info_Table
 *
 * Two-column key-value table with consistent styling.
 * Use for Connection info, metadata display, etc.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

export interface Info_TableProps {
  children: React.ReactNode
  /** Optional footer content (e.g., error alert) */
  footer?: React.ReactNode
  /** Label column width in pixels (default: 128) */
  labelWidth?: number
  className?: string
}

export interface Info_TableRowProps {
  /** Left column label */
  label: string
  /** Right column value (shorthand) */
  value?: React.ReactNode
  /** Right column content (for complex content, use instead of value) */
  children?: React.ReactNode
  className?: string
}

function Info_TableRoot({
  children,
  footer,
  labelWidth = 128,
  className,
}: Info_TableProps) {
  return (
    <div className={cn('py-2', className)}>
      <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
        <colgroup>
          <col style={{ width: labelWidth }} />
          <col />
        </colgroup>
        <tbody>{children}</tbody>
      </table>
      {footer}
    </div>
  )
}

function Info_TableRow({ label, value, children, className }: Info_TableRowProps) {
  const content = children ?? value

  return (
    <tr className={cn('border-b border-border/30 last:border-0', className)}>
      <td className="pl-[22px] pr-4 py-1.5 text-muted-foreground align-top">
        {label}
      </td>
      <td className="pr-4 py-1.5 align-top">{content}</td>
    </tr>
  )
}

export const Info_Table = Object.assign(Info_TableRoot, {
  Row: Info_TableRow,
})
