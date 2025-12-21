/**
 * turn-utils.ts
 *
 * Utilities for grouping messages by turn for TurnCard rendering.
 * Converts the flat Message[] array into grouped turns for email-like display.
 */

import type { Message } from '../../../shared/types'
import type { ActivityItem, ActivityStatus, ActivityType, ResponseContent } from './TurnCard'

// ============================================================================
// Types
// ============================================================================

/** Represents one complete assistant turn */
export interface AssistantTurn {
  type: 'assistant'
  turnId: string
  activities: ActivityItem[]
  response?: ResponseContent
  intent?: string
  isStreaming: boolean
  isComplete: boolean
  timestamp: number
}

/** Represents a user message */
export interface UserTurn {
  type: 'user'
  message: Message
  timestamp: number
}

/** Represents a system/info/error message that stands alone */
export interface SystemTurn {
  type: 'system'
  message: Message
  timestamp: number
}

export type Turn = AssistantTurn | UserTurn | SystemTurn

// ============================================================================
// Helper Functions
// ============================================================================

/** Convert tool status from message to ActivityStatus */
function getToolStatus(message: Message): ActivityStatus {
  if (message.isError) return 'error'
  // Check explicit toolStatus first (set by tool_result handler)
  if (message.toolStatus === 'completed') return 'completed'
  // Fallback: check if toolResult exists (handles empty string results)
  if (message.toolResult !== undefined) return 'completed'
  if (message.toolStatus === 'pending') return 'pending'
  return 'running'
}

/** Convert message to ActivityItem */
function messageToActivity(message: Message): ActivityItem {
  return {
    id: message.id,
    type: 'tool' as ActivityType,
    status: getToolStatus(message),
    toolName: message.toolName,
    toolInput: message.toolInput,
    content: message.toolResult || message.content,
    intent: message.toolIntent,
    timestamp: message.timestamp,
    error: message.isError ? message.content : undefined,
  }
}

// ============================================================================
// Main Grouping Function
// ============================================================================

/**
 * Groups messages into turns for TurnCard rendering
 *
 * Rules:
 * - User messages flush and start fresh context
 * - Tool messages + intermediate assistant messages belong to current turn
 * - Final assistant message (non-streaming, non-intermediate) flushes the turn
 * - Error/status/info messages are standalone system turns
 *
 * Note: We intentionally ignore turnId for grouping. The SDK generates a new
 * turnId for each API message, but from a user perspective, all work between
 * a user message and the final response should be ONE turn. We use isIntermediate
 * as the signal: isIntermediate=true means more work coming, isIntermediate=false
 * means final response.
 */
