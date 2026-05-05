/**
 * "Pending requests" — recent senders the gateway rejected because they
 * weren't on the owners list. Renders nothing when the list is empty.
 *
 * One-click "Allow" promotes the sender into the owners list (which the
 * gateway then trusts going forward). "Ignore" drops them from the
 * pending list silently.
 */

import * as React from 'react'
import { Check, Clock, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { PendingSender } from './types'

interface Props {
  pending: PendingSender[]
  onAllow: (sender: PendingSender) => void
  onIgnore: (userId: string) => void
}

export function PendingSendersList({ pending, onAllow, onIgnore }: Props) {
  if (pending.length === 0) return null

  return (
    <div className="divide-y divide-border/50">
      {pending.map((sender) => (
        <PendingRow
          key={sender.userId}
          sender={sender}
          onAllow={() => onAllow(sender)}
          onIgnore={() => onIgnore(sender.userId)}
        />
      ))}
    </div>
  )
}

function PendingRow({
  sender,
  onAllow,
  onIgnore,
}: {
  sender: PendingSender
  onAllow: () => void
  onIgnore: () => void
}) {
  const primary = sender.displayName || sender.username || sender.userId
  const lastAttemptText = formatRelativeTime(sender.lastAttemptAt)
  const attemptText =
    sender.attemptCount === 1 ? '1 attempt' : `${sender.attemptCount} attempts`

  return (
    <div className="flex items-center gap-3 px-4 py-2.5">
      <div className="flex h-[22px] w-[22px] shrink-0 items-center justify-center">
        <Clock className="h-4 w-4 text-foreground/50" strokeWidth={1.5} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm">{primary}</span>
          {sender.username && (
            <span className="shrink-0 truncate text-xs text-foreground/40">
              @{sender.username}
            </span>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-foreground/50">
          {attemptText} · last {lastAttemptText} · id {sender.userId}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="sm" onClick={onAllow}>
          <Check className="h-3.5 w-3.5" />
          Allow
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onIgnore}
          className="text-foreground/60 hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
          Ignore
        </Button>
      </div>
    </div>
  )
}

function formatRelativeTime(epochMs: number): string {
  const diff = Date.now() - epochMs
  if (diff < 60_000) return 'just now'
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
