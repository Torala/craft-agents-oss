/**
 * FullscreenOverlay - Fullscreen view for reading AI responses
 */

import { useState, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import { Check, Copy, ListTodo, X } from 'lucide-react'
import { cn } from '../../../lib/utils'
import { Markdown } from '../../markdown'

export interface FullscreenOverlayProps {
  /** The content to display (markdown) */
  content: string
  /** Whether the overlay is open */
  isOpen: boolean
  /** Called when overlay should close */
  onClose: () => void
  /** Variant: 'response' (default) or 'plan' (shows header) */
  variant?: 'response' | 'plan'
  /** Callback for URL clicks */
  onOpenUrl?: (url: string) => void
  /** Callback for file path clicks */
  onOpenFile?: (path: string) => void
}

export function FullscreenOverlay({
  content,
  isOpen,
  onClose,
  variant = 'response',
  onOpenUrl,
  onOpenFile,
}: FullscreenOverlayProps) {
  // Copy state
  const [copied, setCopied] = useState(false)

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  // Copy handler
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [content])

  if (!isOpen) return null

  return ReactDOM.createPortal(
    <div className="fixed inset-0 z-50 flex flex-col">
      {/* Fixed header buttons */}
      <div className="fixed top-4 right-4 z-[60] flex items-center gap-2 [-webkit-app-region:no-drag]">
        {/* Copy button */}
        <button
          onClick={handleCopy}
          className={cn(
            "p-[5px] rounded-[6px] transition-all",
            "bg-background shadow-minimal",
            copied ? "text-success" : "text-muted-foreground/50 hover:text-foreground",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
          title={copied ? "Copied!" : "Copy all"}
        >
          {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
        </button>

        {/* Close button */}
        <button
          onClick={onClose}
          className={cn(
            "p-1 rounded-[6px] transition-all",
            "bg-background shadow-minimal",
            "text-muted-foreground/50 hover:text-foreground",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          )}
          title="Close (Esc)"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Main scrollable area */}
      <div className="flex-1 min-h-0 bg-foreground-3 overflow-y-auto">
        <div className="min-h-full flex justify-center pt-16 px-6 pb-24">
          {/* Content card */}
          <div className="bg-background rounded-[16px] shadow-strong w-full max-w-[960px] h-fit">
            {/* Plan header (variant="plan" only) */}
            {variant === 'plan' && (
              <div className="px-4 py-2 border-b border-border/30 flex items-center gap-2 bg-success/5 rounded-t-[16px]">
                <ListTodo className="w-3 h-3 text-success" />
                <span className="text-[13px] font-medium text-success">Plan</span>
              </div>
            )}

            {/* Content area */}
            <div className="px-10 pt-8 pb-8">
              <div className="text-sm">
                <Markdown
                  mode="minimal"
                  onUrlClick={onOpenUrl}
                  onFileClick={onOpenFile}
                >
                  {content}
                </Markdown>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}