export function groupMessagesByTurn(messages: Message[]): Turn[] {
  const turns: Turn[] = []
  let currentTurn: AssistantTurn | null = null

  const flushCurrentTurn = (interrupted = false) => {
    if (currentTurn) {
      // Sort activities by timestamp to ensure correct chronological order
      // This is necessary because buffering can delay when messages are added
      // to the array, causing commentary to appear after tools that started later
      currentTurn.activities.sort((a, b) => a.timestamp - b.timestamp)

      // If interrupted, mark any running activities as error
      if (interrupted) {
        currentTurn.activities = currentTurn.activities.map(activity =>
          activity.status === 'running'
            ? { ...activity, status: 'error' as ActivityStatus, error: 'Interrupted' }
            : activity
        )
        currentTurn.isStreaming = false
        currentTurn.isComplete = true
      }
      turns.push(currentTurn)
      currentTurn = null
    }
  }

  for (const message of messages) {
    // User messages are their own turn
    if (message.role === 'user') {
      flushCurrentTurn()
      turns.push({
        type: 'user',
        message,
        timestamp: message.timestamp,
      })
      continue
    }

    // Error/status/info/warning messages are standalone
    if (message.role === 'error' || message.role === 'status' || message.role === 'info' || message.role === 'warning') {
      // Flush current turn first (mark as interrupted if info message)
      const isInterruption = message.role === 'info'
      flushCurrentTurn(isInterruption)
      turns.push({
        type: 'system',
        message,
        timestamp: message.timestamp,
      })
      continue
    }

    // Tool messages belong to current assistant turn
    if (message.role === 'tool') {
      // Tool is complete if toolStatus is 'completed' OR toolResult exists
      const isToolComplete = message.toolStatus === 'completed' || message.toolResult !== undefined
      if (!currentTurn) {
        // Start a new turn
        currentTurn = {
          type: 'assistant',
          turnId: message.turnId || message.id,
          activities: [],
          response: undefined,
          intent: message.toolIntent,
          isStreaming: !isToolComplete,
          isComplete: false,
          timestamp: message.timestamp,
        }
      }
      // Always add to current turn (ignoring turnId differences)
      currentTurn.activities.push(messageToActivity(message))
      currentTurn.isStreaming = !isToolComplete
      continue
    }

    // Assistant messages are the response part of a turn
    if (message.role === 'assistant') {
      // Intermediate messages OR pending messages (don't know yet) are activities, not responses
      // Pending: streaming text where we don't yet know if it's intermediate - treat as intermediate
      // until text_complete arrives with the definitive isIntermediate flag
      if (message.isIntermediate || message.isPending) {
        if (!currentTurn) {
          // Start a new turn for this intermediate message
          currentTurn = {
            type: 'assistant',
            turnId: message.turnId || message.id,
            activities: [],
            response: undefined,
            intent: undefined,
            isStreaming: !!message.isPending,
            isComplete: false,
            timestamp: message.timestamp,
          }
        }
        // Always add to current turn as activity (ignoring turnId differences)
        // Pending messages show as 'running' until we know they're complete
        currentTurn.activities.push({
          id: message.id,
          type: 'intermediate',
          status: message.isPending ? 'running' : 'completed',
          content: message.content,
          timestamp: message.timestamp,
        })
        continue
      }

      // Non-intermediate assistant message = final response
      if (!currentTurn) {
        // This is a response-only turn (no tools)
        currentTurn = {
          type: 'assistant',
          turnId: message.turnId || message.id,
          activities: [],
          response: undefined,
          intent: undefined,
          isStreaming: !!message.isStreaming,
          isComplete: !message.isStreaming,
          timestamp: message.timestamp,
        }
      }

      // Set as response on current turn (ignoring turnId differences)
      currentTurn.response = {
        text: message.content,
        isStreaming: !!message.isStreaming,
        streamStartTime: message.isStreaming ? message.timestamp : undefined,
      }
      currentTurn.isStreaming = !!message.isStreaming
      currentTurn.isComplete = !message.isStreaming

      // Flush when turn is complete (non-streaming = final response received)
      if (!message.isStreaming) {
        flushCurrentTurn()
      }
      continue
    }
  }

  // Flush any remaining turn
  flushCurrentTurn()

  return turns
}

/**
 * Get the primary intent for a turn (first available intent from activities)
 */
export function getTurnIntent(turn: AssistantTurn): string | undefined {
  // First check explicit turn intent
  if (turn.intent) return turn.intent

  // Then look for activity intents
  for (const activity of turn.activities) {
    if (activity.intent) return activity.intent
  }

  return undefined
}

/**
 * Check if any activity in the turn is still running
 */
export function hasPendingActivities(turn: AssistantTurn): boolean {
  return turn.activities.some(a => a.status === 'running' || a.status === 'pending')
}

/**
 * Check if any activity in the turn has an error
 */
export function hasErrorActivities(turn: AssistantTurn): boolean {
  return turn.activities.some(a => a.status === 'error')
}

/**
 * Get a summary of completed activities
 */
export function getActivitySummary(turn: AssistantTurn): string {
  const completed = turn.activities.filter(a => a.status === 'completed').length
  const running = turn.activities.filter(a => a.status === 'running').length
  const errors = turn.activities.filter(a => a.status === 'error').length

  const parts: string[] = []
  if (running > 0) parts.push(`${running} running`)
  if (completed > 0) parts.push(`${completed} completed`)
  if (errors > 0) parts.push(`${errors} failed`)

  return parts.join(', ') || 'No activities'
}

/**
 * Format an AssistantTurn as markdown for detailed viewing in Monaco
 * Shows full tool inputs, results, and response
 */
