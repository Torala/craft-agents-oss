/**
 * MermaidPreviewOverlay — fullscreen diagram preview with zoom and pan.
 *
 * Renders a pre-rendered mermaid SVG string in a zoomable/pannable viewport.
 * Uses CSS transforms for smooth zoom (mousewheel) and pan (click-drag).
 *
 * Zoom: Mousewheel zooms toward cursor position (multiplicative scaling,
 *       10% per step, range 25%–400%). Trackpad pinch-zoom also works.
 * Pan:  Click-drag moves the diagram. Uses window-level listeners so
 *       dragging outside the container still tracks.
 *
 * Header shows zoom percentage, reset button, and copy-code button.
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { GitGraph, RotateCcw } from 'lucide-react'
import { PreviewOverlay } from './PreviewOverlay'
import { CopyButton } from './CopyButton'

// Zoom constraints
const MIN_SCALE = 0.25
const MAX_SCALE = 4
// Multiplicative zoom factor per scroll notch — 10% in/out.
// Multiplicative feels consistent at all zoom levels.
const ZOOM_FACTOR = 1.1

export interface MermaidPreviewOverlayProps {
  isOpen: boolean
  onClose: () => void
  /** Pre-rendered SVG string from renderMermaid() */
  svg: string
  /** Original mermaid source code (for copy button) */
  code: string
}

export function MermaidPreviewOverlay({
  isOpen,
  onClose,
  svg,
  code,
}: MermaidPreviewOverlayProps) {
  const [scale, setScale] = useState(1)
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)

  // Refs for drag tracking — used in window event handlers to avoid stale closures.
  // The ref mirrors the state for use in the non-React event handlers (mousemove).
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ x: 0, y: 0 })
  const translateAtDragStartRef = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  // Reset zoom/pan state when overlay opens
  useEffect(() => {
    if (isOpen) {
      setScale(1)
      setTranslate({ x: 0, y: 0 })
    }
  }, [isOpen])

  const handleReset = useCallback(() => {
    setScale(1)
    setTranslate({ x: 0, y: 0 })
  }, [])

  // ── Zoom (mousewheel) ──────────────────────────────────────────────────
  // Attached via addEventListener with { passive: false } so we can call
  // preventDefault() to stop the scroll container from scrolling.
  // Uses updater functions for scale/translate to avoid stale closures.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const rect = container.getBoundingClientRect()
      // Cursor position relative to container center
      const cx = e.clientX - rect.left - rect.width / 2
      const cy = e.clientY - rect.top - rect.height / 2

      // Multiplicative zoom: scroll down = zoom out, scroll up = zoom in
      const factor = e.deltaY > 0 ? 1 / ZOOM_FACTOR : ZOOM_FACTOR

      setScale(prev => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor))
        const ratio = next / prev

        // Adjust translate so the point under the cursor stays fixed.
        // Math: screenPos = translate + elementPos * scale
        // We want the same screenPos (cx,cy) before and after zoom change.
        setTranslate(t => ({
          x: cx - ratio * (cx - t.x),
          y: cy - ratio * (cy - t.y),
        }))

        return next
      })
    }

    container.addEventListener('wheel', handleWheel, { passive: false })
    return () => container.removeEventListener('wheel', handleWheel)
  }, [])

  // ── Pan (click-drag) ───────────────────────────────────────────────────
  // Mousedown on the container starts tracking. Mousemove/mouseup on window
  // so dragging outside the container still works.

  // Start drag — captures current translate via updater to avoid stale state
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return // left click only
    e.preventDefault()
    isDraggingRef.current = true
    setIsDragging(true)
    dragStartRef.current = { x: e.clientX, y: e.clientY }
    // Read current translate via updater function (always latest value)
    setTranslate(t => {
      translateAtDragStartRef.current = { x: t.x, y: t.y }
      return t // no change
    })
  }

  // Global mousemove/mouseup listeners for drag tracking
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return
      setTranslate({
        x: translateAtDragStartRef.current.x + (e.clientX - dragStartRef.current.x),
        y: translateAtDragStartRef.current.y + (e.clientY - dragStartRef.current.y),
      })
    }

    const handleMouseUp = () => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        setIsDragging(false)
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [])

  // ── Header actions ─────────────────────────────────────────────────────

  const isDefaultView = scale === 1 && translate.x === 0 && translate.y === 0
  const zoomPercent = Math.round(scale * 100)

  const headerActions = (
    <div className="flex items-center gap-2">
      <span className="text-sm text-muted-foreground min-w-[3rem] text-center tabular-nums">
        {zoomPercent}%
      </span>
      <button
        onClick={handleReset}
        disabled={isDefaultView}
        className="p-1 rounded hover:bg-foreground/5 disabled:opacity-30 disabled:cursor-not-allowed"
        title="Reset zoom"
      >
        <RotateCcw className="w-4 h-4" />
      </button>
      <div className="w-px h-4 bg-foreground/10 mx-1" />
      <CopyButton content={code} title="Copy code" />
    </div>
  )

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <PreviewOverlay
      isOpen={isOpen}
      onClose={onClose}
      typeBadge={{
        icon: GitGraph,
        label: 'Diagram',
        variant: 'purple',
      }}
      title="Mermaid Diagram"
      headerActions={headerActions}
    >
      {/* Zoom/pan viewport — fills the overlay content area.
          overflow:hidden clips the SVG when zoomed; cursor indicates drag capability. */}
      <div
        ref={containerRef}
        className="min-h-full flex items-center justify-center select-none"
        onMouseDown={handleMouseDown}
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          overflow: 'hidden',
        }}
      >
        {/* SVG container — CSS transform handles zoom and pan.
            transformOrigin is center so scale expands equally in all directions. */}
        <div
          dangerouslySetInnerHTML={{ __html: svg }}
          style={{
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: 'center center',
          }}
        />
      </div>
    </PreviewOverlay>
  )
}
