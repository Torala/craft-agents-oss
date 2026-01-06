/**
 * @craft-agent/ui - Shared React UI components for Craft Agent
 *
 * This package provides platform-agnostic UI components that work in both:
 * - Electron desktop app (full interactive mode)
 * - Web session viewer (read-only mode)
 *
 * Key components:
 * - ChatView: Main session viewer with readonly/interactive modes
 * - TurnCard: Email-like display for assistant turns
 * - Markdown: Customizable markdown renderer with syntax highlighting
 *
 * Platform abstraction:
 * - PlatformProvider/usePlatform: Inject platform-specific actions
 */

// Context
export {
  PlatformProvider,
  usePlatform,
  type PlatformActions,
  type PlatformProviderProps,
} from './context'

// Chat components
export {
  ChatView,
  TurnCard,
  PlanCard,
  UserMessageBubble,
  FileTypeIcon,
  getFileTypeLabel,
  type ChatViewProps,
  type ChatViewMode,
  type TurnCardProps,
  type PlanCardProps,
  type UserMessageBubbleProps,
  type FileTypeIconProps,
  type ActivityItem,
  type ResponseContent,
  type TodoItem,
} from './components/chat'

// Markdown
export {
  Markdown,
  MemoizedMarkdown,
  CodeBlock,
  InlineCode,
  CollapsibleMarkdownProvider,
  useCollapsibleMarkdown,
  type MarkdownProps,
  type RenderMode,
} from './components/markdown'

// UI primitives
export { Spinner, type SpinnerProps } from './components/ui'

// Overlay components
export { CodeOverlay, detectLanguageFromPath, type CodeOverlayProps } from './components/overlay'

// Utilities
export { cn } from './lib/utils'

// Turn utilities (pure functions)
export * from './components/chat/turn-utils'
