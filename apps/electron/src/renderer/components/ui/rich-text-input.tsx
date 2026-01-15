import * as React from 'react'
import { cn } from '@/lib/utils'
import { findMentionMatches, type MentionMatch } from '@/lib/mentions'
import type { LoadedSkill, LoadedSource } from '../../../shared/types'
import type { MentionItemType } from './mention-menu'

// ============================================================================
// Types
// ============================================================================

export interface RichTextInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange' | 'onInput' | 'onPaste'> {
  /** Current text value */
  value: string
  /** Called when text changes */
  onChange: (value: string) => void
  /** Placeholder text when empty */
  placeholder?: string
  /** Available skills for mention parsing */
  skills?: LoadedSkill[]
  /** Available sources for mention parsing */
  sources?: LoadedSource[]
  /** Workspace ID for avatars */
  workspaceId?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** Called when input changes (provides value and cursor position for mention detection) */
  onInput?: (value: string, cursorPosition: number) => void
  /** Called on paste */
  onPaste?: (e: React.ClipboardEvent) => void
}

export interface RichTextInputHandle {
  focus: () => void
  blur: () => void
  /** The text value */
  value: string
  /** Selection start position in text model */
  selectionStart: number
  /** Set the text value */
  setValue: (value: string) => void
  /** Set selection range */
  setSelectionRange: (start: number, end: number) => void
  /** Get bounding rect for position calculations */
  getBoundingClientRect: () => DOMRect
  /** The underlying div element */
  element: HTMLDivElement | null
}

// ============================================================================
// InlineMentionBadge - Compact badge for inline display (static HTML version)
// ============================================================================

// SVG icons as HTML strings (avoiding react-dom/server which doesn't work in browser)
const FOLDER_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/></svg>`

const SKILL_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/></svg>`

