/**
 * AutomationsListPanel
 *
 * Navigator panel for displaying automations in the 2nd column.
 * Follows the SourcesListPanel pattern with avatar, title, subtitle, badges.
 * Title and Plus button are handled by the shared PanelHeader in AppShell.
 *
 * Supports CMD/CTRL+click multi-select and Shift+click range select,
 * using the shared EntityRow + createEntitySelection infrastructure.
 */

import * as React from 'react'
import { useState, useCallback } from 'react'
import { Webhook } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import type { Locale } from 'date-fns'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty'
import { EntityRow } from '@/components/ui/entity-row'
import { SessionSearchHeader } from '@/components/app-shell/SessionSearchHeader'
import { AutomationMenu } from './AutomationMenu'
import { BatchAutomationMenu } from './BatchAutomationMenu'
import { AutomationAvatar } from './AutomationAvatar'
import { cn } from '@/lib/utils'
import { automationSelection } from '@/hooks/useEntitySelection'
import { APP_EVENTS, AGENT_EVENTS, getEventDisplayName, type AutomationListItem, type AutomationListFilter } from './types'

const {
  useSelection: useAutomationSelection,
} = automationSelection

/** Short relative time locale — produces compact strings: "7m", "2h", "3d" */
const shortTimeLocale: Pick<Locale, 'formatDistance'> = {
  formatDistance: (token: string, count: number) => {
    const units: Record<string, string> = {
      xSeconds: `${count}s`,
      xMinutes: `${count}m`,
      xHours: `${count}h`,
      xDays: `${count}d`,
      xWeeks: `${count}w`,
      xMonths: `${count}mo`,
      xYears: `${count}y`,
    }
    return units[token] || `${count}`
  },
}


// ============================================================================
// Automation Item
// ============================================================================

interface AutomationItemProps {
  automation: AutomationListItem
  isSelected: boolean
  isInMultiSelect: boolean
  isMultiSelectActive: boolean
  isFirst: boolean
  onClick: () => void
  onToggleSelect?: () => void
  onRangeSelect?: () => void
  onDelete: () => void
  onToggleEnabled: () => void
  onTest: () => void
  onDuplicate: () => void
}

function getActionTypeBadge(_automation: AutomationListItem): { label: string; classes: string } {
  return { label: 'Prompt', classes: 'bg-accent/10 text-accent' }
}

function AutomationItem({
  automation,
  isSelected,
  isInMultiSelect,
  isMultiSelectActive,
  isFirst,
  onClick,
  onToggleSelect,
  onRangeSelect,
  onDelete,
  onToggleEnabled,
  onTest,
  onDuplicate,
}: AutomationItemProps) {
  const actionBadge = getActionTypeBadge(automation)

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (e.button === 2) {
      // Right-click: auto-add to selection if multi-select active
      if (isMultiSelectActive && !isInMultiSelect && onToggleSelect) onToggleSelect()
      return
    }
    if ((e.metaKey || e.ctrlKey) && onToggleSelect) {
      e.preventDefault()
      onToggleSelect()
      return
    }
    if (e.shiftKey && onRangeSelect) {
      e.preventDefault()
      onRangeSelect()
      return
    }
    onClick()
  }, [isMultiSelectActive, isInMultiSelect, onToggleSelect, onRangeSelect, onClick])

  return (
    <EntityRow
      className={cn('automation-item', !automation.enabled && 'opacity-50')}
      showSeparator={!isFirst}
      separatorClassName="pl-10 pr-4"
      isSelected={isSelected}
      isInMultiSelect={isInMultiSelect}
      onMouseDown={handleClick}
      icon={<AutomationAvatar event={automation.event} size="sm" />}
      title={automation.name}
      badges={
        <>
          <span className={cn(
            'shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded',
            'bg-foreground/8 text-foreground/60'
          )}>
            {getEventDisplayName(automation.event)}
          </span>
          <span className={cn(
            'shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded',
            actionBadge.classes
          )}>
            {actionBadge.label}
          </span>
        </>
      }
      trailing={
        automation.lastExecutedAt ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 text-[11px] text-foreground/40 whitespace-nowrap cursor-default">
                {formatDistanceToNowStrict(new Date(automation.lastExecutedAt), { locale: shortTimeLocale as Locale, roundingMethod: 'floor' })}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={4}>
              Last ran {formatDistanceToNowStrict(new Date(automation.lastExecutedAt), { addSuffix: true })}
            </TooltipContent>
          </Tooltip>
        ) : undefined
      }
      menuContent={
        <AutomationMenu
          automationId={automation.id}
          automationName={automation.name}
          enabled={automation.enabled}
          onToggleEnabled={onToggleEnabled}
          onTest={onTest}
          onDuplicate={onDuplicate}
          onDelete={onDelete}
        />
      }
      contextMenuContent={isMultiSelectActive && isInMultiSelect ? <BatchAutomationMenu /> : undefined}
    />
  )
}

// ============================================================================
// AutomationsListPanel
// ============================================================================

