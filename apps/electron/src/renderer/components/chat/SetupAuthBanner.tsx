import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/loading-indicator"

export type BannerState = 'hidden' | 'setup' | 'auth' | 'activating' | 'error'

interface SetupAuthBannerProps {
  state: BannerState
  agentName?: string
  reason?: string
  onAction: () => void
}

/**
 * SetupAuthBanner - Shows when an agent needs activation or authentication
 *
 * States:
 * - 'setup': Agent has never been configured (needs initial activation)
 * - 'auth': Agent exists but needs re-authentication
 * - 'activating': Agent activation is in progress
 * - 'error': Agent activation failed (allows retry)
 * - 'hidden': No banner shown
 */
export function SetupAuthBanner({
  state,
  agentName,
  reason,
  onAction
}: SetupAuthBannerProps) {
  if (state === 'hidden') return null

  // Get title based on state
  const getTitle = () => {
    switch (state) {
      case 'setup':
        return `Activate ${agentName || 'agent'}`
      case 'auth':
        return 'Authentication required'
      case 'activating':
        return `Activating ${agentName || 'agent'}...`
      case 'error':
        return 'Activation failed'
      default:
        return ''
    }
  }

  // Get default description based on state
  const getDescription = () => {
    if (reason) return reason
    switch (state) {
      case 'setup':
        return 'Activate this agent to start chatting.'
      case 'auth':
        return 'Re-authenticate to continue using this agent.'
      case 'activating':
        return 'Setting up agent configuration...'
      case 'error':
        return 'Something went wrong. Tap to retry.'
      default:
        return ''
    }
  }

  // Get button text based on state
  const getButtonText = () => {
    switch (state) {
      case 'setup':
        return 'Activate'
      case 'auth':
        return 'Authenticate'
      case 'activating':
        return 'View Progress'
      case 'error':
        return 'Retry'
      default:
        return 'Continue'
    }
  }

  const isActivating = state === 'activating'

  return (
    <div className="px-3 py-3">
      <div className="rounded-lg border border-foreground/10 bg-card p-5 text-center">
        {/* Title with optional spinner */}
        <h3 className="text-sm font-semibold text-foreground font-sans flex items-center justify-center gap-2">
          {isActivating && <Spinner className="text-sm" />}
          {getTitle()}
        </h3>

        {/* Description */}
        <p className="mt-2 text-xs text-muted-foreground">
          {getDescription()}
        </p>

        {/* Action Button */}
        <Button
          onClick={onAction}
          className="mt-4 w-full text-xs rounded-lg bg-foreground/5 text-foregdound hover:bg-foreground/10"
        >
          {getButtonText()}
        </Button>
      </div>
    </div>
  )
}
