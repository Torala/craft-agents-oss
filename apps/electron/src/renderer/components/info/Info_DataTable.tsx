/**
 * Info_DataTable
 *
 * Multi-column table for structured data like permissions.
 * Compound component with Header, Column, Body, Row, Cell subcomponents.
 */

import * as React from 'react'
import { cn } from '@/lib/utils'

// Context for column widths
const DataTableContext = React.createContext<{ columnWidths: number[] }>({
  columnWidths: [],
})

export interface Info_DataTableProps {
  children: React.ReactNode
  className?: string
}

export interface Info_DataTableHeaderProps {
  children: React.ReactNode
}

export interface Info_DataTableColumnProps {
  children: React.ReactNode
  /** Column width in pixels (optional, defaults to auto) */
  width?: number
}

export interface Info_DataTableBodyProps {
  children: React.ReactNode
}

export interface Info_DataTableRowProps {
  children: React.ReactNode
  className?: string
}

export interface Info_DataTableCellProps {
  children: React.ReactNode
  /** Use muted styling for secondary text */
  muted?: boolean
  className?: string
}

function Info_DataTableRoot({ children, className }: Info_DataTableProps) {
  // Extract column widths from Header children
  const [columnWidths, setColumnWidths] = React.useState<number[]>([])

  // Find Header and extract widths
  React.useEffect(() => {
    const widths: number[] = []
    React.Children.forEach(children, (child) => {
      if (React.isValidElement(child) && child.type === Info_DataTableHeader) {
        const headerChild = child as React.ReactElement<Info_DataTableHeaderProps>
        React.Children.forEach(headerChild.props.children, (col) => {
          if (React.isValidElement(col) && col.type === Info_DataTableColumn) {
            const columnChild = col as React.ReactElement<Info_DataTableColumnProps>
            widths.push(columnChild.props.width ?? 0)
          }
        })
      }
    })
    setColumnWidths(widths)
  }, [children])

  return (
    <DataTableContext.Provider value={{ columnWidths }}>
      <div className={cn('py-2', className)}>
        <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
          {columnWidths.length > 0 && (
            <colgroup>
              {columnWidths.map((width, i) => (
                <col key={i} style={width ? { width } : undefined} />
              ))}
            </colgroup>
          )}
          {children}
        </table>
      </div>
    </DataTableContext.Provider>
  )
}

function Info_DataTableHeader({ children }: Info_DataTableHeaderProps) {
  return (
    <thead className="border-b border-border/30">
      <tr>
        {React.Children.map(children, (child, index) => {
          if (React.isValidElement(child) && child.type === Info_DataTableColumn) {
            return React.cloneElement(child as React.ReactElement<{ _index?: number }>, {
              _index: index,
            })
          }
          return child
        })}
      </tr>
    </thead>
  )
}

function Info_DataTableColumn({
  children,
  width: _width,
  _index,
}: Info_DataTableColumnProps & { _index?: number }) {
  const isFirst = _index === 0

  return (
    <th
      className={cn(
        'py-2 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide',
        isFirst ? 'pl-[22px] pr-4' : 'px-4'
      )}
    >
      {children}
    </th>
  )
}

function Info_DataTableBody({ children }: Info_DataTableBodyProps) {
  return <tbody>{children}</tbody>
}

function Info_DataTableRow({ children, className }: Info_DataTableRowProps) {
  return (
    <tr className={cn('border-b border-border/30 last:border-0', className)}>
      {React.Children.map(children, (child, index) => {
        if (React.isValidElement(child) && child.type === Info_DataTableCell) {
          return React.cloneElement(child as React.ReactElement<{ _index?: number }>, {
            _index: index,
          })
        }
        return child
      })}
    </tr>
  )
}

function Info_DataTableCell({
  children,
  muted,
  className,
  _index,
}: Info_DataTableCellProps & { _index?: number }) {
  const isFirst = _index === 0

  return (
    <td
      className={cn(
        'py-2 align-top',
        isFirst ? 'pl-[22px] pr-4' : 'px-4',
        muted && 'text-muted-foreground text-xs',
        className
      )}
    >
      {children}
    </td>
  )
}

export const Info_DataTable = Object.assign(Info_DataTableRoot, {
  Header: Info_DataTableHeader,
  Column: Info_DataTableColumn,
  Body: Info_DataTableBody,
  Row: Info_DataTableRow,
  Cell: Info_DataTableCell,
})
