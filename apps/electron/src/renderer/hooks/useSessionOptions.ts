/**
 * useSessionOptions - Unified session options management
 *
 * Consolidates all session-scoped settings (ultrathink, skipPermissions, modes)
 * into a single interface to reduce prop drilling and file changes when adding
 * new options.
 *
 * ADDING A NEW SESSION OPTION:
 * 1. Add field to SessionOptions interface below
 * 2. Update defaultSessionOptions
 * 3. Add UI control in FreeFormInput.tsx (or wherever needed)
 * That's it! No other files need changes.
 */

import { useCallback, useMemo } from 'react'
import type { Mode } from '../../shared/types'

/**
 * All session-scoped options in one place.
 * Add new options here - no other files need type changes.
 */
export interface SessionOptions {
  /** Extended thinking mode (single-shot per message) */
  ultrathinkEnabled: boolean
  /** Auto-approve all permission requests */
  skipPermissions: boolean
  /** Active operational modes (e.g., 'safe' for read-only exploration) */
  activeModes: Mode[]
}

/** Default values for new sessions */
export const defaultSessionOptions: SessionOptions = {
  ultrathinkEnabled: false,
  skipPermissions: false,
  activeModes: [],
}

/**
 * Type for partial updates to session options
 */
export type SessionOptionUpdates = Partial<SessionOptions>

/**
 * Hook to get and update options for a specific session.
 * Used by leaf components to avoid prop drilling.
 */
export function useSessionOptions(
  sessionId: string,
  allOptions: Map<string, SessionOptions>,
  onOptionsChange: (sessionId: string, updates: SessionOptionUpdates) => void
): {
  options: SessionOptions
  setOption: <K extends keyof SessionOptions>(key: K, value: SessionOptions[K]) => void
  setOptions: (updates: SessionOptionUpdates) => void
  // Convenience methods for common operations
  toggleUltrathink: () => void
  toggleSkipPermissions: () => void
  setMode: (mode: Mode, enabled: boolean) => void
  isModeActive: (mode: Mode) => boolean
} {
  // Get options for this session, falling back to defaults
  const options = useMemo(() => {
    return allOptions.get(sessionId) ?? defaultSessionOptions
  }, [allOptions, sessionId])

  // Set a single option
  const setOption = useCallback(<K extends keyof SessionOptions>(
    key: K,
    value: SessionOptions[K]
  ) => {
    onOptionsChange(sessionId, { [key]: value })
  }, [sessionId, onOptionsChange])

  // Set multiple options at once
  const setOptions = useCallback((updates: SessionOptionUpdates) => {
    onOptionsChange(sessionId, updates)
  }, [sessionId, onOptionsChange])

  // Convenience toggles
  const toggleUltrathink = useCallback(() => {
    setOption('ultrathinkEnabled', !options.ultrathinkEnabled)
  }, [options.ultrathinkEnabled, setOption])

  const toggleSkipPermissions = useCallback(() => {
    setOption('skipPermissions', !options.skipPermissions)
  }, [options.skipPermissions, setOption])

  // Mode management
  const setMode = useCallback((mode: Mode, enabled: boolean) => {
    const currentModes = options.activeModes
    if (enabled) {
      if (!currentModes.includes(mode)) {
        setOption('activeModes', [...currentModes, mode])
      }
    } else {
      setOption('activeModes', currentModes.filter(m => m !== mode))
    }
  }, [options.activeModes, setOption])

  const isModeActive = useCallback((mode: Mode) => {
    return options.activeModes.includes(mode)
  }, [options.activeModes])

  return {
    options,
    setOption,
    setOptions,
    toggleUltrathink,
    toggleSkipPermissions,
    setMode,
    isModeActive,
  }
}

/**
 * Helper to merge session options with updates
 */
export function mergeSessionOptions(
  current: SessionOptions | undefined,
  updates: SessionOptionUpdates
): SessionOptions {
  return {
    ...defaultSessionOptions,
    ...current,
    ...updates,
  }
}

