import { useEffect, useMemo, useState } from 'react'
import {
  resolveTheme,
  themeToCSS,
  DEFAULT_THEME,
  DEFAULT_SHIKI_THEME,
  getShikiTheme,
  type ThemeOverrides,
  type ThemeFile,
  type ShikiThemeConfig,
} from '@config/theme'
import { useTheme as useThemeContext } from '@/context/ThemeContext'
import log from '@/lib/logger'

const themeLog = log.scope('theme')

interface UseThemeOptions {
  /**
   * App-level theme override (from ~/.craft-agent/theme.json)
   */
  appTheme?: ThemeOverrides | null
}

interface UseThemeResult {
  theme: ThemeOverrides
  defaultTheme: ThemeOverrides
  shikiTheme: string
  shikiConfig: ShikiThemeConfig
  presetTheme: ThemeFile | null
  isDark: boolean
  /** Whether the theme is in scenic mode (background image with glass panels) */
  isScenic: boolean
}

/**
 * Hook to manage theme (preset → app override).
 * Resolves themes and injects CSS variables into document.
 * Also provides Shiki theme name for syntax highlighting.
 *
 * @example
 * ```tsx
 * const [appTheme] = useAtom(appThemeAtom)
 *
 * const { shikiTheme } = useTheme({ appTheme })
 * ```
 */