export function formatTurnAsMarkdown(turn: AssistantTurn): string {
  const lines: string[] = []

  // Header with intent if available
  if (turn.intent) {
    lines.push(`# ${turn.intent}`)
  } else {
    lines.push('# Turn Details')
  }
  lines.push('')

  // Summary
  const summary = getActivitySummary(turn)
  lines.push(`**Status:** ${turn.isComplete ? 'Complete' : 'In Progress'} · ${summary}`)
  lines.push('')

  // Activities section
  if (turn.activities.length > 0) {
    lines.push('---')
    lines.push('')
    lines.push('## Activities')
    lines.push('')

    for (const activity of turn.activities) {
      if (activity.type === 'intermediate') {
        // Intermediate text (thinking/commentary)
        lines.push(`### 💭 Commentary`)
        lines.push('')
        if (activity.content) {
          lines.push(activity.content)
        }
        lines.push('')
      } else if (activity.toolName) {
        // Tool call
        const statusEmoji = activity.status === 'completed' ? '✅' :
                           activity.status === 'error' ? '❌' :
                           activity.status === 'running' ? '⏳' : '⏸️'

        lines.push(`### ${statusEmoji} ${activity.toolName}`)
        lines.push('')

        // Intent if available
        if (activity.intent) {
          lines.push(`> ${activity.intent}`)
          lines.push('')
        }

        // Input
        if (activity.toolInput && Object.keys(activity.toolInput).length > 0) {
          lines.push('**Input:**')
          lines.push('```json')
          lines.push(JSON.stringify(activity.toolInput, null, 2))
          lines.push('```')
          lines.push('')
        }

        // Result/Output
        if (activity.content) {
          lines.push('**Result:**')
          // Check if result looks like JSON
          const trimmed = activity.content.trim()
          if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
            try {
              const parsed = JSON.parse(trimmed)
              lines.push('```json')
              lines.push(JSON.stringify(parsed, null, 2))
              lines.push('```')
            } catch {
              // Not valid JSON, show as text
              lines.push('```')
              lines.push(activity.content)
              lines.push('```')
            }
          } else {
            lines.push('```')
            lines.push(activity.content)
            lines.push('```')
          }
          lines.push('')
        }

        // Error if present
        if (activity.error) {
          lines.push('**Error:**')
          lines.push('```')
          lines.push(activity.error)
          lines.push('```')
          lines.push('')
        }
      }
    }
  }

  // Response section
  if (turn.response?.text) {
    lines.push('---')
    lines.push('')
    lines.push('## Response')
    lines.push('')
    lines.push(turn.response.text)
  }

  return lines.join('\n')
}

/**
 * Format a single ActivityItem as markdown for detailed viewing in Monaco
 */
export function formatActivityAsMarkdown(activity: ActivityItem): string {
  const lines: string[] = []

  if (activity.type === 'intermediate') {
    // Commentary/thinking
    lines.push('# Commentary')
    lines.push('')
    if (activity.content) {
      lines.push(activity.content)
    }
    return lines.join('\n')
  }

  // Tool activity
  const statusEmoji = activity.status === 'completed' ? '✅' :
                     activity.status === 'error' ? '❌' :
                     activity.status === 'running' ? '⏳' : '⏸️'

  lines.push(`# ${statusEmoji} ${activity.toolName || 'Tool'}`)
  lines.push('')

  // Intent if available
  if (activity.intent) {
    lines.push(`> ${activity.intent}`)
    lines.push('')
  }

  // Input
  if (activity.toolInput && Object.keys(activity.toolInput).length > 0) {
    lines.push('## Input')
    lines.push('')
    lines.push('```json')
    lines.push(JSON.stringify(activity.toolInput, null, 2))
    lines.push('```')
    lines.push('')
  }

  // Result/Output
  if (activity.content) {
    lines.push('## Result')
    lines.push('')
    // Check if result looks like JSON
    const trimmed = activity.content.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed)
        lines.push('```json')
        lines.push(JSON.stringify(parsed, null, 2))
        lines.push('```')
      } catch {
        // Not valid JSON, show as text
        lines.push('```')
        lines.push(activity.content)
        lines.push('```')
      }
    } else {
      lines.push('```')
      lines.push(activity.content)
      lines.push('```')
    }
    lines.push('')
  }

  // Error if present
  if (activity.error) {
    lines.push('## Error')
    lines.push('')
    lines.push('```')
    lines.push(activity.error)
    lines.push('```')
  }

  return lines.join('\n')
}
