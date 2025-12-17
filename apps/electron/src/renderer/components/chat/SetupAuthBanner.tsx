import { Settings, Key } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type BannerState = 'hidden' | 'setup' | 'auth'

interface SetupAuthBannerProps {
  state: BannerState
  agentName?: string
  reason?: string
  onAction: () => void
}

/**
 * SetupAuthBanner - Shows when an agent needs setup or authentication
 *
 * States:
 * - 'setup': Agent has never been configured (needs initial setup)
 * - 'auth': Agent exists but needs re-authentication
 * - 'hidden': No banner shown
 */
export function SetupAuthBanner({
  state,
  agentName,
  reason,
  onAction
}: SetupAuthBannerProps) {
  if (state === 'hidden') return null

  const isSetup = state === 'setup'

  return (
    <div
      className={cn(
        "w-full px-4 py-3",
        isSetup
          ? "bg-primary/5"
          : "bg-amber-500/10"
      )}
    >
      {/* Line 1: Icon + Title */}
      <div className="flex items-center gap-2 min-w-0">
        <div className={cn(
          "shrink-0",
          isSetup
            ? "text-primary"
            : "text-amber-600 dark:text-amber-500"
        )}>
          {isSetup ? (
            <Settings className="h-4 w-4" />
          ) : (
            <Key className="h-4 w-4" />
          )}
        </div>
        <p className={cn(
          "text-sm font-medium truncate",
          isSetup
            ? "text-foreground"
            : "text-amber-700 dark:text-amber-400"
        )}>
          {isSetup ? 'Agent needs setup' : 'Agent needs authentication'}
        </p>
      </div>

      {/* Line 2: Reason */}
      {reason && (
        <p className={cn(
          "text-xs mt-1 truncate",
          isSetup
            ? "text-muted-foreground"
            : "text-amber-600/80 dark:text-amber-500/80"
        )}>
          {reason}
        </p>
      )}

      {/* Line 3: Action Button */}
      <div className="mt-2">
        <Button
          size="sm"
          variant={isSetup ? "default" : "outline"}
          onClick={onAction}
          className={cn(
            "h-7 text-xs",
            !isSetup && "border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10"
          )}
        >
          {isSetup ? 'Set up' : 'Authenticate'}
        </Button>
      </div>
    </div>
  )
}
