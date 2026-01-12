/**
 * PreferencesPage
 *
 * Form-based editor for stored user preferences (~/.craft-agent/preferences.json).
 * Features:
 * - Fixed input fields for known preferences (name, timezone, location, language)
 * - Free-form textarea for notes
 * - Auto-saves on change with debouncing
 */

import * as React from 'react'
import { useState, useEffect, useCallback, useRef } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@craft-agent/ui'
import type { DetailsPageMeta } from '@/lib/navigation-registry'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'preferences',
}

interface PreferencesFormState {
  name: string
  timezone: string
  language: string
  city: string
  country: string
  notes: string
}

const emptyFormState: PreferencesFormState = {
  name: '',
  timezone: '',
  language: '',
  city: '',
  country: '',
  notes: '',
}

// Parse JSON to form state
function parsePreferences(json: string): PreferencesFormState {
  try {
    const prefs = JSON.parse(json)
    return {
      name: prefs.name || '',
      timezone: prefs.timezone || '',
      language: prefs.language || '',
      city: prefs.location?.city || '',
      country: prefs.location?.country || '',
      notes: prefs.notes || '',
    }
  } catch {
    return emptyFormState
  }
}

// Serialize form state to JSON
function serializePreferences(state: PreferencesFormState): string {
  const prefs: Record<string, unknown> = {}

  if (state.name) prefs.name = state.name
  if (state.timezone) prefs.timezone = state.timezone
  if (state.language) prefs.language = state.language

  if (state.city || state.country) {
    const location: Record<string, string> = {}
    if (state.city) location.city = state.city
    if (state.country) location.country = state.country
    prefs.location = location
  }

  if (state.notes) prefs.notes = state.notes
  prefs.updatedAt = Date.now()

  return JSON.stringify(prefs, null, 2)
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3">
      {children}
    </h3>
  )
}

function FormField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="flex items-center gap-4 py-1.5">
      <Label className="w-20 text-sm text-muted-foreground shrink-0">
        {label}
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="flex-1 h-8 text-sm"
      />
    </div>
  )
}

export default function PreferencesPage() {
  const [formState, setFormState] = useState<PreferencesFormState>(emptyFormState)
  const [isLoading, setIsLoading] = useState(true)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isInitialLoadRef = useRef(true)
  const formStateRef = useRef(formState)
  const lastSavedRef = useRef<string | null>(null)

  // Keep formStateRef in sync for use in cleanup
  useEffect(() => {
    formStateRef.current = formState
  }, [formState])

  // Load stored user preferences on mount
  useEffect(() => {
    const load = async () => {
      try {
        const result = await window.electronAPI.readPreferences()
        const parsed = parsePreferences(result.content)
        setFormState(parsed)
        lastSavedRef.current = serializePreferences(parsed)
      } catch (err) {
        console.error('Failed to load stored user preferences:', err)
        setFormState(emptyFormState)
      } finally {
        setIsLoading(false)
        // Mark initial load as complete after a short delay
        setTimeout(() => {
          isInitialLoadRef.current = false
        }, 100)
      }
    }
    load()
  }, [])

  // Auto-save with debouncing
  useEffect(() => {
    // Skip auto-save during initial load
    if (isInitialLoadRef.current || isLoading) return

    // Clear any pending save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Debounce save by 500ms
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        const json = serializePreferences(formState)
        const result = await window.electronAPI.writePreferences(json)
        if (result.success) {
          lastSavedRef.current = json
        } else {
          console.error('Failed to save preferences:', result.error)
        }
      } catch (err) {
        console.error('Failed to save preferences:', err)
      }
    }, 500)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [formState, isLoading])

  // Force save on unmount if there are unsaved changes
  useEffect(() => {
    return () => {
      // Clear any pending debounced save
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }

      // Check if there are unsaved changes and save immediately
      const currentJson = serializePreferences(formStateRef.current)
      if (lastSavedRef.current !== currentJson && !isInitialLoadRef.current) {
        // Fire and forget - we can't await in cleanup
        window.electronAPI.writePreferences(currentJson).catch((err) => {
          console.error('Failed to save preferences on unmount:', err)
        })
      }
    }
  }, [])

  const updateField = useCallback(<K extends keyof PreferencesFormState>(
    field: K,
    value: PreferencesFormState[K]
  ) => {
    setFormState(prev => ({ ...prev, [field]: value }))
  }, [])

  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner className="text-lg text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-surface-below">
      <PanelHeader title="Preferences" className="bg-surface-below" />
      <Separator />
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6">
          {/* Basic Info */}
          <section>
            <SectionHeader>Basic Info</SectionHeader>
            <div className="space-y-1">
              <FormField
                label="Name"
                value={formState.name}
                onChange={(v) => updateField('name', v)}
                placeholder="Your name"
              />
              <FormField
                label="Timezone"
                value={formState.timezone}
                onChange={(v) => updateField('timezone', v)}
                placeholder="e.g., America/New_York"
              />
              <FormField
                label="Language"
                value={formState.language}
                onChange={(v) => updateField('language', v)}
                placeholder="e.g., English"
              />
            </div>
          </section>

          {/* Location */}
          <section>
            <SectionHeader>Location</SectionHeader>
            <div className="space-y-1">
              <FormField
                label="City"
                value={formState.city}
                onChange={(v) => updateField('city', v)}
                placeholder="e.g., New York"
              />
              <FormField
                label="Country"
                value={formState.country}
                onChange={(v) => updateField('country', v)}
                placeholder="e.g., USA"
              />
            </div>
          </section>

          {/* Notes */}
          <section>
            <SectionHeader>Notes</SectionHeader>
            <Textarea
              value={formState.notes}
              onChange={(e) => updateField('notes', e.target.value)}
              placeholder="Any additional information you'd like to share with the AI assistant..."
              className="min-h-[120px] text-sm resize-y"
            />
          </section>
        </div>
      </ScrollArea>
    </div>
  )
}