export interface AutomationsListPanelProps {
  automations: AutomationListItem[]
  automationFilter?: AutomationListFilter | null
  onAutomationClick: (automationId: string) => void
  onDeleteAutomation?: (automationId: string) => void
  onToggleAutomation?: (automationId: string) => void
  onTestAutomation?: (automationId: string) => void
  onDuplicateAutomation?: (automationId: string) => void
  selectedAutomationId?: string | null
  className?: string
}

export function AutomationsListPanel({
  automations,
  automationFilter,
  onAutomationClick,
  onDeleteAutomation,
  onToggleAutomation,
  onTestAutomation,
  onDuplicateAutomation,
  selectedAutomationId,
  className,
}: AutomationsListPanelProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [searchActive, setSearchActive] = useState(false)

  const {
    select: selectAutomation,
    toggle: toggleAutomation,
    selectRange,
    isMultiSelectActive,
    isSelected: isInSelection,
  } = useAutomationSelection()

  const isSearchMode = searchActive && searchQuery.length >= 2

  // Filter automations based on sidebar-driven filter (from route)
  const categoryFiltered = React.useMemo(() => {
    const kind = automationFilter?.kind ?? 'all'
    if (kind === 'all') return automations
    if (kind === 'scheduled') return automations.filter(a => a.event === 'SchedulerTick')
    if (kind === 'app') return automations.filter(a => (APP_EVENTS as string[]).includes(a.event) && a.event !== 'SchedulerTick')
    if (kind === 'agent') return automations.filter(a => (AGENT_EVENTS as string[]).includes(a.event))
    return automations
  }, [automations, automationFilter?.kind])

  // Further filter by search query (name, summary, event display name)
  const searchFiltered = React.useMemo(() => {
    if (!isSearchMode) return categoryFiltered
    const q = searchQuery.toLowerCase()
    return categoryFiltered.filter(a =>
      a.name.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      getEventDisplayName(a.event).toLowerCase().includes(q)
    )
  }, [categoryFiltered, isSearchMode, searchQuery])

  // Sort: most recently executed first, never-run at the bottom
  const filteredAutomations = React.useMemo(() => {
    return [...searchFiltered].sort((a, b) => {
      if (!a.lastExecutedAt && !b.lastExecutedAt) return 0
      if (!a.lastExecutedAt) return 1
      if (!b.lastExecutedAt) return -1
      return new Date(b.lastExecutedAt).getTime() - new Date(a.lastExecutedAt).getTime()
    })
  }, [searchFiltered])

  const handleItemClick = useCallback((automationId: string, index: number) => {
    selectAutomation(automationId, index)
    onAutomationClick(automationId)
  }, [selectAutomation, onAutomationClick])

  const handleToggleSelect = useCallback((automationId: string, index: number) => {
    toggleAutomation(automationId, index)
  }, [toggleAutomation])

  const handleRangeSelect = useCallback((toIndex: number) => {
    const allIds = filteredAutomations.map(a => a.id)
    selectRange(toIndex, allIds)
  }, [filteredAutomations, selectRange])

  // Empty state
  if (automations.length === 0) {
    return (
      <div className={cn('flex flex-col flex-1 min-h-0', className)}>
        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Webhook />
            </EmptyMedia>
            <EmptyTitle>No automations configured</EmptyTitle>
            <EmptyDescription>
              Automations run actions when events occur — execute commands on schedules,
              react to label changes, or trigger prompts automatically.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col flex-1 min-h-0', className)}>
      {/* Search header */}
      {searchActive && (
        <SessionSearchHeader
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          onSearchClose={() => {
            setSearchActive(false)
            setSearchQuery('')
          }}
          placeholder="Search automations..."
          resultCount={isSearchMode ? filteredAutomations.length : undefined}
        />
      )}

      {/* Filtered empty state */}
      {filteredAutomations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1">
          <p className="text-sm text-muted-foreground">
            {isSearchMode ? 'No automations found' : 'No automations configured.'}
          </p>
          {isSearchMode && (
            <button
              onClick={() => setSearchQuery('')}
              className="text-xs text-foreground hover:underline"
            >
              Clear search
            </button>
          )}
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div className="pb-2">
            <div className="pt-1">
              {filteredAutomations.map((automation, index) => (
                <AutomationItem
                  key={automation.id}
                  automation={automation}
                  isSelected={selectedAutomationId === automation.id}
                  isInMultiSelect={isMultiSelectActive && isInSelection(automation.id)}
                  isMultiSelectActive={isMultiSelectActive}
                  isFirst={index === 0}
                  onClick={() => handleItemClick(automation.id, index)}
                  onToggleSelect={() => handleToggleSelect(automation.id, index)}
                  onRangeSelect={() => handleRangeSelect(index)}
                  onDelete={() => onDeleteAutomation?.(automation.id)}
                  onToggleEnabled={() => onToggleAutomation?.(automation.id)}
                  onTest={() => onTestAutomation?.(automation.id)}
                  onDuplicate={() => onDuplicateAutomation?.(automation.id)}
                />
              ))}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
