import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'

/**
 * Fixed header with scroll-aware styling.
 * - Transparent background when at top of page
 * - Blurred translucent background when scrolled
 */
export function Header() {
  const [isScrolled, setIsScrolled] = useState(false)

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 0)
    }

    // Check initial scroll position
    handleScroll()

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-40 transition-all duration-200 ${
        isScrolled
          ? 'bg-foreground-2/80 backdrop-blur-md'
          : 'bg-transparent'
      }`}
    >
      <div className="w-full px-6 py-4 flex items-center justify-between">
        {/* Logo - duplicated from favicon.svg to avoid accidental mismatches */}
        <Link to="/" className="flex items-center">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <g transform="translate(3.4502, 3)" fill="#9570BE">
              <path
                d="M3.17890888,3.6 L3.17890888,0 L16,0 L16,3.6 L3.17890888,3.6 Z M9.642,7.2 L9.64218223,10.8 L0,10.8 L0,3.6 L16,3.6 L16,7.2 L9.642,7.2 Z M3.17890888,18 L3.178,14.4 L0,14.4 L0,10.8 L16,10.8 L16,18 L3.17890888,18 Z"
                fillRule="nonzero"
              />
            </g>
          </svg>
        </Link>

        {/* Navigation links */}
        <nav className="flex items-center gap-6 text-sm font-medium">
          <Link to="/blog" className="text-foreground hover:underline">Blog</Link>
          <a
            href="/docs"
            className="text-foreground hover:underline"
          >
            Documentation
          </a>
        </nav>
      </div>
    </header>
  )
}
