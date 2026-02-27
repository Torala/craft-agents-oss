/**
 * BrowserToolbar
 *
 * Navigation bar for the browser pane with back/forward/reload buttons
 * and a URL input field.
 */

import { useState, useCallback, useRef, useEffect } from 'react'
import * as Icons from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@craft-agent/ui'
import type { BrowserInstanceInfo } from '../../../shared/types'

interface BrowserToolbarProps {
  instanceInfo: BrowserInstanceInfo | null
  onNavigate: (url: string) => void
  onGoBack: () => void
  onGoForward: () => void
  onReload: () => void
  onStop: () => void
  compact?: boolean
}

export function BrowserToolbar({
  instanceInfo,
  onNavigate,
  onGoBack,
  onGoForward,
  onReload,
  onStop,
  compact = false,
}: BrowserToolbarProps) {
  const [urlInput, setUrlInput] = useState('')
  const [isFocused, setIsFocused] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync URL input with current page URL (when not focused)
  useEffect(() => {
    if (!isFocused && instanceInfo?.url) {
      setUrlInput(instanceInfo.url === 'about:blank' ? '' : instanceInfo.url)
    }
  }, [instanceInfo?.url, isFocused])

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault()
    if (urlInput.trim()) {
      onNavigate(urlInput.trim())
      inputRef.current?.blur()
    }
  }, [urlInput, onNavigate])

  const handleFocus = useCallback(() => {
    setIsFocused(true)
    // Select all text on focus for easy replacement
    setTimeout(() => inputRef.current?.select(), 0)
  }, [])

  const handleBlur = useCallback(() => {
    setIsFocused(false)
  }, [])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // Reset to current URL and blur
      if (instanceInfo?.url) {
        setUrlInput(instanceInfo.url === 'about:blank' ? '' : instanceInfo.url)
      }
      inputRef.current?.blur()
    }
  }, [instanceInfo?.url])

  const canGoBack = instanceInfo?.canGoBack ?? false
  const canGoForward = instanceInfo?.canGoForward ?? false
  const isLoading = instanceInfo?.isLoading ?? false

  return (
    <div className={compact
      ? 'flex items-center gap-1 px-1.5 py-0.5 rounded-[8px] border border-foreground/10 bg-background/70 min-w-0'
      : 'flex items-center gap-1 px-2 py-1.5 border-b border-border bg-background/80'}>
      {/* Navigation buttons */}
      <div className="flex items-center gap-0.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onGoBack}
              disabled={!canGoBack}
              className="p-1 rounded hover:bg-foreground/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Go back"
            >
              <Icons.ChevronLeft className="h-4 w-4 text-foreground/70" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Back</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onGoForward}
              disabled={!canGoForward}
              className="p-1 rounded hover:bg-foreground/5 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              aria-label="Go forward"
            >
              <Icons.ChevronRight className="h-4 w-4 text-foreground/70" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">Forward</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={isLoading ? onStop : onReload}
              className="p-1 rounded hover:bg-foreground/5 transition-colors"
              aria-label={isLoading ? 'Stop loading' : 'Reload'}
            >
              {isLoading ? (
                <Icons.X className="h-4 w-4 text-foreground/70" />
              ) : (
                <Icons.RotateCw className="h-3.5 w-3.5 text-foreground/70" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{isLoading ? 'Stop' : 'Reload'}</TooltipContent>
        </Tooltip>
      </div>

      {/* URL bar */}
      <form onSubmit={handleSubmit} className="flex-1 min-w-0">
        <div className="relative">
          <input
            ref={inputRef}
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            placeholder="Enter URL or search..."
            className={compact
              ? 'w-full h-[28px] px-3 pl-8 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-[13px] text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50 focus:bg-background transition-colors'
              : 'w-full h-[30px] px-3 pl-8 rounded-lg border border-foreground/10 bg-foreground/[0.03] text-[13px] text-foreground placeholder:text-foreground/30 focus:outline-none focus:border-accent/50 focus:bg-background transition-colors'}
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
          {isLoading ? (
            <Icons.Loader2 className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/30 animate-spin" />
          ) : (
            <Icons.Globe className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-foreground/30" />
          )}
        </div>
      </form>
    </div>
  )
}
