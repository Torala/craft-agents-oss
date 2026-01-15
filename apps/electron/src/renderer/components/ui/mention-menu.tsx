import * as React from 'react'
import { Icon_Folder } from '@craft-agent/ui'
import { cn } from '@/lib/utils'
import { SkillAvatar } from '@/components/ui/skill-avatar'
import { SourceAvatar } from '@/components/ui/source-avatar'
import type { LoadedSkill, LoadedSource } from '../../../shared/types'

// ============================================================================
// Types
// ============================================================================

export type MentionItemType = 'skill' | 'source' | 'folder'

export interface MentionItem {
  id: string
  type: MentionItemType
  label: string
  description?: string
  // Type-specific data
  skill?: LoadedSkill
  source?: LoadedSource
  path?: string
}

export interface MentionSection {
  id: string
  label: string
  items: MentionItem[]
}

export interface InlineMentionMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sections: MentionSection[]
  onSelect: (item: MentionItem) => void
  filter?: string
  position: { x: number; y: number }
  workspaceId?: string
  maxWidth?: number
  className?: string
}

// ============================================================================
// Shared Styles
// ============================================================================

const MENU_CONTAINER_STYLE = 'overflow-hidden rounded-[8px] bg-background text-foreground shadow-modal-small'
const MENU_LIST_STYLE = 'max-h-[300px] overflow-y-auto py-1'
const MENU_ITEM_STYLE = 'flex cursor-pointer select-none items-center gap-3 rounded-[6px] mx-1 px-2 py-1.5 text-[13px]'
const MENU_ITEM_SELECTED = 'bg-foreground/5'
const MENU_SECTION_HEADER = 'px-3 py-1.5 text-[10px] font-medium text-muted-foreground uppercase tracking-wider'

// ============================================================================
// Filter utilities
// ============================================================================

function filterSections(sections: MentionSection[], filter: string): MentionSection[] {
  if (!filter) return sections
  const lowerFilter = filter.toLowerCase()
  return sections
    .map(section => ({
      ...section,
      items: section.items.filter(item =>
        item.label.toLowerCase().includes(lowerFilter) ||
        item.id.toLowerCase().includes(lowerFilter) ||
        item.description?.toLowerCase().includes(lowerFilter)
      ),
    }))
    .filter(section => section.items.length > 0)
}

function flattenItems(sections: MentionSection[]): MentionItem[] {
  return sections.flatMap(section => section.items)
}

// ============================================================================
// InlineMentionMenu Component
// ============================================================================