const SOURCE_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/></svg>`

function renderBadgeHTML(
  type: MentionItemType,
  label: string,
  _skill?: LoadedSkill,
  _source?: LoadedSource,
  _workspaceId?: string
): string {
  // Render icon based on type using plain HTML strings
  let iconHtml = ''
  if (type === 'skill') {
    iconHtml = `<span class="h-3.5 w-3.5 rounded-[3px] bg-foreground/5 flex items-center justify-center text-foreground/50">${SKILL_ICON_SVG}</span>`
  } else if (type === 'source') {
    iconHtml = `<span class="h-3.5 w-3.5 rounded-[3px] bg-foreground/5 flex items-center justify-center text-foreground/50">${SOURCE_ICON_SVG}</span>`
  } else if (type === 'folder') {
    iconHtml = `<span class="h-3.5 w-3.5 rounded-[3px] bg-foreground/5 flex items-center justify-center text-foreground/50">${FOLDER_ICON_SVG}</span>`
  }

  const escapedLabel = label.replace(/</g, '&lt;').replace(/>/g, '&gt;')

  return `<span contenteditable="false" data-mention="true" class="inline-flex items-center gap-1 h-5 px-1.5 mx-0.5 rounded-[4px] bg-background shadow-minimal text-[12px] text-foreground align-baseline select-none">${iconHtml}<span class="truncate max-w-[80px]">${escapedLabel}</span></span>`
}

// ============================================================================
// Helper: Extract plain text from contenteditable
// ============================================================================

function getTextFromElement(element: HTMLElement): string {
  let text = ''

  function processNode(node: Node) {
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent || ''
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement

      // Skip mention badges - they shouldn't contribute additional text
      if (el.getAttribute('data-mention') === 'true') {
        // Get the mention text from data attribute
        const mentionText = el.getAttribute('data-mention-text')
        if (mentionText) {
          text += mentionText
        }
        return // Don't process children
      }

      // Handle line breaks
      if (el.tagName === 'BR') {
        text += '\n'
      } else if (el.tagName === 'DIV' && text.length > 0 && !text.endsWith('\n')) {
        // New divs in contenteditable act as line breaks
        text += '\n'
      }

      // Process children
      Array.from(el.childNodes).forEach(child => {
        processNode(child)
      })
    }
  }

  Array.from(element.childNodes).forEach(child => {
    processNode(child)
  })

  return text
}

// ============================================================================
// Helper: Get cursor position in text model
// ============================================================================

function getCursorPosition(element: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0

  const range = selection.getRangeAt(0)

  // Create a range from start of element to cursor
  const preRange = document.createRange()
  preRange.selectNodeContents(element)
  preRange.setEnd(range.startContainer, range.startOffset)

  // Get text length before cursor, excluding badge content
  const fragment = preRange.cloneContents()
  const div = document.createElement('div')
  div.appendChild(fragment)
  return getTextFromElement(div).length
}

// ============================================================================
// Helper: Set cursor position in contenteditable
// ============================================================================

function setCursorPosition(element: HTMLElement, targetPosition: number): void {
  const selection = window.getSelection()
  if (!selection) return

  let currentPos = 0

  function findPosition(node: Node): { node: Node; offset: number } | null {
    if (node.nodeType === Node.TEXT_NODE) {
      const nodeLength = node.textContent?.length || 0
      if (currentPos + nodeLength >= targetPosition) {
        return { node, offset: targetPosition - currentPos }
      }
      currentPos += nodeLength
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement

      // Skip mention badge internals - treat as atomic
      if (el.getAttribute('data-mention') === 'true') {
        const mentionText = el.getAttribute('data-mention-text') || ''
        const mentionLength = mentionText.length
        if (currentPos + mentionLength >= targetPosition) {
          // Position cursor after the badge
          return { node: el.parentNode!, offset: Array.from(el.parentNode!.childNodes).indexOf(el) + 1 }
        }
        currentPos += mentionLength
        return null
      }

      // Handle BR
      if (el.tagName === 'BR') {
        currentPos += 1
        if (currentPos >= targetPosition) {
          return { node: el.parentNode!, offset: Array.from(el.parentNode!.childNodes).indexOf(el) + 1 }
        }
        return null
      }

      for (let i = 0; i < el.childNodes.length; i++) {
        const result = findPosition(el.childNodes[i])
        if (result) return result
      }
    }
    return null
  }

  const result = findPosition(element)

  if (result) {
    const range = document.createRange()
    range.setStart(result.node, result.offset)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  } else {
    // Position at end
    const range = document.createRange()
    range.selectNodeContents(element)
    range.collapse(false)
    selection.removeAllRanges()
    selection.addRange(range)
  }
}

// ============================================================================
// Convert text with mentions to HTML
// ============================================================================

function textToHTML(
  text: string,
  skills: LoadedSkill[],
  sources: LoadedSource[],
  workspaceId?: string
): string {
  if (!text) return ''

  const skillSlugs = skills.map(s => s.slug)
  const sourceSlugs = sources.map(s => s.config.slug)
  const matches = findMentionMatches(text, skillSlugs, sourceSlugs)

  // Escape HTML in text
  const escapeHTML = (str: string) => str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>')

  if (matches.length === 0) {
    return escapeHTML(text)
  }

  let html = ''
  let lastIndex = 0

  for (const match of matches) {
    // Add escaped text before this mention
    if (match.startIndex > lastIndex) {
      html += escapeHTML(text.slice(lastIndex, match.startIndex))
    }

    // Determine label and data for badge
    let label = match.id
    let skill: LoadedSkill | undefined
    let source: LoadedSource | undefined

    if (match.type === 'skill') {
      skill = skills.find(s => s.slug === match.id)
      label = skill?.metadata.name || match.id
    } else if (match.type === 'source') {
      source = sources.find(s => s.config.slug === match.id)
      label = source?.config.name || match.id
    } else if (match.type === 'folder') {
      label = match.id.split('/').pop() || match.id
    }

    // Render badge with data-mention-text storing the original text
    const badgeHtml = renderBadgeHTML(match.type, label, skill, source, workspaceId)
    // Add data-mention-text attribute to store original text for extraction
    const withMentionText = badgeHtml.replace(
      'data-mention="true"',
      `data-mention="true" data-mention-text="${match.fullMatch.replace(/"/g, '&quot;')}"`
    )
    html += withMentionText

    lastIndex = match.startIndex + match.fullMatch.length
  }

  // Add remaining text after last mention
  if (lastIndex < text.length) {
    html += escapeHTML(text.slice(lastIndex))
  }

  return html
}

// ============================================================================
// Check if mentions have changed (for determining if we need to re-render HTML)
// ============================================================================

function getMentionSignature(text: string, skillSlugs: string[], sourceSlugs: string[]): string {
  const matches = findMentionMatches(text, skillSlugs, sourceSlugs)
  return matches.map(m => `${m.type}:${m.id}:${m.startIndex}`).join('|')
}

// ============================================================================
// RichTextInput Component
// ============================================================================

