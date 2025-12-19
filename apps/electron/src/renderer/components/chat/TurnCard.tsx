import * as React from 'react'
import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  ChevronRight,
  CheckCircle2,
  XCircle,
  Circle,
  MessageCircleDashed,
  ExternalLink,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Markdown, CollapsibleMarkdownProvider, StreamingMarkdown } from '@/components/markdown'
import { Spinner } from '@/components/ui/loading-indicator'
import { stripMarkdown } from '@/utils/text'

// ============================================================================
// Size Configuration
// ============================================================================

/**
 * Global size configuration for TurnCard components.
 * Adjust these values to scale the entire component uniformly.
 */
const SIZE_CONFIG = {
  /** Base font size class for all text */
  fontSize: 'text-[13px]',
  /** Icon size class (width and height) */
  iconSize: 'w-3 h-3',
  /** Spinner text size class */
  spinnerSize: 'text-[10px]',
  /** Small spinner for header */
  spinnerSizeSmall: 'text-[8px]',
} as const

// ============================================================================
// Types
// ============================================================================

export type ActivityStatus = 'pending' | 'running' | 'completed' | 'error'
export type ActivityType = 'tool' | 'thinking' | 'intermediate'

export interface ActivityItem {
  id: string
  type: ActivityType
  status: ActivityStatus
  toolName?: string
  toolInput?: Record<string, unknown>
  content?: string
  intent?: string
  timestamp: number
  error?: string
}

export interface ResponseContent {
  text: string
  isStreaming: boolean
  streamStartTime?: number
}

export interface TurnCardProps {
  /** All activities in this turn (tools, thinking, intermediate text) */
  activities: ActivityItem[]
  /** Final response content (may be streaming) */
  response?: ResponseContent
  /** Primary intent/goal for this turn (shown in collapsed preview) */
  intent?: string
  /** Whether content is still being received */
  isStreaming: boolean
  /** Whether this turn is fully complete */
  isComplete: boolean
  /** Start in expanded state */
  defaultExpanded?: boolean
  /** Callback when file path is clicked */
  onOpenFile?: (path: string) => void
  /** Callback when URL is clicked */
  onOpenUrl?: (url: string) => void
  /** Callback to open response in Monaco editor */
  onPopOut?: (text: string) => void
}

// ============================================================================
// Buffering Constants & Utilities
// ============================================================================

/**
 * Aggressive buffering configuration.
 * Waits until content is suspected to be meaningful "commentary" before showing.
 */
const BUFFER_CONFIG = {
  MIN_WORDS_STANDARD: 40,      // Base threshold for showing content
  MIN_WORDS_CODE: 15,          // Code blocks show faster
  MIN_WORDS_LIST: 20,          // Lists show faster
  MIN_WORDS_QUESTION: 8,       // Questions from AI show faster
  MIN_WORDS_HEADER: 12,        // Headers indicate structure
  MIN_BUFFER_MS: 500,          // Always wait at least 500ms
  MAX_BUFFER_MS: 2500,         // Never buffer longer than 2.5s
  TIMEOUT_MIN_WORDS: 5,        // Show on timeout if at least this many words
  HIGH_WORD_COUNT: 60,         // Show regardless of structure at this count
  REEVAL_INTERVAL_MS: 200,     // Re-evaluate buffering every 200ms
} as const

type BufferReason =
  | 'complete'
  | 'min_time'
  | 'timeout'
  | 'code_block'
  | 'list'
  | 'header'
  | 'question'
  | 'threshold_met'
  | 'high_word_count'
  | 'buffering'

/** Count words in text */
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