export function useTheme({ appTheme }: UseThemeOptions = {}): UseThemeResult {
  // Get resolved mode, system preference, and color theme from ThemeContext
  // Use effectiveColorTheme which includes hover preview state
  const { resolvedMode, systemPreference, colorTheme, effectiveColorTheme } = useThemeContext()
  const isDark = resolvedMode === 'dark'

  // Load preset theme when effectiveColorTheme changes
  // This allows hover preview to load and display themes immediately
  const [presetTheme, setPresetTheme] = useState<ThemeFile | null>(null)

  useEffect(() => {
    if (!effectiveColorTheme || effectiveColorTheme === 'default') {
      setPresetTheme(null)
      return
    }

    // Load preset theme via IPC (app-level)
    window.electronAPI?.loadPresetTheme?.(effectiveColorTheme).then((preset) => {
      setPresetTheme(preset?.theme ?? null)
    }).catch(() => {
      setPresetTheme(null)
    })
  }, [effectiveColorTheme])

  // Resolve theme (preset → app override)
  // Preset provides base, app theme.json can override
  const resolvedTheme = useMemo(() => {
    // First merge preset with app override, then apply resolveTheme for any final processing
    return resolveTheme(
      presetTheme ? { ...presetTheme, ...(appTheme ?? {}) } : (appTheme ?? undefined)
    )
  }, [presetTheme, appTheme])

  // Get Shiki theme configuration
  const shikiConfig = useMemo(() => {
    return presetTheme?.shikiTheme || DEFAULT_SHIKI_THEME
  }, [presetTheme])

  // Determine if theme is scenic mode (scenic themes force dark mode)
  const isScenic = useMemo(() => {
    return resolvedTheme.mode === 'scenic' && !!resolvedTheme.backgroundImage
  }, [resolvedTheme])

  // Scenic themes force dark mode for better contrast with background images
  const effectiveIsDark = isScenic ? true : isDark

  // SYNCHRONOUS dark class application for scenic mode AND dark-only themes
  // This must happen BEFORE any component renders to prevent flash of light mode.
  // Two cases require dark class:
  // 1. Scenic themes (background image) - always need dark for contrast
  // 2. Dark-only themes (supportedModes: ['dark']) - e.g., Ghostty, Dracula
  //
  // While preset is loading, we preserve existing dark state to prevent flash.
  if (typeof document !== 'undefined') {
    const hasDarkClass = document.documentElement.classList.contains('dark')
    const hasScenicAttr = document.documentElement.dataset.scenic === 'true'
    const hasThemeMismatchAttr = document.documentElement.dataset.themeMismatch === 'true'
    // Check if we're still loading a preset theme (colorTheme is set but presetTheme hasn't loaded)
    const isLoadingPreset = effectiveColorTheme && effectiveColorTheme !== 'default' && !presetTheme
    // Check if current preset is a dark-only theme (forces dark mode)
    const isDarkOnlyTheme = presetTheme?.supportedModes?.length === 1 && presetTheme.supportedModes[0] === 'dark'

    // [THEME-DEBUG] Log synchronous check
    themeLog.info(`useTheme SYNC: hasDarkClass=${hasDarkClass}, isScenic=${isScenic}, isDark=${isDark}, hasScenicAttr=${hasScenicAttr}, hasThemeMismatchAttr=${hasThemeMismatchAttr}, isLoadingPreset=${isLoadingPreset}, isDarkOnlyTheme=${isDarkOnlyTheme}`)

    if ((isScenic || isDarkOnlyTheme) && !hasDarkClass) {
      // Scenic mode or dark-only themes require dark class - add it synchronously
      themeLog.info('useTheme SYNC: Adding dark class for scenic/dark-only theme')
      document.documentElement.classList.add('dark')
    } else if (!isScenic && !isDarkOnlyTheme && !isDark && hasDarkClass && !hasScenicAttr && !hasThemeMismatchAttr && !isLoadingPreset) {
      // Only remove dark class if:
      // 1. Not scenic mode
      // 2. Not a dark-only theme
      // 3. User preference is light
      // 4. Dark class is currently set
      // 5. No data-scenic attribute (which would indicate scenic was active)
      // 6. No themeMismatch attribute (which would indicate dark-only theme was active)
      // 7. Not currently loading a preset (which might turn out to be scenic or dark-only)
      themeLog.info('useTheme SYNC: Removing dark class (not scenic/dark-only, user prefers light)')
      document.documentElement.classList.remove('dark')
    }
  }

  // Get the current Shiki theme name based on mode
  // If theme doesn't support current mode, use the mode it does support
  const shikiTheme = useMemo(() => {
    const supportedModes = presetTheme?.supportedModes
    const currentMode = effectiveIsDark ? 'dark' : 'light'

    // If theme has limited mode support and doesn't include current mode,
    // use the mode it does support for Shiki
    if (supportedModes && supportedModes.length > 0 && !supportedModes.includes(currentMode)) {
      // Use the first supported mode (e.g., dark-only theme uses dark shiki even in "light" mode)
      const effectiveMode = supportedModes[0] === 'dark'
      return getShikiTheme(shikiConfig, effectiveMode)
    }

    return getShikiTheme(shikiConfig, effectiveIsDark)
  }, [shikiConfig, effectiveIsDark, presetTheme])

  // Generate CSS and inject into document
  useEffect(() => {
    // [THEME-DEBUG] Log useEffect run
    const currentClass = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    themeLog.info(`useTheme useEffect START: currentClass=${currentClass}, isScenic=${isScenic}, effectiveIsDark=${effectiveIsDark}`)

    // Get or create style element
    const styleId = 'craft-theme-overrides'
    let styleEl = document.getElementById(styleId) as HTMLStyleElement | null

    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = styleId
      document.head.appendChild(styleEl)
    }

    // Always set theme-override for 50% opacity background (vibrancy effect)
    document.documentElement.dataset.themeOverride = 'true'

    // Check if we're still loading a preset theme (used for guarding attribute removal)
    const isLoadingPreset = effectiveColorTheme && effectiveColorTheme !== 'default' && !presetTheme

    // Handle themeMismatch - set solid background when:
    // 1. Theme doesn't support current mode (e.g., dark-only Dracula in light mode), OR
    // 2. Resolved mode differs from system preference (vibrancy mismatch)
    //
    // IMPORTANT: Don't remove themeMismatch while preset is loading!
    // During async preset load, supportedModes is undefined so we can't determine
    // if theme needs mismatch. Removing it causes light mode to bleed through.
    const supportedModes = presetTheme?.supportedModes
    const currentMode = isDark ? 'dark' : 'light'
    const themeModeUnsupported = supportedModes && supportedModes.length > 0 && !supportedModes.includes(currentMode)
    const vibrancyMismatch = resolvedMode !== systemPreference
    const hasThemeMismatchAttr = document.documentElement.dataset.themeMismatch === 'true'

    if (themeModeUnsupported || vibrancyMismatch) {
      document.documentElement.dataset.themeMismatch = 'true'
    } else if (!isLoadingPreset || !hasThemeMismatchAttr) {
      // Only remove if not loading a preset OR nothing to preserve
      // This prevents flash when switching tabs while preset loads
      delete document.documentElement.dataset.themeMismatch
    }
    // If isLoadingPreset && hasThemeMismatchAttr, preserve until preset loads

    // Set scenic mode data attribute for CSS targeting
    // Note: dark class is applied synchronously above (outside useEffect) to prevent flash
    //
    // IMPORTANT: Don't remove scenic attributes while preset is loading!
    // During async preset load, isScenic will be false temporarily even if the theme
    // being loaded IS scenic. Removing the background image causes a flash.
    const hasScenicAttr = document.documentElement.dataset.scenic === 'true'

    if (isScenic) {
      document.documentElement.dataset.scenic = 'true'
      // Set background image directly as CSS property (avoids style sheet size limits)
      if (resolvedTheme.backgroundImage) {
        document.documentElement.style.setProperty(
          '--background-image',
          `url("${resolvedTheme.backgroundImage}")`
        )
      }
    } else if (!isLoadingPreset || !hasScenicAttr) {
      // Only remove scenic attributes if:
      // 1. Not loading a preset (safe to clear), OR
      // 2. No scenic attr currently set (nothing to preserve)
      // This prevents flash when switching tabs while preset loads
      delete document.documentElement.dataset.scenic
      document.documentElement.style.removeProperty('--background-image')
    }
    // If isLoadingPreset && hasScenicAttr, we preserve the existing scenic state
    // until the preset finishes loading and we know the actual theme mode

    // When using default theme, clear custom CSS but keep theme-override and themeMismatch
    if (!effectiveColorTheme || effectiveColorTheme === 'default') {
      styleEl.textContent = ''
      return
    }

    // IMPORTANT: Skip CSS variable update while preset is loading!
    // During async load, resolvedTheme is empty/{} which would generate wrong/no CSS
    // variables, causing a flash to default dark mode colors. Preserve existing CSS
    // until preset finishes loading.
    if (isLoadingPreset) {
      return
    }

    // Generate CSS variable declarations (use effectiveIsDark for scenic mode)
    const cssVars = themeToCSS(resolvedTheme, effectiveIsDark)

    // Inject CSS variables on :root
    if (cssVars) {
      styleEl.textContent = `:root {\n  ${cssVars}\n}`
    } else {
      styleEl.textContent = ''
    }

  }, [resolvedTheme, isDark, effectiveIsDark, presetTheme, appTheme, effectiveColorTheme, resolvedMode, systemPreference, isScenic])

  return {
    theme: resolvedTheme,
    defaultTheme: DEFAULT_THEME,
    shikiTheme,
    shikiConfig,
    presetTheme,
    isDark: effectiveIsDark, // Scenic themes force dark mode
    isScenic,
  }
}