export function InlineMentionMenu({
  open,
  onOpenChange,
  sections,
  onSelect,
  filter = '',
  position,
  workspaceId,
  maxWidth = 280,
  className,
}: InlineMentionMenuProps) {
  const menuRef = React.useRef<HTMLDivElement>(null)
  const [selectedIndex, setSelectedIndex] = React.useState(0)
  const filteredSections = filterSections(sections, filter)
  const flatItems = flattenItems(filteredSections)

  // Reset selection when filter changes
  React.useEffect(() => {
    setSelectedIndex(0)
  }, [filter])

  // Keyboard navigation
  React.useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedIndex(prev => (prev < flatItems.length - 1 ? prev + 1 : 0))
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedIndex(prev => (prev > 0 ? prev - 1 : flatItems.length - 1))
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (flatItems[selectedIndex]) {
            onSelect(flatItems[selectedIndex])
            onOpenChange(false)
          }
          break
        case 'Escape':
          e.preventDefault()
          onOpenChange(false)
          break
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, flatItems, selectedIndex, onSelect, onOpenChange])

  // Close on click outside
  React.useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open, onOpenChange])

  // Hide if no results or not open
  if (!open || flatItems.length === 0) return null

  // Calculate bottom position from window height (menu appears above cursor)
  const bottomPosition = typeof window !== 'undefined'
    ? window.innerHeight - Math.round(position.y) + 8
    : 0

  // Track current item index across all sections
  let currentItemIndex = 0

  return (
    <div
      ref={menuRef}
      className={cn('fixed z-50', MENU_CONTAINER_STYLE, className)}
      style={{
        left: Math.round(position.x) - 10,
        bottom: bottomPosition,
        width: maxWidth,
        maxWidth,
      }}
    >
      <div className={MENU_LIST_STYLE}>
        {filteredSections.map((section, sectionIndex) => (
          <React.Fragment key={section.id}>
            {/* Section header */}
            <div className={MENU_SECTION_HEADER}>
              {section.label}
            </div>

            {/* Section items */}
            {section.items.map((item) => {
              const itemIndex = currentItemIndex++
              const isSelected = itemIndex === selectedIndex

              return (
                <div
                  key={`${section.id}-${item.id}`}
                  onClick={() => {
                    onSelect(item)
                    onOpenChange(false)
                  }}
                  onMouseEnter={() => setSelectedIndex(itemIndex)}
                  className={cn(
                    MENU_ITEM_STYLE,
                    isSelected && MENU_ITEM_SELECTED
                  )}
                >
                  {/* Icon based on type */}
                  <div className="shrink-0">
                    {item.type === 'skill' && item.skill && (
                      <SkillAvatar skill={item.skill} size="sm" workspaceId={workspaceId} />
                    )}
                    {item.type === 'source' && item.source && (
                      <SourceAvatar source={item.source} size="sm" />
                    )}
                    {item.type === 'folder' && (
                      <div className="h-5 w-5 rounded-[4px] bg-foreground/5 flex items-center justify-center">
                        <Icon_Folder className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.75} />
                      </div>
                    )}
                  </div>

                  {/* Label and description */}
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{item.label}</div>
                    {item.description && (
                      <div className="text-[11px] text-foreground/50 truncate">
                        {item.description}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Separator between sections (not after last) */}
            {sectionIndex < filteredSections.length - 1 && (
              <div className="h-px bg-border/50 my-1 mx-2" />
            )}
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}

// ============================================================================
// Hook for managing inline mention state
// ============================================================================

/** Interface for elements that can be used with useInlineMention */
export interface MentionInputElement {
  getBoundingClientRect: () => DOMRect
  value: string
  selectionStart: number
}

export interface UseInlineMentionOptions {
  /** Ref to input element (textarea or RichTextInput handle) */
  inputRef: React.RefObject<MentionInputElement | null>
  skills: LoadedSkill[]
  sources: LoadedSource[]
  recentFolders: string[]
  homeDir?: string
  onSelect: (item: MentionItem) => void
}

export interface UseInlineMentionReturn {
  isOpen: boolean
  filter: string
  position: { x: number; y: number }
  sections: MentionSection[]
  handleInputChange: (value: string, cursorPosition: number) => void
  close: () => void
  handleSelect: (item: MentionItem) => string
}

/**
 * Format path for display, shortening home directory
 */
function formatPathForDisplay(path: string, homeDir?: string): string {
  if (homeDir && path.startsWith(homeDir)) {
    return '~' + path.slice(homeDir.length)
  }
  return path
}

/**
 * Get folder name from path
 */
function getFolderName(path: string): string {
  return path.split('/').pop() || path
}

export function useInlineMention({
  inputRef,
  skills,
  sources,
  recentFolders,
  homeDir,
  onSelect,
}: UseInlineMentionOptions): UseInlineMentionReturn {
  const [isOpen, setIsOpen] = React.useState(false)
  const [filter, setFilter] = React.useState('')
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const [atStart, setAtStart] = React.useState(-1)
  // Store current input state for handleSelect
  const currentInputRef = React.useRef({ value: '', cursorPosition: 0 })

  // Build sections from available data
  const sections = React.useMemo((): MentionSection[] => {
    const result: MentionSection[] = []

    // Skills section
    if (skills.length > 0) {
      result.push({
        id: 'skills',
        label: 'Skills',
        items: skills.map(skill => ({
          id: skill.slug,
          type: 'skill' as const,
          label: skill.metadata.name,
          description: skill.metadata.description,
          skill,
        })),
      })
    }

    // Sources section (only show sources that need enabling or have tools)
    if (sources.length > 0) {
      result.push({
        id: 'sources',
        label: 'Sources',
        items: sources.map(source => ({
          id: source.config.slug,
          type: 'source' as const,
          label: source.config.name,
          description: source.config.tagline,
          source,
        })),
      })
    }

    // Recent folders section
    if (recentFolders.length > 0) {
      result.push({
        id: 'folders',
        label: 'Recent Folders',
        items: recentFolders.slice(0, 4).map(path => ({
          id: path,
          type: 'folder' as const,
          label: getFolderName(path),
          description: formatPathForDisplay(path, homeDir),
          path,
        })),
      })
    }

    return result
  }, [skills, sources, recentFolders, homeDir])

  const handleInputChange = React.useCallback((value: string, cursorPosition: number) => {
    // Store current state for handleSelect
    currentInputRef.current = { value, cursorPosition }

    const textBeforeCursor = value.slice(0, cursorPosition)
    // Match @ at start of text or after whitespace, followed by optional word chars, hyphens, and slashes
    const atMatch = textBeforeCursor.match(/(?:^|\s)@([\w\-/]*)$/)

    // Only show menu if we have at least one section with items
    const hasItems = sections.some(s => s.items.length > 0)

    if (atMatch && hasItems) {
      const matchStart = textBeforeCursor.lastIndexOf('@')
      setAtStart(matchStart)
      setFilter(atMatch[1] || '')

      if (inputRef.current) {
        const rect = inputRef.current.getBoundingClientRect()

        // For position calculation, use a simplified approach:
        // Position menu at bottom-left of input, with slight offset for the @ position
        // A more accurate position would require measuring text, but this works well enough
        const lineHeight = 20 // Approximate line height
        const charWidth = 8 // Approximate character width
        const linesBeforeCursor = textBeforeCursor.split('\n').length - 1
        const charsOnCurrentLine = textBeforeCursor.split('\n').pop()?.length || 0

        setPosition({
          x: rect.left + Math.min(charsOnCurrentLine * charWidth, rect.width - 100),
          y: rect.top + (linesBeforeCursor + 1) * lineHeight,
        })
      }

      setIsOpen(true)
    } else {
      setIsOpen(false)
      setFilter('')
      setAtStart(-1)
    }
  }, [inputRef, sections])

  const handleSelect = React.useCallback((item: MentionItem): string => {
    let result = ''
    if (atStart >= 0) {
      const { value: currentValue, cursorPosition } = currentInputRef.current
      const before = currentValue.slice(0, atStart)
      const after = currentValue.slice(cursorPosition)

      // Build the mention text based on type
      let mentionText: string
      if (item.type === 'skill') {
        mentionText = `@${item.id} `
      } else if (item.type === 'source') {
        mentionText = `@src:${item.id} `
      } else if (item.type === 'folder') {
        mentionText = `@dir:${item.path} `
      } else {
        mentionText = `@${item.id} `
      }

      result = before + mentionText + after
    }

    onSelect(item)
    setIsOpen(false)

    return result
  }, [onSelect, atStart])

  const close = React.useCallback(() => {
    setIsOpen(false)
    setFilter('')
    setAtStart(-1)
  }, [])

  return {
    isOpen,
    filter,
    position,
    sections,
    handleInputChange,
    close,
    handleSelect,
  }
}
