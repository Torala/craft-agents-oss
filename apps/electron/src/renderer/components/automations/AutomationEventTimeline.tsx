/**
 * AutomationEventTimeline
 *
 * Compact timeline showing recent automation executions.
 * Displayed as a section within AutomationInfoPage.
 */

import { CheckCircle2, XCircle, ShieldAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useNavigation } from '@/contexts/NavigationContext'
import { type ExecutionEntry, type ExecutionStatus } from './types'

// ============================================================================
// Helpers
// ============================================================================

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp
  const seconds = Math.floor(diff / 1000)
  const minutes = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (seconds < 60) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

const statusConfig: Record<ExecutionStatus, { icon: React.ElementType; classes: string }> = {
  success: { icon: CheckCircle2, classes: 'text-success' },
  error:   { icon: XCircle,      classes: 'text-destructive' },
  blocked: { icon: ShieldAlert,   classes: 'text-warning' },
}

// ============================================================================
// Component
// ============================================================================

export interface AutomationEventTimelineProps {
  entries: ExecutionEntry[]
  className?: string
}

export function AutomationEventTimeline({ entries, className }: AutomationEventTimelineProps) {
  const { navigateToSession } = useNavigation()

  if (entries.length === 0) {
    return (
      <div className="px-4 py-6 text-center text-sm text-muted-foreground">
        No activity yet.
      </div>
    )
  }

  return (
    <div className={cn('divide-y divide-border/30', className)}>
      {entries.map((entry) => {
        const config = statusConfig[entry.status]
        const StatusIcon = config.icon

        return (
          <div key={entry.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            {/* Status icon */}
            <StatusIcon className={cn('h-3.5 w-3.5 shrink-0', config.classes)} />

            {/* Time */}
            <span className="text-xs text-muted-foreground w-16 shrink-0 tabular-nums">
              {formatRelativeTime(entry.timestamp)}
            </span>

            {/* Action summary — truncated prompt text */}
            <span className="flex-1 min-w-0 truncate text-xs text-foreground/70">
              {entry.actionSummary || entry.error || '—'}
            </span>

            {/* Session deep link */}
            {entry.sessionId && (
              <button
                className="shrink-0 text-[11px] text-accent hover:underline cursor-pointer"
                onClick={() => navigateToSession(entry.sessionId!)}
              >
                Open session
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
