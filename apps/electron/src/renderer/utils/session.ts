import type { Session } from "../../shared/types"

/**
 * Get display title for a session.
 * Priority: custom name > first user message > agent name > "New conversation"
 */
export function getSessionTitle(session: Session): string {
  if (session.name) {
    return session.name
  }

  const firstUserMessage = session.messages.find(m => m.role === 'user')
  if (firstUserMessage?.content) {
    const trimmed = firstUserMessage.content.slice(0, 50)
    return trimmed.length < firstUserMessage.content.length
      ? trimmed + '…'
      : trimmed
  }

  // For agent sessions, show the agent name instead of generic "New conversation"
  if (session.agentName) {
    return session.agentName
  }

  return 'New conversation'
}
