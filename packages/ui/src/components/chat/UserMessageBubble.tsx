/**
 * UserMessageBubble - Shared user message component
 *
 * Displays user messages with right-aligned styling:
 * - Subtle background (5% foreground)
 * - Pill-shaped corners
 * - Max width 80%
 * - Markdown rendering for links and code
 * - Optional file attachments with thumbnails
 * - Content badges for @mentions (sources, skills)
 * - Pending/queued states (Electron only)
 */

import type { ReactNode } from 'react'
import type { StoredAttachment, ContentBadge } from '@craft-agent/core'
import { cn } from '../../lib/utils'
import { Markdown } from '../markdown'
import { FileTypeIcon, getFileTypeLabel } from './attachment-helpers'

// Fallback text icons for badges without iconDataUrl
// Using simple characters since SVG rendering may not work in all contexts
const SKILL_ICON_TEXT = '✦'
const SOURCE_ICON_TEXT = '⊕'

/**
 * InlineBadge - Renders a single content badge inline with text
 * Styled to match the input field badges (bg-background with shadow)
 */
function InlineBadge({ badge }: { badge: ContentBadge }) {
  return (
    <span
      className="inline-flex items-center gap-1 h-[22px] px-1.5 mx-0.5 rounded-[5px] bg-background shadow-minimal text-[12px] align-middle"
      style={{ verticalAlign: 'middle', transform: 'translateY(-1px)' }}
    >
      {badge.iconDataUrl ? (
        <img
          src={badge.iconDataUrl}
          alt=""
          className="h-[12px] w-[12px] rounded-[2px] shrink-0"
        />
      ) : (
        <span className="h-[12px] w-[12px] rounded-[2px] bg-foreground/5 flex items-center justify-center text-foreground/50 shrink-0 text-[8px]">
          {badge.type === 'skill' ? SKILL_ICON_TEXT : SOURCE_ICON_TEXT}
        </span>
      )}
      <span className="truncate max-w-[200px]">{badge.label}</span>
    </span>
  )
}

/**
 * Render content with badges inserted at their positions.
 * Text segments between badges are rendered as Markdown.
 */
function renderContentWithBadges(
  content: string,
  badges: ContentBadge[],
  onUrlClick?: (url: string) => void,
  onFileClick?: (path: string) => void
): ReactNode {
  if (badges.length === 0) {
    return (
      <Markdown
        mode="minimal"
        onUrlClick={onUrlClick}
        onFileClick={onFileClick}
        className="text-sm [&_a]:underline [&_code]:bg-foreground/10"
      >
        {content}
      </Markdown>
    )
  }

  // Sort badges by start position
  const sortedBadges = [...badges].sort((a, b) => a.start - b.start)

  const elements: ReactNode[] = []
  let lastEnd = 0

  sortedBadges.forEach((badge, i) => {
    // Add text before this badge
    if (badge.start > lastEnd) {
      const textBefore = content.slice(lastEnd, badge.start)
      if (textBefore.trim()) {
        elements.push(
          <span key={`text-${i}`} className="whitespace-pre-wrap">
            {textBefore}
          </span>
        )
      }
    }

    // Add the badge
    elements.push(<InlineBadge key={`badge-${i}`} badge={badge} />)

    lastEnd = badge.end
  })

  // Add remaining text after last badge
  if (lastEnd < content.length) {
    const textAfter = content.slice(lastEnd)
    if (textAfter.trim()) {
      elements.push(
        <span key="text-end" className="whitespace-pre-wrap">
          {textAfter}
        </span>
      )
    }
  }

  // Use <p> to match Markdown's block-level line-height behavior
  return <p className="text-sm">{elements}</p>
}

export interface UserMessageBubbleProps {
  /** Message content (markdown supported) */
  content: string
  /** Additional className for the outer container */
  className?: string
  /** Callback when a URL is clicked */
  onUrlClick?: (url: string) => void
  /** Callback when a file path is clicked */
  onFileClick?: (path: string) => void
  /** Stored attachments (images, documents) */
  attachments?: StoredAttachment[]
  /** Content badges for inline display (sources, skills) */
  badges?: ContentBadge[]
  /** Whether the message is pending (shimmer animation) */
  isPending?: boolean
  /** Whether the message is queued (badge shown) */
  isQueued?: boolean
}

export function UserMessageBubble({
  content,
  className,
  onUrlClick,
  onFileClick,
  attachments,
  badges,
  isPending,
  isQueued,
}: UserMessageBubbleProps) {
  const hasAttachments = attachments && attachments.length > 0
  const hasBadges = badges && badges.length > 0

  return (
    <div className={cn("flex flex-col items-end gap-3 w-full", className)}>
      {/* Attachment preview row - stored attachments with thumbnails */}
      {hasAttachments && (
        <div className="flex gap-2 justify-end max-w-[80%] flex-wrap">
          {attachments!.map((att, i) => {
            const isImage = att.type === 'image'
            const hasThumbnail = !!att.thumbnailBase64

            return (
              <div
                key={att.id || i}
                className="shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => att.storedPath && onFileClick?.(att.storedPath)}
                title={`Click to open ${att.name}`}
              >
                {isImage ? (
                  /* IMAGE: Square thumbnail only */
                  <div className="h-14 w-14 rounded-[8px] overflow-hidden bg-background shadow-minimal">
                    {hasThumbnail ? (
                      <img
                        src={`data:image/png;base64,${att.thumbnailBase64}`}
                        alt={att.name}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center">
                        <FileTypeIcon type={att.type} mimeType={att.mimeType} className="h-5 w-5" />
                      </div>
                    )}
                  </div>
                ) : (
                  /* DOCUMENT: Bubble with thumbnail/icon + 2-line text */
                  <div className="flex items-center gap-2.5 rounded-[8px] bg-foreground/5 pl-1.5 pr-3 py-1.5">
                    <div className="h-11 w-8 rounded-[6px] overflow-hidden bg-background shadow-minimal flex items-center justify-center shrink-0">
                      {hasThumbnail ? (
                        <img
                          src={`data:image/png;base64,${att.thumbnailBase64}`}
                          alt={att.name}
                          className="h-full w-full object-cover object-top"
                        />
                      ) : (
                        <FileTypeIcon type={att.type} mimeType={att.mimeType} className="h-5 w-5" />
                      )}
                    </div>
                    <div className="flex flex-col min-w-0 max-w-[120px]">
                      <span className="text-xs font-medium line-clamp-2 break-all" title={att.name}>
                        {att.name}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {getFileTypeLabel(att.type, att.mimeType, att.name)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Text content bubble */}
      <div
        className={cn(
          "max-w-[80%] bg-foreground/5 rounded-[16px] px-5 py-3.5 break-words min-w-0 select-text [&_p]:m-0",
          isPending && "animate-shimmer"
        )}
      >
        {hasBadges
          ? renderContentWithBadges(content, badges!, onUrlClick, onFileClick)
          : (
            <Markdown
              mode="minimal"
              onUrlClick={onUrlClick}
              onFileClick={onFileClick}
              className="text-sm [&_a]:underline [&_code]:bg-foreground/10"
            >
              {content}
            </Markdown>
          )
        }
      </div>

      {/* Queued badge */}
      {isQueued && (
        <span className="text-[10px] text-muted-foreground bg-foreground/5 px-2 py-0.5 rounded-full">
          queued
        </span>
      )}
    </div>
  )
}