export const RichTextInput = React.forwardRef<RichTextInputHandle, RichTextInputProps>(
  function RichTextInput(
    {
      value,
      onChange,
      placeholder = 'Type a message...',
      skills = [],
      sources = [],
      workspaceId,
      disabled = false,
      className,
      onFocus,
      onBlur,
      onKeyDown,
      onInput,
      onPaste,
      ...restProps
    },
    forwardedRef
  ) {
    const divRef = React.useRef<HTMLDivElement>(null)
    const [isFocused, setIsFocused] = React.useState(false)
    const isComposing = React.useRef(false)
    const lastValueRef = React.useRef(value)
    const cursorPositionRef = React.useRef(0)
    const lastMentionSignatureRef = React.useRef('')
    const isInternalUpdate = React.useRef(false)

    const skillSlugs = React.useMemo(() => skills.map(s => s.slug), [skills])
    const sourceSlugs = React.useMemo(() => sources.map(s => s.config.slug), [sources])

    // Expose imperative handle
    React.useImperativeHandle(forwardedRef, () => ({
      focus: () => divRef.current?.focus(),
      blur: () => divRef.current?.blur(),
      get value() { return lastValueRef.current },
      get selectionStart() { return cursorPositionRef.current },
      setValue: (newValue: string) => {
        lastValueRef.current = newValue
      },
      setSelectionRange: (start: number, _end: number) => {
        if (divRef.current) {
          setCursorPosition(divRef.current, start)
          cursorPositionRef.current = start
        }
      },
      getBoundingClientRect: () => divRef.current?.getBoundingClientRect() ?? new DOMRect(),
      get element() { return divRef.current },
    }), [])

    // Handle input events
    const handleInput = React.useCallback(() => {
      if (isComposing.current) return
      if (!divRef.current) return

      const newText = getTextFromElement(divRef.current)
      const cursorPos = getCursorPosition(divRef.current)

      lastValueRef.current = newText
      cursorPositionRef.current = cursorPos

      // Check if mentions changed - if so, we need to re-render HTML
      const newSignature = getMentionSignature(newText, skillSlugs, sourceSlugs)
      if (newSignature !== lastMentionSignatureRef.current) {
        lastMentionSignatureRef.current = newSignature
        // Re-render with badges
        isInternalUpdate.current = true
        const html = textToHTML(newText, skills, sources, workspaceId)
        divRef.current.innerHTML = html || '<br>' // Empty contenteditable needs a BR
        // Restore cursor
        setCursorPosition(divRef.current, cursorPos)
        isInternalUpdate.current = false
      }

      onChange(newText)
      onInput?.(newText, cursorPos)
    }, [onChange, onInput, skills, sources, skillSlugs, sourceSlugs, workspaceId])

    // Handle composition (IME)
    const handleCompositionStart = React.useCallback(() => {
      isComposing.current = true
    }, [])

    const handleCompositionEnd = React.useCallback(() => {
      isComposing.current = false
      handleInput()
    }, [handleInput])

    // Handle paste - extract plain text only
    const handlePasteInternal = React.useCallback((e: React.ClipboardEvent) => {
      // Check if we have files - let parent handle that
      const hasFiles = e.clipboardData?.files && e.clipboardData.files.length > 0
      if (hasFiles && onPaste) {
        onPaste(e)
        return
      }

      e.preventDefault()

      // Insert plain text
      const text = e.clipboardData.getData('text/plain')
      if (text) {
        document.execCommand('insertText', false, text)
      }
    }, [onPaste])

    // Handle focus
    const handleFocus = React.useCallback((e: React.FocusEvent<HTMLDivElement>) => {
      setIsFocused(true)
      onFocus?.(e)
    }, [onFocus])

    // Handle blur
    const handleBlur = React.useCallback((e: React.FocusEvent<HTMLDivElement>) => {
      setIsFocused(false)
      onBlur?.(e)
    }, [onBlur])

    // Sync value from props (when parent updates value externally)
    React.useEffect(() => {
      if (!divRef.current) return
      if (isInternalUpdate.current) return
      if (lastValueRef.current === value) return

      // External value change - update content
      lastValueRef.current = value
      lastMentionSignatureRef.current = getMentionSignature(value, skillSlugs, sourceSlugs)

      const html = textToHTML(value, skills, sources, workspaceId)
      divRef.current.innerHTML = html || '<br>'

      // If focused, restore cursor at end
      if (document.activeElement === divRef.current) {
        setCursorPosition(divRef.current, value.length)
      }
    }, [value, skills, sources, skillSlugs, sourceSlugs, workspaceId])

    // Initialize content on mount
    React.useEffect(() => {
      if (!divRef.current) return
      lastMentionSignatureRef.current = getMentionSignature(value, skillSlugs, sourceSlugs)
      const html = textToHTML(value, skills, sources, workspaceId)
      divRef.current.innerHTML = html || '<br>'
      lastValueRef.current = value
    }, []) // eslint-disable-line react-hooks/exhaustive-deps

    // Show placeholder
    const showPlaceholder = !value

    return (
      <div className="relative">
        <div
          ref={divRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          tabIndex={disabled ? -1 : 0}
          className={cn(
            'outline-none text-sm whitespace-pre-wrap break-words',
            'min-h-[1.5em]',
            disabled && 'opacity-50 cursor-not-allowed',
            showPlaceholder && !isFocused && 'text-transparent',
            className
          )}
          onInput={handleInput}
          onKeyDown={onKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onPaste={handlePasteInternal}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          aria-disabled={disabled}
          aria-placeholder={placeholder}
          role="textbox"
          aria-multiline="true"
          {...restProps}
        />
        {/* Placeholder overlay */}
        {showPlaceholder && !isFocused && (
          <div
            className={cn(
              'absolute inset-0 text-sm text-muted-foreground pointer-events-none',
              className
            )}
          >
            {placeholder}
          </div>
        )}
      </div>
    )
  }
)