/** Detect code blocks (fenced) */
function hasCodeBlock(text: string): boolean {
  return /```/.test(text)
}

/** Detect markdown lists (bullet or numbered) */
function hasList(text: string): boolean {
  return /^\s*[-*•]\s/m.test(text) || /^\s*\d+\.\s/m.test(text)
}

/** Detect markdown headers */
function hasHeader(text: string): boolean {
  return /^#{1,4}\s/m.test(text)
}

/** Detect structural content (sentences, paragraphs, etc) */
function hasStructure(text: string): boolean {
  // Sentence ending (period, exclamation, question mark, colon)
  if (/[.!?:]\s*$/.test(text.trimEnd())) return true
  // Paragraph breaks
  if (/\n\s*\n/.test(text)) return true
  // Headers anywhere
  if (/\n\s*#{1,4}\s/.test(text)) return true
  // Code blocks
  if (hasCodeBlock(text)) return true
  return false
}

/** Detect if text ends with a question (AI asking for clarification) */
function isQuestion(text: string): boolean {
  return /\?\s*$/.test(text.trim())
}

/**
 * Determine if buffered content should be shown.
 * This is the core buffering decision function.
 *
 * @param text - The accumulated response text
 * @param isStreaming - Whether the response is still streaming
 * @param streamStartTime - When streaming started (for timeout calculation)
 * @returns Decision with reason for debugging
 */
function shouldShowContent(
  text: string,
  isStreaming: boolean,
  streamStartTime?: number
): { shouldShow: boolean; reason: BufferReason; wordCount: number } {
  const wordCount = countWords(text)

  // Always show complete content immediately
  if (!isStreaming) {
    return { shouldShow: true, reason: 'complete', wordCount }
  }

  const elapsed = streamStartTime ? Date.now() - streamStartTime : 0

  // Minimum buffer time - always wait at least 500ms
  if (elapsed < BUFFER_CONFIG.MIN_BUFFER_MS) {
    return { shouldShow: false, reason: 'min_time', wordCount }
  }

  // Maximum buffer time - force show after 2.5s if we have some content
  if (elapsed > BUFFER_CONFIG.MAX_BUFFER_MS && wordCount >= BUFFER_CONFIG.TIMEOUT_MIN_WORDS) {
    return { shouldShow: true, reason: 'timeout', wordCount }
  }

  // High-confidence patterns get expedited treatment

  // Code blocks - developers want to see code early
  if (hasCodeBlock(text) && wordCount >= BUFFER_CONFIG.MIN_WORDS_CODE) {
    return { shouldShow: true, reason: 'code_block', wordCount }
  }

  // Headers indicate structured content
  if (hasHeader(text) && wordCount >= BUFFER_CONFIG.MIN_WORDS_HEADER) {
    return { shouldShow: true, reason: 'header', wordCount }
  }

  // Lists indicate structured content
  if (hasList(text) && wordCount >= BUFFER_CONFIG.MIN_WORDS_LIST) {
    return { shouldShow: true, reason: 'list', wordCount }
  }

  // Questions from AI (clarification) - show quickly
  if (isQuestion(text) && wordCount >= BUFFER_CONFIG.MIN_WORDS_QUESTION) {
    return { shouldShow: true, reason: 'question', wordCount }
  }

  // Standard threshold - 40 words with some structure
  if (wordCount >= BUFFER_CONFIG.MIN_WORDS_STANDARD && hasStructure(text)) {
    return { shouldShow: true, reason: 'threshold_met', wordCount }
  }

  // High word count - show regardless of structure
  if (wordCount >= BUFFER_CONFIG.HIGH_WORD_COUNT) {
    return { shouldShow: true, reason: 'high_word_count', wordCount }
  }

  return { shouldShow: false, reason: 'buffering', wordCount }
}

/**
 * Check if a response is currently in buffering state
 * Used by TurnCard to show subtle indicator instead of big card
 */
function isResponseBuffering(response: ResponseContent | undefined): boolean {
  if (!response) return false
  if (!response.isStreaming) return false
  const decision = shouldShowContent(response.text, response.isStreaming, response.streamStartTime)
  return !decision.shouldShow
}

// ============================================================================
// Helper Functions
// ============================================================================

/** Get display name for a tool (strip MCP prefixes) */
function getToolDisplayName(name: string): string {
  const stripped = name.replace(/^mcp__[^_]+__/, '')
  const displayNames: Record<string, string> = {
    'WebFetch': 'Fetching',
    'WebSearch': 'Searching',
    'Read': 'Reading',
    'Write': 'Writing',
    'Edit': 'Editing',
    'Glob': 'Finding files',
    'Grep': 'Searching code',
    'Bash': 'Running command',
  }
  return displayNames[stripped] || stripped
}

/** Format tool input as a concise summary - CSS truncate handles overflow */
function formatToolInput(input?: Record<string, unknown>): string {
  if (!input || Object.keys(input).length === 0) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(input)) {
    if (key === '_intent' || value === undefined || value === null) continue
    const valStr = typeof value === 'string'
      ? value.replace(/\s+/g, ' ').trim()
      : JSON.stringify(value)
    parts.push(valStr)
    if (parts.length >= 2) break // Max 2 values
  }
  return parts.join(' ')
}

/** Get the primary preview text for collapsed state */
function getPreviewText(
  activities: ActivityItem[],
  intent?: string,
  isStreaming?: boolean,
  hasResponse?: boolean
): string {
  // If we have an explicit intent, use it
  if (intent) return intent

  // Find the most relevant activity intent
  const activityWithIntent = activities.find(a => a.intent)
  if (activityWithIntent?.intent) return activityWithIntent.intent

  // Check if we're in responding state
  if (isStreaming && hasResponse) return 'Responding...'

  // Fall back to activity summary
  const runningCount = activities.filter(a => a.status === 'running').length
  const completedCount = activities.filter(a => a.status === 'completed').length
  const errorCount = activities.filter(a => a.status === 'error').length

  if (runningCount > 0) {
    const running = activities.find(a => a.status === 'running')
    if (running?.toolName) {
      return `${getToolDisplayName(running.toolName)}...`
    }
    return `Running ${runningCount} tool${runningCount > 1 ? 's' : ''}...`
  }

  if (errorCount > 0) {
    return `${errorCount} error${errorCount > 1 ? 's' : ''}`
  }

  if (completedCount > 0) {
    return `Ran ${completedCount} tool${completedCount > 1 ? 's' : ''}`
  }

  return 'Starting...'
}

/** Get failed activity count (only shown if there are failures) */
function getFailedCount(activities: ActivityItem[]): number {
  return activities.filter(a => a.status === 'error').length
}

// ============================================================================
// Sub-Components
// ============================================================================

/** Status icon for an activity */
function ActivityStatusIcon({ status }: { status: ActivityStatus }) {
  switch (status) {
    case 'pending':
      return <Circle className={cn(SIZE_CONFIG.iconSize, "text-muted-foreground/50")} />
    case 'running':
      return (
        <div className={cn(SIZE_CONFIG.iconSize, "flex items-center justify-center")}>
          <Spinner className={cn(SIZE_CONFIG.spinnerSize, "text-amber-500")} />
        </div>
      )
    case 'completed':
      return <CheckCircle2 className={cn(SIZE_CONFIG.iconSize, "text-green-500")} />
    case 'error':
      return <XCircle className={cn(SIZE_CONFIG.iconSize, "text-destructive")} />
  }
}

/** Single activity row in expanded view */
function ActivityRow({ activity }: { activity: ActivityItem }) {
  // Intermediate messages (LLM commentary) - render with dashed circle icon
  // Show "Thinking" while streaming, stripped markdown content when complete
  if (activity.type === 'intermediate') {
    const isThinking = activity.status === 'running'
    const displayContent = isThinking ? 'Thinking...' : stripMarkdown(activity.content || '')
    return (
      <div className={cn("flex items-center gap-2 py-0.5 text-muted-foreground/70", SIZE_CONFIG.fontSize)}>
        {isThinking ? (
          <div className={cn(SIZE_CONFIG.iconSize, "flex items-center justify-center shrink-0")}>
            <Spinner className={SIZE_CONFIG.spinnerSize} />
          </div>
        ) : (
          <MessageCircleDashed className={cn(SIZE_CONFIG.iconSize, "shrink-0")} />
        )}
        <span className="truncate">{displayContent}</span>
      </div>
    )
  }

  // Tool activities - show with status icon
  const displayName = activity.toolName
    ? getToolDisplayName(activity.toolName)
    : activity.type === 'thinking'
    ? 'Thinking'
    : 'Processing'

  const inputSummary = formatToolInput(activity.toolInput)

  return (
    <div className={cn("flex items-center gap-2 py-0.5 text-muted-foreground", SIZE_CONFIG.fontSize)}>
      <ActivityStatusIcon status={activity.status} />
      <span className="font-medium">{displayName}</span>
      {inputSummary && (
        <span className="opacity-60 truncate flex-1 min-w-0">{inputSummary}</span>
      )}
      {activity.status === 'error' && activity.error && (
        <span className="text-destructive truncate max-w-[150px]">
          — {activity.error}
        </span>
      )}
    </div>
  )
}

// ============================================================================
// Streaming Response Preview Component
// ============================================================================

interface StreamingResponsePreviewProps {
  text: string
  isStreaming: boolean
  /** When streaming started - used for buffering timeout calculation */
  streamStartTime?: number
  onOpenFile?: (path: string) => void
  onOpenUrl?: (url: string) => void
  /** Callback to open response in Monaco editor */
  onPopOut?: () => void
}

/**
 * StreamingResponsePreview - Buffered response card with aggressive content gating
 *
 * Implements smart buffering that waits until content is suspected to be
 * meaningful "commentary" before showing:
 * - Waits for 40+ words with structure OR
 * - High-confidence patterns (code blocks, headers, lists) with lower threshold OR
 * - Timeout after 2.5 seconds
 *
 * States:
 * - Buffering: Shows nothing (TurnCard shows "Preparing response..." indicator)
 * - Streaming: Shows content with spinner in footer
 * - Completed: Shows content with checkmark in footer
 */
function StreamingResponsePreview({
  text,
  isStreaming,
  streamStartTime,
  onOpenFile,
  onOpenUrl,
  onPopOut,
}: StreamingResponsePreviewProps) {
  // Time-based re-evaluation tick (forces recalculation of shouldShowContent)
  const [, setTick] = useState(0)

  // Re-evaluate buffering decision every 200ms while streaming
  useEffect(() => {
    if (!isStreaming) return

    const interval = setInterval(() => {
      setTick(t => t + 1)
    }, BUFFER_CONFIG.REEVAL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [isStreaming])

  // Calculate buffering decision (recalculates on tick, text, or streaming changes)
  const bufferDecision = useMemo(() => {
    return shouldShowContent(text, isStreaming, streamStartTime)
  }, [text, isStreaming, streamStartTime])

  const isCompleted = !isStreaming
  const isBuffering = isStreaming && !bufferDecision.shouldShow

  // While buffering, return null - TurnCard will show a subtle indicator instead
  if (isBuffering) {
    return null
  }

  const MAX_HEIGHT = 540

  // Completed response - show with max height and footer
  if (isCompleted) {
    return (
      <div className="max-w-[800px] bg-white shadow-minimal rounded-[8px] overflow-hidden">
        <div
          className="pl-[22px] pr-4 py-3 text-sm overflow-y-auto"
          style={{ maxHeight: MAX_HEIGHT }}
        >
          <Markdown
            mode="minimal"
            onUrlClick={onOpenUrl}
            onFileClick={onOpenFile}
          >
            {text}
          </Markdown>
        </div>

        {/* Footer with actions */}
        <div className={cn("px-4 py-2 border-t border-border/30 flex items-center justify-between bg-muted/20", SIZE_CONFIG.fontSize)}>
          <div className="flex items-center gap-2 text-muted-foreground">
            <CheckCircle2 className={cn(SIZE_CONFIG.iconSize, "text-green-500")} />
            <span>Completed</span>
          </div>

          {onPopOut && (
            <button
              onClick={onPopOut}
              className={cn(
                "flex items-center gap-1.5 transition-colors",
                "text-muted-foreground hover:text-foreground",
                "focus:outline-none focus-visible:underline"
              )}
            >
              <ExternalLink className={SIZE_CONFIG.iconSize} />
              <span>Open in Editor</span>
            </button>
          )}
        </div>
      </div>
    )
  }

  // Streaming response - show with max height (same as completed)
  return (
    <div className="max-w-[800px] bg-white shadow-minimal rounded-[8px] overflow-hidden">
      {/* Content area */}
      <div
        className="pl-[22px] pr-4 py-3 text-sm overflow-y-auto"
        style={{ maxHeight: MAX_HEIGHT }}
      >
        <StreamingMarkdown
          content={text}
          isStreaming={true}
          mode="minimal"
          onUrlClick={onOpenUrl}
          onFileClick={onOpenFile}
        />
      </div>

      {/* Footer */}
      <div className={cn("px-4 py-2 border-t border-border/30 flex items-center bg-muted/20", SIZE_CONFIG.fontSize)}>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Spinner className={SIZE_CONFIG.spinnerSize} />
          <span>Streaming...</span>
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

/**
 * TurnCard - Email-like display for one assistant turn
 *
 * Batches all activities (tools, thinking) into a collapsible section
 * with the final response displayed separately below.
 */
export function TurnCard({
  activities,
  response,
  intent,
  isStreaming,
  isComplete,
  defaultExpanded = false,
  onOpenFile,
  onOpenUrl,
  onPopOut,
}: TurnCardProps) {
  const hasRunning = activities.some(a => a.status === 'running')
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)

  // Time-based re-evaluation for buffering state
  const [, setTick] = useState(0)

  // Re-evaluate buffering state periodically while streaming
  useEffect(() => {
    if (!response?.isStreaming) return

    const interval = setInterval(() => {
      setTick(t => t + 1)
    }, BUFFER_CONFIG.REEVAL_INTERVAL_MS)

    return () => clearInterval(interval)
  }, [response?.isStreaming])

  // Check if response is in buffering state
  const isBuffering = useMemo(
    () => isResponseBuffering(response),
    [response]
  )


  // Compute preview text with cross-fade animation
  const previewText = useMemo(
    () => getPreviewText(activities, intent, isStreaming, !!response),
    [activities, intent, isStreaming, response]
  )

  const failedCount = useMemo(
    () => getFailedCount(activities),
    [activities]
  )

  // Sort activities by timestamp for correct chronological order
  // This handles the live streaming case (turn-utils sorts on flush for completed turns)
  const sortedActivities = useMemo(
    () => [...activities].sort((a, b) => a.timestamp - b.timestamp),
    [activities]
  )

  // Don't render if nothing to show and turn is complete
  if (activities.length === 0 && !response && isComplete) {
    return null
  }

  const hasActivities = activities.length > 0

  // Detect "thinking" state - streaming but no running activities and no ready response
  // This covers the gap between tool completion and response starting
  const isThinking = isStreaming && !isComplete && !hasRunning && (!response || isBuffering)

  return (
    <div className="space-y-1">
      {/* Activity Section */}
      {hasActivities && (
        <div className="group">
          {/* Collapsed Header / Toggle */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              "flex items-center gap-2 w-full px-3 py-1.5 rounded-[8px] text-left",
              SIZE_CONFIG.fontSize,
              "text-muted-foreground",
              "hover:bg-muted/50 transition-colors",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            )}
          >
            {/* Chevron with rotation animation - fixed size wrapper prevents layout shift */}
            <div className={cn(SIZE_CONFIG.iconSize, "flex items-center justify-center shrink-0")}>
              <motion.div
                initial={false}
                animate={{ rotate: isExpanded ? 90 : 0 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
              >
                <ChevronRight className={SIZE_CONFIG.iconSize} />
              </motion.div>
            </div>

            {/* Preview text with crossfade + inline failure count */}
            <span className="relative flex-1 min-w-0 h-5 flex items-center">
              <AnimatePresence initial={false}>
                <motion.span
                  key={previewText}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="absolute inset-0 truncate"
                >
                  {previewText}
                </motion.span>
              </AnimatePresence>
            </span>

            {/* Failure count - shown inline after preview text */}
            {failedCount > 0 && !isExpanded && (
              <span className="text-destructive shrink-0">
                · {failedCount} failed
              </span>
            )}

            {/* Spacer */}
            <span className="flex-1" />

            {/* Streaming indicator */}
            {isStreaming && !isComplete && (
              <Spinner className={cn(SIZE_CONFIG.spinnerSizeSmall, "text-muted-foreground")} />
            )}
          </button>

          {/* Expanded Activity List */}
          <AnimatePresence initial={false}>
            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{
                  height: { type: 'spring', stiffness: 400, damping: 30 },
                  opacity: { duration: 0.15 }
                }}
                className="overflow-hidden"
              >
                <div className="pl-4 pr-3 py-0 my-0.5 space-y-0.5 border-l-2 border-muted ml-[16px]">
                  {sortedActivities.map((activity, index) => (
                    <motion.div
                      key={activity.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.03 }}
                    >
                      <ActivityRow activity={activity} />
                    </motion.div>
                  ))}
                  {/* Thinking/Buffering indicator - shown while waiting for response */}
                  {isThinking && (
                    <motion.div
                      key="thinking"
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: sortedActivities.length * 0.03 }}
                      className={cn("flex items-center gap-2 py-0.5 text-muted-foreground/70", SIZE_CONFIG.fontSize)}
                    >
                      <Spinner className={SIZE_CONFIG.spinnerSize} />
                      <span>{isBuffering ? 'Preparing response...' : 'Thinking...'}</span>
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Standalone thinking indicator - when no activities but still working */}
      {!hasActivities && isThinking && (
        <div className={cn("flex items-center gap-2 px-3 py-1.5 text-muted-foreground", SIZE_CONFIG.fontSize)}>
          <Spinner className={SIZE_CONFIG.spinnerSize} />
          <span>{isBuffering ? 'Preparing response...' : 'Thinking...'}</span>
        </div>
      )}

      {/* Response Section - only shown when not buffering */}
      {response && !isBuffering && (
        <div className={cn(hasActivities && "mt-2")}>
          <StreamingResponsePreview
            text={response.text}
            isStreaming={response.isStreaming}
            streamStartTime={response.streamStartTime}
            onOpenFile={onOpenFile}
            onOpenUrl={onOpenUrl}
            onPopOut={onPopOut ? () => onPopOut(response.text) : undefined}
          />
        </div>
      )}
    </div>
  )
}
