import { useEffect, useState } from "react"

const MOBILE_MEDIA_QUERY = "(max-width: 768px)"

/**
 * Returns true when the viewport is at mobile width (≤ 768px).
 * Use for touch-ergonomic decisions (hide shortcuts, flatten nested menus, etc.).
 * Prefer container queries for panel-level layout — this is viewport-level only.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" ? window.matchMedia(MOBILE_MEDIA_QUERY).matches : false
  )

  useEffect(() => {
    const media = window.matchMedia(MOBILE_MEDIA_QUERY)
    const onChange = () => setIsMobile(media.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  return isMobile
}
